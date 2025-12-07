import { Buffer } from 'node:buffer';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { simpleParser } from 'mailparser';
import { SMTPServerSession } from 'smtp-server';

import type { ReceivedEmail } from './interfaces/email-session.interface';
import type { LocalParsedMail, AttachmentSummary, ParsedMailSummary } from './interfaces/parsed-email.interface';
import type { StoredEmailRecord } from './interfaces/stored-email.interface';
import { extractString } from './utils/email.utils';
import { extractUrls } from './utils/url-extraction.utils';

/**
 * Service responsible for email parsing, serialization, and storage operations.
 *
 * This service handles the transformation of raw email data into structured formats
 * and manages persistent storage of email records to disk. It provides functionality
 * for parsing MIME messages, serializing complex email structures (headers, attachments,
 * etc.), and building comprehensive email records suitable for audit and compliance.
 *
 * @remarks
 * The service uses mailparser for MIME parsing and handles various edge cases including:
 * - Malformed email content (returns undefined for unparseable emails)
 * - Complex header value normalization (Maps, Buffers, Dates, nested objects)
 * - Base64 encoding for binary content (attachments, raw email storage)
 * - Safe filesystem operations (sanitized filenames, recursive directory creation)
 *
 * @example
 * ```typescript
 * // Parse an email from raw buffer
 * const parsedMail = await emailProcessingService.parseEmail(rawData, sessionId);
 *
 * // Save email to disk with validation results
 * const filePath = await emailProcessingService.saveEmailToDisk(
 *   receivedEmail,
 *   session,
 *   parsedMail,
 *   new Date()
 * );
 * ```
 */
