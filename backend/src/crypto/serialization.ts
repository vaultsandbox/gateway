/**
 * Serialization utilities for converting binary EncryptedPayload to JSON-serializable format.
 * Base64URL encoding happens only when serializing for API responses, reducing in-memory storage.
 *
 * @module crypto/serialization
 */

import { EncryptedPayload } from './interfaces';

/**
 * Serialized encrypted payload with Base64URL-encoded string fields.
 * This is the format sent over the wire in API responses and SSE events.
 */
export interface SerializedEncryptedPayload {
  v: 1;
  algs: EncryptedPayload['algs'];
  ct_kem: string;
  nonce: string;
  aad: string;
  ciphertext: string;
  sig: string;
  server_sig_pk: string;
}

/**
 * Encode a Uint8Array to Base64URL string (RFC 4648).
 *
 * @param data - Binary data to encode
 * @returns Base64URL-encoded string (no padding)
 */
function base64urlEncode(data: Uint8Array): string {
  const base64 = Buffer.from(data).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Serialize an EncryptedPayload to JSON-serializable format with Base64URL-encoded fields.
 * Use this when building API responses or SSE events.
 *
 * @param payload - Binary encrypted payload from storage
 * @returns Serialized payload ready for JSON.stringify()
 */
export function serializeEncryptedPayload(payload: EncryptedPayload): SerializedEncryptedPayload {
  return {
    v: payload.v,
    algs: payload.algs,
    ct_kem: base64urlEncode(payload.ct_kem),
    nonce: base64urlEncode(payload.nonce),
    aad: base64urlEncode(payload.aad),
    ciphertext: base64urlEncode(payload.ciphertext),
    sig: base64urlEncode(payload.sig),
    server_sig_pk: base64urlEncode(payload.server_sig_pk),
  };
}
