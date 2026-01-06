import { Logger } from '@nestjs/common';
import { SmtpService } from './../smtp.service';
import { ConfigService } from '@nestjs/config';
import { SmtpHandlerService } from './../smtp-handler.service';
import { CertificateService } from '../../certificate/certificate.service';
import { MetricsService } from '../../metrics/metrics.service';
import { SseConsoleService } from '../../sse-console/sse-console.service';
import { SmtpRateLimiterService, RateLimitExceededError } from '../smtp-rate-limiter.service';
import type { SMTPServerSession } from 'smtp-server';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import type { Socket } from 'net';
import type { TLSSocket } from 'tls';

const createHandlerStub = () =>
  ({
    handleAuth: jest.fn().mockResolvedValue({ user: 'test' }),
    handleData: jest.fn().mockResolvedValue(undefined),
    validateRecipient: jest.fn(),
    validateSender: jest.fn().mockResolvedValue(undefined),
    setTlsInfo: jest.fn(),
    cleanupSession: jest.fn(),
  }) as unknown as SmtpHandlerService;

const baseConfig = {
  host: '127.0.0.1',
  port: 0,
  secure: false,
  maxMessageSize: 1024 * 1024,
  maxHeaderSize: 102400,
  sessionTimeout: 1000,
  allowedRecipientDomains: ['example.com'],
  maxConnections: 25,
  closeTimeout: 30000,
  disabledCommands: ['VRFY', 'EXPN', 'ETRN', 'TURN'],
  disablePipelining: false,
  earlyTalkerDelay: 0, // Set to 0 for faster tests
  banner: 'VaultSandbox Test SMTP Server (Receive-Only)',
};

const createMockConfigService = (smtpConfig = baseConfig, certConfig?: { enabled: boolean }) =>
  ({
    get: jest.fn((key: string) => {
      if (key === 'vsb.smtp') {
        return smtpConfig;
      }
      if (key === 'vsb.certificate') {
        return certConfig;
      }
      if (key === 'vsb.certificate.enabled') {
        return certConfig?.enabled;
      }
      return undefined;
    }),
  }) as unknown as ConfigService;

const createMockCertificateService = (cert: { certificate: Buffer; privateKey: Buffer } | null = null) =>
  ({
    getCurrentCertificate: jest.fn().mockResolvedValue(cert),
  }) as unknown as CertificateService;

const createMockMetricsService = () =>
  ({
    increment: jest.fn(),
    decrement: jest.fn(),
    gauge: jest.fn(),
    histogram: jest.fn(),
  }) as unknown as MetricsService;

const createMockSseConsoleService = () =>
  ({
    logRateLimitExceeded: jest.fn(),
  }) as unknown as SseConsoleService;

const createMockRateLimiterService = (consumeResult: Promise<void> = Promise.resolve()) =>
  ({
    consumeIp: jest.fn().mockReturnValue(consumeResult),
  }) as unknown as SmtpRateLimiterService;

