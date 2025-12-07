import { EncryptedPayload } from '../crypto/interfaces';

export interface EncryptedEmail {
  id: string; // UUID
  encryptedMetadata: EncryptedPayload; // Encrypted: { id, from, subject, receivedAt }
  encryptedParsed: EncryptedPayload; // Encrypted: parsed email content (text, html, attachments)
  encryptedRaw: EncryptedPayload; // Encrypted: raw email source
  isRead: boolean; // Read/unread status
}

export interface Inbox {
  emailAddress: string; // e.g., "abc123@vaultsandbox.test"
  clientKemPk: string; // Base64URL client ML-KEM public key
  inboxHash: string; // base64url(SHA-256(clientKemPk)) for SSE + API references
  createdAt: Date;
  expiresAt: Date;
  emails: Map<string, EncryptedEmail>; // Map<emailId, EncryptedEmail>
  emailsHash: string; // SHA-256 hash of sorted email IDs for sync checks
}
