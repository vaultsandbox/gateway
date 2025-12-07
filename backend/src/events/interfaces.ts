import { SerializedEncryptedPayload } from '../crypto/serialization';

/**
 * @interface NewEmailEvent
 * @description Represents an event for a new email with end-to-end encrypted metadata.
 * The metadata (from, to, subject, receivedAt) is encrypted client-side to maintain
 * zero-knowledge architecture - the server cannot read these fields.
 *
 * Uses SerializedEncryptedPayload (Base64URL strings) for SSE transmission.
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
   * @property {SerializedEncryptedPayload} encryptedMetadata - End-to-end encrypted blob containing
   * email metadata (id, from, to, subject, receivedAt). Encrypted with AES-256-GCM
   * using the recipient's public key. Can only be decrypted by the client with the
   * corresponding private key. Uses AAD 'vaultsandbox:metadata' for authentication.
   * Serialized to Base64URL strings for SSE transmission.
   */
  encryptedMetadata: SerializedEncryptedPayload;
}
