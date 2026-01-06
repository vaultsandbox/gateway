import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as chokidar from 'chokidar';
import { CertificateWatcherService } from '../watcher/certificate-watcher.service';
import { CertificateStorageService } from '../storage/certificate-storage.service';
import { CERTIFICATE_CONFIG } from '../certificate.tokens';
import type { CertificateConfig, Certificate } from '../interfaces';

jest.mock('chokidar');

describe('CertificateWatcherService', () => {
  let service: CertificateWatcherService;
  let storageService: jest.Mocked<CertificateStorageService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let mockWatcher: {
    on: jest.Mock;
    close: jest.Mock;
  };

  const createConfig = (overrides: Partial<CertificateConfig> = {}): CertificateConfig => ({
    enabled: true,
    domain: 'test.example.com',
    email: 'test@example.com',
    storagePath: '/tmp/certs',
    renewDaysBeforeExpiry: 30,
    acmeDirectoryUrl: 'https://acme.test/directory',
    peerSharedSecret: 'test-secret',
    ...overrides,
  });

  const createMockCertificate = (overrides: Partial<Certificate> = {}): Certificate => ({
    certificate: Buffer.from('cert'),
    privateKey: Buffer.from('key'),
    domains: ['test.example.com'],
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    ...overrides,
  });

  const createModule = async (config: CertificateConfig) => {
    mockWatcher = {
      on: jest.fn().mockReturnThis(),
      close: jest.fn().mockResolvedValue(undefined),
    };

    (chokidar.watch as jest.Mock).mockReturnValue(mockWatcher);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificateWatcherService,
        {
          provide: CERTIFICATE_CONFIG,
          useValue: config,
        },
        {
          provide: CertificateStorageService,
          useValue: {
            loadCertificate: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    return module;
  };

  beforeEach(async () => {
    const module = await createModule(createConfig());

    service = module.get<CertificateWatcherService>(CertificateWatcherService);
    storageService = module.get(CertificateStorageService);
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startWatching', () => {
    it('should return early when certificate management is disabled', () => {
      const disabledConfig = createConfig({ enabled: false });

      return createModule(disabledConfig).then((module) => {
        const disabledService = module.get<CertificateWatcherService>(CertificateWatcherService);

        disabledService.startWatching();

        expect(chokidar.watch).not.toHaveBeenCalled();
      });
    });

    it('should set up file watcher when enabled', () => {
      service.startWatching();

      expect(chokidar.watch).toHaveBeenCalledWith(
        ['/tmp/certs/cert.pem', '/tmp/certs/key.pem'],
        expect.objectContaining({
          persistent: true,
          ignoreInitial: true,
          awaitWriteFinish: expect.any(Object),
        }),
      );
      expect(mockWatcher.on).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should trigger certificate reload on file change', async () => {
      const mockCert = createMockCertificate();
      storageService.loadCertificate.mockResolvedValue(mockCert);

      service.startWatching();

      // Get the change callback
      const changeCallback = mockWatcher.on.mock.calls.find((call) => call[0] === 'change')?.[1];
      expect(changeCallback).toBeDefined();

      // Trigger the change event
      await changeCallback('/tmp/certs/cert.pem');

      // Wait for async reload to complete
      await new Promise(process.nextTick);

      expect(storageService.loadCertificate).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith('certificate.reloaded', mockCert);
    });

    it('should log warning when no certificate found on reload', async () => {
      storageService.loadCertificate.mockResolvedValue(null);

      service.startWatching();

      const changeCallback = mockWatcher.on.mock.calls.find((call) => call[0] === 'change')?.[1];

      await changeCallback('/tmp/certs/cert.pem');
      await new Promise(process.nextTick);

      expect(storageService.loadCertificate).toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should handle errors during certificate reload', async () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      storageService.loadCertificate.mockRejectedValue(new Error('Storage error'));

      service.startWatching();

      const changeCallback = mockWatcher.on.mock.calls.find((call) => call[0] === 'change')?.[1];

      // Should not throw
      await changeCallback('/tmp/certs/cert.pem');
      await new Promise(process.nextTick);

      expect(storageService.loadCertificate).toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('stopWatching', () => {
    it('should return early when no watcher exists', async () => {
      await service.stopWatching();

      // No error should be thrown
    });

    it('should close watcher and clear reference when watcher exists', async () => {
      service.startWatching();

      await service.stopWatching();

      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it('should allow subsequent stopWatching calls after watcher is closed', async () => {
      service.startWatching();

      await service.stopWatching();
      await service.stopWatching();

      expect(mockWatcher.close).toHaveBeenCalledTimes(1);
    });
  });
});
