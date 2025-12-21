import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthCheckService, HttpHealthIndicator } from '@nestjs/terminus';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { HealthController } from '../health.controller';
import { SmtpHealthIndicator } from '../smtp.health';
import { CertificateHealthIndicator } from '../../certificate/certificate.health';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: jest.Mocked<HealthCheckService>;
  let httpHealthIndicator: jest.Mocked<HttpHealthIndicator>;
  let smtpHealthIndicator: jest.Mocked<SmtpHealthIndicator>;
  let certificateHealthIndicator: jest.Mocked<CertificateHealthIndicator>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: {
            check: jest.fn(),
          },
        },
        {
          provide: HttpHealthIndicator,
          useValue: {
            pingCheck: jest.fn(),
          },
        },
        {
          provide: SmtpHealthIndicator,
          useValue: {
            isHealthy: jest.fn(),
          },
        },
        {
          provide: CertificateHealthIndicator,
          useValue: {
            isHealthy: jest.fn(),
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

    controller = module.get<HealthController>(HealthController);
    healthCheckService = module.get(HealthCheckService);
    httpHealthIndicator = module.get(HttpHealthIndicator);
    smtpHealthIndicator = module.get(SmtpHealthIndicator);
    certificateHealthIndicator = module.get(CertificateHealthIndicator);
    configService = module.get(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('check', () => {
    it('should perform health checks and return results', async () => {
      const mockHealthResult = {
        status: 'ok',
        info: {
          server: { status: 'up' },
          smtp: { status: 'up' },
          backend: { status: 'up' },
          certificate: { status: 'up' },
        },
      };

      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'vsb.main.backend.url') return 'http://localhost:3000';
        if (key === 'vsb.main.gatewayMode') return 'remote';
        return defaultValue;
      });

      healthCheckService.check.mockResolvedValue(mockHealthResult as any);
      smtpHealthIndicator.isHealthy.mockResolvedValue({ smtp: { status: 'up' } } as any);
      httpHealthIndicator.pingCheck.mockResolvedValue({ backend: { status: 'up' } } as any);
      certificateHealthIndicator.isHealthy.mockResolvedValue({
        certificate: { status: 'up' },
      } as any);

      const result = await controller.check();

      expect(result).toEqual(mockHealthResult);
      expect(healthCheckService.check).toHaveBeenCalledWith(expect.any(Array));
      expect(healthCheckService.check).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(Function),
          expect.any(Function),
          expect.any(Function),
          expect.any(Function),
        ]),
      );
    });

    it('should execute server health check', async () => {
      configService.get.mockReturnValue('local');
      healthCheckService.check.mockImplementation(async (checks) => {
        const results = await Promise.all(checks.map(async (check) => await check()));
        return { status: 'ok', info: results } as any;
      });

      await controller.check();

      const checkFunctions = healthCheckService.check.mock.calls[0][0];
      const serverCheck = await checkFunctions[0]();

      expect(serverCheck).toEqual({ server: { status: 'up' } });
    });

    it('should call smtp health indicator', async () => {
      configService.get.mockReturnValue('local');
      smtpHealthIndicator.isHealthy.mockResolvedValue({
        smtp: { status: 'up', listening: true },
      } as any);
      healthCheckService.check.mockImplementation(async (checks) => {
        const results = await Promise.all(checks.map(async (check) => await check()));
        return { status: 'ok', info: results } as any;
      });

      await controller.check();

      const checkFunctions = healthCheckService.check.mock.calls[0][0];
      await checkFunctions[1]();

      expect(smtpHealthIndicator.isHealthy).toHaveBeenCalledWith('smtp');
    });

    describe('backend health check', () => {
      it('should return local mode status when gatewayMode is local', async () => {
        configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
          if (key === 'vsb.main.backend.url') return 'http://localhost:3000';
          if (key === 'vsb.main.gatewayMode') return 'local';
          return defaultValue;
        });

        healthCheckService.check.mockImplementation(async (checks) => {
          const results = await Promise.all(checks.map(async (check) => await check()));
          return { status: 'ok', info: results } as any;
        });

        await controller.check();

        const checkFunctions = healthCheckService.check.mock.calls[0][0];
        const backendCheck = await checkFunctions[2]();

        expect(backendCheck).toEqual({
          backend: { status: 'up', mode: 'local', checked: false },
        });
        expect(httpHealthIndicator.pingCheck).not.toHaveBeenCalled();
      });

      it('should return unconfigured status when gatewayMode is not local and backendUrl is not set', async () => {
        configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
          if (key === 'vsb.main.backend.url') return undefined;
          if (key === 'vsb.main.gatewayMode') return 'remote';
          return defaultValue;
        });

        healthCheckService.check.mockImplementation(async (checks) => {
          const results = await Promise.all(checks.map(async (check) => await check()));
          return { status: 'ok', info: results } as any;
        });

        await controller.check();

        const checkFunctions = healthCheckService.check.mock.calls[0][0];
        const backendCheck = await checkFunctions[2]();

        expect(backendCheck).toEqual({
          backend: { status: 'up', configured: false },
        });
        expect(httpHealthIndicator.pingCheck).not.toHaveBeenCalled();
      });

      it('should ping backend when gatewayMode is not local and backendUrl is configured', async () => {
        const backendUrl = 'http://backend.example.com';
        configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
          if (key === 'vsb.main.backend.url') return backendUrl;
          if (key === 'vsb.main.gatewayMode') return 'remote';
          return defaultValue;
        });

        httpHealthIndicator.pingCheck.mockResolvedValue({
          backend: { status: 'up', url: backendUrl },
        } as HealthIndicatorResult);

        healthCheckService.check.mockImplementation(async (checks) => {
          const results = await Promise.all(checks.map(async (check) => await check()));
          return { status: 'ok', info: results } as any;
        });

        await controller.check();

        const checkFunctions = healthCheckService.check.mock.calls[0][0];
        await checkFunctions[2]();

        expect(httpHealthIndicator.pingCheck).toHaveBeenCalledWith('backend', backendUrl);
      });

      it('should use default gatewayMode of local when not configured', async () => {
        configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
          if (key === 'vsb.main.backend.url') return 'http://localhost:3000';
          if (key === 'vsb.main.gatewayMode') return defaultValue;
          return defaultValue;
        });

        healthCheckService.check.mockImplementation(async (checks) => {
          const results = await Promise.all(checks.map(async (check) => await check()));
          return { status: 'ok', info: results } as any;
        });

        await controller.check();

        expect(configService.get).toHaveBeenCalledWith('vsb.main.gatewayMode', 'local');
      });
    });

    it('should call certificate health indicator', async () => {
      configService.get.mockReturnValue('local');
      certificateHealthIndicator.isHealthy.mockResolvedValue({
        certificate: { status: 'up', valid: true },
      } as any);
      healthCheckService.check.mockImplementation(async (checks) => {
        const results = await Promise.all(checks.map(async (check) => await check()));
        return { status: 'ok', info: results } as any;
      });

      await controller.check();

      const checkFunctions = healthCheckService.check.mock.calls[0][0];
      await checkFunctions[3]();

      expect(certificateHealthIndicator.isHealthy).toHaveBeenCalledWith('certificate');
    });
  });
});
