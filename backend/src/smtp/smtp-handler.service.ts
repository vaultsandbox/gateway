/**
 * SMTP Handler Service
 *
 * Core service responsible for handling SMTP protocol interactions and routing
 * email data based on gateway mode (local or backend).
 *
 * ## Responsibilities
 * - SMTP authentication handling (accept all for receive-only server)
 * - Sender address validation with SPF and reverse DNS checks
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
 * - Non-blocking SPF/DKIM/DMARC validation (logged but not enforced)
 * - Per-session validation result caching
 *
 * @module smtp-handler
 */

import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { SMTPServerAddress, SMTPServerDataStream, SMTPServerSession } from 'smtp-server';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Cron, CronExpression } from '@nestjs/schedule';

import type {
  ReceivedEmail,
  SpfResult,
  ReverseDnsResult,
  DkimResult,
  DmarcResult,
} from './interfaces/email-session.interface';
import type { SmtpConfig } from './interfaces/smtp-config.interface';
import type { EncryptedBodyPayload, AttachmentData } from './interfaces/encrypted-body.interface';
import type { LocalParsedMail, ParsedMailAttachment } from './interfaces/parsed-email.interface';
import type { Inbox } from '../inbox/interfaces';
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

@Injectable()
export class SmtpHandlerService {
  private readonly logger = new Logger(SmtpHandlerService.name);
  private readonly config: SmtpConfig;
  private readonly spfResultCache = new Map<string, TimestampedCacheEntry<SpfResult>>();
  private readonly reverseDnsResultCache = new Map<string, TimestampedCacheEntry<ReverseDnsResult>>();
  private readonly gatewayMode: 'local' | 'backend';
  private readonly sessionCacheMaxAge = 5 * 60 * 1000; // 5 minutes

