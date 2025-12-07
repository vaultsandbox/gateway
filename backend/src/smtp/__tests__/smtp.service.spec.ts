import { SmtpService } from './../smtp.service';
import { ConfigService } from '@nestjs/config';
import { SmtpHandlerService } from './../smtp-handler.service';
import { CertificateService } from '../../certificate/certificate.service';
import { MetricsService } from '../../metrics/metrics.service';
import { SseConsoleService } from '../../sse-console/sse-console.service';

const handlerStub: SmtpHandlerService = {
  handleAuth: jest.fn().mockResolvedValue({ user: 'test' }),
  handleData: jest.fn().mockResolvedValue(undefined),
  validateRecipient: jest.fn().mockResolvedValue(undefined),
  validateSender: jest.fn().mockResolvedValue(undefined),
} as unknown as SmtpHandlerService;

const baseConfig = {
  host: '127.0.0.1',
  port: 0,
  secure: false,
  maxMessageSize: 1024 * 1024,
  sessionTimeout: 1000,
  allowedRecipientDomains: ['example.com'],
  maxConnections: 25,
  closeTimeout: 30000,
  disabledCommands: ['VRFY', 'EXPN', 'ETRN', 'TURN'],
  disablePipelining: false,
  earlyTalkerDelay: 300,
  banner: 'VaultSandbox Test SMTP Server (Receive-Only)',
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'vsb.smtp') {
      return baseConfig;
    }
    return undefined;
  }),
} as unknown as ConfigService;

const mockCertificateService = {
  getCurrentCertificate: jest.fn().mockResolvedValue(null),
} as unknown as CertificateService;

const mockMetricsService = {
  increment: jest.fn(),
  gauge: jest.fn(),
  histogram: jest.fn(),
} as unknown as MetricsService;

const mockSseConsoleService = {
  logRateLimitExceeded: jest.fn(),
} as unknown as SseConsoleService;

describe('SmtpService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('starts and stops the SMTP server', async () => {
    const service = new SmtpService(
      handlerStub,
      mockConfigService,
      mockCertificateService,
      mockMetricsService,
      mockSseConsoleService,
    );

    try {
      await service.start();
      expect((service as unknown as { server?: unknown }).server).toBeDefined();
    } finally {
      await service.stop();
    }

    expect((service as unknown as { server?: unknown }).server).toBeUndefined();
  });

  it('does not restart an already running server', async () => {
    const service = new SmtpService(
      handlerStub,
      mockConfigService,
      mockCertificateService,
      mockMetricsService,
      mockSseConsoleService,
    );

    try {
      await service.start();
      const serverInstance = (service as unknown as { server?: unknown }).server;

      await service.start();

      expect((service as unknown as { server?: unknown }).server).toBe(serverInstance);
    } finally {
      await service.stop();
    }
  });

  it('requires TLS credentials in secure mode', async () => {
    const secureConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'vsb.smtp') {
          return {
            ...baseConfig,
            secure: true,
          };
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    const service = new SmtpService(
      handlerStub,
      secureConfigService,
      mockCertificateService,
      mockMetricsService,
      mockSseConsoleService,
    );

    await expect(service.start()).rejects.toThrow('TLS credentials are required when SMTP secure mode is enabled.');
  });
});
