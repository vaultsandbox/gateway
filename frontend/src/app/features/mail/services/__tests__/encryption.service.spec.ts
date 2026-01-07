import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { EncryptionService } from '../encryption.service';
import { ServerInfoService } from '../server-info.service';
import { EncryptedPayload } from '../../../../shared/interfaces/encrypted-payload';
import { ServerInfo } from '../../interfaces';
import * as mlKem from '@noble/post-quantum/ml-kem.js';
import * as mlDsa from '@noble/post-quantum/ml-dsa.js';

// ML-KEM-768 key sizes from spec
const MLKEM_PUBLIC_KEY_SIZE = 1184;
const MLKEM_SECRET_KEY_SIZE = 2400;

describe('EncryptionService', () => {
  let service: EncryptionService;
  let serverInfoServiceStub: ServerInfoServiceStubClass;

  class ServerInfoServiceStubClass {
    private readonly serverInfoSignal = signal<ServerInfo | null>({
      serverSigPk: 'expected-server-sig-pk',
      algs: { kem: 'ML-KEM-768', sig: 'ML-DSA-65', aead: 'AES-256-GCM', kdf: 'HKDF-SHA-512' },
      context: 'vaultsandbox:email:v1',
      maxTtl: 86400,
      defaultTtl: 3600,
      sseConsole: false,
      allowedDomains: [],
    });

    get serverInfo() {
      return this.serverInfoSignal.asReadonly();
    }

    async getServerInfo(): Promise<ServerInfo | null> {
      return this.serverInfoSignal();
    }

    setServerSigPk(pk: string): void {
      this.serverInfoSignal.set({
        ...this.serverInfoSignal()!,
        serverSigPk: pk,
      });
    }

    setServerInfo(info: ServerInfo | null): void {
      this.serverInfoSignal.set(info);
    }
  }

  const createMockEncryptedPayload = (overrides?: Partial<EncryptedPayload>): EncryptedPayload => ({
    v: 1,
    algs: { kem: 'ML-KEM-768', sig: 'ML-DSA-65', aead: 'AES-256-GCM', kdf: 'HKDF-SHA-512' },
    ct_kem: 'Y3Rfa2VtX2RhdGE', // base64url encoded "ct_kem_data"
    nonce: 'bm9uY2VkYXRh', // base64url encoded "noncedata"
    aad: 'YWFkX2RhdGE', // base64url encoded "aad_data"
    ciphertext: 'Y2lwaGVydGV4dA', // base64url encoded "ciphertext"
    sig: 'c2lnbmF0dXJl', // base64url encoded "signature"
    server_sig_pk: 'expected-server-sig-pk',
    ...overrides,
  });

  beforeEach(() => {
    localStorage.clear();
    serverInfoServiceStub = new ServerInfoServiceStubClass();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        EncryptionService,
        { provide: ServerInfoService, useValue: serverInfoServiceStub },
      ],
    });

    service = TestBed.inject(EncryptionService);
  });

  describe('generateKeypair', () => {
    it('returns a valid keypair with correct structure', () => {
      const keypair = service.generateKeypair();

      expect(keypair).toBeDefined();
      expect(keypair.publicKey).toBeInstanceOf(Uint8Array);
      expect(keypair.secretKey).toBeInstanceOf(Uint8Array);
      expect(typeof keypair.publicKeyB64).toBe('string');
      expect(typeof keypair.secretKeyB64).toBe('string');
    });

    it('generates keys with correct ML-KEM-768 sizes', () => {
      const keypair = service.generateKeypair();

      expect(keypair.publicKey.length).toBe(MLKEM_PUBLIC_KEY_SIZE);
      expect(keypair.secretKey.length).toBe(MLKEM_SECRET_KEY_SIZE);
    });

    it('generates unique keypairs on each call', () => {
      const keypair1 = service.generateKeypair();
      const keypair2 = service.generateKeypair();

      expect(keypair1.publicKeyB64).not.toBe(keypair2.publicKeyB64);
      expect(keypair1.secretKeyB64).not.toBe(keypair2.secretKeyB64);
    });

    it('generates base64url-encoded keys without padding', () => {
      const keypair = service.generateKeypair();

      // base64url should not contain +, /, or = characters
      expect(keypair.publicKeyB64).not.toContain('+');
      expect(keypair.publicKeyB64).not.toContain('/');
      expect(keypair.publicKeyB64).not.toContain('=');

      expect(keypair.secretKeyB64).not.toContain('+');
      expect(keypair.secretKeyB64).not.toContain('/');
      expect(keypair.secretKeyB64).not.toContain('=');
    });

    it('generates base64url-encoded keys with expected character set', () => {
      const keypair = service.generateKeypair();
      const base64urlPattern = /^[A-Za-z0-9_-]+$/;

      expect(keypair.publicKeyB64).toMatch(base64urlPattern);
      expect(keypair.secretKeyB64).toMatch(base64urlPattern);
    });
  });

  describe('decryptPayload', () => {
    it('throws error when server signature key mismatches', async () => {
      const payload = createMockEncryptedPayload({
        server_sig_pk: 'different-server-sig-pk',
      });
      const secretKey = new Uint8Array(MLKEM_SECRET_KEY_SIZE);

      await expectAsync(service.decryptPayload(payload, secretKey)).toBeRejectedWithError(
        'SERVER SIGNATURE KEY MISMATCH - Unexpected signer',
      );
    });

    it('does not throw mismatch error when server info is unavailable', async () => {
      serverInfoServiceStub.setServerInfo(null);

      const payload = createMockEncryptedPayload({
        server_sig_pk: 'any-server-sig-pk',
      });
      const secretKey = new Uint8Array(MLKEM_SECRET_KEY_SIZE);

      // Should not throw mismatch error, but will fail later at signature verification
      // because the mock signature is invalid
      await expectAsync(service.decryptPayload(payload, secretKey)).toBeRejected();

      // The rejection should NOT be about key mismatch since server info was null
      try {
        await service.decryptPayload(payload, secretKey);
      } catch (e) {
        expect((e as Error).message).not.toContain('SERVER SIGNATURE KEY MISMATCH');
      }
    });

    it('does not throw mismatch error when expected key matches payload key', async () => {
      const matchingPk = 'matching-server-pk';
      serverInfoServiceStub.setServerSigPk(matchingPk);

      const payload = createMockEncryptedPayload({
        server_sig_pk: matchingPk,
      });
      const secretKey = new Uint8Array(MLKEM_SECRET_KEY_SIZE);

      // Should not throw mismatch error, but will fail at signature verification
      try {
        await service.decryptPayload(payload, secretKey);
      } catch (e) {
        expect((e as Error).message).not.toContain('SERVER SIGNATURE KEY MISMATCH');
      }
    });
  });

  describe('decryptMetadata', () => {
    it('calls decryptPayload and parses JSON result', async () => {
      const mockMetadata = { from: 'sender@test.com', to: 'recipient@test.com', subject: 'Test' };
      spyOn(service, 'decryptPayload').and.returnValue(Promise.resolve(JSON.stringify(mockMetadata)));

      const payload = createMockEncryptedPayload();
      const secretKey = new Uint8Array(MLKEM_SECRET_KEY_SIZE);

      const result = await service.decryptMetadata(payload, secretKey);

      expect(service.decryptPayload).toHaveBeenCalledWith(payload, secretKey);
      expect(result).toEqual(mockMetadata);
    });

    it('throws when decryptPayload returns invalid JSON', async () => {
      spyOn(service, 'decryptPayload').and.returnValue(Promise.resolve('not valid json'));

      const payload = createMockEncryptedPayload();
      const secretKey = new Uint8Array(MLKEM_SECRET_KEY_SIZE);

      await expectAsync(service.decryptMetadata(payload, secretKey)).toBeRejected();
    });

    it('propagates errors from decryptPayload', async () => {
      const testError = new Error('Decryption failed');
      spyOn(service, 'decryptPayload').and.returnValue(Promise.reject(testError));

      const payload = createMockEncryptedPayload();
      const secretKey = new Uint8Array(MLKEM_SECRET_KEY_SIZE);

      await expectAsync(service.decryptMetadata(payload, secretKey)).toBeRejectedWith(testError);
    });
  });

  describe('decryptBody', () => {
    it('calls decryptPayload and returns the plaintext directly', async () => {
      const mockBody = '{"html": "<p>Hello</p>", "text": "Hello"}';
      spyOn(service, 'decryptPayload').and.returnValue(Promise.resolve(mockBody));

      const payload = createMockEncryptedPayload();
      const secretKey = new Uint8Array(MLKEM_SECRET_KEY_SIZE);

      const result = await service.decryptBody(payload, secretKey);

      expect(service.decryptPayload).toHaveBeenCalledWith(payload, secretKey);
      expect(result).toBe(mockBody);
    });

    it('does not parse JSON - returns raw string', async () => {
      const rawString = 'plain text content';
      spyOn(service, 'decryptPayload').and.returnValue(Promise.resolve(rawString));

      const payload = createMockEncryptedPayload();
      const secretKey = new Uint8Array(MLKEM_SECRET_KEY_SIZE);

      const result = await service.decryptBody(payload, secretKey);

      expect(result).toBe(rawString);
    });

    it('propagates errors from decryptPayload', async () => {
      const testError = new Error('Decryption failed');
      spyOn(service, 'decryptPayload').and.returnValue(Promise.reject(testError));

      const payload = createMockEncryptedPayload();
      const secretKey = new Uint8Array(MLKEM_SECRET_KEY_SIZE);

      await expectAsync(service.decryptBody(payload, secretKey)).toBeRejectedWith(testError);
    });
  });

  describe('decryptPayload - full cryptographic flow', () => {
    // Helper to create base64url encoded data
    const base64urlEncode = (data: Uint8Array): string => {
      const base64 = btoa(String.fromCharCode(...data));
      return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    };

    it('handles getServerInfo rejection gracefully', async () => {
      // Make getServerInfo reject to test the .catch(() => null) path
      serverInfoServiceStub.getServerInfo = jasmine
        .createSpy('getServerInfo')
        .and.returnValue(Promise.reject(new Error('Server error')));

      const payload = createMockEncryptedPayload();
      const secretKey = new Uint8Array(MLKEM_SECRET_KEY_SIZE);

      // Should not throw mismatch error since getServerInfo failed and returned null
      // Will fail at signature verification instead (ml_dsa65 will throw for invalid key size)
      try {
        await service.decryptPayload(payload, secretKey);
        fail('Expected an error to be thrown');
      } catch (e) {
        expect((e as Error).message).not.toContain('SERVER SIGNATURE KEY MISMATCH');
      }
    });

    it('performs end-to-end decryption with real crypto operations', async () => {
      // Generate real ML-KEM keypair for the client
      const clientKeypair = mlKem.ml_kem768.keygen();

      // Generate real ML-DSA keypair for the server
      const serverDsaKeypair = mlDsa.ml_dsa65.keygen();
      const serverSigPkB64 = base64urlEncode(serverDsaKeypair.publicKey);

      // Set expected server key in the stub
      serverInfoServiceStub.setServerSigPk(serverSigPkB64);

      // Simulate server-side encryption:
      // 1. KEM encapsulation with client's public key
      const { sharedSecret, cipherText: ctKem } = mlKem.ml_kem768.encapsulate(clientKeypair.publicKey);

      // 2. Prepare plaintext
      const plaintextString = '{"from":"test@example.com","subject":"Test"}';
      const plaintextBytes = new TextEncoder().encode(plaintextString);

      // 3. Derive AES key using HKDF (matching the service's deriveKey method)
      const context = 'vaultsandbox:email:v1';
      const contextBytes = new TextEncoder().encode(context);

      // Create salt from ctKem hash
      const saltBuffer = await crypto.subtle.digest('SHA-256', ctKem as BufferSource);
      const salt = new Uint8Array(saltBuffer);

      // AAD for this test
      const aadBytes = new TextEncoder().encode('test-aad');

      // Structure info with aad_length prefix
      const aadLength = new Uint8Array(4);
      new DataView(aadLength.buffer).setUint32(0, aadBytes.length, false);

      const totalLength = contextBytes.length + aadLength.length + aadBytes.length;
      const info = new Uint8Array(totalLength);
      let offset = 0;
      info.set(contextBytes, offset);
      offset += contextBytes.length;
      info.set(aadLength, offset);
      offset += aadLength.length;
      info.set(aadBytes, offset);

      // Derive key using HKDF
      const baseKey = await crypto.subtle.importKey('raw', sharedSecret as BufferSource, 'HKDF', false, ['deriveBits']);
      const derivedBits = await crypto.subtle.deriveBits(
        {
          name: 'HKDF',
          hash: 'SHA-512',
          salt: salt as BufferSource,
          info: info as BufferSource,
        },
        baseKey,
        256,
      );
      const aesKey = new Uint8Array(derivedBits);

      // 4. Encrypt with AES-256-GCM
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const cryptoKey = await crypto.subtle.importKey('raw', aesKey as BufferSource, { name: 'AES-GCM' }, false, [
        'encrypt',
      ]);
      const ciphertextBuffer = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: nonce as BufferSource,
          additionalData: aadBytes as BufferSource,
          tagLength: 128,
        },
        cryptoKey,
        plaintextBytes as BufferSource,
      );
      const ciphertextBytes = new Uint8Array(ciphertextBuffer);

      // 5. Build transcript and sign with ML-DSA
      const algs = { kem: 'ML-KEM-768', sig: 'ML-DSA-65', aead: 'AES-256-GCM', kdf: 'HKDF-SHA-512' };
      const algsCiphersuite = `${algs.kem}:${algs.sig}:${algs.aead}:${algs.kdf}`;

      // Build transcript matching the service's buildTranscript method
      const versionBytes = new Uint8Array([1]);
      const algsBytes = new TextEncoder().encode(algsCiphersuite);
      const transcriptParts = [
        versionBytes,
        algsBytes,
        contextBytes,
        ctKem,
        nonce,
        aadBytes,
        ciphertextBytes,
        serverDsaKeypair.publicKey,
      ];
      const transcriptLength = transcriptParts.reduce((sum, arr) => sum + arr.length, 0);
      const transcript = new Uint8Array(transcriptLength);
      let tOffset = 0;
      for (const part of transcriptParts) {
        transcript.set(part, tOffset);
        tOffset += part.length;
      }

      const signature = mlDsa.ml_dsa65.sign(transcript, serverDsaKeypair.secretKey);

      // 6. Create the encrypted payload
      const encryptedPayload: EncryptedPayload = {
        v: 1,
        algs,
        ct_kem: base64urlEncode(ctKem),
        nonce: base64urlEncode(nonce),
        aad: base64urlEncode(aadBytes),
        ciphertext: base64urlEncode(ciphertextBytes),
        sig: base64urlEncode(signature),
        server_sig_pk: serverSigPkB64,
      };

      // 7. Decrypt using the service
      const result = await service.decryptPayload(encryptedPayload, clientKeypair.secretKey);

      expect(result).toBe(plaintextString);
    });

    it('throws SIGNATURE VERIFICATION FAILED with tampered ciphertext', async () => {
      // Generate real keypairs
      const clientKeypair = mlKem.ml_kem768.keygen();
      const serverDsaKeypair = mlDsa.ml_dsa65.keygen();
      const serverSigPkB64 = base64urlEncode(serverDsaKeypair.publicKey);

      serverInfoServiceStub.setServerSigPk(serverSigPkB64);

      // Create valid encrypted payload
      const { sharedSecret, cipherText: ctKem } = mlKem.ml_kem768.encapsulate(clientKeypair.publicKey);

      const plaintextBytes = new TextEncoder().encode('original');
      const aadBytes = new TextEncoder().encode('aad');
      const context = 'vaultsandbox:email:v1';
      const contextBytes = new TextEncoder().encode(context);

      // Derive key
      const saltBuffer = await crypto.subtle.digest('SHA-256', ctKem as BufferSource);
      const aadLength = new Uint8Array(4);
      new DataView(aadLength.buffer).setUint32(0, aadBytes.length, false);
      const info = new Uint8Array(contextBytes.length + 4 + aadBytes.length);
      info.set(contextBytes, 0);
      info.set(aadLength, contextBytes.length);
      info.set(aadBytes, contextBytes.length + 4);

      const baseKey = await crypto.subtle.importKey('raw', sharedSecret as BufferSource, 'HKDF', false, ['deriveBits']);
      const derivedBits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-512', salt: new Uint8Array(saltBuffer) as BufferSource, info: info as BufferSource },
        baseKey,
        256,
      );

      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        new Uint8Array(derivedBits) as BufferSource,
        { name: 'AES-GCM' },
        false,
        ['encrypt'],
      );
      const ciphertextBuffer = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: nonce as BufferSource,
          additionalData: aadBytes as BufferSource,
          tagLength: 128,
        },
        cryptoKey,
        plaintextBytes as BufferSource,
      );
      const ciphertextBytes = new Uint8Array(ciphertextBuffer);

      // Sign the ORIGINAL transcript
      const algs = { kem: 'ML-KEM-768', sig: 'ML-DSA-65', aead: 'AES-256-GCM', kdf: 'HKDF-SHA-512' };
      const algsStr = `${algs.kem}:${algs.sig}:${algs.aead}:${algs.kdf}`;
      const transcriptParts = [
        new Uint8Array([1]),
        new TextEncoder().encode(algsStr),
        contextBytes,
        ctKem,
        nonce,
        aadBytes,
        ciphertextBytes,
        serverDsaKeypair.publicKey,
      ];
      const transcript = new Uint8Array(transcriptParts.reduce((s, a) => s + a.length, 0));
      let off = 0;
      for (const p of transcriptParts) {
        transcript.set(p, off);
        off += p.length;
      }
      const signature = mlDsa.ml_dsa65.sign(transcript, serverDsaKeypair.secretKey);

      // TAMPER with the ciphertext by flipping a byte
      const tamperedCiphertext = new Uint8Array(ciphertextBytes);
      tamperedCiphertext[0] ^= 0xff;

      const payload: EncryptedPayload = {
        v: 1,
        algs,
        ct_kem: base64urlEncode(ctKem),
        nonce: base64urlEncode(nonce),
        aad: base64urlEncode(aadBytes),
        ciphertext: base64urlEncode(tamperedCiphertext), // Tampered!
        sig: base64urlEncode(signature),
        server_sig_pk: serverSigPkB64,
      };

      await expectAsync(service.decryptPayload(payload, clientKeypair.secretKey)).toBeRejectedWithError(
        'SIGNATURE VERIFICATION FAILED - Data may be tampered!',
      );
    });
  });
});
