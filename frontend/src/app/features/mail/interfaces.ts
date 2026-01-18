import { EncryptedPayload } from '../../shared/interfaces/encrypted-payload';

/**
 * Parsed and structured email content including headers, body, attachments, and authentication results.
 */
export interface ParsedEmailContent {
  /** HTML version of the email body, or null if not available */
  html: string | null;

  /** Plain text version of the email body, or null if not available */
  text: string | null;

  /** Plain text converted to HTML format for display, or null if not available */
  textAsHtml: string | null;

  /**
   * Raw headers as returned by the backend (may include complex objects from mailparser).
   */
  headers: Record<string, unknown>;

  /** Email subject line */
  subject: string;

  /** Unique message identifier */
  messageId?: string;

  /** Date the email was sent */
  date?: string;

  /** Sender email address */
  from: string;

  /** Recipient email address(es) */
  to: string;

  /** Carbon copy recipient email address(es) */
  cc?: string;

  /** Blind carbon copy recipient email address(es) */
  bcc?: string;

  /** Reply-to email address if different from sender */
  replyTo?: string;

  /** Message ID(s) that this email is in reply to */
  inReplyTo?: string | string[];

  /** Message IDs referenced by this email */
  references?: string[];

  /** Email priority level */
  priority?: 'high' | 'normal' | 'low';

  /** Array of attachments included with the email */
  attachments: AttachmentData[];

  /**
   * Extracted URLs from email HTML and text content
   *
   * Array of unique URLs extracted from both HTML anchor tags and plain text.
   * Supports http://, https://, ftp://, and mailto: schemes.
   */
  links?: string[];

  /** Email authentication results including SPF, DKIM, DMARC, and reverse DNS verification */
  authResults?: {
    spf?: {
      result: string;
      domain: string;
      details: string;
    };
    dkim?: {
      domain: string;
      result: string;
      selector: string;
      signature: string;
    }[];
    dmarc?: {
      result: string;
      policy: string;
      domain: string;
      aligned: boolean;
    };
    reverseDns?: {
      result: 'pass' | 'fail' | 'none' | 'skipped';
      hostname: string;
      ip: string;
    };
  };
}

/**
 * Represents an email attachment with metadata and content.
 */
export interface AttachmentData {
  /** Name of the attached file */
  filename: string;

  /** MIME type of the attachment (e.g., 'image/png', 'application/pdf') */
  contentType: string;

  /** Size of the attachment in bytes */
  size: number;

  /** Optional content ID for inline attachments referenced in HTML */
  contentId?: string;

  /** Content disposition header value (e.g., 'attachment', 'inline') */
  contentDisposition?: string;

  /** Optional checksum for verifying attachment integrity */
  checksum?: string;

  /** Base64-encoded attachment content */
  content: string;
}

/**
 * Model representing an email item in the inbox with optional decrypted data.
 */
export interface EmailItemModel {
  /** Unique identifier for the email */
  id: string;

  /** Encrypted email metadata payload from the server */
  encryptedMetadata: EncryptedPayload | null;

  /** Decrypted basic metadata including sender, recipient, subject, and received timestamp */
  decryptedMetadata?: {
    from: string;
    to: string;
    subject: string;
    receivedAt: string;
  };

  /** Decrypted raw email body (if fetched) */
  decryptedBody?: string;

  /** Parsed and structured email content (if fetched and parsed) */
  parsedContent?: ParsedEmailContent;

  /** Flag indicating if the full email body is currently being loaded */
  isLoadingBody?: boolean;

  /** Flag indicating if the email has been marked as read */
  isRead: boolean;
}

/**
 * Model representing an inbox with its emails and cryptographic keys.
 */
export interface InboxModel {
  /** The generated email address for this inbox */
  emailAddress: string;

  /** ISO timestamp when the inbox expires */
  expiresAt: string;

  /** Unique hash identifier for the inbox */
  inboxHash: string;

  /** Whether this inbox uses encryption */
  encrypted: boolean;

  /** Server's public signing key for verifying encrypted messages (only for encrypted inboxes) */
  serverSigPk?: string;

  /** Client's secret key for decrypting messages (only for encrypted inboxes) */
  secretKey?: Uint8Array;

  /** Array of emails in this inbox */
  emails: EmailItemModel[];
}

/**
 * Database model containing all inboxes managed by the application.
 */
export interface MailDBModel {
  /** Array of all inboxes stored locally */
  inboxes: InboxModel[];
}

/**
 * Exported inbox data structure for sharing or backup purposes.
 * Contains all necessary information to import and access an inbox.
 * Conforms to VaultSandbox Cryptographic Protocol Specification v1.0, Section 9.
 */
export interface ExportedInboxData {
  /** Export format version. MUST be 1. */
  version: 1;

