import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CertificateController } from '../certificate.controller';
import { CertificateService } from '../certificate.service';
import { CertificateStorageService } from '../storage/certificate-storage.service';
import { CERTIFICATE_CONFIG } from '../certificate.tokens';
import type { CertificateConfig, CertificateSyncRequest, ChallengeSyncRequest } from '../interfaces';

describe('CertificateController', () => {
  let controller: CertificateController;
  let storageService: jest.Mocked<CertificateStorageService>;
  let certificateService: jest.Mocked<CertificateService>;
  let configService: jest.Mocked<ConfigService>;

  const mockConfig: CertificateConfig = {
    enabled: true,
    domain: 'test.example.com',
    email: 'test@example.com',
    storagePath: '/tmp/certs',
    renewDaysBeforeExpiry: 30,
    acmeDirectoryUrl: 'https://acme.test/directory',
    peerSharedSecret: 'test-secret',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CertificateController],
      providers: [
        {
          provide: CERTIFICATE_CONFIG,
          useValue: mockConfig,
        },
        {
          provide: CertificateStorageService,
          useValue: {
            getChallengeResponse: jest.fn(),
            saveChallengeResponse: jest.fn(),
          },
        },
        {
          provide: CertificateService,
          useValue: {
            receiveCertificateSync: jest.fn(),
            getStatus: jest.fn(),
            manualRenewal: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<CertificateController>(CertificateController);
    storageService = module.get(CertificateStorageService);
    certificateService = module.get(CertificateService);
    configService = module.get(ConfigService);
  });

  describe('acmeChallenge', () => {
    it('should return key authorization when challenge is found', () => {
      const token = 'test-token';
      const keyAuth = 'test-key-auth';
      storageService.getChallengeResponse.mockReturnValue(keyAuth);
      configService.get.mockReturnValue(8080);

      const result = controller.acmeChallenge(token);

      expect(result).toBe(keyAuth);
      expect(storageService.getChallengeResponse).toHaveBeenCalledWith(token);
    });

    it('should throw NotFoundException when challenge is not found', () => {
      const token = 'nonexistent-token';
      storageService.getChallengeResponse.mockReturnValue(null);
      configService.get.mockReturnValue(8080);

      expect(() => controller.acmeChallenge(token)).toThrow(NotFoundException);
    });

    it('should handle port 80 without port suffix in URL', () => {
      const token = 'test-token';
      const keyAuth = 'test-key-auth';
      storageService.getChallengeResponse.mockReturnValue(keyAuth);
      configService.get.mockReturnValue(80);

      const result = controller.acmeChallenge(token);

      expect(result).toBe(keyAuth);
    });

    it('should include port suffix for non-80 ports', () => {
      const token = 'test-token';
      const keyAuth = 'test-key-auth';
      storageService.getChallengeResponse.mockReturnValue(keyAuth);
      configService.get.mockReturnValue(3000);

      const result = controller.acmeChallenge(token);

      expect(result).toBe(keyAuth);
    });
  });

  describe('getVaultSandboxVerification', () => {
    it('should return "ok"', () => {
      const result = controller.getVaultSandboxVerification();

      expect(result).toBe('ok');
    });
  });

  describe('syncCertificate', () => {
    it('should delegate to certificateService.receiveCertificateSync', () => {
      const syncRequest: CertificateSyncRequest = {
        certificate: 'base64-cert',
        privateKey: 'base64-key',
        metadata: {
          domains: ['test.example.com'],
          issuedAt: new Date().toISOString(),
          expiresAt: new Date().toISOString(),
        },
      };

      controller.syncCertificate(syncRequest);

      expect(certificateService.receiveCertificateSync).toHaveBeenCalledWith(syncRequest);
    });
  });

  describe('syncChallenge', () => {
    it('should delegate to storageService.saveChallengeResponse', () => {
      const syncRequest: ChallengeSyncRequest = {
        token: 'test-token',
        keyAuth: 'test-key-auth',
      };

      controller.syncChallenge(syncRequest);

      expect(storageService.saveChallengeResponse).toHaveBeenCalledWith(syncRequest.token, syncRequest.keyAuth);
    });
  });

  describe('getCertificateStatus', () => {
    it('should delegate to certificateService.getStatus', async () => {
      const expectedStatus = {
        exists: true,
        valid: true,
        domain: 'test.example.com',
        issuedAt: new Date(),
        expiresAt: new Date(),
        daysUntilExpiry: 30,
      };
      certificateService.getStatus.mockResolvedValue(expectedStatus);

      const result = await controller.getCertificateStatus();

      expect(result).toEqual(expectedStatus);
      expect(certificateService.getStatus).toHaveBeenCalled();
    });
  });

  describe('renewCertificate', () => {
    it('should trigger manual renewal and return success message', async () => {
      certificateService.manualRenewal.mockResolvedValue();

      const result = await controller.renewCertificate();

      expect(result).toEqual({ message: 'Certificate renewal initiated' });
      expect(certificateService.manualRenewal).toHaveBeenCalled();
    });
  });
});
