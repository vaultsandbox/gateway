/**
 * SMTP Handler Service
 *
 * Core service responsible for handling SMTP protocol interactions and routing
 * email data based on gateway mode (local or backend).
 *
 * ## Responsibilities
 * - SMTP authentication handling (accept all for receive-only server)
 * - Sender address validation (format validation)
 * - Recipient address validation against allowed domains
 * - Email data processing with dual-mode support:
 *   - **Local Mode**: Encrypt and store emails in memory
 *   - **Backend Mode**: Forward emails to backend HTTP API
 * - Email authentication coordination (delegates to EmailValidationService)
 * - Email parsing coordination (delegates to EmailProcessingService)
 *
 * ## Gateway Modes
 * - **Local Mode**: Requires InboxService and CryptoService for in-memory storage
 * - **Backend Mode**: Requires HttpService for forwarding to backend API
 *
 * ## Security Features
 * - Open relay prevention via allowed domains list
 * - Non-blocking SPF/DKIM/DMARC/PTR validation (logged but not enforced)
 * - Per-inbox email auth settings support
 *
 * @module smtp-handler
 */

import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { SMTPServerAddress, SMTPServerDataStream, SMTPServerSession } from 'smtp-server';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';

import type {
  ReceivedEmail,
  SpfResult,
  ReverseDnsResult,
  DkimResult,
  DmarcResult,
  SpamAnalysisResult,
} from './interfaces/email-session.interface';
import type { SmtpConfig } from './interfaces/smtp-config.interface';
import type { EncryptedBodyPayload, AttachmentData } from './interfaces/encrypted-body.interface';
import type { LocalParsedMail, ParsedMailAttachment } from './interfaces/parsed-email.interface';
import type { Inbox, PlainStoredEmail } from '../inbox/interfaces';
import type { EncryptedPayload } from '../crypto/interfaces';
import { serializeEncryptedPayload } from '../crypto/serialization';
import { InboxService } from '../inbox/inbox.service';
import { InboxStorageService } from '../inbox/storage/inbox-storage.service';
import { CryptoService } from '../crypto/crypto.service';
import { EventsService } from '../events/events.service';
import { SseConsoleService } from '../sse-console/sse-console.service';
import { EmailValidationService } from './email-validation.service';
import { EmailProcessingService } from './email-processing.service';
import { EmailStorageService } from './storage/email-storage.service';
import { normalizeIp, extractDomain, isEmailLike, getBaseEmail, validateEmailAddress } from './utils/email.utils';
import { extractUrls } from './utils/url-extraction.utils';
import { MetricsService } from '../metrics/metrics.service';
import { METRIC_PATHS } from '../metrics/metrics.constants';
import { DEFAULT_GATEWAY_MODE } from '../config/config.constants';
import { SpamAnalysisService } from './spam-analysis.service';
import { ChaosService } from '../chaos/chaos.service';
import { ChaosSmtpError, ChaosDropError } from '../chaos/chaos-error';

type ParsedEmailPayload = Omit<EncryptedBodyPayload, 'rawEmail'>;

interface MetadataPayload {
  id: string;
  from: string;
  to: string;
  subject: string;
  receivedAt: string;
}

interface EmailValidationResults {
  spfResult?: SpfResult;
  dkimResults: DkimResult[];
  dmarcResult?: DmarcResult;
  reverseDnsResult?: ReverseDnsResult;
}

interface EncryptedEmailPayloads {
  encryptedMetadata: EncryptedPayload;
  encryptedParsed: EncryptedPayload;
  encryptedRaw: EncryptedPayload;
}

interface RecipientContext {
  recipientAddress: string;
  baseEmail: string;
  inbox: Inbox;
}

interface TimestampedCacheEntry<T> {
  value: T;
  timestamp: number;
}

export interface TlsInfo {
  version: string; // e.g., 'TLSv1.3'
  cipher: string; // e.g., 'TLS_AES_256_GCM_SHA384'
  bits?: number; // e.g., 256
}

@Injectable()
export class SmtpHandlerService {
  private readonly logger = new Logger(SmtpHandlerService.name);
  private readonly config: SmtpConfig;
  private readonly tlsInfoCache = new Map<string, TimestampedCacheEntry<TlsInfo>>();
  private readonly gatewayMode: 'local' | 'backend';
  private readonly sessionCacheMaxAge = 5 * 60 * 1000; // 5 minutes

  /**
   * Constructor with conditional service injection based on gateway mode
   */
  /* v8 ignore next 16 - false positive on constructor parameter properties */
  constructor(
    private readonly configService: ConfigService,
    private readonly emailValidationService: EmailValidationService,
    private readonly emailProcessingService: EmailProcessingService,
    private readonly metricsService: MetricsService,
    private readonly sseConsoleService: SseConsoleService,
    private readonly eventEmitter: EventEmitter2,
    @Optional() private readonly inboxService?: InboxService,
    @Optional() private readonly inboxStorageService?: InboxStorageService,
    @Optional() private readonly cryptoService?: CryptoService,
    @Optional() private readonly httpService?: HttpService,
    @Optional() private readonly eventsService?: EventsService,
    @Optional() private readonly emailStorageService?: EmailStorageService,
    @Optional() private readonly spamAnalysisService?: SpamAnalysisService,
    @Optional() private readonly chaosService?: ChaosService,
  ) {
    this.config = this.configService.get<SmtpConfig>('vsb.smtp')!;
    const configuredGatewayMode =
      this.configService.get<string>('vsb.main.gatewayMode', DEFAULT_GATEWAY_MODE) ?? DEFAULT_GATEWAY_MODE;
    /* v8 ignore next - compile-time constant, only one branch taken */
    this.gatewayMode = (configuredGatewayMode || DEFAULT_GATEWAY_MODE) as 'local' | 'backend';

    this.logger.log(`SMTP Handler initialized in ${this.gatewayMode.toUpperCase()} mode`);

    if (this.gatewayMode === 'local' && (!this.inboxService || !this.cryptoService)) {
      this.logger.warn('Local mode enabled but InboxService or CryptoService not available');
    }

    /* v8 ignore next 3 - backend mode is disabled at runtime, this code is unreachable */
    if (this.gatewayMode === 'backend' && !this.httpService) {
      this.logger.warn('Backend mode enabled but HttpService not available');
    }

    /* v8 ignore next 5 - backend mode is disabled at runtime, this code is unreachable */
    if (this.gatewayMode === 'backend') {
      const message = 'Gateway backend mode is currently unsupported and intentionally disabled to prevent data loss.';
      this.logger.error(message);
      throw new Error(message);
    }
  }

