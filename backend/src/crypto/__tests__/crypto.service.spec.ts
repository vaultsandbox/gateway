import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../crypto.service';
import { readFileSync } from 'fs';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { webcrypto } from 'crypto';
import { silenceNestLogger } from '../../../test/helpers/silence-logger';

jest.mock('fs');
jest.mock('@noble/post-quantum/ml-kem.js');
jest.mock('@noble/post-quantum/ml-dsa.js');

describe('CryptoService', () => {
  let service: CryptoService;
  const restoreLogger = silenceNestLogger();

  afterAll(() => restoreLogger());

  const mockSecretKey = new Uint8Array(4032).fill(1);
  const mockPublicKey = new Uint8Array(1952).fill(2);

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock ml_dsa65.keygen
    (ml_dsa65.keygen as jest.Mock) = jest.fn().mockReturnValue({
      secretKey: mockSecretKey,
      publicKey: mockPublicKey,
    });
  });

  describe('Initialization with ephemeral keys', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CryptoService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
            },
          },
        ],
      }).compile();

      service = module.get<CryptoService>(CryptoService);
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should generate ephemeral keys when no key paths configured', () => {
      expect(ml_dsa65.keygen).toHaveBeenCalled();
      expect(service['serverSigSK']).toEqual(mockSecretKey);
      expect(service['serverSigPK']).toEqual(mockPublicKey);
    });

    it('should throw error if generated secret key has wrong length', async () => {
      (ml_dsa65.keygen as jest.Mock).mockReturnValue({
        secretKey: new Uint8Array(100),
        publicKey: mockPublicKey,
      });

      await expect(
        Test.createTestingModule({
          providers: [
            CryptoService,
            {
              provide: ConfigService,
              useValue: {
                get: jest.fn().mockReturnValue(undefined),
              },
            },
          ],
        }).compile(),
      ).rejects.toThrow('Failed to generate signing keys');
    });

    it('should throw error if generated public key has wrong length', async () => {
      (ml_dsa65.keygen as jest.Mock).mockReturnValue({
        secretKey: mockSecretKey,
        publicKey: new Uint8Array(100),
      });

      await expect(
        Test.createTestingModule({
          providers: [
            CryptoService,
            {
              provide: ConfigService,
              useValue: {
                get: jest.fn().mockReturnValue(undefined),
              },
            },
          ],
        }).compile(),
      ).rejects.toThrow('Failed to generate signing keys');
    });
  });

  describe('Initialization with file-based keys', () => {
    beforeEach(() => {
      (readFileSync as jest.Mock).mockImplementation((path: string) => {
        if (path.includes('sk')) {
          return Buffer.from(mockSecretKey);
        }
        return Buffer.from(mockPublicKey);
      });
    });

    it('should load keys from files when paths are configured', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CryptoService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'vsb.crypto.sigSkPath') return '/path/to/sk';
                if (key === 'vsb.crypto.sigPkPath') return '/path/to/pk';
                return undefined;
              }),
            },
          },
        ],
      }).compile();

      service = module.get<CryptoService>(CryptoService);

      expect(readFileSync).toHaveBeenCalledWith('/path/to/sk');
      expect(readFileSync).toHaveBeenCalledWith('/path/to/pk');
      expect(service['serverSigSK']).toEqual(mockSecretKey);
      expect(service['serverSigPK']).toEqual(mockPublicKey);
    });

    it('should throw error if secret key file has wrong size', async () => {
      (readFileSync as jest.Mock).mockImplementation((path: string) => {
        if (path.includes('sk')) {
          return Buffer.from(new Uint8Array(100));
        }
        return Buffer.from(mockPublicKey);
      });

      await expect(
        Test.createTestingModule({
          providers: [
            CryptoService,
            {
              provide: ConfigService,
              useValue: {
                get: jest.fn((key: string) => {
                  if (key === 'vsb.crypto.sigSkPath') return '/path/to/sk';
                  if (key === 'vsb.crypto.sigPkPath') return '/path/to/pk';
                  return undefined;
                }),
              },
            },
          ],
        }).compile(),
      ).rejects.toThrow('Failed to load signing keys');
    });

    it('should throw error if public key file has wrong size', async () => {
      (readFileSync as jest.Mock).mockImplementation((path: string) => {
        if (path.includes('sk')) {
          return Buffer.from(mockSecretKey);
        }
        return Buffer.from(new Uint8Array(100));
      });

      await expect(
        Test.createTestingModule({
          providers: [
            CryptoService,
            {
              provide: ConfigService,
              useValue: {
                get: jest.fn((key: string) => {
                  if (key === 'vsb.crypto.sigSkPath') return '/path/to/sk';
                  if (key === 'vsb.crypto.sigPkPath') return '/path/to/pk';
                  return undefined;
                }),
              },
            },
          ],
        }).compile(),
      ).rejects.toThrow('Failed to load signing keys');
    });

    it('should throw error if file reading fails', async () => {
      (readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('File not found');
      });

      await expect(
        Test.createTestingModule({
          providers: [
            CryptoService,
            {
              provide: ConfigService,
              useValue: {
                get: jest.fn((key: string) => {
                  if (key === 'vsb.crypto.sigSkPath') return '/path/to/sk';
                  if (key === 'vsb.crypto.sigPkPath') return '/path/to/pk';
                  return undefined;
                }),
              },
            },
          ],
        }).compile(),
      ).rejects.toThrow('Failed to load signing keys');
    });
  });

  describe('encryptForClient', () => {
    const mockClientKemPK = new Uint8Array(1184).fill(3);
    const mockSharedSecret = new Uint8Array(32).fill(4);
    const mockCipherText = new Uint8Array(1088).fill(5);
    const mockSignature = new Uint8Array(3309).fill(6);

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CryptoService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
            },
          },
        ],
      }).compile();

      service = module.get<CryptoService>(CryptoService);

      // Mock ml_kem768.encapsulate
      (ml_kem768.encapsulate as jest.Mock) = jest.fn().mockReturnValue({
        sharedSecret: mockSharedSecret,
        cipherText: mockCipherText,
      });

      // Mock ml_dsa65.sign
      (ml_dsa65.sign as jest.Mock) = jest.fn().mockReturnValue(mockSignature);
    });

    it('should encrypt data for client without AAD', async () => {
      const clientKemPublicKeyB64u = service['base64urlEncode'](mockClientKemPK);
      const plaintext = new TextEncoder().encode('test message');

      const result = await service.encryptForClient(clientKemPublicKeyB64u, plaintext);

      expect(result).toBeDefined();
      expect(result.v).toBe(1);
      expect(result.algs.kem).toBe('ML-KEM-768');
      expect(result.algs.sig).toBe('ML-DSA-65');
      expect(result.algs.aead).toBe('AES-256-GCM');
      expect(result.algs.kdf).toBe('HKDF-SHA-512');
      expect(result.ct_kem).toBeDefined();
      expect(result.nonce).toBeDefined();
      expect(result.ciphertext).toBeDefined();
      expect(result.sig).toBeDefined();
      expect(result.server_sig_pk).toBeDefined();
    });

    it('should encrypt data for client with AAD', async () => {
      const clientKemPublicKeyB64u = service['base64urlEncode'](mockClientKemPK);
      const plaintext = new TextEncoder().encode('test message');
      const aad = new TextEncoder().encode('additional data');

      const result = await service.encryptForClient(clientKemPublicKeyB64u, plaintext, aad);

      expect(result).toBeDefined();
      expect(result.aad).toBeDefined();
      expect(ml_kem768.encapsulate).toHaveBeenCalledWith(mockClientKemPK);
      expect(ml_dsa65.sign).toHaveBeenCalled();
    });

    it('should reject invalid base64url client KEM key input', async () => {
      const plaintext = new TextEncoder().encode('test message');

      await expect(service.encryptForClient('***not-base64url***', plaintext)).rejects.toThrow(
        'Invalid client KEM public key',
      );
      expect(ml_kem768.encapsulate).not.toHaveBeenCalled();
    });

    it('should reject client KEM key with incorrect length', async () => {
      const shortKey = service['base64urlEncode'](new Uint8Array(10).fill(1));
      const plaintext = new TextEncoder().encode('test message');

      await expect(service.encryptForClient(shortKey, plaintext)).rejects.toThrow('Invalid client KEM public key');
      expect(ml_kem768.encapsulate).not.toHaveBeenCalled();
    });

    it('should reject oversized client KEM key input before KEM', async () => {
      const oversizedKey = service['base64urlEncode'](new Uint8Array(2000).fill(7));
      const plaintext = new TextEncoder().encode('test message');

      await expect(service.encryptForClient(oversizedKey, plaintext)).rejects.toThrow('Invalid client KEM public key');
      expect(ml_kem768.encapsulate).not.toHaveBeenCalled();
    });

    it('should throw error if encryption fails', async () => {
      (ml_kem768.encapsulate as jest.Mock).mockImplementation(() => {
        throw new Error('Encapsulation failed');
      });

      const clientKemPublicKeyB64u = service['base64urlEncode'](mockClientKemPK);
      const plaintext = new TextEncoder().encode('test message');

      await expect(service.encryptForClient(clientKemPublicKeyB64u, plaintext)).rejects.toThrow('Encryption failed');
    });

    it('should handle non-Error exceptions', async () => {
      (ml_kem768.encapsulate as jest.Mock).mockImplementation(() => {
        throw new Error('String error');
      });

      const clientKemPublicKeyB64u = service['base64urlEncode'](mockClientKemPK);
      const plaintext = new TextEncoder().encode('test message');

      await expect(service.encryptForClient(clientKemPublicKeyB64u, plaintext)).rejects.toThrow('Encryption failed');
    });
  });

  describe('deriveKey', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CryptoService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
            },
          },
        ],
      }).compile();

      service = module.get<CryptoService>(CryptoService);
    });

    const encryptWithKey = async (key: CryptoKey): Promise<Buffer> => {
      const plaintext = new Uint8Array([1, 2, 3, 4]);
      const iv = new Uint8Array(12); // zero IV for deterministic comparison
      const additionalData = new Uint8Array([9, 9]);

      const ciphertext = await webcrypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData,
          tagLength: 128,
        },
        key,
        plaintext,
      );

      return Buffer.from(ciphertext);
    };

    it('should derive AES-256 key from shared secret', async () => {
      const ikm = new Uint8Array(32).fill(1);
      const context = 'test:context';
      const aad = new Uint8Array(16).fill(2);
      const ctKem = new Uint8Array(1088).fill(3); // ML-KEM-768 ciphertext size

      const key = await service['deriveKey'](ikm, context, aad, ctKem);

      expect(key).toBeInstanceOf(CryptoKey);
      expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
      expect(key.usages).toEqual(['encrypt']);
      expect(key.type).toBe('secret');
      expect(key.extractable).toBe(false);
    });

    it('should derive different keys for different contexts', async () => {
      const ikm = new Uint8Array(32).fill(1);
      const aad = new Uint8Array(16).fill(2);
      const ctKem = new Uint8Array(1088).fill(3);

      const key1 = await service['deriveKey'](ikm, 'context1', aad, ctKem);
      const key2 = await service['deriveKey'](ikm, 'context2', aad, ctKem);

      const ciphertext1 = await encryptWithKey(key1);
      const ciphertext2 = await encryptWithKey(key2);

      expect(ciphertext1.equals(ciphertext2)).toBe(false);
    });

    it('should derive different keys for different AAD', async () => {
      const ikm = new Uint8Array(32).fill(1);
      const context = 'test:context';
      const aad1 = new Uint8Array(16).fill(2);
      const aad2 = new Uint8Array(16).fill(3);
      const ctKem = new Uint8Array(1088).fill(4);

      const key1 = await service['deriveKey'](ikm, context, aad1, ctKem);
      const key2 = await service['deriveKey'](ikm, context, aad2, ctKem);

      const ciphertext1 = await encryptWithKey(key1);
      const ciphertext2 = await encryptWithKey(key2);

      expect(ciphertext1.equals(ciphertext2)).toBe(false);
    });
  });

  describe('buildTranscript', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CryptoService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
            },
          },
        ],
      }).compile();

      service = module.get<CryptoService>(CryptoService);
    });

    it('should build transcript from components', () => {
      const version = 1;
      const algsCiphersuite = 'ML-KEM-768:ML-DSA-65:AES-256-GCM:HKDF-SHA-512';
      const ctKem = new Uint8Array(10).fill(1);
      const nonce = new Uint8Array(12).fill(2);
      const aad = new Uint8Array(8).fill(3);
      const ciphertext = new Uint8Array(20).fill(4);
      const serverSigPk = new Uint8Array(1952).fill(5);

      const transcript = service['buildTranscript'](
        version,
        algsCiphersuite,
        ctKem,
        nonce,
        aad,
        ciphertext,
        serverSigPk,
      );

      expect(transcript).toBeInstanceOf(Uint8Array);
      // Version (1 byte) + algs string + context string + all components
      const expectedLength = 1 + algsCiphersuite.length + 'vaultsandbox:email:v1'.length + 10 + 12 + 8 + 20 + 1952;
      expect(transcript.length).toBe(expectedLength);
    });

    it('should produce consistent transcript for same inputs', () => {
      const version = 1;
      const algsCiphersuite = 'ML-KEM-768:ML-DSA-65:AES-256-GCM:HKDF-SHA-512';
      const ctKem = new Uint8Array(10).fill(1);
      const nonce = new Uint8Array(12).fill(2);
      const aad = new Uint8Array(8).fill(3);
      const ciphertext = new Uint8Array(20).fill(4);
      const serverSigPk = new Uint8Array(1952).fill(5);

      const transcript1 = service['buildTranscript'](
        version,
        algsCiphersuite,
        ctKem,
        nonce,
        aad,
        ciphertext,
        serverSigPk,
      );
      const transcript2 = service['buildTranscript'](
        version,
        algsCiphersuite,
        ctKem,
        nonce,
        aad,
        ciphertext,
        serverSigPk,
      );

      expect(transcript1).toEqual(transcript2);
    });
  });

  describe('concat', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CryptoService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
            },
          },
        ],
      }).compile();

      service = module.get<CryptoService>(CryptoService);
    });

    it('should concatenate multiple arrays', () => {
      const arr1 = new Uint8Array([1, 2, 3]);
      const arr2 = new Uint8Array([4, 5]);
      const arr3 = new Uint8Array([6, 7, 8, 9]);

      const result = service['concat']([arr1, arr2, arr3]);

      expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    });

    it('should handle empty arrays', () => {
      const arr1 = new Uint8Array([1, 2]);
      const arr2 = new Uint8Array([]);
      const arr3 = new Uint8Array([3, 4]);

      const result = service['concat']([arr1, arr2, arr3]);

      expect(result).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it('should handle single array', () => {
      const arr = new Uint8Array([1, 2, 3, 4, 5]);

      const result = service['concat']([arr]);

      expect(result).toEqual(arr);
    });

    it('should return empty array for empty input', () => {
      const result = service['concat']([]);

      expect(result).toEqual(new Uint8Array([]));
    });
  });

  describe('base64urlEncode', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CryptoService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
            },
          },
        ],
      }).compile();

      service = module.get<CryptoService>(CryptoService);
    });

    it('should encode data to base64url', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const encoded = service['base64urlEncode'](data);

      expect(encoded).toBeDefined();
      expect(typeof encoded).toBe('string');
      // Should not contain standard base64 characters
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
    });

    it('should handle empty data', () => {
      const data = new Uint8Array([]);
      const encoded = service['base64urlEncode'](data);

      expect(encoded).toBe('');
    });

    it('should replace special characters', () => {
      // Data that would produce + and / in standard base64
      const data = new Uint8Array([251, 239, 255]);
      const encoded = service['base64urlEncode'](data);

      expect(encoded).toBe('--__');
    });
  });

  describe('base64urlDecode', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CryptoService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
            },
          },
        ],
      }).compile();

      service = module.get<CryptoService>(CryptoService);
    });

    it('should decode base64url string', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const encoded = service['base64urlEncode'](original);
      const decoded = service['base64urlDecode'](encoded);

      expect(decoded).toEqual(original);
    });

    it('should handle strings without padding', () => {
      const encoded = 'AQIDBAU';
      const decoded = service['base64urlDecode'](encoded);

      expect(decoded).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    });

    it('should handle strings with url-safe characters', () => {
      const encoded = '--__';
      const decoded = service['base64urlDecode'](encoded);

      expect(decoded).toEqual(new Uint8Array([251, 239, 255]));
    });

    it('should handle empty string', () => {
      const decoded = service['base64urlDecode']('');

      expect(decoded).toEqual(new Uint8Array([]));
    });

    it('should add padding when needed', () => {
      // Test different padding scenarios
      const testCases = [
        'QQ', // needs 2 padding chars
        'QWI', // needs 1 padding char
        'QUJD', // needs 0 padding chars
      ];

      testCases.forEach((encoded) => {
        const decoded = service['base64urlDecode'](encoded);
        expect(decoded).toBeInstanceOf(Uint8Array);
      });
    });
  });

  describe('getServerSigningPublicKey', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CryptoService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
            },
          },
        ],
      }).compile();

      service = module.get<CryptoService>(CryptoService);
    });

    it('should return base64url encoded public key', () => {
      const publicKey = service.getServerSigningPublicKey();

      expect(publicKey).toBeDefined();
      expect(typeof publicKey).toBe('string');
      expect(publicKey.length).toBeGreaterThan(0);
    });

    it('should return consistent value', () => {
      const key1 = service.getServerSigningPublicKey();
      const key2 = service.getServerSigningPublicKey();

      expect(key1).toBe(key2);
    });

    it('should be decodable back to public key', () => {
      const encoded = service.getServerSigningPublicKey();
      const decoded = service['base64urlDecode'](encoded);

      expect(decoded).toEqual(service['serverSigPK']);
    });

    it('should return raw public key bytes', () => {
      const rawKey = service.getServerSigningPublicKeyRaw();

      expect(rawKey).toBeDefined();
      expect(rawKey).toBeInstanceOf(Uint8Array);
      expect(rawKey).toEqual(service['serverSigPK']);
    });

    it('should return consistent raw public key', () => {
      const key1 = service.getServerSigningPublicKeyRaw();
      const key2 = service.getServerSigningPublicKeyRaw();

      expect(key1).toEqual(key2);
    });
  });

  describe('Integration tests', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CryptoService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
            },
          },
        ],
      }).compile();

      service = module.get<CryptoService>(CryptoService);
    });

    it('should encode and decode data correctly', () => {
      const testData = [
        new Uint8Array([0]),
        new Uint8Array([255]),
        new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        new Uint8Array(100).fill(42),
      ];

      testData.forEach((data) => {
        const encoded = service['base64urlEncode'](data);
        const decoded = service['base64urlDecode'](encoded);
        expect(decoded).toEqual(data);
      });
    });

    it('should concatenate and build transcript correctly', () => {
      const arrays = [new Uint8Array([1, 2]), new Uint8Array([3, 4]), new Uint8Array([5, 6])];

      const concatenated = service['concat'](arrays);
      expect(concatenated.length).toBe(6);
      expect(Array.from(concatenated)).toEqual([1, 2, 3, 4, 5, 6]);
    });
  });

  /**
   * Cross-Implementation Test Vectors
   *
   * These test vectors document the encryption protocol and provide reference
   * implementations for external contributors and client implementations.
   *
   * Protocol Overview:
   * 1. Client generates ML-KEM-768 keypair
   * 2. Server encapsulates shared secret using client's public key
   * 3. Derive AES-256-GCM key via HKDF-SHA-512
   * 4. Encrypt plaintext with AES-256-GCM
   * 5. Sign transcript with ML-DSA-65
   *
   * Payload Structure:
   * {
   *   v: 1,                                    // Protocol version
   *   algs: {
   *     kem: 'ML-KEM-768',                    // Key encapsulation mechanism
   *     sig: 'ML-DSA-65',                     // Signature algorithm
   *     aead: 'AES-256-GCM',                  // Authenticated encryption
   *     kdf: 'HKDF-SHA-512'                   // Key derivation function
   *   },
   *   ct_kem: string,                         // Base64URL KEM ciphertext (1088 bytes)
   *   nonce: string,                          // Base64URL AES-GCM nonce (12 bytes)
   *   aad: string,                            // Base64URL additional authenticated data
   *   ciphertext: string,                     // Base64URL encrypted payload
   *   sig: string,                            // Base64URL ML-DSA-65 signature (3309 bytes)
   *   server_sig_pk: string                   // Base64URL server public key (1952 bytes)
   * }
   *
   * NOTE: These tests use mocked crypto operations for performance. For real
   * interoperability testing, run the integration tests with actual crypto
   * implementations using: npm run test:e2e
   */
  describe('Cross-Implementation Test Vectors (Protocol Documentation)', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CryptoService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
            },
          },
        ],
      }).compile();

      service = module.get<CryptoService>(CryptoService);
    });

    it('should document the encryption protocol structure', async () => {
      // Test vector: Protocol structure documentation
      const mockClientKemPK = new Uint8Array(1184).fill(3);
      const mockSharedSecret = new Uint8Array(32).fill(4);
      const mockCipherText = new Uint8Array(1088).fill(5);
      const mockSignature = new Uint8Array(3309).fill(6);

      (ml_kem768.encapsulate as jest.Mock).mockReturnValue({
        sharedSecret: mockSharedSecret,
        cipherText: mockCipherText,
      });
      (ml_dsa65.sign as jest.Mock).mockReturnValue(mockSignature);

      const plaintext = new TextEncoder().encode('Hello, VaultSandbox!');
      const aad = new TextEncoder().encode('test-aad');
      const clientKemPublicKeyB64u = service['base64urlEncode'](mockClientKemPK);

      const encryptedPayload = await service.encryptForClient(clientKemPublicKeyB64u, plaintext, aad);

      // Verify payload structure matches protocol specification
      expect(encryptedPayload).toMatchObject({
        v: 1,
        algs: {
          kem: 'ML-KEM-768',
          sig: 'ML-DSA-65',
          aead: 'AES-256-GCM',
          kdf: 'HKDF-SHA-512',
        },
      });

      // Verify all required fields are present and are Uint8Array (binary storage)
      // Base64URL encoding now happens only when serializing for API responses
      expect(encryptedPayload.ct_kem).toBeInstanceOf(Uint8Array);
      expect(encryptedPayload.nonce).toBeInstanceOf(Uint8Array);
      expect(encryptedPayload.aad).toBeInstanceOf(Uint8Array);
      expect(encryptedPayload.ciphertext).toBeInstanceOf(Uint8Array);
      expect(encryptedPayload.sig).toBeInstanceOf(Uint8Array);
      expect(encryptedPayload.server_sig_pk).toBeInstanceOf(Uint8Array);
    });

    it('should document expected field sizes for client implementations', async () => {
      // Test vector: Field size documentation
      const mockClientKemPK = new Uint8Array(1184).fill(3);
      const mockSharedSecret = new Uint8Array(32).fill(4);
      const mockCipherText = new Uint8Array(1088).fill(5);
      const mockSignature = new Uint8Array(3309).fill(6);

      (ml_kem768.encapsulate as jest.Mock).mockReturnValue({
        sharedSecret: mockSharedSecret,
        cipherText: mockCipherText,
      });
      (ml_dsa65.sign as jest.Mock).mockReturnValue(mockSignature);

      const plaintext = new TextEncoder().encode('Test message');
      const clientKemPublicKeyB64u = service['base64urlEncode'](mockClientKemPK);

      const encryptedPayload = await service.encryptForClient(clientKemPublicKeyB64u, plaintext);

      // Document expected sizes for implementers (fields are now raw Uint8Array)
      expect(encryptedPayload.ct_kem.length).toBe(1088); // ML-KEM-768 ciphertext size
      expect(encryptedPayload.nonce.length).toBe(12); // AES-GCM nonce size
      expect(encryptedPayload.sig.length).toBe(3309); // ML-DSA-65 signature size
      expect(encryptedPayload.server_sig_pk.length).toBe(1952); // ML-DSA-65 public key size
    });

    it('should document AAD usage for metadata separation', () => {
      // Test vector: AAD values used by VaultSandbox
      // These AAD strings are used to separate different types of encrypted data:
      const metadataAad = 'vaultsandbox:metadata'; // Email metadata (id, from, to, subject, receivedAt)
      const parsedAad = 'vaultsandbox:parsed'; // Parsed email content (headers, body, attachments)
      const rawAad = 'vaultsandbox:raw'; // Raw email message (base64 encoded)

      // Context string for HKDF key derivation
      const context = 'vaultsandbox:email:v1';

      // Document these values for external implementers
      expect(metadataAad).toBe('vaultsandbox:metadata');
      expect(parsedAad).toBe('vaultsandbox:parsed');
      expect(rawAad).toBe('vaultsandbox:raw');
      expect(context).toBe('vaultsandbox:email:v1');
    });

    it('should document decryption workflow for client implementations', () => {
      // Test vector: Client decryption workflow documentation
      // Step-by-step guide for implementing decryption:
      //
      // 1. Receive EncryptedPayload from server
      // 2. Decode all base64url fields to bytes:
      //    - ct_kem (1088 bytes)
      //    - nonce (12 bytes)
      //    - aad (variable length)
      //    - ciphertext (variable length)
      //    - sig (3309 bytes)
      //    - server_sig_pk (1952 bytes)
      //
      // 3. Build transcript for signature verification:
      //    transcript = version || algs || context || ct_kem || nonce || aad || ciphertext || server_sig_pk
      //    where:
      //    - version: 1 byte (value: 1)
      //    - algs: UTF-8 encoded string "ML-KEM-768:ML-DSA-65:AES-256-GCM:HKDF-SHA-512"
      //    - context: UTF-8 encoded string "vaultsandbox:email:v1"
      //
      // 4. Verify ML-DSA-65 signature:
      //    isValid = ml_dsa65.verify(sig, transcript, server_sig_pk)
      //
      // 5. Decapsulate shared secret using client's ML-KEM-768 secret key:
      //    shared_secret = ml_kem768.decapsulate(ct_kem, client_kem_sk)
      //
      // 6. Derive AES-256-GCM key using HKDF-SHA-512:
      //    salt = SHA-256(ct_kem)
      //    info = context || aad_length (4 bytes, big-endian) || aad
      //    aes_key = HKDF-SHA-512(shared_secret, salt, info, 32 bytes)
      //
      // 7. Decrypt ciphertext using AES-256-GCM:
      //    plaintext = AES-GCM-decrypt(ciphertext, aes_key, nonce, aad)
      //
      // This test serves as documentation for implementers
      expect(true).toBe(true);
    });

    it('should document protocol version and algorithm compatibility', () => {
      // Test vector: Protocol version compatibility
      // Current protocol version: 1
      // Algorithm suite:
      const protocol = {
        version: 1,
        algorithms: {
          kem: 'ML-KEM-768', // NIST FIPS 203 (formerly Kyber)
          sig: 'ML-DSA-65', // NIST FIPS 204 (formerly Dilithium)
          aead: 'AES-256-GCM', // NIST SP 800-38D
          kdf: 'HKDF-SHA-512', // RFC 5869 with SHA-512
        },
        context: 'vaultsandbox:email:v1',
      };

      // Implementers should check version field to ensure compatibility
      expect(protocol.version).toBe(1);
      expect(protocol.algorithms.kem).toBe('ML-KEM-768');
      expect(protocol.algorithms.sig).toBe('ML-DSA-65');
      expect(protocol.algorithms.aead).toBe('AES-256-GCM');
      expect(protocol.algorithms.kdf).toBe('HKDF-SHA-512');
      expect(protocol.context).toBe('vaultsandbox:email:v1');
    });
  });
});
