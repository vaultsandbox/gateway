import { inject, Injectable } from '@angular/core';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { ServerInfoService } from './server-info.service';
import { EncryptedPayload } from '../../../shared/interfaces/encrypted-payload';

/**
 * Base64URL encode
 */
function base64urlEncode(data: Uint8Array): string {
  // Convert Uint8Array to base64
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64URL decode
 */
function base64urlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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
 * Ensure Uint8Array has its own buffer (copy if it's a view)
 */
function ensureOwnBuffer(arr: Uint8Array): Uint8Array {
  // If the array uses the entire buffer, return as is
  if (arr.byteOffset === 0 && arr.byteLength === arr.buffer.byteLength) {
    return arr;
  }
  // Otherwise, create a copy with its own buffer by going through slice
  return arr.slice(0) as Uint8Array;
}

/**
 * Interface for ML-KEM keypair
 */
export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  publicKeyB64: string;
  secretKeyB64: string;
}

@Injectable({
  providedIn: 'root',
})
export class EncryptionService {
  private readonly serverInfoService = inject(ServerInfoService);

  /**
   * Generate ML-KEM-768 keypair
   */
  generateKeypair(): KeyPair {
    const { publicKey, secretKey } = ml_kem768.keygen();

    return {
      publicKey,
      secretKey,
      publicKeyB64: base64urlEncode(publicKey),
      secretKeyB64: base64urlEncode(secretKey),
    };
  }

  /**
   * Derive AES-256 key material using HKDF-SHA-512 with a deterministic context.
   * @param ikm - Shared secret derived from ML-KEM decapsulation.
   * @param context - Domain separation string (e.g., `vaultsandbox:email:v1`).
   * @param aad - Additional authenticated data that must be bound to the derived key.
   * @param ctKem - KEM ciphertext used for salt derivation (unique per encryption).
   */
  private async deriveKey(ikm: Uint8Array, context: string, aad: Uint8Array, ctKem: Uint8Array): Promise<Uint8Array> {
    const contextBytes = new TextEncoder().encode(context);

    // Hash KEM ciphertext to create unique salt per encryption
    const ctKemClean = ensureOwnBuffer(ctKem);
    const saltBuffer = await crypto.subtle.digest('SHA-256', ctKemClean as BufferSource);
    const salt = new Uint8Array(saltBuffer);

    // Structure info with aad_length prefix (4 bytes, big-endian)
    const aadLength = new Uint8Array(4);
    new DataView(aadLength.buffer).setUint32(0, aad.length, false);
    const info = concat([contextBytes, aadLength, aad]);

    // WebCrypto HKDF requires ArrayBuffers that are not shared views
    const ikmClean = ensureOwnBuffer(ikm);
    const saltClean = ensureOwnBuffer(salt);
    const infoClean = ensureOwnBuffer(info);

    // HKDF-SHA-512 with SHA-256(ctKem) as salt and structured info
    const baseKey = await crypto.subtle.importKey('raw', ikmClean as BufferSource, 'HKDF', false, ['deriveBits']);

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-512',
        salt: saltClean as BufferSource,
        info: infoClean as BufferSource,
      },
      baseKey,
      256,
    );

    return ensureOwnBuffer(new Uint8Array(derivedBits));
  }

  /**
   * Build transcript for signature verification
   * @param version - Protocol version number (1 byte).
   * @param algsCiphersuite - Algorithm ciphersuite string (e.g., "ML-KEM-768:ML-DSA-65:AES-256-GCM:HKDF-SHA-512").
   * @param ctKem - Ciphertext returned by ML-KEM encapsulation.
   * @param nonce - AES-GCM nonce used during encryption.
   * @param aad - Additional authenticated data bound to ciphertext.
   * @param ciphertext - Encrypted payload bytes.
   * @param serverSigPk - Server ML-DSA public key, included so recipients can verify origin.
   * @param context - Domain separation used to avoid cross-protocol transcript reuse.
   */
  private buildTranscript(
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
   * Convert algorithms object to ciphersuite string
   * @param algs - Algorithms object from encrypted payload
   * @returns Colon-separated ciphersuite string
   */
  private buildAlgsCiphersuite(algs: { kem: string; sig: string; aead: string; kdf: string }): string {
    return `${algs.kem}:${algs.sig}:${algs.aead}:${algs.kdf}`;
  }

  /**
   * Decrypt an encrypted payload
   * @param encryptedPayload - The encrypted payload from the server
   * @param clientSecretKey - Client's ML-KEM-768 secret key
   * @returns Decrypted plaintext
   */
  async decryptPayload(encryptedPayload: EncryptedPayload, clientSecretKey: Uint8Array): Promise<string> {
    const { v, algs, ct_kem, nonce, aad, ciphertext, sig, server_sig_pk } = encryptedPayload;

    const serverInfo = await this.serverInfoService.getServerInfo().catch(() => null);
    const expectedServerSigPk = serverInfo?.serverSigPk;
    if (expectedServerSigPk && expectedServerSigPk !== server_sig_pk) {
      throw new Error('SERVER SIGNATURE KEY MISMATCH - Unexpected signer');
    }

    // Decode all components
    const ctKem = base64urlDecode(ct_kem);
    const nonceBytes = base64urlDecode(nonce);
    const aadBytes = base64urlDecode(aad);
    const ciphertextBytes = base64urlDecode(ciphertext);
    const signature = base64urlDecode(sig);
    const serverSigPk = base64urlDecode(server_sig_pk);

    // 1. Verify signature first (before decryption)
    const context = 'vaultsandbox:email:v1';
    const algsCiphersuite = this.buildAlgsCiphersuite(algs);
    const transcript = this.buildTranscript(
      v,
      algsCiphersuite,
      ctKem,
      nonceBytes,
      aadBytes,
      ciphertextBytes,
      serverSigPk,
      context,
    );

    // Noble's ML-DSA verify signature order: (signature, message, publicKey)
    const signatureValid = ml_dsa65.verify(signature, transcript, serverSigPk);
    if (!signatureValid) {
      throw new Error('SIGNATURE VERIFICATION FAILED - Data may be tampered!');
    }

    // 2. KEM Decapsulation
    const sharedSecret = ml_kem768.decapsulate(ctKem, clientSecretKey);

    // 3. Derive AES-256 key using HKDF-SHA-512
    const aesKey = await this.deriveKey(sharedSecret, context, aadBytes, ctKem);

    // 4. Decrypt with AES-256-GCM
    // Ensure all buffers are properly aligned
    const aesKeyClean = ensureOwnBuffer(aesKey);
    const nonceClean = ensureOwnBuffer(nonceBytes);
    const aadClean = ensureOwnBuffer(aadBytes);
    const ciphertextClean = ensureOwnBuffer(ciphertextBytes);

    const cryptoKey = await crypto.subtle.importKey('raw', aesKeyClean as BufferSource, { name: 'AES-GCM' }, false, [
      'decrypt',
    ]);

    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonceClean as BufferSource,
        additionalData: aadClean as BufferSource,
        tagLength: 128, // 16 bytes
      },
      cryptoKey,
      ciphertextClean as BufferSource,
    );

    return new TextDecoder().decode(plaintext);
  }

  /**
   * Decrypt metadata payloads that wrap headers such as from/to/subject.
   * @param encryptedMetadata - The encrypted payload from the API.
   * @param clientSecretKey - Inbox-specific private key used to decapsulate content.
   * @returns Parsed metadata object.
   */
  async decryptMetadata(
    encryptedMetadata: EncryptedPayload,
    clientSecretKey: Uint8Array,
  ): Promise<Record<string, unknown>> {
    const plaintext = await this.decryptPayload(encryptedMetadata, clientSecretKey);
    return JSON.parse(plaintext) as Record<string, unknown>;
  }

  /**
   * Decrypt a parsed email body blob and return the plaintext JSON string.
   * @param encryptedBody - Encrypted parsed or raw body payload from the API.
   * @param clientSecretKey - Inbox-specific private key used during ML-KEM decapsulation.
   */
  async decryptBody(encryptedBody: EncryptedPayload, clientSecretKey: Uint8Array): Promise<string> {
    return await this.decryptPayload(encryptedBody, clientSecretKey);
  }
}