  /**
   * Get appropriate SMTP error message for hard mode rejection based on response code
   */
  private getHardModeErrorMessage(code: number): string {
    const messages: Record<number, string> = {
      421: 'Service not available, closing transmission channel',
      450: 'Requested mail action not taken: mailbox unavailable',
      451: 'Requested action aborted: local error in processing',
      550: 'Requested action not taken: mailbox unavailable',
      554: 'Transaction failed: no mailboxes available',
    };
    return messages[code] || 'Service temporarily unavailable';
  }

  /**
   * Validates the sender email address in the MAIL FROM command.
   *
   * Performs basic structural validation to ensure the address looks like
   * a valid email address. Email authentication (SPF, DKIM, DMARC, PTR) is
   * performed later in the DATA phase when the recipient inbox is known.
   *
   * @param address - The sender address to validate
   * @param session - Current SMTP session (unused, kept for interface compatibility)
   * @throws {Error} If the address is not email-like
   * @throws {Error} If hard mode is active (no inboxes exist)
   */
  // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  async validateSender(address: SMTPServerAddress, session: SMTPServerSession): Promise<void> {
    // Hard mode check: reject if no inboxes exist
    if (this.gatewayMode === 'local' && this.inboxStorageService) {
      const hardModeRejectCode = this.configService.get<number>('vsb.local.hardModeRejectCode', 0);
      if (hardModeRejectCode > 0) {
        const inboxCount = this.inboxStorageService.getInboxCount();
        if (inboxCount === 0) {
          this.metricsService.increment(METRIC_PATHS.REJECTIONS_HARD_MODE);
          const error = new Error(this.getHardModeErrorMessage(hardModeRejectCode)) as Error & { responseCode: number };
          error.responseCode = hardModeRejectCode;
          throw error;
        }
      }
    }

    // Validate email address format, length limits, and control characters
    validateEmailAddress(address.address);

