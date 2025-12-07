import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InboxStorageService } from './storage/inbox-storage.service';
import { CryptoService } from '../crypto/crypto.service';
import { Inbox, EncryptedEmail } from './interfaces';
import { randomBytes, createHash } from 'crypto';
import { MetricsService } from '../metrics/metrics.service';
import { METRIC_PATHS } from '../metrics/metrics.constants';
import {
  DEFAULT_LOCAL_INBOX_ALIAS_RANDOM_BYTES,
  DEFAULT_LOCAL_INBOX_MAX_TTL,
  DEFAULT_LOCAL_INBOX_TTL,
  MAX_INBOX_ALIAS_RANDOM_BYTES,
  MIN_INBOX_ALIAS_RANDOM_BYTES,
} from '../config/config.constants';
import { ServerInfoResponseDto } from './dto/response.dto';
import { serializeEncryptedPayload, SerializedEncryptedPayload } from '../crypto/serialization';

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
  private readonly allowedDomain: string;
  private readonly aliasRandomBytes: number;

  /**
   * Constructor
   */
  constructor(
    private readonly storageService: InboxStorageService,
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
  ) {
    this.defaultTtl = this.configService.get<number>('vsb.local.inboxDefaultTtl', DEFAULT_LOCAL_INBOX_TTL);
    this.maxTtl = this.configService.get<number>('vsb.local.inboxMaxTtl', DEFAULT_LOCAL_INBOX_MAX_TTL);
    this.sseConsole = this.configService.get<boolean>('vsb.sseConsole.enabled', false);
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

    this.logger.log(
      `InboxService initialized: defaultTTL=${this.defaultTtl}s, maxTTL=${this.maxTtl}s, domain=${this.allowedDomain}, aliasRandomBytes=${this.aliasRandomBytes}`,
    );
  }

  /**
   * Create a new inbox with specified or random email address
   *
   * @param clientKemPk - Base64URL-encoded ML-KEM-768 public key
   * @param ttl - Optional time-to-live in seconds
   * @param emailAddress - Optional email address or domain:
   *   - If null/undefined: Generate random email with first allowed domain
   *   - If domain only (e.g., "mydomain.com"): Generate random email with that domain
   *   - If full email (e.g., "alias@mydomain.com"): Use that email if available,
   *     otherwise generate random email with the same domain
   */
  createInbox(clientKemPk: string, ttl?: number, emailAddress?: string): { inbox: Inbox; serverSigPk: string } {
    // Validate and normalize TTL
    const effectiveTtl = this.validateTtl(ttl);

    // Validate client KEM public key format (basic check)
    if (!this.isValidBase64Url(clientKemPk)) {
      throw new BadRequestException('Invalid clientKemPk format (must be Base64URL)');
    }

    // Base64URL encoding: (1184 * 4) / 3 ≈ 1579 characters
    const decodedLength = this.estimateBase64UrlLength(clientKemPk);
    if (decodedLength < MIN_EXPECTED_KEM_PK_BYTES || decodedLength > MAX_EXPECTED_KEM_PK_BYTES) {
      throw new BadRequestException(`Invalid clientKemPk length (expected ~1184 bytes for ML-KEM-768)`);
    }

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

    const inboxHash = this.deriveInboxHash(clientKemPk);

    // Create inbox
    const inbox = this.storageService.createInbox(finalEmailAddress, clientKemPk, expiresAt, inboxHash);

    // Get server signing public key
    const serverSigPk = this.cryptoService.getServerSigningPublicKey();

    // Log inbox creation (with note if +tag was stripped)
    const requestedEmail = emailAddress?.trim().toLowerCase();
    if (requestedEmail && requestedEmail !== finalEmailAddress && requestedEmail.includes('+')) {
      this.logger.log(
        `Inbox created email=${inbox.emailAddress} hash=${inbox.inboxHash} (requested: ${requestedEmail}, auto-aliasing enabled)`,
      );
    } else {
      this.logger.log(`Inbox created email=${inbox.emailAddress} hash=${inbox.inboxHash}`);
    }

    this.metricsService.increment(METRIC_PATHS.INBOX_CREATED_TOTAL);
    this.updateActiveInboxMetric();
    return { inbox, serverSigPk };
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
    return this.storageService.deleteEmail(emailAddress, emailId);
  }

  /**
   * Remove every inbox
   */
  clearAllInboxes(): number {
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
  addEmail(emailAddress: string, email: EncryptedEmail): void {
    this.storageService.addEmail(emailAddress, email);
  }

  /**
   * Get all emails for an inbox (metadata only)
   * Serializes binary payloads to Base64URL for API response
   */
  getEmails(
    emailAddress: string,
  ): Array<{ id: string; encryptedMetadata: SerializedEncryptedPayload; isRead: boolean }> {
    const emails = this.storageService.getEmails(emailAddress);
    return emails.map((email) => ({
      id: email.id,
      encryptedMetadata: serializeEncryptedPayload(email.encryptedMetadata),
      isRead: email.isRead,
    }));
  }

  /**
   * Get a specific email (parsed data only, without raw content)
   * Serializes binary payloads to Base64URL for API response
   */
  getEmail(
    emailAddress: string,
    emailId: string,
  ): {
    id: string;
    encryptedMetadata: SerializedEncryptedPayload;
    encryptedParsed: SerializedEncryptedPayload;
    isRead: boolean;
  } {
    const email = this.storageService.getEmail(emailAddress, emailId);
    return {
      id: email.id,
      encryptedMetadata: serializeEncryptedPayload(email.encryptedMetadata),
      encryptedParsed: serializeEncryptedPayload(email.encryptedParsed),
      isRead: email.isRead,
    };
  }

  /**
   * Get raw email content only
   * Serializes binary payload to Base64URL for API response
   */
  getRawEmail(emailAddress: string, emailId: string): { id: string; encryptedRaw: SerializedEncryptedPayload } {
    const email = this.storageService.getEmail(emailAddress, emailId);
    return {
      id: email.id,
      encryptedRaw: serializeEncryptedPayload(email.encryptedRaw),
    };
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
    return {
      serverSigPk: this.cryptoService.getServerSigningPublicKey(),
      algs: ALGORITHMS,
      context: 'vaultsandbox:email:v1',
      maxTtl: this.maxTtl,
      defaultTtl: this.defaultTtl,
      sseConsole: this.sseConsole,
      allowedDomains: this.getAllowedDomains(),
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
   * Derive a stable inbox hash from the ML-KEM public key (base64url encoded)
   */
  private deriveInboxHash(clientKemPk: string): string {
    return createHash('sha256').update(Buffer.from(clientKemPk, 'base64url')).digest('base64url');
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
