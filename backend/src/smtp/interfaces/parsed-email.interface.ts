/**
 * Type definitions for parsed email content
 *
 * These interfaces describe the structure of emails parsed by the mailparser library
 * and their serialized summaries for storage and transmission.
 *
 * @module parsed-email
 */

/**
 * Email address structure from mailparser
 *
 * Represents a parsed email address with both human-readable and machine-readable formats.
 */
export interface EmailAddress {
  /**
   * Array of address objects with name and email
   */
  value: Array<{ address?: string; name?: string }>;

  /**
   * HTML-formatted address string
   */
  html: string;

  /**
   * Plain text address string
   */
  text: string;
}

/**
 * Parsed email attachment metadata and content
 *
 * Describes an attachment extracted from an email by the mailparser library.
 */
export interface ParsedMailAttachment {
  /**
   * Attachment filename, or false if inline content
   */
  filename?: string | false;

  /**
   * MIME content type (e.g., 'image/png', 'application/pdf')
   */
  contentType?: string;

  /**
   * Size of the attachment in bytes
   */
  size?: number;

  /**
   * Checksum hash of the attachment content
   */
  checksum?: string;

  /**
   * Content-Disposition header value ('attachment' or 'inline')
   */
  contentDisposition?: string;

  /**
   * Content-ID for referencing inline attachments in HTML
   */
  cid?: string;

  /**
   * Whether this attachment is referenced in the HTML content
   */
  related?: boolean;

  /**
   * Raw attachment content as Buffer or string
   */
  content?: Buffer | string;
}

/**
 * Parsed email structure from mailparser
 *
 * Complete representation of a parsed email message with all headers,
 * content, and attachments extracted by the mailparser library.
 */
export interface LocalParsedMail {
  /**
   * Email subject line
   */
  subject?: string;

  /**
   * Unique message identifier from Message-ID header
   */
  messageId?: string;

  /**
   * Date the email was sent
   */
  date?: Date;

  /**
   * Sender address (From header)
   */
  from?: EmailAddress;

  /**
   * Primary recipient addresses (To header)
   */
  to?: EmailAddress;

  /**
   * Carbon copy recipient addresses (Cc header)
   */
  cc?: EmailAddress;

  /**
   * Blind carbon copy recipient addresses (Bcc header)
   */
  bcc?: EmailAddress;

  /**
   * Reply-to address (Reply-To header)
   */
  replyTo?: EmailAddress;

  /**
   * Message-ID this email is replying to (In-Reply-To header)
   */
  inReplyTo?: string | string[];

  /**
   * Array of related Message-IDs (References header)
   */
  references?: string[];

  /**
   * Email priority level
   */
  priority?: 'high' | 'normal' | 'low';

  /**
   * Plain text email body
   */
  text?: string;

  /**
   * Plain text converted to HTML format
   */
  textAsHtml?: string | Buffer;

  /**
   * HTML email body, or false if none present
   */
  html?: string | Buffer | false;

  /**
   * Array of email attachments
   */
  attachments?: ParsedMailAttachment[];

  /**
   * All email headers as a Map
   */
  headers?: Map<string, string | string[]>;

  /**
   * Extracted URLs from email HTML and text content
   *
   * Array of unique URLs extracted from both HTML anchor tags and plain text.
   * Supports http://, https://, ftp://, and mailto: schemes.
   * URLs are deduplicated while preserving order of first occurrence.
   */
  links?: string[];
}

/**
 * Serialized attachment summary for storage
 *
 * Simplified attachment representation suitable for JSON serialization
 * and long-term storage.
 */
export interface AttachmentSummary {
  /**
   * Attachment filename, or false if inline content
   */
  filename?: string | false;

  /**
   * MIME content type
   */
  contentType?: string;

  /**
   * Size of the attachment in bytes
   */
  size?: number;

  /**
   * Checksum hash of the attachment content
   */
  checksum?: string;

  /**
   * Content-Disposition header value
   */
  contentDisposition?: string;

  /**
   * Content-ID for inline attachments
   */
  cid?: string;

  /**
   * Whether this attachment is referenced in HTML
   */
  related?: boolean;

  /**
   * Content encoding used for storage (always 'base64' when present)
   */
  contentEncoding?: 'base64';

  /**
   * Base64-encoded attachment content
   */
  content?: string;
}

/**
 * Serialized parsed email summary for storage
 *
 * JSON-serializable representation of a parsed email suitable for
 * persistent storage and API responses.
 */
export interface ParsedMailSummary {
  /**
   * Email subject line
   */
  subject?: string;

  /**
   * Unique message identifier
   */
  messageId?: string;

  /**
   * ISO 8601 formatted date string
   */
  date?: string;

  /**
   * Sender address as text
   */
  from?: string;

  /**
   * Primary recipients as text
   */
  to?: string;

  /**
   * Carbon copy recipients as text
   */
  cc?: string;

  /**
   * Blind carbon copy recipients as text
   */
  bcc?: string;

  /**
   * Reply-to address as text
   */
  replyTo?: string;

  /**
   * Message-ID(s) this email is replying to
   */
  inReplyTo?: string | string[] | undefined;

  /**
   * Array of related Message-IDs
   */
  references?: string[] | undefined;

  /**
   * Email priority level
   */
  priority?: 'high' | 'normal' | 'low';

  /**
   * Plain text email body
   */
  text?: string;

  /**
   * Plain text converted to HTML format
   */
  textAsHtml?: string;

  /**
   * HTML email body
   */
  html?: string;

  /**
   * Array of serialized attachments
   */
  attachments?: AttachmentSummary[];

  /**
   * Email headers as a plain object
   */
  headers?: Record<string, unknown>;

  /**
   * Extracted URLs from email HTML and text content
   *
   * Array of unique URLs extracted during email parsing.
   * Includes URLs from both HTML anchor tags and plain text.
   * Supports http://, https://, ftp://, and mailto: schemes.
   */
  links?: string[];
}
