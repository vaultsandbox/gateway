import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { CERTIFICATE_CONFIG } from '../certificate.tokens';
import type { CertificateConfig } from '../interfaces';

const mockClient = {
  createAccount: jest.fn(),
  createOrder: jest.fn(),
  getAuthorizations: jest.fn(),
  getChallengeKeyAuthorization: jest.fn(),
  completeChallenge: jest.fn(),
  waitForValidStatus: jest.fn(),
  finalizeOrder: jest.fn(),
  getCertificate: jest.fn(),
};

jest.mock('acme-client', () => ({
  Client: jest.fn().mockImplementation(() => mockClient),
  forge: {
    createPrivateKey: jest.fn(),
    createCsr: jest.fn(),
    readCertificateInfo: jest.fn(),
  },
}));

import { AcmeClientService } from '../acme/acme-client.service';
import { CertificateStorageService } from '../storage/certificate-storage.service';
import * as acme from 'acme-client';

const mockForge = acme.forge as jest.Mocked<typeof acme.forge>;

describe('AcmeClientService', () => {
  let service: AcmeClientService;
  let storageService: jest.Mocked<CertificateStorageService>;

  const createConfig = (overrides: Partial<CertificateConfig> = {}): CertificateConfig => ({
    enabled: true,
    domain: 'test.example.com',
    email: 'test@example.com',
    storagePath: '/tmp/certs',
    renewDaysBeforeExpiry: 30,
    acmeDirectoryUrl: 'https://acme.test/directory',
    peerSharedSecret: 'test-secret',
    checkInterval: 3600000,
    staging: false,
    ...overrides,
  });

  const createModule = async (config: CertificateConfig) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AcmeClientService,
        {
          provide: CERTIFICATE_CONFIG,
          useValue: config,
        },
        {
          provide: CertificateStorageService,
          useValue: {
            loadOrGenerateAccountKey: jest.fn(),
          },
        },
      ],
    }).compile();

    return module;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const module = await createModule(createConfig());

    service = module.get<AcmeClientService>(AcmeClientService);
    storageService = module.get(CertificateStorageService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialize', () => {
    it('should skip initialization when disabled', async () => {
      const module = await createModule(createConfig({ enabled: false }));
      const disabledService = module.get<AcmeClientService>(AcmeClientService);
      const disabledStorageService = module.get<CertificateStorageService>(CertificateStorageService);

      await disabledService.initialize();

      expect(disabledStorageService.loadOrGenerateAccountKey).not.toHaveBeenCalled();
    });

    it('should initialize ACME client and create account', async () => {
      const accountKey = Buffer.from('test-account-key');
      storageService.loadOrGenerateAccountKey.mockResolvedValue(accountKey);
      mockClient.createAccount.mockResolvedValue({ status: 'valid' });

      await service.initialize();

      expect(storageService.loadOrGenerateAccountKey).toHaveBeenCalled();
      expect(mockClient.createAccount).toHaveBeenCalledWith({
        termsOfServiceAgreed: true,
        contact: ['mailto:test@example.com'],
      });
    });

    it('should pass empty contact array when no email configured', async () => {
      const module = await createModule(createConfig({ email: '' }));
      const noEmailService = module.get<AcmeClientService>(AcmeClientService);
      const noEmailStorageService = module.get<CertificateStorageService>(CertificateStorageService);

      const accountKey = Buffer.from('test-account-key');
      noEmailStorageService.loadOrGenerateAccountKey.mockResolvedValue(accountKey);
      mockClient.createAccount.mockResolvedValue({ status: 'valid' });

      await noEmailService.initialize();

      expect(mockClient.createAccount).toHaveBeenCalledWith({
        termsOfServiceAgreed: true,
        contact: [],
      });
    });

    it('should handle 409 account exists error gracefully', async () => {
      const accountKey = Buffer.from('test-account-key');
      storageService.loadOrGenerateAccountKey.mockResolvedValue(accountKey);

      const error = new Error('Account already exists') as Error & { status: number };
      error.status = 409;
      mockClient.createAccount.mockRejectedValue(error);

      await service.initialize();

      expect(Logger.prototype.log).toHaveBeenCalledWith('ACME account already exists; continuing');
    });

    it('should log and rethrow non-409 errors', async () => {
      const accountKey = Buffer.from('test-account-key');
      storageService.loadOrGenerateAccountKey.mockResolvedValue(accountKey);

      const error = new Error('Connection refused');
      mockClient.createAccount.mockRejectedValue(error);

      await expect(service.initialize()).rejects.toThrow('Connection refused');
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to initialize ACME client: Connection refused',
        error.stack,
      );
    });
  });

  describe('createOrder', () => {
    beforeEach(async () => {
      const accountKey = Buffer.from('test-account-key');
      storageService.loadOrGenerateAccountKey.mockResolvedValue(accountKey);
      mockClient.createAccount.mockResolvedValue({ status: 'valid' });
      await service.initialize();
    });

    it('should create order for single domain', async () => {
      const mockOrder = { status: 'pending' };
      const mockAuths = [{ identifier: { value: 'test.example.com' } }];
      const mockKey = Buffer.from('certificate-key');

      mockClient.createOrder.mockResolvedValue(mockOrder);
      mockClient.getAuthorizations.mockResolvedValue(mockAuths);
      mockForge.createPrivateKey.mockResolvedValue(mockKey);

      const result = await service.createOrder('test.example.com');

      expect(mockClient.createOrder).toHaveBeenCalledWith({
        identifiers: [{ type: 'dns', value: 'test.example.com' }],
      });
      expect(result.order).toBe(mockOrder);
      expect(result.authorizations).toBe(mockAuths);
      expect(result.certificateKey).toBe(mockKey);
    });

    it('should create order with additional domains', async () => {
      const mockOrder = { status: 'pending' };
      const mockAuths = [{ identifier: { value: 'test.example.com' } }];
      const mockKey = Buffer.from('certificate-key');

      mockClient.createOrder.mockResolvedValue(mockOrder);
      mockClient.getAuthorizations.mockResolvedValue(mockAuths);
      mockForge.createPrivateKey.mockResolvedValue(mockKey);

      await service.createOrder('test.example.com', ['www.example.com', 'api.example.com']);

      expect(mockClient.createOrder).toHaveBeenCalledWith({
        identifiers: [
          { type: 'dns', value: 'test.example.com' },
          { type: 'dns', value: 'www.example.com' },
          { type: 'dns', value: 'api.example.com' },
        ],
      });
    });

    it('should filter out empty domain strings', async () => {
      const mockOrder = { status: 'pending' };
      const mockAuths = [{ identifier: { value: 'test.example.com' } }];
      const mockKey = Buffer.from('certificate-key');

      mockClient.createOrder.mockResolvedValue(mockOrder);
      mockClient.getAuthorizations.mockResolvedValue(mockAuths);
      mockForge.createPrivateKey.mockResolvedValue(mockKey);

      await service.createOrder('test.example.com', ['', 'valid.example.com', '']);

      expect(mockClient.createOrder).toHaveBeenCalledWith({
        identifiers: [
          { type: 'dns', value: 'test.example.com' },
          { type: 'dns', value: 'valid.example.com' },
        ],
      });
    });

    it('should throw error when no domains specified', async () => {
      await expect(service.createOrder('', [])).rejects.toThrow('No domains specified for certificate order');
    });

    it('should throw when client not initialized', async () => {
      const uninitializedModule = await createModule(createConfig());
      const uninitializedService = uninitializedModule.get<AcmeClientService>(AcmeClientService);

      await expect(uninitializedService.createOrder('test.example.com')).rejects.toThrow('ACME client not initialised');
    });
  });

  describe('getChallengeKeyAuthorization', () => {
    beforeEach(async () => {
      const accountKey = Buffer.from('test-account-key');
      storageService.loadOrGenerateAccountKey.mockResolvedValue(accountKey);
      mockClient.createAccount.mockResolvedValue({ status: 'valid' });
      await service.initialize();
    });

    it('should return key authorization for challenge', async () => {
      const mockChallenge = { type: 'http-01', token: 'test-token', url: 'http://acme/challenge' };
      mockClient.getChallengeKeyAuthorization.mockResolvedValue('key-auth-string');

      const result = await service.getChallengeKeyAuthorization(mockChallenge);

      expect(result).toBe('key-auth-string');
      expect(mockClient.getChallengeKeyAuthorization).toHaveBeenCalledWith(mockChallenge);
    });

    it('should throw when client not initialized', async () => {
      const uninitializedModule = await createModule(createConfig());
      const uninitializedService = uninitializedModule.get<AcmeClientService>(AcmeClientService);

      const mockChallenge = { type: 'http-01', token: 'test-token', url: 'http://acme/challenge' };

      await expect(uninitializedService.getChallengeKeyAuthorization(mockChallenge)).rejects.toThrow(
        'ACME client not initialised',
      );
    });
  });

  describe('completeChallenge', () => {
    beforeEach(async () => {
      const accountKey = Buffer.from('test-account-key');
      storageService.loadOrGenerateAccountKey.mockResolvedValue(accountKey);
      mockClient.createAccount.mockResolvedValue({ status: 'valid' });
      await service.initialize();
    });

    it('should complete challenge', async () => {
      const mockChallenge = { type: 'http-01', token: 'test-token', url: 'http://acme/challenge' };
      mockClient.completeChallenge.mockResolvedValue(undefined);

      await service.completeChallenge(mockChallenge);

      expect(mockClient.completeChallenge).toHaveBeenCalledWith(mockChallenge);
    });

    it('should throw when client not initialized', async () => {
      const uninitializedModule = await createModule(createConfig());
      const uninitializedService = uninitializedModule.get<AcmeClientService>(AcmeClientService);

      const mockChallenge = { type: 'http-01', token: 'test-token', url: 'http://acme/challenge' };

      await expect(uninitializedService.completeChallenge(mockChallenge)).rejects.toThrow(
        'ACME client not initialised',
      );
    });
  });

  describe('waitForOrderReady', () => {
    beforeEach(async () => {
      const accountKey = Buffer.from('test-account-key');
      storageService.loadOrGenerateAccountKey.mockResolvedValue(accountKey);
      mockClient.createAccount.mockResolvedValue({ status: 'valid' });
      await service.initialize();
    });

    it('should wait for order ready', async () => {
      const mockOrder = { status: 'pending' };
      mockClient.waitForValidStatus.mockResolvedValue({ status: 'ready' });

      await service.waitForOrderReady(mockOrder);

      expect(mockClient.waitForValidStatus).toHaveBeenCalledWith(mockOrder);
    });

    it('should throw when client not initialized', async () => {
      const uninitializedModule = await createModule(createConfig());
      const uninitializedService = uninitializedModule.get<AcmeClientService>(AcmeClientService);

      const mockOrder = { status: 'pending' };

      await expect(uninitializedService.waitForOrderReady(mockOrder)).rejects.toThrow('ACME client not initialised');
    });
  });

  describe('finalizeCertificate', () => {
    beforeEach(async () => {
      const accountKey = Buffer.from('test-account-key');
      storageService.loadOrGenerateAccountKey.mockResolvedValue(accountKey);
      mockClient.createAccount.mockResolvedValue({ status: 'valid' });
      await service.initialize();
    });

    it('should finalize certificate with buffer response', async () => {
      const mockOrder = {
        status: 'ready',
        identifiers: [
          { type: 'dns', value: 'test.example.com' },
          { type: 'dns', value: 'www.example.com' },
        ],
      };
      const certificateKey = Buffer.from('certificate-key');
      const mockCertPem = Buffer.from('-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----');
      const notBefore = new Date('2024-01-01');
      const notAfter = new Date('2024-04-01');

      mockForge.createCsr.mockResolvedValue([Buffer.from('key'), Buffer.from('csr')]);
      mockClient.finalizeOrder.mockResolvedValue(undefined);
      mockClient.getCertificate.mockResolvedValue(mockCertPem);
      mockForge.readCertificateInfo.mockResolvedValue({ notBefore, notAfter });

      const result = await service.finalizeCertificate(mockOrder, certificateKey);

      expect(mockForge.createCsr).toHaveBeenCalledWith(
        { commonName: 'test.example.com', altNames: ['www.example.com'] },
        certificateKey,
      );
      expect(mockClient.finalizeOrder).toHaveBeenCalledWith(mockOrder, Buffer.from('csr'));
      expect(result.domains).toEqual(['test.example.com', 'www.example.com']);
      expect(result.issuedAt).toEqual(notBefore);
      expect(result.expiresAt).toEqual(notAfter);
      expect(result.privateKey).toBe(certificateKey);
      expect(Buffer.isBuffer(result.certificate)).toBe(true);
    });

    it('should finalize certificate with string response', async () => {
      const mockOrder = {
        status: 'ready',
        identifiers: [{ type: 'dns', value: 'test.example.com' }],
      };
      const certificateKey = Buffer.from('certificate-key');
      const mockCertPemString = '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----';
      const notBefore = new Date('2024-01-01');
      const notAfter = new Date('2024-04-01');

      mockForge.createCsr.mockResolvedValue([Buffer.from('key'), Buffer.from('csr')]);
      mockClient.finalizeOrder.mockResolvedValue(undefined);
      mockClient.getCertificate.mockResolvedValue(mockCertPemString); // String response
      mockForge.readCertificateInfo.mockResolvedValue({ notBefore, notAfter });

      const result = await service.finalizeCertificate(mockOrder, certificateKey);

      expect(Buffer.isBuffer(result.certificate)).toBe(true);
      expect(result.certificate.toString()).toBe(mockCertPemString);
    });

    it('should handle order with no identifiers', async () => {
      const mockOrder = {
        status: 'ready',
        identifiers: undefined,
      };
      const certificateKey = Buffer.from('certificate-key');
      const notBefore = new Date('2024-01-01');
      const notAfter = new Date('2024-04-01');

      mockForge.createCsr.mockResolvedValue([Buffer.from('key'), Buffer.from('csr')]);
      mockClient.finalizeOrder.mockResolvedValue(undefined);
      mockClient.getCertificate.mockResolvedValue(Buffer.from('cert'));
      mockForge.readCertificateInfo.mockResolvedValue({ notBefore, notAfter });

      const result = await service.finalizeCertificate(mockOrder, certificateKey);

      expect(result.domains).toEqual([]);
      expect(mockForge.createCsr).toHaveBeenCalledWith({ commonName: undefined, altNames: [] }, certificateKey);
    });

    it('should throw when client not initialized', async () => {
      const uninitializedModule = await createModule(createConfig());
      const uninitializedService = uninitializedModule.get<AcmeClientService>(AcmeClientService);

      const mockOrder = { status: 'ready', identifiers: [] };
      const certificateKey = Buffer.from('key');

      await expect(uninitializedService.finalizeCertificate(mockOrder, certificateKey)).rejects.toThrow(
        'ACME client not initialised',
      );
    });
  });
});