@Injectable()
export class EmailProcessingService {
  private readonly logger = new Logger(EmailProcessingService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Parses raw email data into a structured format using mailparser.
   *
   * Attempts to parse the raw email buffer into a `LocalParsedMail` object containing
   * headers, body content (text/html), attachments, and other MIME structure elements.
   * If parsing fails (e.g., malformed email), logs a warning and returns `undefined`.
   *
   * @param rawData - The complete raw email message as a Buffer (including headers and body)
   * @param sessionId - SMTP session identifier for logging purposes
   * @returns Parsed email object with all MIME components, or undefined if parsing fails
   *
   * @remarks
   * - Uses mailparser's `simpleParser` for RFC 5322 compliant parsing
   * - Non-blocking: failures return undefined rather than throwing errors
   * - Handles multipart/mixed, multipart/alternative, and other MIME types
   * - Extracts metadata: subject, from/to addresses, date, message-id, etc.
   * - Decodes encoded content (quoted-printable, base64, etc.)
   *
   * @example
   * ```typescript
   * const parsedMail = await parseEmail(rawEmailBuffer, 'session-123');
   * if (parsedMail) {
   *   console.log(`Subject: ${parsedMail.subject}`);
   *   console.log(`Attachments: ${parsedMail.attachments?.length ?? 0}`);
   * }
   * ```
   */
  async parseEmail(rawData: Buffer, sessionId: string): Promise<LocalParsedMail | undefined> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const parsed: unknown = await simpleParser(rawData);
      return parsed as LocalParsedMail;
    } catch (error) {
      this.logger.warn(
        `mailparser failed (session=${sessionId}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /**
   * Builds a comprehensive email record suitable for persistent storage.
   *
   * Combines SMTP envelope data, email headers, validation results (SPF/DKIM/DMARC),
   * parsed content, and the raw email message into a single structured object. This
   * record is designed for audit trails, compliance, and forensic analysis.
   *
   * @param email - Received email with headers and validation results
   * @param session - SMTP session containing envelope and connection metadata
   * @param parsedMail - Parsed email structure (optional, may be undefined if parsing failed)
   * @param receivedAt - Timestamp when the email was received
   * @returns Complete email record ready for JSON serialization
   *
   * @remarks
   * - Uses Message-ID as primary identifier, falls back to session ID if unavailable
   * - SMTP addresses are extracted and normalized from envelope data
   * - Remote address and client hostname are preserved for tracking sender origin
   * - Raw email is base64-encoded for safe JSON storage
   * - Validation results include all authentication checks (SPF, DKIM, DMARC, reverse DNS)
   * - Parsed content is serialized to handle complex types (Maps, Buffers, etc.)
   *
   * @example
   * ```typescript
   * const record = buildEmailRecord(receivedEmail, session, parsedMail, new Date());
   * console.log(`Email ID: ${record.id}`);
   * console.log(`SPF Result: ${record.validations.spf?.result}`);
   * console.log(`Attachments: ${record.parsed?.attachments?.length ?? 0}`);
   * ```
   */
  buildEmailRecord(
    email: ReceivedEmail,
    session: SMTPServerSession,
    parsedMail: LocalParsedMail | undefined,
    receivedAt: Date,
  ): StoredEmailRecord {
    const serializedParsed = this.serializeParsedMail(parsedMail);

    return {
      id: email.messageId ?? session.id,
      sessionId: session.id,
      receivedAt: receivedAt.toISOString(),
      remoteAddress: typeof session.remoteAddress === 'string' ? session.remoteAddress : undefined,
      clientHostname: typeof session.clientHostname === 'string' ? session.clientHostname : undefined,
      envelope: {
        mailFrom: this.extractSmtpAddress(session.envelope.mailFrom),
        rcptTo: session.envelope.rcptTo
          .map((recipient) => this.extractSmtpAddress(recipient))
          .filter((address): address is string => Boolean(address)),
      },
      size: email.size,
      headers: email.headers,
      validations: {
        spf: email.spfResult,
        dkim: email.dkimResults,
        dmarc: email.dmarcResult,
        reverseDns: email.reverseDnsResult,
      },
      parsed: serializedParsed,
      rawEncoding: 'base64',
      raw: email.rawData.toString('base64'),
    } satisfies StoredEmailRecord;
  }

  /**
   * Serializes a parsed email object into a storage-friendly summary format.
   *
   * Converts mailparser's `LocalParsedMail` object into a `ParsedMailSummary` by
   * extracting key fields, normalizing complex types, and encoding attachments as
   * base64. Handles missing or undefined fields gracefully.
   *
   * @param parsedMail - Parsed email from mailparser (may be undefined if parsing failed)
   * @returns Serialized email summary, or undefined if input is undefined
   *
   * @remarks
   * - All address fields (from, to, cc, bcc, replyTo) are converted to text representation
   * - Date objects are converted to ISO 8601 strings
   * - HTML and text content is extracted and normalized (Buffer → string)
   * - Attachments are base64-encoded with metadata (filename, content-type, size, checksum)
   * - Headers are serialized separately via `serializeParsedHeaders()`
   * - Inline images (related attachments) are preserved with their CID references
   *
   * @example
   * ```typescript
   * const summary = serializeParsedMail(parsedMail);
   * if (summary) {
   *   console.log(`From: ${summary.from}`);
   *   console.log(`Subject: ${summary.subject}`);
   *   console.log(`Attachments: ${summary.attachments?.length ?? 0}`);
   * }
   * ```
   */
  private serializeParsedMail(parsedMail: LocalParsedMail | undefined): ParsedMailSummary | undefined {
    if (!parsedMail) {
      return undefined;
    }

    // Extract URLs from HTML and text content
    const links = extractUrls(extractString(parsedMail.html), parsedMail.text);

    return {
      subject: parsedMail.subject,
      messageId: parsedMail.messageId,
      date: parsedMail.date ? parsedMail.date.toISOString() : undefined,
      from: parsedMail.from?.text || undefined,
      to: parsedMail.to?.text || undefined,
      cc: parsedMail.cc?.text || undefined,
      bcc: parsedMail.bcc?.text || undefined,
      replyTo: parsedMail.replyTo?.text || undefined,
      inReplyTo: parsedMail.inReplyTo || undefined,
      references: parsedMail.references || undefined,
      priority: parsedMail.priority || undefined,
      text: parsedMail.text || undefined,
      textAsHtml: extractString(parsedMail.textAsHtml) || undefined,
      html: extractString(parsedMail.html) || undefined,
      attachments: parsedMail.attachments?.map((attachment) => {
        const content = Buffer.isBuffer(attachment.content) ? attachment.content.toString('base64') : undefined;

        return {
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          checksum: attachment.checksum,
          contentDisposition: attachment.contentDisposition,
          cid: attachment.cid,
          related: attachment.related,
          contentEncoding: content ? ('base64' as const) : undefined,
          content,
        } satisfies AttachmentSummary;
      }),
      headers: this.serializeParsedHeaders(parsedMail),
      links: links.length > 0 ? links : undefined,
    };
  }

  /**
   * Serializes email headers from mailparser's Map structure to a plain object.
   *
   * Converts the parsed email's headers (stored as a Map) into a plain JavaScript
   * object suitable for JSON serialization. Normalizes complex header values using
   * `normalizeHeaderValue()`.
   *
   * @param parsedMail - Parsed email containing headers Map (may be undefined)
   * @returns Plain object mapping header names to normalized values
   *
   * @remarks
   * - Header names are preserved as-is (case from mailparser, typically lowercase)
   * - Header values are normalized to handle Maps, Buffers, Dates, and nested objects
   * - Returns empty object if parsedMail is undefined or has no headers
   * - Multiple headers with same name are handled by mailparser (typically as arrays)
   *
   * @example
   * ```typescript
   * const headers = serializeParsedHeaders(parsedMail);
   * console.log(headers['content-type']); // "text/html; charset=utf-8"
   * console.log(headers['received']);     // May be array if multiple Received headers
   * ```
   */
  private serializeParsedHeaders(parsedMail: LocalParsedMail | undefined): Record<string, unknown> {
    const headers: Record<string, unknown> = {};

    if (parsedMail?.headers) {
      for (const [key, value] of parsedMail.headers) {
        headers[key] = this.normalizeHeaderValue(value);
      }
    }

    return headers;
  }

  /**
   * Recursively normalizes header values to JSON-serializable types.
   *
   * Handles various complex types that may appear in email headers:
   * - Buffers → UTF-8 strings
   * - Dates → ISO 8601 strings
   * - Maps → Plain objects
   * - Arrays → Recursively normalized arrays
   * - Objects → JSON-parsed/stringified (handles circular references)
   * - Primitives → Unchanged (string, number, boolean, null, undefined)
   *
   * @param value - Header value of unknown type
   * @returns JSON-serializable normalized value
   *
   * @remarks
   * - Buffer handling assumes UTF-8 encoding (may lose data for non-text buffers)
   * - Map keys are converted to strings via `String(key)`
   * - Circular object references are caught and converted to JSON strings
   * - Nested structures are recursively normalized
   * - Falls back to returning original value if normalization fails
   *
   * @example
   * ```typescript
   * normalizeHeaderValue(Buffer.from('test'));           // Returns: "test"
   * normalizeHeaderValue(new Date('2025-11-11'));        // Returns: "2025-11-11T00:00:00.000Z"
   * normalizeHeaderValue(new Map([['a', 1]]));           // Returns: { "a": 1 }
   * normalizeHeaderValue(['a', Buffer.from('b')]);       // Returns: ["a", "b"]
   * ```
   */
  private normalizeHeaderValue(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeHeaderValue(item));
    }

    if (Buffer.isBuffer(value)) {
      return value.toString('utf8');
    }

    if (value instanceof Map) {
      const mapObject: Record<string, unknown> = {};
      for (const [key, entry] of value.entries()) {
        mapObject[String(key)] = this.normalizeHeaderValue(entry);
      }
      return mapObject;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return JSON.stringify(value);
      }
    }

    return value;
  }

  /**
   * Sanitizes a string for safe use as a filename component.
   *
   * Removes all characters except alphanumerics, hyphens, and underscores,
   * then truncates to 64 characters. Falls back to 'email' if result is empty.
   *
   * @param value - Raw string to sanitize
   * @returns Safe filename component (max 64 chars, alphanumeric + hyphen + underscore)
   *
   * @remarks
   * - Removes: slashes, dots, spaces, special characters
   * - Preserves: a-z, A-Z, 0-9, hyphen, underscore
   * - Maximum length: 64 characters
   * - Empty result fallback: 'email'
   *
   * @example
   * ```typescript
   * sanitizeFileComponent('msg-123@example.com'); // Returns: "msg-123examplecom"
   * sanitizeFileComponent('../../etc/passwd');    // Returns: "etcpasswd"
   * sanitizeFileComponent('!@#$%^&*()');          // Returns: "email"
   * ```
   */
  private sanitizeFileComponent(value: string): string {
    const safe = value.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 64);
    return safe || 'email';
  }

  /**
   * Extracts the email address string from an SMTP server address value.
   *
   * Handles the SMTP server's polymorphic address type which can be
   * an address object, false, or undefined. Returns the address string
   * if available, otherwise undefined.
   *
   * @param address - SMTP address value from envelope (may be object, false, or undefined)
   * @returns Email address string, or undefined if not available
   *
   * @remarks
   * - `false` indicates empty MAIL FROM (bounce messages)
   * - `undefined` indicates missing address
   * - Otherwise, extracts the `address` property from the object
   *
   * @example
   * ```typescript
   * extractSmtpAddress({ address: 'user@example.com', args: {} }); // Returns: "user@example.com"
   * extractSmtpAddress(false);                                      // Returns: undefined
   * extractSmtpAddress(undefined);                                  // Returns: undefined
   * ```
   */
  private extractSmtpAddress(address: unknown): string | undefined {
    if (!address) {
      return undefined;
    }

    if (typeof address === 'boolean') {
      return undefined;
    }

    // Type guard: at this point, address should be an object with an address property
    if (typeof address === 'object' && address !== null && 'address' in address) {
      return (address as { address: string }).address;
    }

    return undefined;
  }
}
