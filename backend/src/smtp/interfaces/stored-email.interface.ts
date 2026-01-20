/**
 * Type definitions for stored email records
 *
 * These interfaces describe the structure of emails as they are persisted
 * to disk for audit trails and archival purposes.
 *
 * @module stored-email
 */

import type {
  SpfResult,
  DkimResult,
  DmarcResult,
  ReverseDnsResult,
  SpamAnalysisResult,
} from './email-session.interface';
import type { ParsedMailSummary } from './parsed-email.interface';

/**
 * Complete email record as stored on disk
 *
 * Contains all metadata, validation results, parsed content, and raw email data
 * in a JSON-serializable format suitable for long-term storage and audit trails.
 */
export interface StoredEmailRecord {
  /**
   * Unique identifier for this email (Message-ID or session ID fallback)
   */
  id: string;

  /**
   * SMTP session ID that received this email
   */
  sessionId: string;

  /**
   * ISO 8601 timestamp when the email was received
   */
  receivedAt: string;

  /**
   * IP address of the connecting SMTP client
   */
  remoteAddress?: string;

  /**
   * Hostname provided by the client in EHLO/HELO command
   */
  clientHostname?: string;

  /**
   * SMTP envelope information (separate from email headers)
   */
  envelope: {
    /**
     * Sender address from MAIL FROM command
     */
    mailFrom?: string;

    /**
     * Recipient addresses from RCPT TO commands
     */
    rcptTo: string[];
  };

  /**
   * Email size in bytes
   */
  size: number;

  /**
   * Email headers as key-value pairs
   */
  headers: Record<string, string>;

  /**
   * Email authentication validation results
   */
  validations: {
    /**
     * SPF (Sender Policy Framework) validation result
     */
    spf?: SpfResult;

    /**
     * DKIM (DomainKeys Identified Mail) validation results
     * Multiple signatures possible if email signed by multiple domains
     */
    dkim?: DkimResult[];

    /**
     * DMARC (Domain-based Message Authentication) validation result
     */
    dmarc?: DmarcResult;

    /**
     * Reverse DNS (PTR record) validation result
     */
    reverseDns?: ReverseDnsResult;
  };

  /**
   * Spam analysis results from Rspamd
   */
  spamAnalysis?: SpamAnalysisResult;

  /**
   * Parsed email content (subject, body, attachments, etc.)
   */
  parsed?: ParsedMailSummary;

  /**
   * Encoding used for the raw email data (always 'base64')
   */
  rawEncoding: 'base64';

  /**
   * Complete raw email message encoded in base64
   * Can be decoded to reconstruct the original email exactly as received
   */
  raw: string;
}
