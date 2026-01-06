import { Test, TestingModule } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';
import { CertificateHealthIndicator } from '../certificate.health';
import { CertificateService } from '../certificate.service';
import type { CertificateStatus } from '../interfaces';

describe('CertificateHealthIndicator', () => {
  let healthIndicator: CertificateHealthIndicator;
  let certificateService: jest.Mocked<CertificateService>;
  let healthIndicatorService: jest.Mocked<HealthIndicatorService>;
  let mockIndicator: { up: jest.Mock; down: jest.Mock };

  beforeEach(async () => {
    mockIndicator = {
      up: jest.fn((details) => ({ certificate: { status: 'up', ...details } })),
      down: jest.fn((details) => ({ certificate: { status: 'down', ...details } })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificateHealthIndicator,
        {
          provide: CertificateService,
          useValue: {
            getStatus: jest.fn(),
          },
        },
        {
          provide: HealthIndicatorService,
          useValue: {
            check: jest.fn().mockReturnValue(mockIndicator),
          },
        },
      ],
    }).compile();

    healthIndicator = module.get<CertificateHealthIndicator>(CertificateHealthIndicator);
    certificateService = module.get(CertificateService);
    healthIndicatorService = module.get(HealthIndicatorService);
  });

  describe('isHealthy', () => {
    it('should return up status when certificate exists, is valid, and has more than 7 days until expiry', async () => {
      const status: CertificateStatus = {
        exists: true,
        valid: true,
        domain: 'test.example.com',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        daysUntilExpiry: 30,
      };
      certificateService.getStatus.mockResolvedValue(status);

      const result = await healthIndicator.isHealthy('certificate');

      expect(healthIndicatorService.check).toHaveBeenCalledWith('certificate');
      expect(mockIndicator.up).toHaveBeenCalledWith({
        exists: true,
        domain: 'test.example.com',
        expiresAt: status.expiresAt,
        daysUntilExpiry: 30,
        valid: true,
      });
      expect(result).toEqual({
        certificate: {
          status: 'up',
          exists: true,
          domain: 'test.example.com',
          expiresAt: status.expiresAt,
          daysUntilExpiry: 30,
          valid: true,
        },
      });
    });

    it('should return down status when certificate does not exist', async () => {
      const status: CertificateStatus = {
        exists: false,
        valid: false,
      };
      certificateService.getStatus.mockResolvedValue(status);

      const result = await healthIndicator.isHealthy('certificate');

      expect(mockIndicator.down).toHaveBeenCalledWith({
        exists: false,
        domain: undefined,
        expiresAt: undefined,
        daysUntilExpiry: undefined,
        valid: false,
      });
      expect(result).toEqual({
        certificate: {
          status: 'down',
          exists: false,
          domain: undefined,
          expiresAt: undefined,
          daysUntilExpiry: undefined,
          valid: false,
        },
      });
    });

    it('should return down status when certificate is not valid', async () => {
      const status: CertificateStatus = {
        exists: true,
        valid: false,
        domain: 'test.example.com',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() - 1000), // Expired
        daysUntilExpiry: -1,
      };
      certificateService.getStatus.mockResolvedValue(status);

      await healthIndicator.isHealthy('certificate');

      expect(mockIndicator.down).toHaveBeenCalled();
    });

    it('should return down status when certificate expires in 7 days or less', async () => {
      const status: CertificateStatus = {
        exists: true,
        valid: true,
        domain: 'test.example.com',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        daysUntilExpiry: 5,
      };
      certificateService.getStatus.mockResolvedValue(status);

      await healthIndicator.isHealthy('certificate');

      expect(mockIndicator.down).toHaveBeenCalled();
    });

    it('should return down status when certificate expires in exactly 7 days', async () => {
      const status: CertificateStatus = {
        exists: true,
        valid: true,
        domain: 'test.example.com',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        daysUntilExpiry: 7,
      };
      certificateService.getStatus.mockResolvedValue(status);

      await healthIndicator.isHealthy('certificate');

      expect(mockIndicator.down).toHaveBeenCalled();
    });

    it('should return up status when certificate has exactly 8 days until expiry', async () => {
      const status: CertificateStatus = {
        exists: true,
        valid: true,
        domain: 'test.example.com',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
        daysUntilExpiry: 8,
      };
      certificateService.getStatus.mockResolvedValue(status);

      await healthIndicator.isHealthy('certificate');

      expect(mockIndicator.up).toHaveBeenCalled();
    });

    it('should default daysUntilExpiry to 0 when undefined', async () => {
      const status: CertificateStatus = {
        exists: true,
        valid: true,
        domain: 'test.example.com',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        daysUntilExpiry: undefined,
      };
      certificateService.getStatus.mockResolvedValue(status);

      await healthIndicator.isHealthy('certificate');

      // When daysUntilExpiry is undefined, it defaults to 0, which is <= 7
      expect(mockIndicator.down).toHaveBeenCalled();
    });
  });
});
