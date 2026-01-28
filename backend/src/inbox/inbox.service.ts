import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InboxStorageService } from './storage/inbox-storage.service';
import { CryptoService } from '../crypto/crypto.service';
import { Inbox, StoredEmail, isEncryptedEmail } from './interfaces';
import { randomBytes, createHash } from 'crypto';
import { MetricsService } from '../metrics/metrics.service';
import { METRIC_PATHS } from '../metrics/metrics.constants';
import { ChaosService } from '../chaos/chaos.service';
import {
  DEFAULT_LOCAL_INBOX_ALIAS_RANDOM_BYTES,
  DEFAULT_LOCAL_INBOX_MAX_TTL,
  DEFAULT_LOCAL_INBOX_TTL,
  MAX_INBOX_ALIAS_RANDOM_BYTES,
  MIN_INBOX_ALIAS_RANDOM_BYTES,
  EncryptionPolicy,
} from '../config/config.constants';
import { ServerInfoResponseDto } from './dto/response.dto';
import { serializeEncryptedPayload, SerializedEncryptedPayload } from '../crypto/serialization';
import { getErrorMessage } from '../shared/error.utils';

// Response types for email endpoints - discriminated unions for encrypted vs plain emails
interface EncryptedEmailListItem {
  id: string;
  isRead: boolean;
  encryptedMetadata: SerializedEncryptedPayload;
  encryptedParsed?: SerializedEncryptedPayload;
}

interface PlainEmailListItem {
  id: string;
  isRead: boolean;
  metadata: string; // Base64
  parsed?: string; // Base64
}

export type EmailListItemResponse = EncryptedEmailListItem | PlainEmailListItem;

interface EncryptedEmailDetail {
  id: string;
  isRead: boolean;
  encryptedMetadata: SerializedEncryptedPayload;
  encryptedParsed: SerializedEncryptedPayload;
}

interface PlainEmailDetail {
  id: string;
  isRead: boolean;
  metadata: string; // Base64
  parsed: string; // Base64
}

export type EmailDetailResponse = EncryptedEmailDetail | PlainEmailDetail;

interface EncryptedRawEmail {
  id: string;
  encryptedRaw: SerializedEncryptedPayload;
}

interface PlainRawEmail {
  id: string;
  raw: string; // Base64
}

export type RawEmailResponse = EncryptedRawEmail | PlainRawEmail;

// Expected length for ML-KEM-768 public key is 1184 bytes
const MIN_EXPECTED_KEM_PK_BYTES = 1100;
const MAX_EXPECTED_KEM_PK_BYTES = 1300;

