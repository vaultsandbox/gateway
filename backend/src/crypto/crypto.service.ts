import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { webcrypto } from 'crypto';
import { readFileSync } from 'fs';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { EncryptedPayload } from './interfaces';
import { getErrorMessage } from '../shared/error.utils';

const CONTEXT_STRING = 'vaultsandbox:email:v1';

// ML-DSA-65 key sizes
const ML_DSA_65_SK_SIZE = 4032;
const ML_DSA_65_PK_SIZE = 1952;
// ML-KEM-768 key sizes
const ML_KEM_768_PK_SIZE = 1184;
const ML_KEM_768_PK_B64U_MAX_LENGTH = Math.ceil((ML_KEM_768_PK_SIZE * 4) / 3); // includes padding
/* v8 ignore next - compile-time constant, only one branch taken */
const ML_KEM_768_PK_B64U_MIN_LENGTH = ML_KEM_768_PK_B64U_MAX_LENGTH - (ML_KEM_768_PK_SIZE % 3 === 0 ? 0 : 1);
const CLIENT_KEM_VALIDATION_ERROR = 'Invalid client KEM public key';

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private serverSigSK: Uint8Array;
  private serverSigPK: Uint8Array;

  /**
   * Constructor
   */
  /* v8 ignore next - false positive on constructor parameter property */
  constructor(private configService: ConfigService) {
    this.initializeSigningKeys();
  }

  /**
   * Initialize server signing keys.
   * Loads keys from files if configured, otherwise generates ephemeral keys.
   */
  private initializeSigningKeys(): void {
    const sigSkPath = this.configService.get<string>('vsb.crypto.sigSkPath');
    const sigPkPath = this.configService.get<string>('vsb.crypto.sigPkPath');

    if (sigSkPath && sigPkPath) {
      this.loadKeysFromFiles(sigSkPath, sigPkPath);
    } else {
      this.generateEphemeralKeys();
    }
  }

  /**
   * Load signing keys from files.
   * Keys must be raw binary format (not Base64 or PEM).
   * @param skPath Path to secret key file (4032 bytes)
   * @param pkPath Path to public key file (1952 bytes)
   */
  private loadKeysFromFiles(skPath: string, pkPath: string): void {
    try {
      // Read secret key
      const skBuffer = readFileSync(skPath);
      this.serverSigSK = new Uint8Array(skBuffer);

      // Read public key
      const pkBuffer = readFileSync(pkPath);
      this.serverSigPK = new Uint8Array(pkBuffer);

      // Validate key lengths
      if (this.serverSigSK.length !== ML_DSA_65_SK_SIZE) {
        throw new Error(
          `Invalid ML-DSA-65 secret key size: ${this.serverSigSK.length} bytes (expected ${ML_DSA_65_SK_SIZE})`,
        );
      }

      if (this.serverSigPK.length !== ML_DSA_65_PK_SIZE) {
        throw new Error(
          `Invalid ML-DSA-65 public key size: ${this.serverSigPK.length} bytes (expected ${ML_DSA_65_PK_SIZE})`,
        );
      }

      this.logger.log('✓ ML-DSA-65 signing keys loaded successfully from files');
      this.logger.log(`  Secret key: ${this.serverSigSK.length} bytes`);
      this.logger.log(`  Public key: ${this.serverSigPK.length} bytes`);
    } catch (error) {
      /* v8 ignore next - defensive for non-Error exceptions */
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Failed to load signing keys from files: ${errorMessage}`);
      throw new Error(`Failed to load signing keys: ${errorMessage}`);
    }
  }

  /**
   * Generate ephemeral signing keypair.
   * Keys are regenerated on each server restart.
   */
  private generateEphemeralKeys(): void {
    try {
      const keygenResult = ml_dsa65.keygen();

      this.serverSigSK = keygenResult.secretKey;
      this.serverSigPK = keygenResult.publicKey;

      // Validate key lengths
      if (this.serverSigSK.length !== ML_DSA_65_SK_SIZE) {
        throw new Error(
          `Generated ML-DSA-65 secret key has wrong length: ${this.serverSigSK.length} (expected ${ML_DSA_65_SK_SIZE})`,
        );
      }

      if (this.serverSigPK.length !== ML_DSA_65_PK_SIZE) {
        throw new Error(
          `Generated ML-DSA-65 public key has wrong length: ${this.serverSigPK.length} (expected ${ML_DSA_65_PK_SIZE})`,
        );
      }
    } catch (error) {
      /* v8 ignore next - defensive for non-Error exceptions */
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Failed to generate ephemeral keys: ${errorMessage}`);
      throw new Error(`Failed to generate signing keys: ${errorMessage}`);
    }
  }

  /**
   * Encrypt data for a client using their ML-KEM-768 public key
   * @param clientKemPublicKeyB64u Base64URL-encoded client KEM public key
   * @param plaintext Data to encrypt
   * @param aad Additional authenticated data (optional)
   * @returns EncryptedPayload with all cryptographic components
   */
  async encryptForClient(
    clientKemPublicKeyB64u: string,
    plaintext: Uint8Array,
    aad?: Uint8Array,
  ): Promise<EncryptedPayload> {
    try {
      // 1. Decode client's KEM public key (validated before KEM use to prevent crashes/DoS)
      const clientKemPK = this.decodeClientKemPublicKey(clientKemPublicKeyB64u);

      // 2. KEM Encapsulation: Generate shared secret and ciphertext
      const { sharedSecret, cipherText } = ml_kem768.encapsulate(clientKemPK);

      // 3. Derive AES-256-GCM key using HKDF-SHA-512
      const cryptoKey = await this.deriveKey(sharedSecret, CONTEXT_STRING, aad || new Uint8Array(0), cipherText);

      // 4. Generate random nonce (96 bits / 12 bytes)
      const nonce = webcrypto.getRandomValues(new Uint8Array(12));

      // 5. Encrypt plaintext with AES-256-GCM
      const encryptedData = await webcrypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: nonce,
          additionalData: aad || new Uint8Array(0),
          tagLength: 128, // 16 bytes
        },
        cryptoKey,
        plaintext,
      );

      const ciphertext = new Uint8Array(encryptedData);

      // 6. Define protocol parameters
      const version = 1;
      const algsCiphersuite = 'ML-KEM-768:ML-DSA-65:AES-256-GCM:HKDF-SHA-512';

      // 7. Build transcript for signature
      const transcript = this.buildTranscript(
        version,
        algsCiphersuite,
        cipherText,
        nonce,
        aad || new Uint8Array(0),
        ciphertext,
        this.serverSigPK,
      );

      // 8. Sign transcript with ML-DSA-65
      // Note: API is sign(message, secretKey) not sign(secretKey, message)
      const signature = ml_dsa65.sign(transcript, this.serverSigSK);

      // 9. Build encrypted payload with raw binary data (no base64 encoding)
      // Base64 encoding happens only when serializing for API responses
      const payload: EncryptedPayload = {
        v: version,
        algs: {
          kem: 'ML-KEM-768',
          sig: 'ML-DSA-65',
          aead: 'AES-256-GCM',
          kdf: 'HKDF-SHA-512',
        },
        ct_kem: cipherText,
        nonce: nonce,
        aad: aad || new Uint8Array(0),
        ciphertext: ciphertext,
        sig: signature,
        server_sig_pk: this.serverSigPK,
      };

      return payload;
    } catch (error) {
      /* v8 ignore next 2 - defensive for non-Error exceptions */
      const errorMessage = getErrorMessage(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      if (error instanceof Error && error.message.startsWith(CLIENT_KEM_VALIDATION_ERROR)) {
        this.logger.warn(error.message);
        throw error;
      }
      this.logger.error(`Encryption failed: ${errorMessage}`, errorStack);
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decode and validate client ML-KEM-768 public key input
   * @param clientKemPublicKeyB64u Base64URL-encoded client public key
   * @returns Decoded public key bytes
   */
  private decodeClientKemPublicKey(clientKemPublicKeyB64u: string): Uint8Array {
    /* v8 ignore next 3 - defensive check for non-TypeScript callers */
    if (!clientKemPublicKeyB64u || typeof clientKemPublicKeyB64u !== 'string') {
      throw new Error(`${CLIENT_KEM_VALIDATION_ERROR}: value is required`);
    }

    const trimmed = clientKemPublicKeyB64u.trim();

    if (!/^[A-Za-z0-9_-]+=*$/.test(trimmed)) {
      throw new Error(`${CLIENT_KEM_VALIDATION_ERROR}: must be base64url encoded`);
    }

    const unpadded = trimmed.replace(/=+$/, '');
    if (unpadded.length < ML_KEM_768_PK_B64U_MIN_LENGTH || unpadded.length > ML_KEM_768_PK_B64U_MAX_LENGTH) {
      throw new Error(
        `${CLIENT_KEM_VALIDATION_ERROR}: expected base64url length between ${ML_KEM_768_PK_B64U_MIN_LENGTH} and ${ML_KEM_768_PK_B64U_MAX_LENGTH}`,
      );
    }

    try {
      const clientKemPK = this.base64urlDecode(trimmed);
      if (clientKemPK.length !== ML_KEM_768_PK_SIZE) {
        throw new Error(
          `${CLIENT_KEM_VALIDATION_ERROR}: decoded length ${clientKemPK.length} bytes (expected ${ML_KEM_768_PK_SIZE})`,
        );
      }
      return clientKemPK;
    } catch {
      throw new Error(`${CLIENT_KEM_VALIDATION_ERROR}: failed to decode key`);
    }
  }

  /**
   * Derive AES-256 key using HKDF-SHA-512
   * @param ikm Input key material (shared secret from KEM)
   * @param context Context string for domain binding
   * @param aad Additional authenticated data
   * @param ctKem KEM ciphertext (used to derive unique salt)
   * @returns 32-byte AES-256 key
   */
  private async deriveKey(ikm: Uint8Array, context: string, aad: Uint8Array, ctKem: Uint8Array): Promise<CryptoKey> {
    const contextBytes = new TextEncoder().encode(context);

    // Use KEM ciphertext as salt (unique per encryption)
    const saltBuffer = await webcrypto.subtle.digest('SHA-256', ctKem);
    const salt = new Uint8Array(saltBuffer);

    // Structured info: context || aad length || aad
    const aadLength = new Uint8Array(4);
    new DataView(aadLength.buffer).setUint32(0, aad.length, false); // big-endian
    const info = this.concat([contextBytes, aadLength, aad]);

    const baseKey = await webcrypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
    return webcrypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-512',
        salt, // Unique per encryption
        info,
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );
  }

  /**
   * Build transcript for ML-DSA signature
   * Format: version || algs || context || ct_kem || nonce || aad || ciphertext || server_sig_pk
   * @param version Protocol version number
   * @param algsCiphersuite Algorithm ciphersuite string (e.g., "ML-KEM-768:ML-DSA-65:AES-256-GCM:HKDF-SHA-512")
   * @param ctKem KEM ciphertext
   * @param nonce AES-GCM nonce
   * @param aad Additional authenticated data
   * @param ciphertext Encrypted data
   * @param serverSigPk Server's ML-DSA-65 public key
   * @returns Concatenated transcript for signing
   */
  private buildTranscript(
    version: number,
    algsCiphersuite: string,
    ctKem: Uint8Array,
    nonce: Uint8Array,
    aad: Uint8Array,
    ciphertext: Uint8Array,
    serverSigPk: Uint8Array,
  ): Uint8Array {
    const versionBytes = new Uint8Array([version]);
    const algsBytes = new TextEncoder().encode(algsCiphersuite);
    const contextBytes = new TextEncoder().encode(CONTEXT_STRING);

    return this.concat([versionBytes, algsBytes, contextBytes, ctKem, nonce, aad, ciphertext, serverSigPk]);
  }

  /**
   * Concatenate multiple Uint8Arrays
   * @param arrays Array of Uint8Arrays to concatenate
   * @returns Single concatenated Uint8Array
   */
  private concat(arrays: Uint8Array[]): Uint8Array {
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
   * Base64URL encode (RFC 4648)
   * @param data Data to encode
   * @returns Base64URL-encoded string
   */
  private base64urlEncode(data: Uint8Array): string {
    const base64 = Buffer.from(data).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Base64URL decode (RFC 4648)
   * @param str Base64URL-encoded string to decode
   * @returns Decoded data as Uint8Array
   */
  private base64urlDecode(str: string): Uint8Array {
    // Add padding if needed
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  /**
   * Get server signing public key (Base64URL)
   * @returns Base64URL-encoded server ML-DSA-65 public key
   */
  getServerSigningPublicKey(): string {
    return this.base64urlEncode(this.serverSigPK);
  }

  /**
   * Get server signing public key (raw bytes)
   * @returns Read-only view of server ML-DSA-65 public key bytes
   */
  getServerSigningPublicKeyRaw(): Readonly<Uint8Array> {
    return new Uint8Array(this.serverSigPK);
  }
}
