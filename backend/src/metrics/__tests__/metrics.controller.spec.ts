import { Test, TestingModule } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';
import { MetricsController } from '../metrics.controller';
import { MetricsService } from '../metrics.service';
import { EmailStorageService } from '../../smtp/storage/email-storage.service';
import { ApiKeyGuard } from '../../inbox/guards/api-key.guard';

describe('MetricsController', () => {
  let controller: MetricsController;
  let metricsService: jest.Mocked<MetricsService>;
  let emailStorageService: jest.Mocked<EmailStorageService>;
  let moduleRef: jest.Mocked<ModuleRef>;

  const mockMetrics = {
    connections: { total: 10, active: 2, rejected: 0 },
    inbox: { created_total: 5, deleted_total: 1, active_total: 4 },
    email: { received_total: 100, recipients_total: 120, processing_time_ms: 50 },
    rejections: {
      invalid_commands: 0,
      sender_rejected_total: 0,
      recipient_rejected_total: 0,
      data_rejected_size_total: 0,
      hard_mode_total: 0,
      rate_limit_total: 0,
    },
    auth: { spf_pass: 90, spf_fail: 5, dkim_pass: 85, dkim_fail: 10, dmarc_pass: 80, dmarc_fail: 15 },
    certificate: { days_until_expiry: 30, renewal_attempts: 1, renewal_success: 1, renewal_failures: 0 },
    server: { uptime_seconds: 3600 },
  };

  const mockStorageMetrics = {
    storage: {
      usedMemoryBytes: 1024,
      usedMemoryMB: '0.00',
      maxMemoryBytes: 524288000,
      maxMemoryMB: '500.00',
      availableMemoryBytes: 524286976,
      utilizationPercent: '0.00',
    },
    emails: {
      totalStored: 5,
      totalEvicted: 0,
      tombstones: 0,
      oldestEmailAge: null,
      newestEmailAge: null,
    },
    eviction: {
      maxAgeEnabled: false,
      maxAgeSeconds: null,
    },
  };

  const mockApiKeyGuard = { canActivate: jest.fn().mockReturnValue(true) };

  beforeEach(async () => {
    metricsService = {
      getMetrics: jest.fn().mockReturnValue(mockMetrics),
    } as unknown as jest.Mocked<MetricsService>;

    emailStorageService = {
      getMetrics: jest.fn().mockReturnValue(mockStorageMetrics),
    } as unknown as jest.Mocked<EmailStorageService>;

    moduleRef = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ModuleRef>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        { provide: MetricsService, useValue: metricsService },
        { provide: EmailStorageService, useValue: emailStorageService },
        { provide: ModuleRef, useValue: moduleRef },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue(mockApiKeyGuard)
      .compile();

    controller = module.get<MetricsController>(MetricsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getMetrics', () => {
    it('should return metrics from MetricsService', () => {
      const result = controller.getMetrics();

      expect(result).toEqual(mockMetrics);
      expect(metricsService.getMetrics).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStorageMetrics', () => {
    it('should return storage metrics when EmailStorageService is directly injected', () => {
      const result = controller.getStorageMetrics();

      expect(result).toEqual(mockStorageMetrics);
      expect(emailStorageService.getMetrics).toHaveBeenCalledTimes(1);
    });

    it('should return storage metrics when resolved via ModuleRef', async () => {
      // Create controller without directly injected EmailStorageService
      const resolvedStorageService = {
        getMetrics: jest.fn().mockReturnValue(mockStorageMetrics),
      } as unknown as jest.Mocked<EmailStorageService>;

      moduleRef.get.mockReturnValue(resolvedStorageService);

      const moduleWithoutStorage: TestingModule = await Test.createTestingModule({
        controllers: [MetricsController],
        providers: [
          { provide: MetricsService, useValue: metricsService },
          { provide: ModuleRef, useValue: moduleRef },
        ],
      })
        .overrideGuard(ApiKeyGuard)
        .useValue(mockApiKeyGuard)
        .compile();

      const controllerWithoutStorage = moduleWithoutStorage.get<MetricsController>(MetricsController);
      const result = controllerWithoutStorage.getStorageMetrics();

      expect(result).toEqual(mockStorageMetrics);
      expect(moduleRef.get).toHaveBeenCalledWith(EmailStorageService, { strict: false });
      expect(resolvedStorageService.getMetrics).toHaveBeenCalledTimes(1);
    });

    it('should return error when EmailStorageService is not available', async () => {
      // Create controller without EmailStorageService and with ModuleRef returning null
      moduleRef.get.mockReturnValue(null);

      const moduleWithoutStorage: TestingModule = await Test.createTestingModule({
        controllers: [MetricsController],
        providers: [
          { provide: MetricsService, useValue: metricsService },
          { provide: ModuleRef, useValue: moduleRef },
        ],
      })
        .overrideGuard(ApiKeyGuard)
        .useValue(mockApiKeyGuard)
        .compile();

      const controllerWithoutStorage = moduleWithoutStorage.get<MetricsController>(MetricsController);
      const result = controllerWithoutStorage.getStorageMetrics();

      expect(result).toEqual({
        error: 'Email storage service not available',
        reason: 'Gateway may not be running in local mode or storage service not initialized',
      });
    });

    it('should return error when ModuleRef is not available', async () => {
      // Create controller without EmailStorageService and with ModuleRef explicitly undefined
      const moduleWithoutDependencies: TestingModule = await Test.createTestingModule({
        controllers: [MetricsController],
        providers: [
          { provide: MetricsService, useValue: metricsService },
          { provide: ModuleRef, useValue: undefined },
        ],
      })
        .overrideGuard(ApiKeyGuard)
        .useValue(mockApiKeyGuard)
        .compile();

      const controllerWithoutDeps = moduleWithoutDependencies.get<MetricsController>(MetricsController);
      const result = controllerWithoutDeps.getStorageMetrics();

      expect(result).toEqual({
        error: 'Email storage service not available',
        reason: 'Gateway may not be running in local mode or storage service not initialized',
      });
    });

    it('should return error when ModuleRef.get throws an exception', async () => {
      moduleRef.get.mockImplementation(() => {
        throw new Error('Service not found');
      });

      const moduleWithThrowingRef: TestingModule = await Test.createTestingModule({
        controllers: [MetricsController],
        providers: [
          { provide: MetricsService, useValue: metricsService },
          { provide: ModuleRef, useValue: moduleRef },
        ],
      })
        .overrideGuard(ApiKeyGuard)
        .useValue(mockApiKeyGuard)
        .compile();

      const controllerWithThrowingRef = moduleWithThrowingRef.get<MetricsController>(MetricsController);
      const result = controllerWithThrowingRef.getStorageMetrics();

      expect(result).toEqual({
        error: 'Email storage service not available',
        reason: 'Gateway may not be running in local mode or storage service not initialized',
      });
    });
  });
});