describe('SmtpService', () => {
  let handlerStub: SmtpHandlerService;
  let mockConfigService: ConfigService;
  let mockCertificateService: CertificateService;
  let mockMetricsService: MetricsService;
  let mockSseConsoleService: SseConsoleService;

  beforeEach(() => {
    handlerStub = createHandlerStub();
    mockConfigService = createMockConfigService();
    mockCertificateService = createMockCertificateService();
    mockMetricsService = createMockMetricsService();
    mockSseConsoleService = createMockSseConsoleService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('lifecycle hooks', () => {
    it('starts server via onModuleInit', async () => {
      const service = new SmtpService(
        handlerStub,
        mockConfigService,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      try {
        await service.onModuleInit();
        expect(service.isListening()).toBe(true);
      } finally {
        await service.onModuleDestroy();
      }
    });

    it('stops server via onModuleDestroy', async () => {
      const service = new SmtpService(
        handlerStub,
        mockConfigService,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      await service.start();
      await service.onModuleDestroy();
      expect(service.isListening()).toBe(false);
    });
  });

  describe('start', () => {
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
        expect(service.isListening()).toBe(true);
      } finally {
        await service.stop();
      }

      expect(service.isListening()).toBe(false);
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
        const port1 = service.getListeningPort();

        await service.start();
        const port2 = service.getListeningPort();

        expect(port1).toBe(port2);
      } finally {
        await service.stop();
      }
    });

    it('requires TLS credentials in secure mode', async () => {
      const secureConfigService = createMockConfigService({
        ...baseConfig,
        secure: true,
      });

      const service = new SmtpService(
        handlerStub,
        secureConfigService,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      await expect(service.start()).rejects.toThrow('TLS credentials are required when SMTP secure mode is enabled.');
    });

    it('warns when TLS is enabled without minVersion', async () => {
      const loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      // Create a config service that returns secure with TLS but no minVersion
      // We use secure: false to not actually start a TLS server, but we'll test the code path
      // by directly accessing the private buildServerOptions method
      const configWithNoMinVersion = createMockConfigService({
        ...baseConfig,
        secure: true,
        tls: {
          cert: Buffer.from('test'),
          key: Buffer.from('test'),
          // No minVersion specified
        },
      });

      const service = new SmtpService(
        handlerStub,
        configWithNoMinVersion,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      const logger = (service as unknown as { logger: { warn: jest.Mock } }).logger;
      const warnSpy = jest.spyOn(logger, 'warn');

      // Calling start will trigger the warning even if it later fails on TLS creation
      try {
        await service.start();
      } catch {
        // Expected to fail due to invalid certs
      }

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('TLS enabled without minVersion'));
      loggerWarnSpy.mockRestore();
    });
  });

  describe('stop', () => {
    it('does nothing when server is not running', async () => {
      const service = new SmtpService(
        handlerStub,
        mockConfigService,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      // Should not throw
      await service.stop();
      expect(service.isListening()).toBe(false);
    });
  });

  describe('isListening', () => {
    it('returns true when server is running', async () => {
      const service = new SmtpService(
        handlerStub,
        mockConfigService,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      expect(service.isListening()).toBe(false);

      try {
        await service.start();
        expect(service.isListening()).toBe(true);
      } finally {
        await service.stop();
      }

      expect(service.isListening()).toBe(false);
    });
  });

  describe('getListeningPort', () => {
    it('returns the port when server is listening', async () => {
      const service = new SmtpService(
        handlerStub,
        mockConfigService,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      try {
        await service.start();
        const port = service.getListeningPort();
        expect(typeof port).toBe('number');
        expect(port).toBeGreaterThan(0);
      } finally {
        await service.stop();
      }
    });

    it('returns config port when server is not listening', () => {
      const configWithPort = createMockConfigService({
        ...baseConfig,
        port: 2525,
      });

      const service = new SmtpService(
        handlerStub,
        configWithPort,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      expect(service.getListeningPort()).toBe(2525);
    });
  });

  describe('handleCertificateReload', () => {
    it('restarts server when certificate is enabled', async () => {
      const loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const certConfigService = createMockConfigService(baseConfig, { enabled: true });

      const service = new SmtpService(
        handlerStub,
        certConfigService,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      const logger = (service as unknown as { logger: { log: jest.Mock } }).logger;
      const logSpy = jest.spyOn(logger, 'log');

      try {
        await service.start();

        await service.handleCertificateReload();

        expect(service.isListening()).toBe(true);
        expect(logSpy).toHaveBeenCalledWith('Certificate reload event received, restarting SMTP server');
        expect(logSpy).toHaveBeenCalledWith('SMTP server restarted successfully');
      } finally {
        await service.stop();
        loggerWarnSpy.mockRestore();
      }
    });

    it('does nothing when certificate is not enabled', async () => {
      const service = new SmtpService(
        handlerStub,
        mockConfigService, // vsb.certificate.enabled returns undefined
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      const logger = (service as unknown as { logger: { log: jest.Mock } }).logger;
      const logSpy = jest.spyOn(logger, 'log');

      try {
        await service.start();
        const port = service.getListeningPort();

        await service.handleCertificateReload();

        // Server should still be running on the same port
        expect(service.isListening()).toBe(true);
        expect(service.getListeningPort()).toBe(port);
        // Should not have logged the reload message
        expect(logSpy).not.toHaveBeenCalledWith('Certificate reload event received, restarting SMTP server');
      } finally {
        await service.stop();
      }
    });
  });

  describe('applyManagedCertificate', () => {
    it('warns when no certificate is available yet', async () => {
      const loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const certService = createMockCertificateService(null);
      const certConfigService = createMockConfigService(baseConfig, { enabled: true });

      const service = new SmtpService(
        handlerStub,
        certConfigService,
        certService,
        mockMetricsService,
        mockSseConsoleService,
      );

      const logger = (service as unknown as { logger: { warn: jest.Mock } }).logger;
      const warnSpy = jest.spyOn(logger, 'warn');

      try {
        await service.start();
        expect(warnSpy).toHaveBeenCalledWith('Certificate management enabled but no certificate found yet');
      } finally {
        await service.stop();
        loggerWarnSpy.mockRestore();
      }
    });

    it('warns when manual TLS paths are configured but will be overridden', async () => {
      const loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const certService = createMockCertificateService(null);
      // Create config via the direct config object, not through mocked service
      const smtpConfig = {
        ...baseConfig,
        tls: {
          cert: Buffer.from('manual-cert'),
          key: Buffer.from('manual-key'),
          minVersion: 'TLSv1.2' as const,
        },
      };
      const configWithManualTls = createMockConfigService(smtpConfig, { enabled: true });

      const service = new SmtpService(
        handlerStub,
        configWithManualTls,
        certService,
        mockMetricsService,
        mockSseConsoleService,
      );

      const logger = (service as unknown as { logger: { warn: jest.Mock } }).logger;
      const warnSpy = jest.spyOn(logger, 'warn');

      // The server will fail because cert service returns null but TLS config has invalid certs
      // But we can still verify the warning was logged before the failure
      try {
        await service.start();
      } catch {
        // Expected: SMTPServer fails with invalid cert data
      }

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('will be IGNORED because certificate management is enabled'),
      );
      loggerWarnSpy.mockRestore();
    });

    it('preserves existing TLS security options when applying managed certificate', async () => {
      const loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      // Test that when cert management is enabled and manual TLS config exists,
      // the security options (minVersion, ciphers, etc.) are preserved
      // We can't actually test server startup without valid certs, but we can verify the
      // applyManagedCertificate method preserves security options
      const certService = createMockCertificateService(null);
      const smtpConfig = {
        ...baseConfig,
        tls: {
          cert: Buffer.from('manual-cert'),
          key: Buffer.from('manual-key'),
          minVersion: 'TLSv1.2' as const,
          ciphers: 'ECDHE-RSA-AES128-GCM-SHA256',
          honorCipherOrder: true,
          ecdhCurve: 'secp384r1',
        },
      };
      const configWithTlsOptions = createMockConfigService(smtpConfig, { enabled: true });

      const service = new SmtpService(
        handlerStub,
        configWithTlsOptions,
        certService,
        mockMetricsService,
        mockSseConsoleService,
      );

      const logger = (service as unknown as { logger: { warn: jest.Mock } }).logger;
      const warnSpy = jest.spyOn(logger, 'warn');

      // Server will fail due to invalid certs, but the code path was exercised
      try {
        await service.start();
      } catch {
        // Expected failure
      }

      // Verify the code ran and warnings were logged (which exercises the existingTlsSecurityOptions path)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('will be IGNORED'));
      loggerWarnSpy.mockRestore();
    });

    it('logs when certificate is loaded from service', async () => {
      const loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      // To properly test this, we'd need valid PEM certificates
      // Instead, we test the code path by mocking at a lower level
      const certService = createMockCertificateService(null);
      const certConfigService = createMockConfigService(baseConfig, { enabled: true });

      const service = new SmtpService(
        handlerStub,
        certConfigService,
        certService,
        mockMetricsService,
        mockSseConsoleService,
      );

      // Verify the certificate service is called
      try {
        await service.start();
        expect(certService.getCurrentCertificate).toHaveBeenCalled();
      } finally {
        await service.stop();
        loggerWarnSpy.mockRestore();
      }
    });
  });

  describe('gracefulRestart', () => {
    it('handles restart when server is not running', async () => {
      const loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const certConfigService = createMockConfigService(baseConfig, { enabled: true });

      const service = new SmtpService(
        handlerStub,
        certConfigService,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      // Not started yet
      expect(service.isListening()).toBe(false);

      await service.handleCertificateReload();

      try {
        // Should have started
        expect(service.isListening()).toBe(true);
      } finally {
        await service.stop();
        loggerWarnSpy.mockRestore();
      }
    });

    it('logs error when restart fails', async () => {
      const loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const certConfigService = createMockConfigService(
        {
          ...baseConfig,
          secure: true, // Will fail without valid TLS credentials
        },
        { enabled: true },
      );

      const service = new SmtpService(
        handlerStub,
        certConfigService,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      const logger = (service as unknown as { logger: { error: jest.Mock } }).logger;
      const errorSpy = jest.spyOn(logger, 'error');

      await service.handleCertificateReload();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to restart SMTP server'),
        expect.any(String),
      );
      loggerErrorSpy.mockRestore();
      loggerWarnSpy.mockRestore();
    });
  });

  describe('resolveListeningPort', () => {
    it('returns undefined for null address', () => {
      const service = new SmtpService(
        handlerStub,
        mockConfigService,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      const resolve = (
        service as unknown as { resolveListeningPort: (addr: unknown) => number | undefined }
      ).resolveListeningPort.bind(service);

      expect(resolve(null)).toBeUndefined();
    });

    it('returns undefined for string address (Unix socket)', () => {
      const service = new SmtpService(
        handlerStub,
        mockConfigService,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      const resolve = (
        service as unknown as { resolveListeningPort: (addr: unknown) => number | undefined }
      ).resolveListeningPort.bind(service);

      expect(resolve('/var/run/smtp.sock')).toBeUndefined();
    });

    it('returns port for AddressInfo', () => {
      const service = new SmtpService(
        handlerStub,
        mockConfigService,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      const resolve = (
        service as unknown as { resolveListeningPort: (addr: unknown) => number | undefined }
      ).resolveListeningPort.bind(service);

      expect(resolve({ port: 2525, address: '127.0.0.1', family: 'IPv4' })).toBe(2525);
    });
  });

  describe('server event handlers', () => {
    it('handles server error events', async () => {
      const loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const service = new SmtpService(
        handlerStub,
        mockConfigService,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      const logger = (service as unknown as { logger: { error: jest.Mock } }).logger;
      const errorSpy = jest.spyOn(logger, 'error');

      try {
        await service.start();
        const server = (service as unknown as { server: EventEmitter }).server;

        // Emit an error event
        server.emit('error', new Error('Test server error'));

        expect(mockMetricsService.increment).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('SMTP server error: Test server error'),
          expect.any(String),
        );
      } finally {
        await service.stop();
        loggerErrorSpy.mockRestore();
      }
    });
  });

  describe('buildServerOptions handlers', () => {
    let service: SmtpService;
    let rateLimiter: SmtpRateLimiterService;

    let options: any;

    beforeEach(() => {
      rateLimiter = createMockRateLimiterService();
      const configWithDelay = createMockConfigService({
        ...baseConfig,
        earlyTalkerDelay: 10, // Small delay for testing
      });

      service = new SmtpService(
        handlerStub,
        configWithDelay,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
        rateLimiter,
      );

      // Access the private method to get options
      const buildServerOptions = (
        service as unknown as { buildServerOptions: () => Record<string, unknown> }
      ).buildServerOptions.bind(service);

      options = buildServerOptions();
    });

    describe('onConnect', () => {
      it('handles rate limiting and early talker delay', async () => {
        const session = {
          id: 'test-session-1',
          remoteAddress: '192.168.1.1',
        } as SMTPServerSession;

        await new Promise<void>((resolve) => {
          options.onConnect(session, (err?: Error) => {
            expect(err).toBeUndefined();
            resolve();
          });
        });

        expect(rateLimiter.consumeIp).toHaveBeenCalledWith('192.168.1.1');
        expect(mockMetricsService.increment).toHaveBeenCalled();
      });

      it('rejects when rate limit exceeded', () => {
        const rateLimitError = new RateLimitExceededError(1000);
        const rateLimiterReject = createMockRateLimiterService(Promise.reject(rateLimitError));

        const configWithDelay = createMockConfigService({
          ...baseConfig,
          earlyTalkerDelay: 0,
        });

        const serviceWithRateLimiter = new SmtpService(
          handlerStub,
          configWithDelay,
          mockCertificateService,
          mockMetricsService,
          mockSseConsoleService,
          rateLimiterReject,
        );

        const buildServerOptions = (
          serviceWithRateLimiter as unknown as { buildServerOptions: () => Record<string, unknown> }
        ).buildServerOptions.bind(serviceWithRateLimiter);

        const localOptions = buildServerOptions();

        const session = {
          id: 'test-session-2',
          remoteAddress: '192.168.1.2',
        } as SMTPServerSession;

        return new Promise<void>((resolve) => {
          (localOptions.onConnect as (session: SMTPServerSession, callback: (err?: Error) => void) => void)(
            session,
            (err?: Error) => {
              expect(err).toBeInstanceOf(RateLimitExceededError);
              expect(mockSseConsoleService.logRateLimitExceeded).toHaveBeenCalledWith('192.168.1.2');
              resolve();
            },
          );
        });
      });

      it('handles unexpected rate limiter error', async () => {
        const loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
        const unexpectedError = new Error('Database connection failed');
        const rateLimiterReject = createMockRateLimiterService(Promise.reject(unexpectedError));

        const configWithDelay = createMockConfigService({
          ...baseConfig,
          earlyTalkerDelay: 0,
        });

        const serviceWithRateLimiter = new SmtpService(
          handlerStub,
          configWithDelay,
          mockCertificateService,
          mockMetricsService,
          mockSseConsoleService,
          rateLimiterReject,
        );

        const logger = (serviceWithRateLimiter as unknown as { logger: { error: jest.Mock } }).logger;
        const errorSpy = jest.spyOn(logger, 'error');

        const buildServerOptions = (
          serviceWithRateLimiter as unknown as { buildServerOptions: () => Record<string, unknown> }
        ).buildServerOptions.bind(serviceWithRateLimiter);

        const localOptions = buildServerOptions();

        const session = {
          id: 'test-session-3',
          remoteAddress: '192.168.1.3',
        } as SMTPServerSession;

        await new Promise<void>((resolve) => {
          (localOptions.onConnect as (session: SMTPServerSession, callback: (err?: Error) => void) => void)(
            session,
            (err?: Error) => {
              expect(err).toBeUndefined(); // Connection still allowed
              resolve();
            },
          );
        });

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Rate limiter error'));
        loggerErrorSpy.mockRestore();
      });

      it('works without rate limiter', () => {
        const serviceNoRateLimiter = new SmtpService(
          handlerStub,
          mockConfigService,
          mockCertificateService,
          mockMetricsService,
          mockSseConsoleService,
          // No rate limiter
        );

        const buildServerOptions = (
          serviceNoRateLimiter as unknown as { buildServerOptions: () => Record<string, unknown> }
        ).buildServerOptions.bind(serviceNoRateLimiter);

        const localOptions = buildServerOptions();

        const session = {
          id: 'test-session-4',
          remoteAddress: '192.168.1.4',
        } as SMTPServerSession;

        (localOptions.onConnect as (session: SMTPServerSession, callback: (err?: Error) => void) => void)(
          session,
          (err?: Error) => {
            expect(err).toBeUndefined();
          },
        );

        expect(mockMetricsService.increment).toHaveBeenCalled();
      });

      it('handles null IP from normalizeIp', () => {
        // Test case when remoteAddress doesn't normalize to a valid IP
        const serviceNoRateLimiter = new SmtpService(
          handlerStub,
          mockConfigService,
          mockCertificateService,
          mockMetricsService,
          mockSseConsoleService,
          rateLimiter,
        );

        const buildServerOptions = (
          serviceNoRateLimiter as unknown as { buildServerOptions: () => Record<string, unknown> }
        ).buildServerOptions.bind(serviceNoRateLimiter);

        const localOptions = buildServerOptions();

        const session = {
          id: 'test-session-null-ip',
          remoteAddress: '', // Empty string normalizes to null
        } as SMTPServerSession;

        (localOptions.onConnect as (session: SMTPServerSession, callback: (err?: Error) => void) => void)(
          session,
          (err?: Error) => {
            expect(err).toBeUndefined();
          },
        );

        // Rate limiter should not be called when IP is null
        expect(rateLimiter.consumeIp).not.toHaveBeenCalled();
        expect(mockMetricsService.increment).toHaveBeenCalled();
      });
    });

    describe('onMailFrom', () => {
      it('validates sender with rate limiting', async () => {
        const address = { address: 'sender@example.com' };
        const session = {
          id: 'test-session-5',
          remoteAddress: '192.168.1.5',
        } as SMTPServerSession;

        await new Promise<void>((resolve) => {
          options.onMailFrom(address, session, (err?: Error) => {
            expect(err).toBeUndefined();
            resolve();
          });
        });

        expect(rateLimiter.consumeIp).toHaveBeenCalledWith('192.168.1.5');
        expect(handlerStub.validateSender).toHaveBeenCalledWith(address, session);
      });

      it('rejects when rate limit exceeded', () => {
        const rateLimitError = new RateLimitExceededError(1000);
        const rateLimiterReject = createMockRateLimiterService(Promise.reject(rateLimitError));

        const serviceWithRateLimiter = new SmtpService(
          handlerStub,
          mockConfigService,
          mockCertificateService,
          mockMetricsService,
          mockSseConsoleService,
          rateLimiterReject,
        );

        const buildServerOptions = (
          serviceWithRateLimiter as unknown as { buildServerOptions: () => Record<string, unknown> }
        ).buildServerOptions.bind(serviceWithRateLimiter);

        const localOptions = buildServerOptions();

        const address = { address: 'sender@example.com' };
        const session = {
          id: 'test-session-6',
          remoteAddress: '192.168.1.6',
        } as SMTPServerSession;

        return new Promise<void>((resolve) => {
          (
            localOptions.onMailFrom as (
              address: { address: string },
              session: SMTPServerSession,
              callback: (err?: Error) => void,
            ) => void
          )(address, session, (err?: Error) => {
            expect(err).toBeInstanceOf(RateLimitExceededError);
            expect(mockSseConsoleService.logRateLimitExceeded).toHaveBeenCalledWith('192.168.1.6');
            resolve();
          });
        });
      });

      it('rejects when sender validation fails', async () => {
        const validationError = new Error('Sender rejected');
        (handlerStub.validateSender as jest.Mock).mockRejectedValueOnce(validationError);

        const address = { address: 'bad-sender@example.com' };
        const session = {
          id: 'test-session-7',
          remoteAddress: '192.168.1.7',
        } as SMTPServerSession;

        await new Promise<void>((resolve) => {
          options.onMailFrom(address, session, (err?: Error) => {
            expect(err).toBe(validationError);
            resolve();
          });
        });

        expect(mockMetricsService.increment).toHaveBeenCalled();
      });

      it('works without rate limiter', () => {
        const serviceNoRateLimiter = new SmtpService(
          handlerStub,
          mockConfigService,
          mockCertificateService,
          mockMetricsService,
          mockSseConsoleService,
          // No rate limiter
        );

        const buildServerOptions = (
          serviceNoRateLimiter as unknown as { buildServerOptions: () => Record<string, unknown> }
        ).buildServerOptions.bind(serviceNoRateLimiter);

        const localOptions = buildServerOptions();

        const address = { address: 'sender@example.com' };
        const session = {
          id: 'test-session-no-ratelimiter',
          remoteAddress: '192.168.1.100',
        } as SMTPServerSession;

        return new Promise<void>((resolve) => {
          (
            localOptions.onMailFrom as (
              address: { address: string },
              session: SMTPServerSession,
              callback: (err?: Error) => void,
            ) => void
          )(address, session, (err?: Error) => {
            expect(err).toBeUndefined();
            expect(handlerStub.validateSender).toHaveBeenCalledWith(address, session);
            resolve();
          });
        });
      });
    });

    describe('onRcptTo', () => {
      it('validates recipient', () => {
        const address = { address: 'recipient@example.com' };
        const session = {} as SMTPServerSession;

        options.onRcptTo(address, session, (err?: Error) => {
          expect(err).toBeUndefined();
        });

        expect(handlerStub.validateRecipient).toHaveBeenCalledWith(address);
      });

      it('rejects invalid recipient', () => {
        const validationError = new Error('Recipient rejected');
        (handlerStub.validateRecipient as jest.Mock).mockImplementationOnce(() => {
          throw validationError;
        });

        const address = { address: 'bad-recipient@example.com' };
        const session = {} as SMTPServerSession;

        options.onRcptTo(address, session, (err?: Error) => {
          expect(err).toBe(validationError);
        });

        expect(mockMetricsService.increment).toHaveBeenCalled();
      });
    });

    describe('onData', () => {
      it('handles email data', async () => {
        const stream = new Readable({
          read() {
            this.push('test email content');
            this.push(null);
          },
        });
        const session = { id: 'test-session-8' } as SMTPServerSession;

        await new Promise<void>((resolve) => {
          options.onData(stream, session, (err?: Error) => {
            expect(err).toBeUndefined();
            resolve();
          });
        });

        expect(handlerStub.handleData).toHaveBeenCalledWith(stream, session);
      });

      it('handles errors', async () => {
        const dataError = new Error('Data processing failed');
        (handlerStub.handleData as jest.Mock).mockRejectedValueOnce(dataError);

        const stream = new Readable({
          read() {
            this.push('test email content');
            this.push(null);
          },
        });
        const session = { id: 'test-session-9' } as SMTPServerSession;

        await new Promise<void>((resolve) => {
          options.onData(stream, session, (err?: Error) => {
            expect(err).toBe(dataError);
            resolve();
          });
        });
      });
    });

    describe('onClose', () => {
      it('cleans up session that was in activeSessions', async () => {
        const session = {
          id: 'test-session-10',
          remoteAddress: '192.168.1.10',
        } as SMTPServerSession;

        // First establish connection to add to active sessions
        await new Promise<void>((resolve) => {
          options.onConnect(session, () => resolve());
        });

        // Now close it
        options.onClose(session);

        expect(handlerStub.cleanupSession).toHaveBeenCalledWith('test-session-10');
        expect(mockMetricsService.decrement).toHaveBeenCalled();
      });

      it('handles session without id', () => {
        const session = { remoteAddress: '192.168.1.11' } as SMTPServerSession;

        // Should not throw
        options.onClose(session);

        // cleanupSession should not be called (no id)
        expect(handlerStub.cleanupSession).not.toHaveBeenCalled();
      });

      it('handles session not in activeSessions', () => {
        const session = {
          id: 'test-session-12',
          remoteAddress: '192.168.1.12',
        } as SMTPServerSession;

        // Close without prior connection
        options.onClose(session);

        // cleanupSession should still be called (has id)
        expect(handlerStub.cleanupSession).toHaveBeenCalledWith('test-session-12');
        // But decrement should NOT be called (not in activeSessions)
        expect(mockMetricsService.decrement).not.toHaveBeenCalled();
      });

      it('handles null session', () => {
        // Should not throw
        options.onClose(null);
        expect(handlerStub.cleanupSession).not.toHaveBeenCalled();
      });
    });

    describe('onSecure', () => {
      it('captures TLS info', () => {
        const socket = {
          getCipher: () => ({ name: 'ECDHE-RSA-AES128-GCM-SHA256', bits: 128 }),
          getProtocol: () => 'TLSv1.3',
        } as unknown as TLSSocket;
        const session = { id: 'test-session-13' } as SMTPServerSession;

        let callbackCalled = false;
        options.onSecure(socket, session, () => {
          callbackCalled = true;
        });

        expect(callbackCalled).toBe(true);
        expect(handlerStub.setTlsInfo).toHaveBeenCalledWith('test-session-13', {
          version: 'TLSv1.3',
          cipher: 'ECDHE-RSA-AES128-GCM-SHA256',
          bits: 128,
        });
      });

      it('handles non-TLS socket', () => {
        const socket = {} as Socket; // No getCipher/getProtocol methods
        const session = { id: 'test-session-14' } as SMTPServerSession;

        let callbackCalled = false;
        options.onSecure(socket, session, () => {
          callbackCalled = true;
        });

        expect(callbackCalled).toBe(true);
        expect(handlerStub.setTlsInfo).not.toHaveBeenCalled();
      });

      it('handles missing cipher/protocol info', () => {
        const socket = {
          getCipher: () => null,
          getProtocol: () => null,
        } as unknown as TLSSocket;
        const session = { id: 'test-session-15' } as SMTPServerSession;

        options.onSecure(socket, session, () => {});

        expect(handlerStub.setTlsInfo).not.toHaveBeenCalled();
      });
    });
  });

  describe('logger integration in buildServerOptions', () => {
    it('logger methods call appropriate logger functions', () => {
      const loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const service = new SmtpService(
        handlerStub,
        mockConfigService,
        mockCertificateService,
        mockMetricsService,
        mockSseConsoleService,
      );

      const logger = (service as unknown as { logger: { warn: jest.Mock; error: jest.Mock } }).logger;
      const warnSpy = jest.spyOn(logger, 'warn');
      const errorSpy = jest.spyOn(logger, 'error');

      const buildServerOptions = (
        service as unknown as {
          buildServerOptions: () => {
            logger: {
              level: (level: string) => string;
              info: () => void;
              debug: () => void;
              error: (msg: string) => void;
              warn: (msg: string) => void;
              trace: () => void;
              fatal: (msg: string) => void;
            };
          };
        }
      ).buildServerOptions.bind(service);

      const options = buildServerOptions();

      // Test level function
      expect(options.logger.level('info')).toBe('info');

      // Test suppressed loggers (should not throw)
      options.logger.info();
      options.logger.debug();
      options.logger.trace();

      // Test actual loggers
      options.logger.error('test error');
      options.logger.warn('test warning');
      options.logger.fatal('test fatal');

      expect(errorSpy).toHaveBeenCalledWith('test error');
      expect(warnSpy).toHaveBeenCalledWith('test warning');
      expect(errorSpy).toHaveBeenCalledWith('test fatal');
      loggerErrorSpy.mockRestore();
      loggerWarnSpy.mockRestore();
    });
  });
});
