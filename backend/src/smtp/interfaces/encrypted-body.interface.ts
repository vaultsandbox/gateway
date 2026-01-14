/**
 * Type definitions for encrypted email body payload
 *
 * These interfaces describe the structure of the encrypted email body payload
 * that is sent to the frontend. Instead of encrypting the raw email buffer,
 * we encrypt a JSON structure containing all parsed email data, authentication
 * results, and the raw email for .eml download.
 *
 * @module encrypted-body
 */

/**
 * Attachment data for frontend display and download
 *
 * Contains attachment metadata and base64-encoded content for download.
 */
export interface AttachmentData {
  /**
   * Attachment filename
   */
  filename: string;

  /**
   * MIME content type (e.g., 'image/png', 'application/pdf')
   */
  contentType: string;

  /**
   * Size of the attachment in bytes
   */
  size: number;

  /**
   * Content-ID for inline images (cid: references in HTML)
   */
  contentId?: string;

  /**
   * Content-Disposition header value ('inline' or 'attachment')
   */
  contentDisposition?: string;

  /**
   * Checksum hash of the attachment content
   */
  checksum?: string;

  /**
   * Base64-encoded attachment content
   */
  content: string;
}

/**
 * Authentication results for email validation
 *
 * Contains SPF, DKIM, DMARC, and reverse DNS validation results
 * that are displayed in the frontend authentication tab.
 */
export interface AuthenticationResults {
  /**
   * SPF (Sender Policy Framework) validation result
   */
  spf?: {
    result: string;
    domain: string;
    details: string;
  };

  /**
   * DKIM (DomainKeys Identified Mail) validation results
   * Can have multiple signatures from different domains
   */
  dkim?: Array<{
    domain: string;
    result: string;
    selector: string;
    signature: string;
  }>;

  /**
   * DMARC (Domain-based Message Authentication) validation result
   */
  dmarc?: {
    result: string;
    policy: string;
    domain: string;
    aligned: boolean;
  };

  /**
   * Reverse DNS (PTR record) validation result
   */
  reverseDns?: {
    result: string;
    hostname: string;
    ip: string;
  };
}

/**
 * Complete encrypted body payload
 *
 * This structure is encrypted and sent to the frontend, replacing the
 * raw email buffer encryption. It contains all parsed email data,
 * authentication results, and the raw email for .eml download.
 */
export interface EncryptedBodyPayload {
  // Content variations
  /**
   * HTML email body
   */
  html: string | null;

  /**
   * Plain text email body
   */
  text: string | null;

  /**
   * Plain text converted to HTML format
   */
  textAsHtml: string | null;

  // Headers
  /**
   * All email headers as key-value pairs
   * Values can be string or string[] for headers with multiple values
   */
  headers: Record<string, string | string[]>;

  // Extended Metadata (supplement to encrypted metadata)
  /**
   * Email subject line
   */
  subject: string;

  /**
   * Unique message identifier from Message-ID header
   */
  messageId?: string;

  /**
   * ISO 8601 formatted date string
   */
  date?: string;

  /**
   * Sender address
   */
  from: string;

  /**
   * Recipient addresses (comma-separated)
   */
  to: string;

  /**
   * Carbon copy recipients
   */
  cc?: string;

  /**
   * Blind carbon copy recipients
   */
  bcc?: string;

  /**
   * Reply-to address
   */
  replyTo?: string;

  /**
   * Message-ID(s) this email is replying to
   */
  inReplyTo?: string | string[];

  /**
   * Array of related Message-IDs
   */
  references?: string[];

  /**
   * Email priority level
   */
  priority?: 'high' | 'normal' | 'low';

  // Attachments
  /**
   * Array of email attachments with base64-encoded content
   */
  attachments: AttachmentData[];

  // Authentication Results
  /**
   * Email authentication validation results
   * (SPF, DKIM, DMARC, reverse DNS)
   */
  authResults: AuthenticationResults;

  // Extracted URLs
  /**
   * Array of unique URLs extracted from email HTML and text content
   * Supports http://, https://, ftp://, and mailto: schemes
   */
  links?: string[];

  // Raw email for .eml download
  /**
   * Complete RFC 5322 email (base64 encoded for JSON safety)
   */
  rawEmail: string;
}
