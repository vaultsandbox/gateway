import { EncryptedPayload } from '../crypto/interfaces';

// Base fields shared by both encrypted and plain email storage modes
interface StoredEmailBase {
  id: string; // UUID
  isRead: boolean; // Read/unread status
}

/**
 * Encrypted email - stored with encrypted payloads using ML-KEM-768 + AES-256-GCM
 */
export interface EncryptedStoredEmail extends StoredEmailBase {
  encryptedMetadata: EncryptedPayload; // Encrypted: { id, from, to, subject, receivedAt }
  encryptedParsed: EncryptedPayload; // Encrypted: parsed email content (text, html, attachments)
  encryptedRaw: EncryptedPayload; // Encrypted: raw email source
}

/**
 * Plain email - stored as binary Uint8Array for memory efficiency (same as encrypted emails).
 * Serialization to Base64 happens only when sending API responses.
 */
export interface PlainStoredEmail extends StoredEmailBase {
  metadata: Uint8Array; // Buffer.from(JSON.stringify(metadataObject))
  parsed: Uint8Array; // Buffer.from(JSON.stringify(parsedObject))
  raw: Uint8Array; // Buffer.from(rawEmailString)
}

/**
 * Union type for stored emails - discriminated by field presence
 */
export type StoredEmail = EncryptedStoredEmail | PlainStoredEmail;

/**
 * Type guard to check if an email is encrypted
 */
export function isEncryptedEmail(email: StoredEmail): email is EncryptedStoredEmail {
  return 'encryptedMetadata' in email;
}

export interface Inbox {
  emailAddress: string; // e.g., "abc123@vaultsandbox.test"
  clientKemPk?: string; // Base64URL client ML-KEM public key (only for encrypted inboxes)
  inboxHash: string; // base64url(SHA-256(clientKemPk or "plain:"+email)) for SSE + API references
  encrypted: boolean; // Whether this inbox uses encryption
  emailAuth: boolean; // Whether email authentication (SPF, DKIM, DMARC, PTR) is enabled
  createdAt: Date;
  expiresAt: Date;
  emails: Map<string, StoredEmail>; // Map<emailId, StoredEmail>
  emailsHash: string; // SHA-256 hash of sorted email IDs for sync checks
}