    /* v8 ignore next 3 - defensive check after validateEmailAddress catches most invalid formats */
    if (!isEmailLike(address.address)) {
      throw new Error(`Invalid MAIL FROM address: ${address.address}`);
    }
  }

  /**
   * Cleans up session-specific caches when a connection closes.
   *
   * This method is called by the SMTP server's onClose handler to immediately
   * release memory associated with TLS info cache entries.
   * Prevents memory leaks from clients that disconnect before DATA phase.
   *
   * @param sessionId - The SMTP session ID to clean up
   */
  cleanupSession(sessionId: string): void {
    const hadTls = this.tlsInfoCache.delete(sessionId);

    if (hadTls) {
      this.logger.debug(`Cleaned up session cache for ${sessionId} (TLS: ${hadTls})`);
    }
  }

  /**
   * Stores TLS connection information for a session.
   *
   * Called by the SMTP service's onSecure handler when TLS is established.
   * The TLS info is later used to build the Received header with cipher details.
   *
   * @param sessionId - The SMTP session ID
   * @param tlsInfo - TLS connection details (version, cipher, bits)
   */
  setTlsInfo(sessionId: string, tlsInfo: TlsInfo): void {
    this.tlsInfoCache.set(sessionId, { value: tlsInfo, timestamp: Date.now() });
    this.logger.debug(`TLS info cached for session ${sessionId}: ${tlsInfo.version} ${tlsInfo.cipher}`);
  }

  /**
   * Periodic cleanup of stale session cache entries.
   *
   * This method runs every minute as a defensive fallback to catch any cache
   * entries that were not cleaned up by the onClose handler (e.g., zombie sessions).
   * Removes entries older than 5 minutes to prevent unbounded memory growth.
   *
   * This is a defense-in-depth measure - onClose should handle most cleanup,
   * but this catches edge cases where sessions don't properly close.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  private cleanupStaleSessions(): void {
    const now = Date.now();
    let cleanedTls = 0;

    // Cleanup stale TLS info cache entries
    for (const [sessionId, entry] of this.tlsInfoCache.entries()) {
      if (now - entry.timestamp > this.sessionCacheMaxAge) {
        this.tlsInfoCache.delete(sessionId);
        cleanedTls++;
      }
    }

    if (cleanedTls > 0) {
      this.logger.warn(
        `Cleaned up ${cleanedTls} stale TLS session cache entries. ` +
          `This may indicate sessions not properly closing.`,
      );
    }
  }

  /**
   * Validates recipient email addresses in the RCPT TO command.
   *
   * Performs early validation of recipient addresses to reject invalid
   * recipients before wasting bandwidth receiving the message body.
   * This includes:
   * - Email structure validation (local part and domain)
   * - Domain authorization check (allowed domains list)
   * - Local mode: Inbox existence check (prevents accepting mail for non-existent inboxes)
   *
   * Early rejection improves protocol efficiency and prevents wasted bandwidth
   * on messages that will ultimately fail during DATA phase.
   *
   * @param address - The recipient address to validate
   * @throws {Error} If the address is not email-like
   * @throws {Error} If the recipient domain is not in the allowed list
   * @throws {Error} If the inbox does not exist (local mode only)
   */
  validateRecipient(address: SMTPServerAddress): void {
    // Validate email address format, length limits, and control characters
    validateEmailAddress(address.address);

    /* v8 ignore next 4 - defensive check after validateEmailAddress catches most invalid formats */
    // Validate complete email structure (local part + domain)
    if (!isEmailLike(address.address)) {
      throw new Error(`Invalid RCPT TO address: ${address.address}`);
    }

    /* v8 ignore next 4 - defensive check; extractDomain succeeds for valid email formats */
    const domain = extractDomain(address.address);
    if (!domain) {
      throw new Error(`Cannot extract domain from address: ${address.address}`);
    }

    // Check domain authorization
    if (!this.config.allowedRecipientDomains.includes(domain.toLowerCase())) {
      this.logger.warn(
        `Rejected email for unauthorized domain: ${domain} (allowed: ${this.config.allowedRecipientDomains.join(', ')})`,
      );
      this.sseConsoleService.logRecipientRejected(address.address);
      throw new Error(`This server does not accept mail for domain: ${domain}`);
    }

    // Local mode: Check if inbox exists for this recipient
    // This prevents accepting mail for non-existent inboxes and saves bandwidth
    if (this.gatewayMode === 'local' && this.inboxService) {
      const baseEmail = getBaseEmail(address.address.toLowerCase());
      const inbox = this.inboxService.getInboxByEmail(baseEmail);

      if (!inbox) {
        this.logger.warn(`Rejected email for non-existent inbox: ${address.address}`);
        this.sseConsoleService.logRecipientRejected(address.address);
        throw new Error('Recipient address rejected');
      }
    }

    this.sseConsoleService.logRecipientAccepted(address.address);
  }

  /**
   * Processes incoming email data from the SMTP DATA command.
   *
   * Behavior depends on gateway mode:
   * - LOCAL MODE: Encrypts email and stores in memory using InboxService
   * - BACKEND MODE: Forwards raw email to backend service via HTTP
   *
   * @param stream - Data stream containing the email message
   * @param session - Current SMTP session with envelope information
   * @returns Parsed email with headers, metadata, raw content, and validation results
   * @throws {Error} If message size exceeds the configured limit
   */
  async handleData(stream: SMTPServerDataStream, session: SMTPServerSession): Promise<ReceivedEmail> {
    const startTime = Date.now();

    if (stream.sizeExceeded) {
      this.metricsService.increment(METRIC_PATHS.REJECTIONS_DATA_SIZE);
      throw new Error('Message rejected – size limit exceeded.');
    }

    const rawData = await this.collectStream(stream);

    // Post-collection size check: catches clients that don't use SIZE extension or lie about size
    if (stream.sizeExceeded) {
      this.metricsService.increment(METRIC_PATHS.REJECTIONS_DATA_SIZE);
      throw new Error('Message rejected – size limit exceeded.');
    }

    // Branch based on gateway mode
    let result: ReceivedEmail;
    if (this.gatewayMode === 'local') {
      result = await this.handleDataLocalMode(rawData, stream, session);
      /* v8 ignore next 3 - backend mode is disabled at runtime, this branch is unreachable */
    } else {
      result = await this.handleDataBackendMode(rawData, stream, session);
    }

    // Track authentication results
    this.trackAuthMetrics(result);

    // Track successful email receipt
    this.metricsService.increment(METRIC_PATHS.EMAIL_RECEIVED_TOTAL);
    session.envelope.rcptTo.forEach(() => this.metricsService.increment(METRIC_PATHS.EMAIL_RECIPIENTS_TOTAL));

    // Track processing time
    const processingTime = Date.now() - startTime;
    this.metricsService.recordProcessingTime(processingTime);

    return result;
  }

  /**
   * Handle email data in LOCAL mode: encrypt and store in memory.
   *
   * In local mode, emails are encrypted using the recipient's public key
   * and stored in memory via InboxService. Both metadata and full email
   * body are encrypted separately with different AAD values.
   *
   * @param rawData - Complete raw email message as Buffer
   * @param stream - SMTP data stream (used for size information)
   * @param session - SMTP session with envelope and connection details
   * @returns Parsed email with headers, validation results, and metadata
   * @throws {Error} If required services are unavailable
   * @throws {Error} If recipient inbox is not found
   */
  private async handleDataLocalMode(
    rawData: Buffer,
    stream: SMTPServerDataStream,
    session: SMTPServerSession,
  ): Promise<ReceivedEmail> {
    const { inboxService, cryptoService } = this.ensureLocalModeServicesAvailable();

    // Extract recipients early for Received header
    const to = session.envelope.rcptTo
      .map((recipient) => this.extractSmtpAddress(recipient))
      .filter((address): address is string => Boolean(address));
    const receivedAt = new Date();

    // Prepend RFC 5321 Received header with transport security info (ESMTPS indicates TLS)
    const receivedHeader = this.buildReceivedHeader(session, to[0] || 'unknown', receivedAt);
    const rawDataWithReceived = Buffer.concat([Buffer.from(receivedHeader, 'utf8'), rawData]);

    const parsedHeaders = this.parseHeaders(rawDataWithReceived.toString('utf8'));
    const parsedMail = await this.emailProcessingService.parseEmail(rawDataWithReceived, session.id);
    const messageId = this.extractMessageId(parsedHeaders);
    const envelopeFrom = this.extractSmtpAddress(session.envelope.mailFrom);
    // Use the From header for display (e.g., "contact@example.com")
    // Fall back to envelope sender if header is missing
    /* v8 ignore next - optional chaining fallback for missing From header */
    const displayFrom = parsedMail?.from?.text || envelopeFrom;

    const recipientContexts = this.resolveRecipientInboxes(to, inboxService);
    // Use first recipient's inbox for email auth settings (multi-recipient emails use first inbox's settings)
    const primaryInbox = recipientContexts[0]?.inbox;

    // Chaos evaluation point - evaluates configured chaos types and applies actions
    // Pass sender info for greylist tracking
    /* v8 ignore next - normalizeIp always returns valid string for IPv4/IPv6 */
    const senderIp = normalizeIp(session.remoteAddress) || session.remoteAddress;
    const chaosResult = this.evaluateChaos(primaryInbox, session.id, senderIp, envelopeFrom);

    const validationResults = await this.performEmailValidation(rawData, session, parsedHeaders, primaryInbox);

    // Perform spam analysis (synchronous, blocks until complete)
    const spamAnalysis = await this.performSpamAnalysis(rawDataWithReceived, session.id, primaryInbox);

    // Track spam analysis metrics
    this.trackSpamMetrics(spamAnalysis);

    const parsedPayload = this.buildParsedPayload(
      parsedMail,
      displayFrom,
      envelopeFrom,
      to,
      validationResults,
      session,
      spamAnalysis,
    );
    const rawPayload = rawDataWithReceived.toString('base64');

    // Check for blackhole mode - skip storage if enabled
    const isBlackhole = chaosResult?.result.action === 'blackhole';
    const blackholeTriggerWebhooks =
      chaosResult?.result.action === 'blackhole' ? chaosResult.result.triggerWebhooks : false;

    for (const recipientContext of recipientContexts) {
      const emailId = randomUUID();
      const metadataPayload = this.buildMetadataPayload(
        emailId,
        displayFrom,
        recipientContext.recipientAddress,
        parsedMail?.subject,
        receivedAt,
      );

      /* v8 ignore next 4 - branch for alias logging, tests use base email addresses */
      const aliasInfo =
        recipientContext.recipientAddress !== recipientContext.baseEmail
          ? ` (alias of ${recipientContext.baseEmail})`
          : '';

      // Blackhole mode: skip storage and optionally webhooks
      if (isBlackhole) {
        /* v8 ignore next 2 - displayFrom always set from parsed email headers */
        this.logger.log(
          `Email ${emailId} blackholed for ${recipientContext.recipientAddress}${aliasInfo} (session=${session.id}) from '${displayFrom ?? 'unknown'}' (${stream.byteLength} bytes)`,
        );

        // Optionally emit webhook events even in blackhole mode
        if (blackholeTriggerWebhooks) {
          this.emitEmailWebhookEvents(
            emailId,
            recipientContext.inbox,
            recipientContext.recipientAddress,
            parsedMail,
            displayFrom,
            to,
            validationResults,
            receivedAt,
          );
        }
        continue; // Skip storage for this recipient
      }

      if (recipientContext.inbox.encrypted) {
        // Encrypted inbox: encrypt and store
        const encryptedPayloads = await this.encryptEmailData(
          cryptoService,
          recipientContext.inbox,
          metadataPayload,
          parsedPayload,
          rawPayload,
        );

        this.storeEncryptedEmail(recipientContext.baseEmail, emailId, encryptedPayloads);

        this.logger.log(
          `Email ${emailId} encrypted and stored for ${recipientContext.recipientAddress}${aliasInfo} (session=${session.id}) from '${displayFrom ?? 'unknown'}' (${stream.byteLength} bytes)`,
        );

        this.notifyClient(recipientContext.inbox, emailId, encryptedPayloads.encryptedMetadata);

        // Emit webhook events for email.received and email.stored
        this.emitEmailWebhookEvents(
          emailId,
          recipientContext.inbox,
          recipientContext.recipientAddress,
          parsedMail,
          displayFrom,
          to,
          validationResults,
          receivedAt,
        );
      } else {
        // Plain inbox: store as binary Uint8Array (no encryption)
        const plainEmail = this.buildPlainEmail(emailId, metadataPayload, parsedPayload, rawPayload);

        this.storePlainEmail(recipientContext.baseEmail, plainEmail);

        /* v8 ignore next 3 */
        this.logger.log(
          `Email ${emailId} stored (plain) for ${recipientContext.recipientAddress}${aliasInfo} (session=${session.id}) from '${displayFrom ?? 'unknown'}' (${stream.byteLength} bytes)`,
        );

        this.notifyClientPlain(recipientContext.inbox, emailId, metadataPayload);

        // Emit webhook events for email.received and email.stored
        this.emitEmailWebhookEvents(
          emailId,
          recipientContext.inbox,
          recipientContext.recipientAddress,
          parsedMail,
          displayFrom,
          to,
          validationResults,
          receivedAt,
        );
      }
    }

    const { spfResult, dkimResults, dmarcResult, reverseDnsResult } = validationResults;

    // Apply chaos latency delay before returning (simulates slow server response)
    if (chaosResult?.result.action === 'delay') {
      const delayMs = chaosResult.result.delayMs;
      this.logger.debug(`Applying chaos latency delay: ${delayMs}ms for session ${session.id}`);
      await this.delay(delayMs);
    }

    return {
      from: displayFrom,
      to,
      messageId,
      rawData: rawDataWithReceived,
      size: stream.byteLength,
      headers: parsedHeaders,
      spfResult,
      dkimResults,
      dmarcResult,
      reverseDnsResult,
      spamAnalysis,
    };
  }

  /**
   * Evaluates chaos configuration for an inbox and applies immediate actions.
   *
   * This method evaluates the chaos configuration and:
   * - For 'error' actions: throws a ChaosSmtpError immediately
   * - For 'drop' actions: throws a ChaosDropError immediately
   * - For 'delay' actions: returns the result so delay can be applied later
   * - For 'blackhole' actions: returns the result so storage can be skipped
   * - For 'continue' actions: returns the result (no action needed)
   *
   * @param inbox - The inbox to evaluate chaos for
   * @param sessionId - SMTP session ID for logging
   * @param senderIp - Sender's IP address (for greylist tracking)
   * @param senderEmail - Sender's email address (for greylist tracking)
   * @returns ChaosEvaluationResult or undefined if chaos not applicable
   * @throws ChaosSmtpError for error actions
   * @throws ChaosDropError for drop actions
   */
  private evaluateChaos(
    inbox: Inbox | undefined,
    sessionId: string,
    senderIp?: string,
    senderEmail?: string,
  ): import('../chaos/interfaces/chaos-config.interface').ChaosEvaluationResult | undefined {
    if (!this.chaosService || !inbox?.chaos?.enabled) {
      return undefined;
    }

    // Build greylist context if sender info is available
    const greylistContext =
      senderIp && senderEmail
        ? {
            senderIp,
            senderEmail,
          }
        : /* v8 ignore next - senderIp always provided by caller */ undefined;

    const chaosResult = this.chaosService.evaluate(inbox.chaos, sessionId, inbox.emailAddress, greylistContext);

    // Handle immediate actions (error and drop throw, delay is returned)
    switch (chaosResult.result.action) {
      case 'error':
        this.logger.log(
          `Chaos error triggered: ${chaosResult.result.code} ${chaosResult.result.enhanced} ` +
            `for inbox=${inbox.emailAddress} session=${sessionId}`,
        );
        throw new ChaosSmtpError(chaosResult.result.code, chaosResult.result.enhanced, chaosResult.result.message);

      case 'drop':
        this.logger.log(
          `Chaos connection drop triggered: graceful=${chaosResult.result.graceful} ` +
            `for inbox=${inbox.emailAddress} session=${sessionId}`,
        );
        throw new ChaosDropError(chaosResult.result.graceful);

      case 'delay':
        this.logger.debug(
          `Chaos latency scheduled: ${chaosResult.result.delayMs}ms ` +
            `for inbox=${inbox.emailAddress} session=${sessionId}`,
        );
        return chaosResult;

      default:
        return chaosResult;
    }
  }

  /**
   * Delays execution for the specified number of milliseconds.
   *
   * @param ms - Number of milliseconds to delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Ensures local-mode services are available and narrows their types.
   */
  private ensureLocalModeServicesAvailable(): { inboxService: InboxService; cryptoService: CryptoService } {
    if (!this.inboxService || !this.cryptoService) {
      throw new Error('Local mode services not available (InboxService or CryptoService missing)');
    }
    return { inboxService: this.inboxService, cryptoService: this.cryptoService };
  }

  /**
   * Resolves the recipient inbox context (address, base email, inbox record).
   */
  private resolveRecipientInboxes(to: string[], inboxService: InboxService): RecipientContext[] {
    if (to.length === 0) {
      throw new Error('No valid recipient address');
    }

    const contexts: RecipientContext[] = [];
    const seen = new Set<string>();

    for (const recipient of to) {
      const normalizedRecipient = recipient.toLowerCase();
      const baseEmail = getBaseEmail(normalizedRecipient);

      if (seen.has(baseEmail)) {
        continue; // Avoid duplicate deliveries to the same inbox
      }

      const inbox = inboxService.getInboxByEmail(baseEmail);
      if (!inbox) {
        this.logger.warn(`Inbox not found for ${recipient} (base: ${baseEmail})`);
        throw new Error('Recipient address rejected');
      }

      seen.add(baseEmail);
      contexts.push({ recipientAddress: normalizedRecipient, baseEmail, inbox });
    }

    return contexts;
  }

  /**
   * Performs SPF, DKIM, DMARC, and reverse DNS validation aggregation.
   *
   * @param rawData - Raw email data
   * @param session - SMTP session
   * @param parsedHeaders - Parsed email headers
   * @param inbox - Optional inbox for per-inbox email auth settings (uses first recipient's inbox)
   */
  private async performEmailValidation(
    rawData: Buffer,
    session: SMTPServerSession,
    parsedHeaders: Record<string, string>,
    inbox?: Inbox,
  ): Promise<EmailValidationResults> {
    // Extract sender info for SPF validation
    const senderAddress = session.envelope.mailFrom ? this.extractSmtpAddress(session.envelope.mailFrom) : undefined;
    const domain = senderAddress ? extractDomain(senderAddress) : undefined;
    const remoteIp = normalizeIp(session.remoteAddress);

    // Run all email auth checks in parallel, passing inbox for per-inbox settings
    const [spfResult, reverseDnsResult, dkimResults] = await Promise.all([
      this.emailValidationService.verifySpf(domain, remoteIp, senderAddress || '', session.id, inbox),
      this.emailValidationService.verifyReverseDns(remoteIp, session.id, inbox),
      this.emailValidationService.verifyDkim(rawData, session.id, inbox),
    ]);

    const dmarcResult = await this.emailValidationService.verifyDmarc(
      parsedHeaders,
      spfResult,
      dkimResults,
      session.id,
      inbox,
    );

    this.emailValidationService.logValidationResults(session.id, spfResult, dkimResults, dmarcResult, reverseDnsResult);

    // Log to SSE console for real-time monitoring
    const fromAddress = session.envelope.mailFrom ? this.extractSmtpAddress(session.envelope.mailFrom) : 'unknown';
    const toAddresses = session.envelope.rcptTo
      .map((r) => this.extractSmtpAddress(r))
      .filter((a): a is string => Boolean(a));
    const dkimStatus = dkimResults.some((d) => d.status === 'pass')
      ? 'pass'
      : dkimResults.some((d) => d.status === 'fail')
        ? 'fail'
        : dkimResults.length > 0
          ? dkimResults[0].status
          : 'none';

    /* v8 ignore next 7 - fallback branches for undefined validation results */
    this.sseConsoleService.logEmailReceived(
      fromAddress || 'unknown',
      toAddresses,
      spfResult?.status || 'none',
      dkimStatus,
      dmarcResult?.status || 'none',
    );

    return {
      spfResult,
      dkimResults,
      dmarcResult,
      reverseDnsResult,
    };
  }

  /**
   * Performs spam analysis using Rspamd if enabled.
   *
   * @param rawData - Raw email data (with Received header prepended)
   * @param sessionId - SMTP session ID for logging
   * @param inbox - Optional inbox for per-inbox spam analysis settings
   * @returns Spam analysis result or undefined if service unavailable
   */
  private async performSpamAnalysis(
    rawData: Buffer,
    sessionId: string,
    inbox?: Inbox,
  ): Promise<SpamAnalysisResult | undefined> {
    if (!this.spamAnalysisService) {
      return undefined;
    }

    return this.spamAnalysisService.analyzeEmail(rawData, sessionId, inbox);
  }

  /**
   * Builds the parsed email payload that will be encrypted for the client.
   * @param displayFrom - The From header value for display purposes
   * @param envelopeFrom - The SMTP envelope sender (MAIL FROM) for SPF domain fallback
   * @param spamAnalysis - Optional spam analysis results from Rspamd
   */
  /* v8 ignore start - optional chaining branches for undefined parsedMail properties */
  private buildParsedPayload(
    parsedMail: LocalParsedMail | undefined,
    displayFrom: string | undefined,
    envelopeFrom: string | undefined,
    to: string[],
    validationResults: EmailValidationResults,
    session: SMTPServerSession,
    spamAnalysis?: SpamAnalysisResult,
  ): ParsedEmailPayload {
    const htmlContent = this.bufferToString(parsedMail?.html);
    const textContent = parsedMail?.text || null;
    const links = extractUrls(htmlContent || undefined, textContent || undefined);
    const { spfResult, dkimResults, dmarcResult, reverseDnsResult } = validationResults;

    return {
      html: htmlContent,
      text: textContent,
      textAsHtml: this.bufferToString(parsedMail?.textAsHtml),
      headers: parsedMail?.headers ? this.serializeHeaders(parsedMail.headers) : {},
      subject: parsedMail?.subject || '(no subject)',
      messageId: parsedMail?.messageId,
      date: parsedMail?.date?.toISOString(),
      from: displayFrom || 'unknown',
      to: to.join(', '),
      cc: parsedMail?.cc?.text,
      bcc: parsedMail?.bcc?.text,
      replyTo: parsedMail?.replyTo?.text,
      inReplyTo: parsedMail?.inReplyTo,
      references: parsedMail?.references,
      priority: parsedMail?.priority,
      attachments: this.serializeAttachments(parsedMail?.attachments || []),
      authResults: {
        spf: spfResult
          ? {
              result: spfResult.status,
              // Use envelope sender for SPF domain (SPF validates MAIL FROM, not header From)
              domain: spfResult.domain || extractDomain(envelopeFrom || '') || 'unknown',
              details: spfResult.info || '',
            }
          : undefined,
        dkim: dkimResults?.map((d) => ({
          domain: d.domain || '',
          result: d.status,
          selector: d.selector || '',
          signature: d.info || '',
        })),
        dmarc: dmarcResult
          ? {
              result: dmarcResult.status,
              policy: dmarcResult.policy || 'none',
              domain: dmarcResult.domain || '',
              aligned: dmarcResult.aligned || false,
            }
          : undefined,
        reverseDns: reverseDnsResult
          ? {
              result: reverseDnsResult.status,
              hostname: reverseDnsResult.hostname || '',
              ip: normalizeIp(session.remoteAddress) || 'unknown',
            }
          : undefined,
      },
      links: links.length > 0 ? links : undefined,
      spamAnalysis: spamAnalysis
        ? {
            status: spamAnalysis.status,
            score: spamAnalysis.score,
            requiredScore: spamAnalysis.requiredScore,
            action: spamAnalysis.action,
            isSpam: spamAnalysis.isSpam,
            symbols: spamAnalysis.symbols,
            processingTimeMs: spamAnalysis.processingTimeMs,
            info: spamAnalysis.info,
          }
        : undefined,
    };
  }
  /* v8 ignore stop */

  /**
   * Builds the plaintext metadata payload used for metadata encryption.
   */
  private buildMetadataPayload(
    emailId: string,
    from: string | undefined,
    recipientAddress: string,
    subject: string | undefined,
    receivedAt: Date,
  ): MetadataPayload {
    return {
      id: emailId,
      from: from || 'unknown',
      to: recipientAddress,
      subject: subject || '(no subject)',
      receivedAt: receivedAt.toISOString(),
    };
  }

  /**
   * Encrypts metadata, parsed payload, and raw email payload with proper AAD values.
   */
  private async encryptEmailData(
    cryptoService: CryptoService,
    inbox: Inbox,
    metadataPayload: MetadataPayload,
    parsedPayload: ParsedEmailPayload,
    rawPayload: string,
  ): Promise<EncryptedEmailPayloads> {
    // clientKemPk is guaranteed to exist for encrypted inboxes (validated at inbox creation)
    const clientKemPk = inbox.clientKemPk!;

    const metadataPlaintext = Buffer.from(JSON.stringify(metadataPayload), 'utf-8');
    const parsedPlaintext = Buffer.from(JSON.stringify(parsedPayload), 'utf-8');
    const rawPlaintext = Buffer.from(rawPayload, 'utf-8');

    const metadataAad = Buffer.from('vaultsandbox:metadata', 'utf-8');
    const parsedAad = Buffer.from('vaultsandbox:parsed', 'utf-8');
    const rawAad = Buffer.from('vaultsandbox:raw', 'utf-8');

    const encryptedMetadata = await cryptoService.encryptForClient(clientKemPk, metadataPlaintext, metadataAad);
    const encryptedParsed = await cryptoService.encryptForClient(clientKemPk, parsedPlaintext, parsedAad);
    const encryptedRaw = await cryptoService.encryptForClient(clientKemPk, rawPlaintext, rawAad);

    return {
      encryptedMetadata,
      encryptedParsed,
      encryptedRaw,
    };
  }

  /**
   * Persists encrypted email payloads into the inbox storage with memory management.
   * Uses EmailStorageService which provides automatic FIFO eviction when memory limits are reached.
   */
  private storeEncryptedEmail(baseEmail: string, emailId: string, encryptedPayloads: EncryptedEmailPayloads): void {
    // EmailStorageService is always available in local mode (same lifecycle as InboxService)
    this.emailStorageService!.storeEmail(baseEmail, emailId, encryptedPayloads);
  }

  /**
   * Builds a plain email for storage (Uint8Array format for memory efficiency).
   */
  private buildPlainEmail(
    emailId: string,
    metadataPayload: MetadataPayload,
    parsedPayload: ParsedEmailPayload,
    rawPayload: string,
  ): PlainStoredEmail {
    return {
      id: emailId,
      isRead: false,
      metadata: new Uint8Array(Buffer.from(JSON.stringify(metadataPayload))),
      parsed: new Uint8Array(Buffer.from(JSON.stringify(parsedPayload))),
      raw: new Uint8Array(Buffer.from(rawPayload, 'base64')), // decode base64 to actual bytes
    };
  }

  /**
   * Persists plain email into the inbox storage.
   */
  private storePlainEmail(baseEmail: string, email: PlainStoredEmail): void {
    this.inboxStorageService!.addEmail(baseEmail, email);
  }

  /**
   * Emits SSE events for new encrypted emails. Non-critical failures are logged only.
   * Serializes binary payload to Base64URL for SSE transmission.
   */
  private notifyClient(inbox: Inbox, emailId: string, encryptedMetadata: EncryptedPayload): void {
    if (!this.eventsService) {
      this.logger.warn('EventsService unavailable; SSE clients will not be notified');
      return;
    }

    try {
      this.eventsService.emitNewEmailEvent({
        inboxId: inbox.inboxHash,
        emailId,
        encryptedMetadata: serializeEncryptedPayload(encryptedMetadata),
      });
    } catch (error) {
      /* v8 ignore next - defensive for non-Error exceptions */
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to emit SSE event for email ${emailId}: ${message}`);
    }
  }

  /**
   * Emits SSE events for new plain emails. Non-critical failures are logged only.
   * Serializes metadata to Base64 for SSE transmission.
   */
  private notifyClientPlain(inbox: Inbox, emailId: string, metadata: MetadataPayload): void {
    /* v8 ignore next 4 - eventsService is always available in production */
    if (!this.eventsService) {
      this.logger.warn('EventsService unavailable; SSE clients will not be notified');
      return;
    }

    try {
      this.eventsService.emitNewEmailEvent({
        inboxId: inbox.inboxHash,
        emailId,
        metadata: Buffer.from(JSON.stringify(metadata)).toString('base64'),
      });
      /* v8 ignore start - defensive error handling */
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to emit SSE event for email ${emailId}: ${message}`);
    }
    /* v8 ignore stop */
  }

  /**
   * Emits webhook events for email.received and email.stored.
   * Non-critical failures are logged only (webhooks should not block email processing).
   */
  private emitEmailWebhookEvents(
    emailId: string,
    inbox: Inbox,
    recipientAddress: string,
    parsedMail: LocalParsedMail | undefined,
    displayFrom: string | undefined,
    to: string[],
    validationResults: EmailValidationResults,
    receivedAt: Date,
  ): void {
    try {
      // Extract parsed address from mailparser (preferred) or parse from display string (fallback)
      const fromAddress =
        parsedMail?.from?.value?.[0]?.address || this.extractEmailFromDisplay(displayFrom) || 'unknown';
      const fromName = parsedMail?.from?.value?.[0]?.name || undefined;

      // Build email data payload for webhook event
      const emailPayload = {
        email: {
          id: emailId,
          from: { address: fromAddress, name: fromName },
          // Use parsedMail.to.value for proper parsing of display names with commas
          to:
            parsedMail?.to?.value?.map((addr) => ({
              address: addr.address,
              name: addr.name || undefined,
            })) || to.map((addr) => ({ address: addr })),
          // Use parsedMail.cc.value instead of splitting on commas (breaks "Doe, John" format)
          cc:
            parsedMail?.cc?.value?.map((addr) => ({
              address: addr.address,
              /* v8 ignore next - optional field */
              name: addr.name || undefined,
            })) || undefined,
          subject: parsedMail?.subject || '(no subject)',
          text: parsedMail?.text,
          html: this.bufferToString(parsedMail?.html) || undefined,
          /* v8 ignore next */
          headers: parsedMail?.headers ? this.serializeHeaders(parsedMail.headers) : undefined,
          attachments: parsedMail?.attachments?.map((att) => ({
            filename: typeof att.filename === 'string' ? att.filename : 'unnamed',
            contentType: att.contentType || 'application/octet-stream',
            size: att.size || 0,
            contentId: att.cid,
          })),
          receivedAt,
          auth: {
            spf: validationResults.spfResult?.status,
            dkim: validationResults.dkimResults?.some((d) => d.status === 'pass')
              ? 'pass'
              : validationResults.dkimResults?.some((d) => d.status === 'fail')
                ? 'fail'
                : 'none',
            dmarc: validationResults.dmarcResult?.status,
          },
        },
        inboxHash: inbox.inboxHash,
        inboxEmail: recipientAddress,
      };

      // Emit email.received event (for real-time webhook notifications)
      this.eventEmitter.emit('email.received', emailPayload);

      // Emit email.stored event (confirms successful storage)
      this.eventEmitter.emit('email.stored', {
        emailId,
        inboxHash: inbox.inboxHash,
        inboxEmail: recipientAddress,
      });
      /* v8 ignore start */
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to emit webhook events for email ${emailId}: ${message}`);
    }
    /* v8 ignore stop */
  }

  /**
   * Extract email address from display format "Name <email>" or plain email.
   *
   * @param display - Display string that may contain "Name <email>" format or plain email
   * @returns The extracted email address, or undefined if not found
   */
  private extractEmailFromDisplay(display?: string): string | undefined {
    if (!display) return undefined;

    // Match email in angle brackets: "Name <email@domain.com>"
    const bracketMatch = display.match(/<([^>]+)>/);
    if (bracketMatch) {
      return bracketMatch[1].trim().toLowerCase();
    }

    // If no brackets, assume it's a plain email address
    if (display.includes('@')) {
      return display.trim().toLowerCase();
    }

    return undefined;
  }

  /**
   * Handle email data in BACKEND mode: forward to backend service.
   *
   * In backend mode, raw emails are forwarded to a backend HTTP API
   * (base64 encoded) for processing and storage. A copy is also saved
   * to disk locally for audit trail purposes.
   *
   * @param rawData - Complete raw email message as Buffer
   * @param stream - SMTP data stream (used for size information)
   * @param session - SMTP session with envelope and connection details
   * @returns Parsed email with headers, validation results, and metadata
   * @throws {Error} If backend URL or HttpService is unavailable
   * @throws {Error} If HTTP forwarding to backend fails
   */
  /* v8 ignore start - backend mode is disabled at runtime, this method is unreachable */
  private handleDataBackendMode(
    rawData: Buffer,
    stream: SMTPServerDataStream,
    session: SMTPServerSession,
  ): Promise<ReceivedEmail> {
    const recipientList = session.envelope.rcptTo
      .map((recipient) => this.extractSmtpAddress(recipient))
      .filter((address): address is string => Boolean(address))
      .join(', ');

    const errorMessage = [
      'Gateway backend mode is not implemented yet; incoming email will not be processed in this mode.',
      `session=${session.id ?? 'unknown'}`,
      `bytes=${rawData.length}`,
      `streamBytes=${stream.byteLength}`,
      recipientList ? `recipients=${recipientList}` : 'recipients=unknown',
    ].join(' ');

    this.logger.error(errorMessage);
    return Promise.reject(new Error(errorMessage));
  }
  /* v8 ignore stop */

  /**
   * Extracts the email address string from an SMTP server address object.
   *
   * Handles the various types that SMTP server address can be (object, false, undefined)
   * and safely extracts the string email address.
   *
   * @param address - SMTP server address object, false, or undefined
   * @returns The email address string, or undefined if not available
   */
  private extractSmtpAddress(address: SMTPServerAddress | false | undefined): string | undefined {
    if (!address) {
      return undefined;
    }

    /* v8 ignore next 3 - defensive check for TypeScript type narrowing; first check catches false */
    if (typeof address === 'boolean') {
      return undefined;
    }

    return address.address;
  }

  /**
   * Collects all data from a stream into a single Buffer.
   *
   * Reads the entire stream and concatenates all chunks into a single
   * Buffer for easier processing. Properly handles both error and end events.
   *
   * @param stream - The data stream to collect
   * @returns Complete buffer containing all stream data
   */
  /* v8 ignore next - false positive on function definition */
  private collectStream(stream: SMTPServerDataStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      stream.on('data', (chunk) => {
        /* v8 ignore next - Buffer.isBuffer branch is defensive for non-Buffer chunks */
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferLike));
      });

      stream.once('error', (error) => {
        stream.removeAllListeners('end');
        reject(error);
      });

      stream.once('end', () => {
        resolve(Buffer.concat(chunks));
      });
    });
  }

  /**
   * Parses email headers from raw email content.
   *
   * Extracts and normalizes email headers following RFC 5322 rules.
   * Handles multi-line header values (folded headers) by concatenating
   * continuation lines. Header names are normalized to lowercase.
   *
   * Defense-in-depth limits applied:
   * - Header section capped at 64KB (prevents memory abuse from malformed emails)
   * - Maximum 1000 header lines processed (prevents DoS from header bombs)
   * - Individual header values capped at 8KB (prevents single-header abuse)
   *
   * @param raw - Raw email content as a string
   * @returns Object mapping lowercase header names to their values
   */
  private parseHeaders(raw: string): Record<string, string> {
    // Defense-in-depth: Limit header section size to 64KB
    const MAX_HEADER_SECTION_SIZE = 64 * 1024;
    const MAX_HEADER_LINES = 1000;
    const MAX_HEADER_VALUE_LENGTH = 8 * 1024;

    let [headerSection] = raw.split(/\r?\n\r?\n/, 1);

    // Truncate oversized header sections
    if (headerSection.length > MAX_HEADER_SECTION_SIZE) {
      this.logger.warn(`Header section truncated from ${headerSection.length} to ${MAX_HEADER_SECTION_SIZE} bytes`);
      headerSection = headerSection.slice(0, MAX_HEADER_SECTION_SIZE);
    }

    const lines = headerSection.split(/\r?\n/);
    const headers: Record<string, string> = {};

    let currentKey = '';
    let lineCount = 0;

    for (const line of lines) {
      // Limit number of header lines processed
      if (++lineCount > MAX_HEADER_LINES) {
        this.logger.warn(`Header parsing stopped after ${MAX_HEADER_LINES} lines`);
        break;
      }

      /* v8 ignore next 3 - empty line check is defensive for malformed headers */
      if (!line.trim()) {
        continue;
      }

      if (/^[\t ]/.test(line) && currentKey) {
        /* v8 ignore next - fallback for headers not yet seen */
        const currentValue = headers[currentKey] || '';
        const newValue = `${currentValue} ${line.trim()}`;
        // Cap individual header value length
        headers[currentKey] = newValue.slice(0, MAX_HEADER_VALUE_LENGTH);
        continue;
      }

      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) {
        continue;
      }

      currentKey = line.slice(0, separatorIndex).trim().toLowerCase();
      // Cap individual header value length
      headers[currentKey] = line.slice(separatorIndex + 1, separatorIndex + 1 + MAX_HEADER_VALUE_LENGTH).trim();
    }

    return headers;
  }

  /**
   * Extracts and normalizes the Message-ID from email headers.
   *
   * Removes angle brackets from the Message-ID header value and trims whitespace.
   * The Message-ID is used to uniquely identify email messages.
   *
   * @param headers - Parsed email headers
   * @returns The message ID without angle brackets, or undefined if not present
   */
  private extractMessageId(headers: Record<string, unknown>): string | undefined {
    const messageId = headers['message-id'];

    if (typeof messageId === 'string') {
      return messageId.replace(/[<>]/g, '').trim();
    }

    return undefined;
  }

  /**
   * Builds an RFC 5321 compliant Received header for the email.
   *
   * The Received header documents the email's path through mail servers and includes
   * transport security information including TLS version and cipher suite.
   *
   * Format follows RFC 5321 Section 4.4:
   * - from: client hostname and IP
   * - by: this server's hostname
   * - with: protocol (SMTP, ESMTP, ESMTPS for TLS, ESMTPSA for TLS+Auth)
   * - TLS details: version and cipher (when TLS is used)
   * - id: session identifier
   * - for: recipient address
   * - date: RFC 2822 formatted timestamp
   *
   * @param session - SMTP session containing connection details
   * @param recipient - The recipient email address
   * @param receivedAt - Timestamp when the email was received
   * @returns Formatted Received header string
   */
  /* v8 ignore start - session fallbacks for missing/undefined properties */
  private buildReceivedHeader(session: SMTPServerSession, recipient: string, receivedAt: Date): string {
    const serverHostname = hostname();
    const clientHostname = session.clientHostname || 'unknown';
    const remoteAddress = normalizeIp(session.remoteAddress) || session.remoteAddress;
    // transmissionType includes TLS indicator: ESMTP (no TLS), ESMTPS (TLS), ESMTPSA (TLS+Auth)
    const transmissionType = session.transmissionType || (session.secure ? 'ESMTPS' : 'ESMTP');
    const dateString = receivedAt.toUTCString();

    // Get TLS details if available
    const tlsInfo = this.tlsInfoCache.get(session.id)?.value;
    // Format: (version=TLSv1.3 cipher=TLS_AES_256_GCM_SHA384 bits=256)
    const tlsDetails =
      tlsInfo && session.secure
        ? ` (version=${tlsInfo.version} cipher=${tlsInfo.cipher}${tlsInfo.bits ? ` bits=${tlsInfo.bits}` : ''})`
        : '';

    return (
      `Received: from ${clientHostname} (${clientHostname} [${remoteAddress}])\r\n` +
      `\tby ${serverHostname} with ${transmissionType}${tlsDetails}\r\n` +
      `\tid ${session.id} for <${recipient}>;\r\n` +
      `\t${dateString}\r\n`
    );
  }
  /* v8 ignore stop */

  /**
   * Converts a Buffer or string to a UTF-8 string
   *
   * Helper method to safely convert various content types to strings.
   * Returns null if the input is falsy or explicitly false.
   *
   * @param buf - Buffer, string, false, or undefined
   * @returns UTF-8 string or null
   */
  /* v8 ignore start - type narrowing branches for string/Buffer/falsy */
  private bufferToString(buf: string | Buffer | false | undefined): string | null {
    if (!buf) return null;
    if (typeof buf === 'string') return buf;
    return buf.toString('utf-8');
  }
  /* v8 ignore stop */

  /**
   * Serializes email headers Map to a plain object
   *
   * Converts the Map structure from mailparser to a JSON-serializable
   * object for encryption and transmission to frontend.
   *
   * @param headers - Headers Map from mailparser
   * @returns Plain object with header key-value pairs
   */
  private serializeHeaders(headers: Map<string, string | string[]>): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  /**
   * Serializes email attachments for encryption
   *
   * Converts parsed attachments to a JSON-serializable format with
   * base64-encoded content for safe transmission to frontend.
   *
   * @param attachments - Array of parsed attachments from mailparser
   * @returns Array of serialized attachments with base64 content
   */
  private serializeAttachments(attachments: ParsedMailAttachment[]): AttachmentData[] {
    return attachments.map((att) => ({
      filename: typeof att.filename === 'string' ? att.filename : 'unnamed',
      contentType: att.contentType || 'application/octet-stream',
      size: att.size || 0,
      contentId: att.cid,
      contentDisposition: att.contentDisposition,
      checksum: att.checksum,
      content: att.content
        ? Buffer.isBuffer(att.content)
          ? att.content.toString('base64')
          : Buffer.from(att.content).toString('base64')
        : '',
    }));
  }

  /**
   * Tracks authentication metrics from email validation results
   *
   * Increments metric counters for SPF, DKIM, and DMARC validation
   * results. Only tracks results that have a defined status.
   *
   * @param email - Received email with authentication results
   */
  private trackAuthMetrics(email: ReceivedEmail): void {
    // Track SPF results
    if (email.spfResult?.status === 'pass') {
      this.metricsService.increment(METRIC_PATHS.AUTH_SPF_PASS);
    } else if (email.spfResult?.status && email.spfResult.status !== 'none') {
      this.metricsService.increment(METRIC_PATHS.AUTH_SPF_FAIL);
    }

    // Track DKIM results - check if any signatures passed
    if (email.dkimResults && email.dkimResults.length > 0) {
      const hasPass = email.dkimResults.some((d) => d.status === 'pass');
      const hasFail = email.dkimResults.some((d) => d.status !== 'pass' && d.status !== 'none');

      if (hasPass) {
        this.metricsService.increment(METRIC_PATHS.AUTH_DKIM_PASS);
      } else if (hasFail) {
        this.metricsService.increment(METRIC_PATHS.AUTH_DKIM_FAIL);
      }
    }

    // Track DMARC results
    if (email.dmarcResult?.status === 'pass') {
      this.metricsService.increment(METRIC_PATHS.AUTH_DMARC_PASS);
    } else if (email.dmarcResult?.status && email.dmarcResult.status !== 'none') {
      this.metricsService.increment(METRIC_PATHS.AUTH_DMARC_FAIL);
    }
  }

  /**
   * Tracks spam analysis metrics from spam analysis results
   *
   * Increments metric counters for spam analysis status.
   * Only tracks results that have a defined status.
   *
   * @param spamAnalysis - Spam analysis result
   */
  private trackSpamMetrics(spamAnalysis: SpamAnalysisResult | undefined): void {
    if (!spamAnalysis) return;

    if (spamAnalysis.status === 'analyzed') {
      this.metricsService.increment(METRIC_PATHS.SPAM_ANALYZED_TOTAL);
      if (spamAnalysis.processingTimeMs) {
        this.metricsService.increment(METRIC_PATHS.SPAM_PROCESSING_TIME_MS, spamAnalysis.processingTimeMs);
      }
      if (spamAnalysis.isSpam) {
        this.metricsService.increment(METRIC_PATHS.SPAM_DETECTED_TOTAL);
      }
    } else if (spamAnalysis.status === 'error') {
      this.metricsService.increment(METRIC_PATHS.SPAM_ERRORS_TOTAL);
    } else if (spamAnalysis.status === 'skipped') {
      this.metricsService.increment(METRIC_PATHS.SPAM_SKIPPED_TOTAL);
    }
  }
}
