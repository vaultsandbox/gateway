import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { webcrypto } from 'crypto';

const CONTEXT_STRING = 'vaultsandbox:email:v1';

export interface ClientKeypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  publicKeyB64: string;
  secretKeyB64: string;
}

export interface EncryptedPayload {
  v: number;
  algs: {
    kem: string;
    sig: string;
    aead: string;
    kdf?: string;
  };
  ct_kem: string;
  nonce: string;
  aad: string;
  ciphertext: string;
  sig: string;
  server_sig_pk: string;
}

/**
 * Base64URL encode
 */
export function base64urlEncode(data: Uint8Array): string {
  const base64 = Buffer.from(data).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64URL decode
 */
export function base64urlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/**
 * Generate ML-KEM-768 keypair for client testing
 */
export function generateClientKeypair(): ClientKeypair {
  const { publicKey, secretKey } = ml_kem768.keygen();

  return {
    publicKey,
    secretKey,
    publicKeyB64: base64urlEncode(publicKey),
    secretKeyB64: base64urlEncode(secretKey),
  };
}

/**
 * Concatenate multiple Uint8Arrays
 */
function concat(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Derive AES-256 key using HKDF-SHA-512 (using WebCrypto native implementation)
 */
async function deriveKey(ikm: Uint8Array, context: string, aad: Uint8Array, ctKem: Uint8Array): Promise<Uint8Array> {
  const contextBytes = new TextEncoder().encode(context);

  // Use KEM ciphertext as salt (unique per encryption)
  const saltBuffer = await webcrypto.subtle.digest('SHA-256', ctKem);
  const salt = new Uint8Array(saltBuffer);

  // Structured info: context || aad length || aad
  const aadLength = new Uint8Array(4);
  new DataView(aadLength.buffer).setUint32(0, aad.length, false); // big-endian
  const info = concat([contextBytes, aadLength, aad]);

  // Use WebCrypto's native HKDF implementation (matches server-side)
  const baseKey = await webcrypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  const derivedKey = await webcrypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-512',
      salt, // Unique per encryption
      info,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true, // extractable
    ['decrypt'],
  );

  // Export the key as raw bytes
  const keyBuffer = await webcrypto.subtle.exportKey('raw', derivedKey);
  return new Uint8Array(keyBuffer);
}

/**
 * Build transcript for signature verification
 */
function buildTranscript(
  version: number,
  algsCiphersuite: string,
  ctKem: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array,
  serverSigPk: Uint8Array,
  context: string,
): Uint8Array {
  const versionBytes = new Uint8Array([version]);
  const algsBytes = new TextEncoder().encode(algsCiphersuite);
  const contextBytes = new TextEncoder().encode(context);
  return concat([versionBytes, algsBytes, contextBytes, ctKem, nonce, aad, ciphertext, serverSigPk]);
}

/**
 * Convert algs object to ciphersuite string
 */
function buildAlgsCiphersuite(algs: { kem: string; sig: string; aead: string; kdf?: string }): string {
  return `${algs.kem}:${algs.sig}:${algs.aead}:${algs.kdf || 'HKDF-SHA-512'}`;
}

/**
 * Decrypt an encrypted payload from the server
 * @param encryptedPayload - The encrypted payload from the server
 * @param clientSecretKey - Client's ML-KEM-768 secret key
 * @returns Decrypted plaintext as Buffer
 */
export async function decryptPayload(encryptedPayload: EncryptedPayload, clientSecretKey: Uint8Array): Promise<Buffer> {
  const { v, algs, ct_kem, nonce, aad, ciphertext, sig, server_sig_pk } = encryptedPayload;

  // Decode all components
  const ctKem = base64urlDecode(ct_kem);
  const nonceBytes = base64urlDecode(nonce);
  const aadBytes = base64urlDecode(aad);
  const ciphertextBytes = base64urlDecode(ciphertext);
  const signature = base64urlDecode(sig);
  const serverSigPk = base64urlDecode(server_sig_pk);

  // 1. Verify signature first (before decryption)
  const algsCiphersuite = buildAlgsCiphersuite(algs);
  const transcript = buildTranscript(
    v,
    algsCiphersuite,
    ctKem,
    nonceBytes,
    aadBytes,
    ciphertextBytes,
    serverSigPk,
    CONTEXT_STRING,
  );

  // Noble's ML-DSA verify signature order: (signature, message, publicKey)
  const signatureValid = ml_dsa65.verify(signature, transcript, serverSigPk);
  if (!signatureValid) {
    throw new Error('SIGNATURE VERIFICATION FAILED - Data may be tampered!');
  }

  // 2. KEM Decapsulation
  const sharedSecret = ml_kem768.decapsulate(ctKem, clientSecretKey);

  // 3. Derive AES-256 key using HKDF-SHA-512
  const aesKey = await deriveKey(sharedSecret, CONTEXT_STRING, aadBytes, ctKem);

  // 4. Decrypt with AES-256-GCM
  const cryptoKey = await webcrypto.subtle.importKey('raw', aesKey, { name: 'AES-GCM' }, false, ['decrypt']);

  const plaintext = await webcrypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: nonceBytes,
      additionalData: aadBytes,
      tagLength: 128, // 16 bytes
    },
    cryptoKey,
    ciphertextBytes,
  );

  return Buffer.from(plaintext);
}

/**
 * Decrypt metadata (returns JSON object)
 */
export async function decryptMetadata<T = any>(
  encryptedMetadata: EncryptedPayload,
  clientSecretKey: Uint8Array,
): Promise<T> {
  const plaintext = await decryptPayload(encryptedMetadata, clientSecretKey);
  return JSON.parse(plaintext.toString('utf-8'));
}

/**
 * Decrypt parsed email body (returns JSON object)
 */
export async function decryptParsed<T = any>(
  encryptedParsed: EncryptedPayload,
  clientSecretKey: Uint8Array,
): Promise<T> {
  const plaintext = await decryptPayload(encryptedParsed, clientSecretKey);
  return JSON.parse(plaintext.toString('utf-8'));
}

/**
 * Decrypt raw email content (returns decoded RFC822 string)
 */
export async function decryptRaw(encryptedRaw: EncryptedPayload, clientSecretKey: Uint8Array): Promise<string> {
  const plaintext = await decryptPayload(encryptedRaw, clientSecretKey);
  return Buffer.from(plaintext.toString('utf-8'), 'base64').toString('utf-8');
}
