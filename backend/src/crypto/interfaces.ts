/**
 * Encrypted payload stored in memory using binary Uint8Array fields.
 * This reduces memory usage by ~25% compared to Base64 string storage.
 * Serialization to Base64URL strings happens only when sending API responses.
 */
export interface EncryptedPayload {
  v: 1;
  algs: {
    kem: 'ML-KEM-768';
    sig: 'ML-DSA-65';
    aead: 'AES-256-GCM';
    kdf: 'HKDF-SHA-512';
  };
  ct_kem: Uint8Array; // KEM ciphertext (raw bytes)
  nonce: Uint8Array; // 12-byte nonce (raw bytes)
  aad: Uint8Array; // Additional authenticated data (raw bytes)
  ciphertext: Uint8Array; // AES-GCM ciphertext with tag (raw bytes)
  sig: Uint8Array; // ML-DSA signature (raw bytes)
  server_sig_pk: Uint8Array; // Server signing public key (raw bytes)
}