  /** The email address for this inbox. MUST contain exactly one '@' character. */
  emailAddress: string;

  /** ISO timestamp when the inbox expires (ISO 8601 with Z suffix) */
  expiresAt: string;

  /** Unique hash identifier for the inbox. Non-empty. */
  inboxHash: string;

  /** Whether this inbox uses encryption */
  encrypted: boolean;

  /** Server's ML-DSA-65 public key (base64url encoded, 1952 bytes decoded). Only for encrypted inboxes. */
  serverSigPk?: string;

  /** ML-KEM-768 secret key (base64url encoded, 2400 bytes decoded). Only for encrypted inboxes. */
  secretKey?: string;

  /** ISO timestamp when the inbox was exported (ISO 8601 with Z suffix) */
  exportedAt: string;
}

/**
 * Result of an inbox import operation.
 */
export interface ImportResult {
  /** Name of the imported file */
  filename: string;

  /** Whether the import was successful */
  success: boolean;

  /** Human-readable message describing the import result */
  message: string;

  /** Email address of the imported inbox (if successful) */
  emailAddress?: string;
}

/**
 * Encryption policy values that control inbox encryption behavior.
 * - 'always': All inboxes are encrypted, no override allowed
 * - 'enabled': Default encrypted, can request plain
 * - 'disabled': Default plain, can request encrypted
 * - 'never': All inboxes are plain, no override allowed
 */
export type EncryptionPolicy = 'always' | 'enabled' | 'disabled' | 'never';

/**
 * Server configuration and cryptographic algorithm information.
 */
export interface ServerInfo {
  /** Server's public signing key */
  serverSigPk: string;

  /** Cryptographic algorithms used by the server */
  algs: { kem: string; sig: string; aead: string; kdf: string };

  /** Server context identifier */
  context: string;

  /** Maximum time-to-live for inboxes in seconds */
  maxTtl: number;

  /** Default time-to-live for inboxes in seconds */
  defaultTtl: number;

  /** If sse consolee is enabled at the server */
  sseConsole: boolean;

  /** Whether the clear all inboxes endpoint is enabled on the server */
  allowClearAllInboxes: boolean;

  /** Optional list of allowed email domains */
  allowedDomains?: string[];

  /** Encryption policy controlling inbox encryption behavior */
  encryptionPolicy: EncryptionPolicy;

  /** Whether the webhook system is enabled on this server */
  webhookEnabled: boolean;

  /** Default value for webhook requireAuth filter when not specified */
  webhookRequireAuthDefault: boolean;
}

/**
 * Response from the server when creating a new inbox.
 */
export interface CreateInboxResponse {
  /** The generated email address */
  emailAddress: string;

  /** ISO timestamp when the inbox expires */
  expiresAt: string;

  /** Unique hash identifier for the inbox */
  inboxHash: string;

  /** Whether this inbox is encrypted */
  encrypted: boolean;

  /** Server's public signing key (only present when encrypted=true) */
  serverSigPk?: string;

  /** Whether email authentication (SPF/DKIM/DMARC/PTR) is enabled for this inbox */
  emailAuth: boolean;
}

/**
 * Response structure for email list items from the server.
 * Contains minimal information for displaying emails in a list.
 * Supports both encrypted and plain formats - use field presence to discriminate.
 */
export interface EmailListItemResponse {
  /** Unique email identifier */
  id: string;

  /** Whether the email has been marked as read */
  isRead?: boolean;

  /** Encrypted metadata containing basic email information (encrypted inbox) */
  encryptedMetadata?: EncryptedPayload;

  /** Base64-encoded metadata JSON (plain inbox) */
  metadata?: string;
}

/**
 * Response structure for full email details from the server.
 * Contains encrypted content that needs to be decrypted client-side.
 * Supports both encrypted and plain formats - use field presence to discriminate.
 */
export interface EmailDetailResponse {
  /** Whether the email has been marked as read */
  isRead?: boolean;

  /** Encrypted parsed email content with structured data (encrypted inbox) */
  encryptedParsed?: EncryptedPayload;

  /** Encrypted raw email body (encrypted inbox) */
  encryptedBody?: EncryptedPayload;

  /** Encrypted email metadata (encrypted inbox) */
  encryptedMetadata?: EncryptedPayload;

  /** Base64-encoded parsed content JSON (plain inbox) */
  parsed?: string;

  /** Base64-encoded metadata JSON (plain inbox) */
  metadata?: string;
}

/**
 * Response structure for raw email content from the server.
 * Supports both encrypted and plain formats - use field presence to discriminate.
 */
export interface RawEmailResponse {
  /** Encrypted raw email data (encrypted inbox) */
  encryptedRaw?: EncryptedPayload;

  /** Base64-encoded raw email (plain inbox) */
  raw?: string;
}