  /**
   * Constructor with conditional service injection based on gateway mode
   */
  constructor(
    private readonly configService: ConfigService,
    private readonly emailValidationService: EmailValidationService,
    private readonly emailProcessingService: EmailProcessingService,
    private readonly metricsService: MetricsService,
    private readonly sseConsoleService: SseConsoleService,
    @Optional() private readonly inboxService?: InboxService,
    @Optional() private readonly inboxStorageService?: InboxStorageService,
    @Optional() private readonly cryptoService?: CryptoService,
    @Optional() private readonly httpService?: HttpService,
    @Optional() private readonly eventsService?: EventsService,
    @Optional() private readonly emailStorageService?: EmailStorageService,
  ) {
    this.config = this.configService.get<SmtpConfig>('vsb.smtp')!;
    const configuredGatewayMode =
      this.configService.get<string>('vsb.main.gatewayMode', DEFAULT_GATEWAY_MODE) ?? DEFAULT_GATEWAY_MODE;
    this.gatewayMode = (configuredGatewayMode || DEFAULT_GATEWAY_MODE) as 'local' | 'backend';

    this.logger.log(`SMTP Handler initialized in ${this.gatewayMode.toUpperCase()} mode`);

    if (this.gatewayMode === 'local' && (!this.inboxService || !this.cryptoService)) {
      this.logger.warn('Local mode enabled but InboxService or CryptoService not available');
    }

    if (this.gatewayMode === 'backend' && !this.httpService) {
      this.logger.warn('Backend mode enabled but HttpService not available');
    }

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
   * a valid email address. Also performs SPF validation by checking if the
   * sending server's IP is authorized to send mail for the sender's domain.
   * SPF validation is non-blocking - results are logged but do not reject mail.
   *
   * @param address - The sender address to validate
   * @param session - Current SMTP session containing remote IP address
   * @returns SPF validation result (for logging purposes)
   * @throws {Error} If the address is not email-like
   * @throws {Error} If hard mode is active (no inboxes exist)
   */
  async validateSender(address: SMTPServerAddress, session: SMTPServerSession): Promise<SpfResult> {
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

    if (!isEmailLike(address.address)) {
      throw new Error(`Invalid MAIL FROM address: ${address.address}`);
    }

    const domain = extractDomain(address.address);
    const remoteIp = normalizeIp(session.remoteAddress);

    const [spfResult, reverseDnsResult] = await Promise.all([
      this.emailValidationService.verifySpf(domain, remoteIp, address.address, session.id),
      this.emailValidationService.verifyReverseDns(remoteIp, session.id),
    ]);

    const timestamp = Date.now();
    this.spfResultCache.set(session.id, { value: spfResult, timestamp });
    this.reverseDnsResultCache.set(session.id, { value: reverseDnsResult, timestamp });

    // Log sender validation outcome to SSE console
    this.sseConsoleService.logSenderValidation(address.address, remoteIp, spfResult?.status, reverseDnsResult?.status);

    return spfResult;
  }

  /**
   * Cleans up session-specific caches when a connection closes.
   *
   * This method is called by the SMTP server's onClose handler to immediately
   * release memory associated with SPF and reverse DNS validation results.
   * Prevents memory leaks from clients that disconnect before DATA phase.
   *
   * @param sessionId - The SMTP session ID to clean up
   */
  cleanupSession(sessionId: string): void {
    const hadSpf = this.spfResultCache.delete(sessionId);
    const hadReverseDns = this.reverseDnsResultCache.delete(sessionId);

    if (hadSpf || hadReverseDns) {
      this.logger.debug(`Cleaned up session cache for ${sessionId} (SPF: ${hadSpf}, ReverseDNS: ${hadReverseDns})`);
    }
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
    let cleanedSpf = 0;
    let cleanedReverseDns = 0;

    // Cleanup stale SPF cache entries
    for (const [sessionId, entry] of this.spfResultCache.entries()) {
      if (now - entry.timestamp > this.sessionCacheMaxAge) {
        this.spfResultCache.delete(sessionId);
        cleanedSpf++;
      }
    }

    // Cleanup stale reverse DNS cache entries
    for (const [sessionId, entry] of this.reverseDnsResultCache.entries()) {
      if (now - entry.timestamp > this.sessionCacheMaxAge) {
        this.reverseDnsResultCache.delete(sessionId);
        cleanedReverseDns++;
      }
    }

    if (cleanedSpf > 0 || cleanedReverseDns > 0) {
      this.logger.warn(
        `Cleaned up ${cleanedSpf + cleanedReverseDns} stale session cache entries ` +
          `(SPF: ${cleanedSpf}, ReverseDNS: ${cleanedReverseDns}). ` +
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

    // Validate complete email structure (local part + domain)
    if (!isEmailLike(address.address)) {
      throw new Error(`Invalid RCPT TO address: ${address.address}`);
    }

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

    // Branch based on gateway mode
    let result: ReceivedEmail;
    if (this.gatewayMode === 'local') {
      result = await this.handleDataLocalMode(rawData, stream, session);
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
    const parsedHeaders = this.parseHeaders(rawData.toString('utf8'));
    const parsedMail = await this.emailProcessingService.parseEmail(rawData, session.id);
    const messageId = this.extractMessageId(parsedHeaders);
    const from = this.extractSmtpAddress(session.envelope.mailFrom);
    const to = session.envelope.rcptTo
      .map((recipient) => this.extractSmtpAddress(recipient))
      .filter((address): address is string => Boolean(address));
    const receivedAt = new Date();

    const recipientContexts = this.resolveRecipientInboxes(to, inboxService);
    const validationResults = await this.performEmailValidation(rawData, session, parsedHeaders);
    const parsedPayload = this.buildParsedPayload(parsedMail, from, to, validationResults, session);
    const rawPayload = rawData.toString('base64');

    for (const recipientContext of recipientContexts) {
      const emailId = randomUUID();
      const metadataPayload = this.buildMetadataPayload(
        emailId,
        from,
        recipientContext.recipientAddress,
        parsedMail?.subject,
        receivedAt,
      );

      const encryptedPayloads = await this.encryptEmailData(
        cryptoService,
        recipientContext.inbox,
        metadataPayload,
        parsedPayload,
        rawPayload,
      );

      this.storeEmail(recipientContext.baseEmail, emailId, encryptedPayloads);

      const aliasInfo =
        recipientContext.recipientAddress !== recipientContext.baseEmail
          ? ` (alias of ${recipientContext.baseEmail})`
          : '';
      this.logger.log(
        `Email ${emailId} encrypted and stored for ${recipientContext.recipientAddress}${aliasInfo} (session=${session.id}) from '${from ?? 'unknown'}' (${stream.byteLength} bytes)`,
      );

      this.notifyClient(recipientContext.inbox, emailId, encryptedPayloads.encryptedMetadata);
    }

    const { spfResult, dkimResults, dmarcResult, reverseDnsResult } = validationResults;
    return {
      from,
      to,
      messageId,
      rawData,
      size: stream.byteLength,
      headers: parsedHeaders,
      spfResult,
      dkimResults,
      dmarcResult,
      reverseDnsResult,
    };
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
   */
  private async performEmailValidation(
    rawData: Buffer,
    session: SMTPServerSession,
    parsedHeaders: Record<string, string>,
  ): Promise<EmailValidationResults> {
    const spfResult = this.spfResultCache.get(session.id)?.value;
    this.spfResultCache.delete(session.id);

    const reverseDnsResult = this.reverseDnsResultCache.get(session.id)?.value;
    this.reverseDnsResultCache.delete(session.id);

    const dkimResults = await this.emailValidationService.verifyDkim(rawData, session.id);
    const dmarcResult = await this.emailValidationService.verifyDmarc(
      parsedHeaders,
      spfResult,
      dkimResults,
      session.id,
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
   * Builds the parsed email payload that will be encrypted for the client.
   */
  private buildParsedPayload(
    parsedMail: LocalParsedMail | undefined,
    from: string | undefined,
    to: string[],
    validationResults: EmailValidationResults,
    session: SMTPServerSession,
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
      from: from || 'unknown',
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
              domain: spfResult.domain || extractDomain(from || '') || 'unknown',
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
              hostname: reverseDnsResult.hostname || '',
              verified: reverseDnsResult.status === 'pass',
              ip: normalizeIp(session.remoteAddress) || 'unknown',
            }
          : undefined,
      },
      links: links.length > 0 ? links : undefined,
    };
  }

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
    const metadataPlaintext = Buffer.from(JSON.stringify(metadataPayload), 'utf-8');
    const parsedPlaintext = Buffer.from(JSON.stringify(parsedPayload), 'utf-8');
    const rawPlaintext = Buffer.from(rawPayload, 'utf-8');

    const metadataAad = Buffer.from('vaultsandbox:metadata', 'utf-8');
    const parsedAad = Buffer.from('vaultsandbox:parsed', 'utf-8');
    const rawAad = Buffer.from('vaultsandbox:raw', 'utf-8');

    const encryptedMetadata = await cryptoService.encryptForClient(inbox.clientKemPk, metadataPlaintext, metadataAad);
    const encryptedParsed = await cryptoService.encryptForClient(inbox.clientKemPk, parsedPlaintext, parsedAad);
    const encryptedRaw = await cryptoService.encryptForClient(inbox.clientKemPk, rawPlaintext, rawAad);

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
  private storeEmail(baseEmail: string, emailId: string, encryptedPayloads: EncryptedEmailPayloads): void {
    // EmailStorageService is always available in local mode (same lifecycle as InboxService)
    this.emailStorageService!.storeEmail(baseEmail, emailId, encryptedPayloads);
  }

  /**
   * Emits SSE events for new emails. Non-critical failures are logged only.
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
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to emit SSE event for email ${emailId}: ${message}`);
    }
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
  private collectStream(stream: SMTPServerDataStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      stream.on('data', (chunk) => {
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

      if (!line.trim()) {
        continue;
      }

      if (/^[\t ]/.test(line) && currentKey) {
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
   * Converts a Buffer or string to a UTF-8 string
   *
   * Helper method to safely convert various content types to strings.
   * Returns null if the input is falsy or explicitly false.
   *
   * @param buf - Buffer, string, false, or undefined
   * @returns UTF-8 string or null
   */
  private bufferToString(buf: string | Buffer | false | undefined): string | null {
    if (!buf) return null;
    if (typeof buf === 'string') return buf;
    return buf.toString('utf-8');
  }

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
}
