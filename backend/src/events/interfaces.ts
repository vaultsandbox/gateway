import { SerializedEncryptedPayload } from '../crypto/serialization';

/**
 * @interface NewEmailEvent
 * @description Represents an event for a new email. Supports both encrypted and plain modes.
 *
 * For encrypted inboxes:
 * - encryptedMetadata is present (SerializedEncryptedPayload)
 * - metadata is undefined
 *
 * For plain inboxes:
 * - metadata is present (Base64-encoded JSON string)
 * - encryptedMetadata is undefined
 *
 * Clients can use the presence of encryptedMetadata to determine the mode.
 */
export interface NewEmailEvent {
  /**
   * @property {string} inboxId - The identifier for the inbox that received the email.
   */
  inboxId: string;
  /**
   * @property {string} emailId - The unique identifier for the email.
   */
  emailId: string;
  /**
   * @property {SerializedEncryptedPayload} [encryptedMetadata] - End-to-end encrypted blob containing
   * email metadata (id, from, to, subject, receivedAt). Present only for encrypted inboxes.
   * Encrypted with AES-256-GCM using the recipient's public key.
   * Serialized to Base64URL strings for SSE transmission.
   */
  encryptedMetadata?: SerializedEncryptedPayload;
  /**
   * @property {string} [metadata] - Base64-encoded JSON string containing email metadata
   * (id, from, to, subject, receivedAt). Present only for plain inboxes.
   */
  metadata?: string;
}