const ALGORITHMS = {
  kem: 'ML-KEM-768',
  sig: 'ML-DSA-65',
  aead: 'AES-256-GCM',
  kdf: 'HKDF-SHA-512',
};

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);
  private readonly defaultTtl: number;
  private readonly maxTtl: number;
  private readonly sseConsole: boolean;
  private readonly allowClearAllInboxes: boolean;
  private readonly allowedDomain: string;
  private readonly aliasRandomBytes: number;
  private readonly emailAuthInboxDefault: boolean;
  private readonly spamAnalysisInboxDefault: boolean;
  private readonly chaosEnabled: boolean;

  /**
   * Constructor
   */
  /* v8 ignore next 7 - false positive on constructor parameter properties */
  constructor(
    private readonly storageService: InboxStorageService,
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly chaosService?: ChaosService,
  ) {
    this.defaultTtl = this.configService.get<number>('vsb.local.inboxDefaultTtl', DEFAULT_LOCAL_INBOX_TTL);
    this.maxTtl = this.configService.get<number>('vsb.local.inboxMaxTtl', DEFAULT_LOCAL_INBOX_MAX_TTL);
    this.sseConsole = this.configService.get<boolean>('vsb.sseConsole.enabled', false);
    this.allowClearAllInboxes = this.configService.get<boolean>('vsb.local.allowClearAllInboxes', true);
    this.emailAuthInboxDefault = this.configService.get<boolean>('vsb.emailAuth.inboxDefault', true);
    this.spamAnalysisInboxDefault = this.configService.get<boolean>('vsb.spamAnalysis.inboxDefault', true);
    const configuredRandomBytes = this.configService.get<number>(
      'vsb.local.inboxAliasRandomBytes',
      DEFAULT_LOCAL_INBOX_ALIAS_RANDOM_BYTES,
    );
    const clampedRandomBytes = Math.min(
      Math.max(configuredRandomBytes, MIN_INBOX_ALIAS_RANDOM_BYTES),
      MAX_INBOX_ALIAS_RANDOM_BYTES,
    );
    this.aliasRandomBytes = Number.isFinite(clampedRandomBytes)
      ? clampedRandomBytes
      : DEFAULT_LOCAL_INBOX_ALIAS_RANDOM_BYTES;

    // Get first allowed domain for default inbox email addresses
    const domains = this.getAllowedDomains();
    this.allowedDomain = domains[0];

    // Check if chaos engineering is enabled
    this.chaosEnabled = this.configService.get<boolean>('vsb.chaos.enabled', false);

    this.logger.log(
      `InboxService initialized: defaultTTL=${this.defaultTtl}s, maxTTL=${this.maxTtl}s, domain=${this.allowedDomain}, aliasRandomBytes=${this.aliasRandomBytes}, emailAuthDefault=${this.emailAuthInboxDefault}, chaosEnabled=${this.chaosEnabled}`,
    );
  }

  /**
   * Create a new inbox with specified or random email address
   *
   * @param clientKemPk - Base64URL-encoded ML-KEM-768 public key (required for encrypted inboxes)
   * @param ttl - Optional time-to-live in seconds
   * @param emailAddress - Optional email address or domain:
   *   - If null/undefined: Generate random email with first allowed domain
   *   - If domain only (e.g., "mydomain.com"): Generate random email with that domain
   *   - If full email (e.g., "alias@mydomain.com"): Use that email if available,
   *     otherwise generate random email with the same domain
   * @param encryption - Optional encryption preference ('encrypted' | 'plain')
   * @param emailAuth - Optional email authentication preference (default: config value)
   * @param spamAnalysis - Optional spam analysis preference (default: config value)
   * @param chaos - Optional chaos configuration (only processed if VSB_CHAOS_ENABLED=true)
   */
  createInbox(
    clientKemPk?: string,
    ttl?: number,
    emailAddress?: string,
    encryption?: 'encrypted' | 'plain',
    emailAuth?: boolean,
    spamAnalysis?: boolean,

    chaos?: Record<string, any>,
  ): { inbox: Inbox; serverSigPk?: string } {
    // 1. Determine effective encryption state using server policy and inbox preference
    const policy = this.configService.get<EncryptionPolicy>('vsb.crypto.encryptionPolicy', EncryptionPolicy.ENABLED);
    const encrypted = this.resolveEncryptionState(policy, encryption);

    // 2. Validate clientKemPk requirement
    if (encrypted && !clientKemPk) {
      throw new BadRequestException('clientKemPk is required when encryption is enabled');
    }

    // 3. Validate client KEM public key format if provided
    if (clientKemPk) {
      if (!this.isValidBase64Url(clientKemPk)) {
        throw new BadRequestException('Invalid clientKemPk format (must be Base64URL)');
      }

      // Base64URL encoding: (1184 * 4) / 3 ≈ 1579 characters
      const decodedLength = this.estimateBase64UrlLength(clientKemPk);
      if (decodedLength < MIN_EXPECTED_KEM_PK_BYTES || decodedLength > MAX_EXPECTED_KEM_PK_BYTES) {
        throw new BadRequestException(`Invalid clientKemPk length (expected ~1184 bytes for ML-KEM-768)`);
      }

      // Log warning if clientKemPk provided but will be ignored (server never mode or plain requested)
      if (!encrypted) {
        this.logger.warn(`clientKemPk provided but encryption is disabled; key will be ignored`);
      }
    }

    // Validate and normalize TTL
    const effectiveTtl = this.validateTtl(ttl);

    // Determine the email address to use (may strip +tag portion)
    let finalEmailAddress = this.resolveEmailAddress(emailAddress);

    // Check for collision and handle iteratively
    let retries = 0;
    const maxRetries = 10; // Safety break
    while (this.storageService.inboxExists(finalEmailAddress) && retries < maxRetries) {
      this.logger.warn(`Email address collision: ${finalEmailAddress}, generating random alternative`);
      const domain = finalEmailAddress.split('@')[1];
      finalEmailAddress = this.generateEmailAddressWithDomain(domain);
      retries++;
    }

    // If we still have a collision after retries, something is wrong
    if (this.storageService.inboxExists(finalEmailAddress)) {
      this.logger.error(`Failed to generate a unique email address after ${maxRetries} retries.`);
      throw new InternalServerErrorException('Failed to generate a unique email address.');
    }

    // Calculate expiration time
    const expiresAt = new Date(Date.now() + effectiveTtl * 1000);

    // Derive inbox hash from appropriate source
    const inboxHash = this.deriveInboxHash(
      encrypted ? clientKemPk : undefined,
      encrypted ? undefined : finalEmailAddress,
    );

    // Determine effective emailAuth value (use provided value or default from config)
    const effectiveEmailAuth = emailAuth ?? this.emailAuthInboxDefault;

    // Determine effective spamAnalysis value (use provided value or default from config)
    const effectiveSpamAnalysis = spamAnalysis ?? this.spamAnalysisInboxDefault;

    // Normalize chaos config (only if chaos is globally enabled)
    const normalizedChaos =
      this.chaosEnabled && chaos && this.chaosService ? this.chaosService.normalizeConfig(chaos) : undefined;

    // Create inbox with encryption, emailAuth, spamAnalysis, and chaos flags
    const inbox = this.storageService.createInbox(
      finalEmailAddress,
      encrypted ? clientKemPk : undefined,
      expiresAt,
      inboxHash,
      encrypted,
      effectiveEmailAuth,
      effectiveSpamAnalysis,
      normalizedChaos,
    );

    // Get server signing public key (only for encrypted inboxes)
    const serverSigPk = encrypted ? this.cryptoService.getServerSigningPublicKey() : undefined;

    // Log inbox creation (with note if +tag was stripped)
    const requestedEmail = emailAddress?.trim().toLowerCase();
    if (requestedEmail && requestedEmail !== finalEmailAddress && requestedEmail.includes('+')) {
      this.logger.log(
        `Inbox created email=${inbox.emailAddress} hash=${inbox.inboxHash} encrypted=${encrypted} emailAuth=${effectiveEmailAuth} (requested: ${requestedEmail}, auto-aliasing enabled)`,
      );
    } else {
      this.logger.log(
        `Inbox created email=${inbox.emailAddress} hash=${inbox.inboxHash} encrypted=${encrypted} emailAuth=${effectiveEmailAuth}`,
      );
    }

    this.metricsService.increment(METRIC_PATHS.INBOX_CREATED_TOTAL);
    this.updateActiveInboxMetric();
    return { inbox, serverSigPk };
  }

  /**
   * Resolve effective encryption state from server policy and inbox preference.
   * Locked policies (ALWAYS/NEVER) ignore inbox preference.
   */
  private resolveEncryptionState(policy: EncryptionPolicy, inboxPreference?: 'encrypted' | 'plain'): boolean {
    switch (policy) {
      case EncryptionPolicy.ALWAYS:
        return true;
      case EncryptionPolicy.NEVER:
        return false;
      case EncryptionPolicy.ENABLED:
        return inboxPreference !== 'plain';
      case EncryptionPolicy.DISABLED:
        return inboxPreference === 'encrypted';
    }
  }

  /**
   * Get inbox by email address
   */
  getInboxByEmail(emailAddress: string): Inbox | undefined {
    return this.storageService.getInbox(emailAddress);
  }

  /**
   * Get inbox by derived hash
   */
  getInboxByHash(inboxHash: string): Inbox | undefined {
    return this.storageService.getInboxByHash(inboxHash);
  }

  /**
   * List all inbox hashes (local mode proxy for "owned" inboxes)
   */
  listInboxHashes(): string[] {
    return this.storageService.listInboxHashes();
  }

  /**
   * Delete inbox
   */
  deleteInbox(emailAddress: string): boolean {
    const inbox = this.storageService.getInbox(emailAddress);
    const deleted = this.storageService.deleteInbox(emailAddress);

    if (inbox && deleted) {
      this.metricsService.increment(METRIC_PATHS.INBOX_DELETED_TOTAL);
      this.updateActiveInboxMetric();
    }

    return deleted;
  }

  /**
   * Delete a specific email
   */
  deleteEmail(emailAddress: string, emailId: string): boolean {
    // Get inbox for event emission before deletion
    const inbox = this.storageService.getInbox(emailAddress);
    const deleted = this.storageService.deleteEmail(emailAddress, emailId);

    // Emit webhook event for email deletion
    if (deleted && inbox) {
      try {
        this.eventEmitter.emit('email.deleted', {
          emailId,
          inboxHash: inbox.inboxHash,
          inboxEmail: emailAddress.toLowerCase(),
          reason: 'manual',
        });
        /* v8 ignore start - defensive error handling */
      } catch (error) {
        const message = getErrorMessage(error);
        this.logger.error(`Failed to emit email.deleted event: ${message}`);
      }
      /* v8 ignore stop */
    }

    return deleted;
  }

  /**
   * Remove every inbox
   */
  clearAllInboxes(): number {
    if (!this.allowClearAllInboxes) {
      throw new ForbiddenException('Clear all inboxes is disabled (VSB_LOCAL_ALLOW_CLEAR_ALL_INBOXES=false)');
    }

    const removed = this.storageService.clearAllInboxes();
    if (removed > 0) {
      this.metricsService.increment(METRIC_PATHS.INBOX_DELETED_TOTAL, removed);
    }
    this.updateActiveInboxMetric();
    return removed;
  }

  /**
   * Add encrypted email to inbox
   */
  addEmail(emailAddress: string, email: StoredEmail): void {
    this.storageService.addEmail(emailAddress, email);
  }

  // Serialize a single email for list response (handles both encrypted and plain)
  private serializeEmailListItem(email: StoredEmail, includeContent: boolean): EmailListItemResponse {
    if (isEncryptedEmail(email)) {
      return {
        id: email.id,
        isRead: email.isRead,
        encryptedMetadata: serializeEncryptedPayload(email.encryptedMetadata),
        ...(includeContent && {
          encryptedParsed: serializeEncryptedPayload(email.encryptedParsed),
        }),
      };
    } else {
      return {
        id: email.id,
        isRead: email.isRead,
        metadata: Buffer.from(email.metadata).toString('base64'),
        ...(includeContent && {
          parsed: Buffer.from(email.parsed).toString('base64'),
        }),
      };
    }
  }

  /**
   * Get all emails for an inbox (metadata only, or with content if includeContent=true)
   * Serializes binary payloads to Base64/Base64URL for API response
   */
  getEmails(emailAddress: string, includeContent = false): EmailListItemResponse[] {
    const emails = this.storageService.getEmails(emailAddress);
    return emails.map((email) => this.serializeEmailListItem(email, includeContent));
  }

  /**
   * Get a specific email (parsed data only, without raw content)
   * Serializes binary payloads to Base64/Base64URL for API response
   */
  getEmail(emailAddress: string, emailId: string): EmailDetailResponse {
    const email = this.storageService.getEmail(emailAddress, emailId);

    if (isEncryptedEmail(email)) {
      return {
        id: email.id,
        isRead: email.isRead,
        encryptedMetadata: serializeEncryptedPayload(email.encryptedMetadata),
        encryptedParsed: serializeEncryptedPayload(email.encryptedParsed),
      };
    } else {
      return {
        id: email.id,
        isRead: email.isRead,
        metadata: Buffer.from(email.metadata).toString('base64'),
        parsed: Buffer.from(email.parsed).toString('base64'),
      };
    }
  }

  /**
   * Get raw email content only
   * Serializes binary payload to Base64/Base64URL for API response
   */
  getRawEmail(emailAddress: string, emailId: string): RawEmailResponse {
    const email = this.storageService.getEmail(emailAddress, emailId);

    if (isEncryptedEmail(email)) {
      return {
        id: email.id,
        encryptedRaw: serializeEncryptedPayload(email.encryptedRaw),
      };
    } else {
      return {
        id: email.id,
        raw: Buffer.from(email.raw).toString('base64'),
      };
    }
  }

  /**
   * Mark an email as read
   */
  markEmailAsRead(emailAddress: string, emailId: string): void {
    this.storageService.markEmailAsRead(emailAddress, emailId);
  }

  /**
   * Get server cryptographic information
   */
  getServerInfo(): ServerInfoResponseDto {
    const encryptionPolicy = this.configService.get<EncryptionPolicy>(
      'vsb.crypto.encryptionPolicy',
      EncryptionPolicy.ALWAYS,
    );
    const webhookEnabled = this.configService.get<boolean>('vsb.webhook.enabled', true);
    const webhookRequireAuthDefault = this.configService.get<boolean>('vsb.webhook.requireAuthDefault', false);
    const spamAnalysisEnabled = this.configService.get<boolean>('vsb.spamAnalysis.enabled', false);

    return {
      serverSigPk: this.cryptoService.getServerSigningPublicKey(),
      algs: ALGORITHMS,
      context: 'vaultsandbox:email:v1',
      maxTtl: this.maxTtl,
      defaultTtl: this.defaultTtl,
      sseConsole: this.sseConsole,
      allowClearAllInboxes: this.allowClearAllInboxes,
      allowedDomains: this.getAllowedDomains(),
      encryptionPolicy,
      webhookEnabled,
      webhookRequireAuthDefault,
      spamAnalysisEnabled,
      chaosEnabled: this.chaosEnabled,
    };
  }

  /**
   * Validate TTL and apply limits
   */
  private validateTtl(ttl?: number): number {
    if (ttl === undefined || ttl === null) {
      return this.defaultTtl;
    }

    if (ttl < 60) {
      throw new BadRequestException('TTL must be at least 60 seconds');
    }

    if (ttl > this.maxTtl) {
      throw new BadRequestException(`TTL cannot exceed ${this.maxTtl} seconds`);
    }

    return ttl;
  }

  /**
   * Generate random email address
   * Format: random hex string (configurable length) + domain
   */
  private generateEmailAddress(): string {
    const randomHex = randomBytes(this.aliasRandomBytes).toString('hex');
    // Always return lowercase for consistent storage and lookups
    return `${randomHex}@${this.allowedDomain}`.toLowerCase();
  }

  /**
   * Resolve the final email address based on client input
   *
   * @param emailAddress - Optional email or domain from client
   * @returns Final email address to use (always lowercase)
   */
  private resolveEmailAddress(emailAddress?: string): string {
    if (!emailAddress) {
      // Case 1: No input - generate random email with first allowed domain
      return this.generateEmailAddress();
    }

    const normalized = emailAddress.trim().toLowerCase();

    // Check if input contains '@' (full email vs domain-only)
    if (normalized.includes('@')) {
      // Case 2: Full email provided (e.g., "myalias@mydomain.com")
      const [localPart, domain] = normalized.split('@');

      // Validate domain is allowed
      if (!this.isDomainAllowed(domain)) {
        throw new BadRequestException(`Domain is not allowed`);
      }

      // Check for multiple + signs (not allowed)
      const plusCount = (localPart.match(/\+/g) || []).length;
      if (plusCount > 1) {
        throw new BadRequestException(
          `Invalid email local part: "${localPart}". Only one plus sign (+) is allowed for aliasing.`,
        );
      }

      // If local part contains a + sign, strip it for the base inbox
      // E.g., test123+tag@domain.com becomes test123@domain.com
      const baseLocalPart = localPart.includes('+') ? localPart.split('+')[0] : localPart;

      // Validate the base local part (without +tag)
      if (!this.isValidLocalPart(baseLocalPart)) {
        throw new BadRequestException(
          `Invalid email local part: "${baseLocalPart}". Must contain only alphanumeric characters, dots, hyphens, and underscores.`,
        );
      }

      // Return the base email (with +tag stripped)
      return `${baseLocalPart}@${domain}`;
    } else {
      // Case 3: Domain only provided (e.g., "mydomain.com")
      const domain = normalized;

      // Validate domain is allowed
      if (!this.isDomainAllowed(domain)) {
        throw new BadRequestException(`Domain is not allowed`);
      }

      // Generate random email with specified domain
      return this.generateEmailAddressWithDomain(domain);
    }
  }

  /**
   * Generate random email address with specific domain
   * Format: random hex string (configurable length) + domain
   */
  private generateEmailAddressWithDomain(domain: string): string {
    const randomHex = randomBytes(this.aliasRandomBytes).toString('hex');
    return `${randomHex}@${domain.toLowerCase()}`;
  }

  /**
   * Check if domain is in allowed domains list
   */
  private isDomainAllowed(domain: string): boolean {
    const allowedDomains = this.getAllowedDomains();
    return allowedDomains.includes(domain.toLowerCase());
  }

  /**
   * Validate email local part (part before @)
   * Allows: alphanumeric, dots, hyphens, underscores
   * Does not allow: leading/trailing dots, consecutive dots, special chars
   *
   * Note: This validates the base local part (without +tag portion).
   * Plus signs are handled separately in resolveEmailAddress.
   */
  private isValidLocalPart(localPart: string): boolean {
    // Basic validation - adjust regex as needed for your requirements
    const localPartRegex = /^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/;

    // Additional checks
    if (localPart.includes('..')) return false; // No consecutive dots
    if (localPart.startsWith('.') || localPart.endsWith('.')) return false; // No leading/trailing dots

    return localPartRegex.test(localPart);
  }

  /**
   * Check if string is valid Base64URL
   */
  private isValidBase64Url(str: string): boolean {
    return /^[A-Za-z0-9_-]+$/.test(str);
  }

  /**
   * Estimate decoded length of Base64URL string
   */
  private estimateBase64UrlLength(str: string): number {
    // Base64 encoding: 4 chars represent 3 bytes
    // Remove padding to get accurate length
    return Math.floor((str.length * 3) / 4);
  }

  /**
   * Derive a stable inbox hash.
   * - Encrypted inboxes: SHA-256 of clientKemPk (existing behavior)
   * - Plain inboxes: SHA-256 of "plain:" + email (prefixed to avoid collision)
   */
  private deriveInboxHash(clientKemPk?: string, emailAddress?: string): string {
    if (clientKemPk) {
      return createHash('sha256').update(Buffer.from(clientKemPk, 'base64url')).digest('base64url');
    }
    if (emailAddress) {
      return createHash('sha256').update(`plain:${emailAddress.toLowerCase()}`).digest('base64url');
    }
    /* v8 ignore next 2 - defensive: createInbox always provides one of clientKemPk or emailAddress */
    throw new Error('Either clientKemPk or emailAddress must be provided for hash derivation');
  }

  /**
   * Get all allowed domains from configuration
   */
  private getAllowedDomains(): string[] {
    return this.configService.get<string[]>('vsb.smtp.allowedRecipientDomains', ['vaultsandbox.test']);
  }

  /**
   * Update and log the current number of active inboxes
   */
  private updateActiveInboxMetric(): number {
    const activeInboxes = this.storageService.getInboxCount();
    this.metricsService.set(METRIC_PATHS.INBOX_ACTIVE_TOTAL, activeInboxes);
    this.logger.log(`Active inboxes: ${activeInboxes}`);
    return activeInboxes;
  }
}
