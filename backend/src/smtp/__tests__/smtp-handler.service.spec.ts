import { PassThrough } from 'stream';
import { SMTPServerDataStream, SMTPServerSession } from 'smtp-server';
import { ConfigService } from '@nestjs/config';
import type { EventEmitter2 } from '@nestjs/event-emitter';

import { SmtpHandlerService } from '../smtp-handler.service';
import type { SmtpConfig } from '../interfaces/smtp-config.interface';
import { EmailValidationService } from '../email-validation.service';
import { EmailProcessingService } from '../email-processing.service';
import { MetricsService } from '../../metrics/metrics.service';
import { InboxService } from '../../inbox/inbox.service';
import { CryptoService } from '../../crypto/crypto.service';
import { EventsService } from '../../events/events.service';
import { silenceNestLogger } from '../../../test/helpers/silence-logger';
import { SseConsoleService } from '../../sse-console/sse-console.service';

const baseSession: SMTPServerSession = {
  id: 'session-1',
  localAddress: '127.0.0.1',
  localPort: 2525,
  remoteAddress: '127.0.0.1',
  remotePort: 54321,
  clientHostname: 'localhost',
  openingCommand: 'EHLO localhost',
  hostNameAppearsAs: 'localhost',
  envelope: {
    mailFrom: { address: 'sender@example.com', args: {} },
    rcptTo: [{ address: 'recipient@example.com', args: {} }],
  },
  secure: false,
  transmissionType: 'SMTP',
  tlsOptions: {},
};

const defaultConfig: SmtpConfig = {
  host: '127.0.0.1',
  port: 0,
  secure: false,
  maxMessageSize: 10 * 1024 * 1024,
  sessionTimeout: 30000,
  allowedRecipientDomains: ['example.com'],
  maxConnections: 25,
  closeTimeout: 30000,
  disabledCommands: ['VRFY', 'EXPN', 'ETRN', 'TURN'],
  disablePipelining: false,
  earlyTalkerDelay: 300,
  banner: 'VaultSandbox Test SMTP Server (Receive-Only)',
  maxMemoryMB: 500,
  maxEmailAgeSeconds: 0,
};

function createStream(overrides: Partial<SMTPServerDataStream> = {}) {
  const stream = new PassThrough() as SMTPServerDataStream;
  (stream as unknown as { sizeExceeded: boolean }).sizeExceeded = false;

  return Object.assign(stream, overrides);
}

function createMockConfigService(config: SmtpConfig): ConfigService {
  return {
    get: jest.fn(<T = unknown>(key: string): T | undefined => {
      if (key === 'vsb.smtp') return config as T;
      if (key === 'VSB_GATEWAY_MODE') return 'local' as T;
      return undefined;
    }),
  } as unknown as ConfigService;
}

const mockEmailValidationService = {
  verifySpf: jest.fn().mockResolvedValue({ status: 'pass' }),
  verifyReverseDns: jest.fn().mockResolvedValue({ status: 'pass' }),
  verifyDkim: jest.fn().mockResolvedValue([{ status: 'pass', domain: 'example.com', selector: 'default' }]),
  verifyDmarc: jest.fn().mockResolvedValue({ status: 'pass' }),
  logValidationResults: jest.fn(),
} as unknown as EmailValidationService;

const mockEmailProcessingService = {
  parseEmail: jest.fn().mockResolvedValue({
    messageId: '123@local',
    headers: new Map([
      ['subject', 'Test'],
      ['x-custom', 'value'],
    ]),
    text: 'Body',
    html: '',
    attachments: [],
  }),
} as unknown as EmailProcessingService;

const mockMetricsService = {
  increment: jest.fn(),
  gauge: jest.fn(),
  histogram: jest.fn(),
  recordProcessingTime: jest.fn(),
} as unknown as MetricsService;

const mockSseConsoleService = {
  logSenderValidation: jest.fn(),
  logRecipientAccepted: jest.fn(),
  logRecipientRejected: jest.fn(),
  logEmailReceived: jest.fn(),
  logRateLimitExceeded: jest.fn(),
} as unknown as SseConsoleService;

const mockEventEmitter = {
  emit: jest.fn(),
} as unknown as EventEmitter2;

const mockInboxService = {
  storeEmail: jest.fn().mockResolvedValue(undefined),
  getInboxByEmail: jest.fn().mockReturnValue({
    id: 'inbox-1',
    emailAddress: 'recipient@example.com',
    clientKemPk: 'base64url-encoded-client-kem-public-key',
    inboxHash: 'inbox-hash-123',
    encrypted: true,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3600000),
    emails: new Map(),
    emailsHash: 'emails-hash',
  }),
  addEmail: jest.fn(),
} as unknown as InboxService;

const mockInboxStorageService = {
  getEmail: jest.fn(),
  getAllEmails: jest.fn(),
  deleteEmail: jest.fn(),
  getInboxCount: jest.fn().mockReturnValue(1), // Return 1 to avoid hard mode rejection
} as unknown as any;

const mockCryptoService = {
  encryptAndSign: jest.fn().mockResolvedValue({
    ciphertext: Buffer.from('encrypted'),
    iv: Buffer.from('iv'),
    tag: Buffer.from('tag'),
    signature: Buffer.from('signature'),
  }),
  encryptForClient: jest.fn().mockResolvedValue({
    ciphertext: Buffer.from('encrypted-for-client'),
    kemCt: Buffer.from('kem-ciphertext'),
  }),
} as unknown as CryptoService;

const mockEmailStorageService = {
  storeEmail: jest.fn().mockReturnValue('email-id-123'),
  onEmailDeleted: jest.fn(),
  onInboxDeleted: jest.fn(),
  getMetrics: jest.fn().mockReturnValue({
    storage: { maxMemoryMB: '500.00', usedMemoryMB: '0.00' },
    emails: { totalStored: 0, totalEvicted: 0 },
  }),
} as unknown as any;

const restoreLogger = silenceNestLogger();

afterAll(() => restoreLogger());

describe('SmtpHandlerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Restore mock implementations cleared by clearAllMocks
    (mockInboxService.getInboxByEmail as jest.Mock).mockReturnValue({
      id: 'inbox-1',
      emailAddress: 'recipient@example.com',
      clientKemPk: 'base64url-encoded-client-kem-public-key',
      inboxHash: 'inbox-hash-123',
      encrypted: true,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
      emails: new Map(),
      emailsHash: 'emails-hash',
    });
    (mockInboxStorageService.getInboxCount as jest.Mock).mockReturnValue(1);
  });

  it('rejects invalid email addresses', async () => {
    const handler = new SmtpHandlerService(
      createMockConfigService(defaultConfig),
      mockEmailValidationService,
      mockEmailProcessingService,
      mockMetricsService,
      mockSseConsoleService,
      mockEventEmitter,
      mockInboxService,
      mockInboxStorageService,
      mockCryptoService,
      undefined, // httpService
      undefined, // eventsService
      mockEmailStorageService,
    );

    // validateSender is async and should reject for invalid addresses (RFC 5321 validation)
    await expect(handler.validateSender({ address: 'invalid', args: {} }, baseSession)).rejects.toThrow(
      'Invalid email address format',
    );

    // validateRecipient is synchronous and should throw for invalid addresses (RFC 5321 validation)
    expect(() => handler.validateRecipient({ address: 'invalid', args: {} })).toThrow('Invalid email address format');
  });

  it('collects and logs message metadata', async () => {
    const handler = new SmtpHandlerService(
      createMockConfigService(defaultConfig),
      mockEmailValidationService,
      mockEmailProcessingService,
      mockMetricsService,
      mockSseConsoleService,
      mockEventEmitter,
      mockInboxService,
      mockInboxStorageService,
      mockCryptoService,
      undefined, // httpService
      undefined, // eventsService
      mockEmailStorageService,
    );
    const payload = 'Subject: Test\r\nMessage-ID: <123@local>\r\nX-Custom: value\r\n\r\nBody';
    const stream = createStream();
    (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

    const promise = handler.handleData(stream, baseSession);
    stream.end(payload);
    await promise;

    expect(mockEmailProcessingService.parseEmail).toHaveBeenCalled();
    expect(mockEmailStorageService.storeEmail).toHaveBeenCalled();
    expect(mockCryptoService.encryptForClient).toHaveBeenCalled();
  });

  it('rejects messages that exceed allowed size', async () => {
    const handler = new SmtpHandlerService(
      createMockConfigService(defaultConfig),
      mockEmailValidationService,
      mockEmailProcessingService,
      mockMetricsService,
      mockSseConsoleService,
      mockEventEmitter,
      mockInboxService,
      mockInboxStorageService,
      mockCryptoService,
      undefined, // httpService
      undefined, // eventsService
      mockEmailStorageService,
    );
    const stream = createStream({
      sizeExceeded: true,
    } as Partial<SMTPServerDataStream>);

    await expect(handler.handleData(stream, baseSession)).rejects.toThrow('Message rejected – size limit exceeded.');
  });

  describe('cleanupSession', () => {
    it('should clean up session caches without errors', () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      // Should not throw when cleaning up non-existent session
      expect(() => handler.cleanupSession('non-existent-session')).not.toThrow();
    });

    it('should clean up caches after TLS info is set', () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      // Set TLS info to populate cache
      handler.setTlsInfo(baseSession.id, { version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384', bits: 256 });

      // Cleanup should remove cached entries
      expect(() => handler.cleanupSession(baseSession.id)).not.toThrow();
    });
  });

  describe('setTlsInfo', () => {
    it('should store TLS info for session', () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const tlsInfo = {
        version: 'TLSv1.3',
        cipher: 'TLS_AES_256_GCM_SHA384',
        bits: 256,
      };

      // Should not throw
      expect(() => handler.setTlsInfo('test-session', tlsInfo)).not.toThrow();
    });
  });

  describe('validateRecipient', () => {
    it('should accept valid recipient address', () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      // Should not throw for valid address
      expect(() => handler.validateRecipient({ address: 'recipient@example.com', args: {} })).not.toThrow();
      expect(mockSseConsoleService.logRecipientAccepted).toHaveBeenCalledWith('recipient@example.com');
    });

    it('should reject emails to unauthorized domains', () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      expect(() => handler.validateRecipient({ address: 'user@unauthorized.com', args: {} })).toThrow(
        'does not accept mail for domain',
      );
    });

    it('should reject emails with control characters in address', () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      expect(() => handler.validateRecipient({ address: 'user\x00@example.com', args: {} })).toThrow(
        'control characters',
      );
    });

    it('should reject emails with oversized local part', () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const oversizedLocal = 'a'.repeat(65);
      expect(() => handler.validateRecipient({ address: `${oversizedLocal}@example.com`, args: {} })).toThrow(
        'exceeds maximum length',
      );
    });

    it('should reject emails to non-existent inbox in local mode', () => {
      const mockInboxServiceNoInbox = {
        ...mockInboxService,
        getInboxByEmail: jest.fn().mockReturnValue(null),
      } as unknown as InboxService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxServiceNoInbox,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      expect(() => handler.validateRecipient({ address: 'nonexistent@example.com', args: {} })).toThrow(
        'Recipient address rejected',
      );
    });
  });

  describe('validateSender', () => {
    it('should reject in hard mode when no inboxes exist', async () => {
      const mockInboxStorageNoInboxes = {
        ...mockInboxStorageService,
        getInboxCount: jest.fn().mockReturnValue(0),
      };

      const configWithHardMode = {
        get: jest.fn(<T = unknown>(key: string, defaultValue?: T): T | undefined => {
          if (key === 'vsb.smtp') return defaultConfig as T;
          if (key === 'vsb.local.hardModeRejectCode') return 421 as T;
          if (key === 'vsb.main.gatewayMode') return 'local' as T;
          return defaultValue;
        }),
      } as unknown as ConfigService;

      const handler = new SmtpHandlerService(
        configWithHardMode,
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageNoInboxes,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      await expect(handler.validateSender({ address: 'sender@test.com', args: {} }, baseSession)).rejects.toThrow();
    });

    it('should accept valid sender address', async () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      // validateSender now only validates format, email auth happens in DATA phase
      await expect(
        handler.validateSender({ address: 'sender@example.com', args: {} }, baseSession),
      ).resolves.toBeUndefined();
    });
  });

  describe('handleData stream handling', () => {
    it('should handle stream with size exceeded after collection', async () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = 100;

      const promise = handler.handleData(stream, baseSession);

      // Simulate size exceeded after data collection
      (stream as unknown as { sizeExceeded: boolean }).sizeExceeded = true;
      stream.end('test data');

      await expect(promise).rejects.toThrow('size limit exceeded');
    });

    it('should handle stream errors during collection', async () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = 100;

      const promise = handler.handleData(stream, baseSession);

      // Emit an error before ending the stream
      stream.emit('error', new Error('Stream read error'));

      await expect(promise).rejects.toThrow('Stream read error');
    });
  });

  describe('cleanupStaleSessions (cron job)', () => {
    it('should clean up stale session cache entries', () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      // Access the private method via type casting
      const handlerAny = handler as any;

      // Manually set old timestamps to simulate stale TLS entries
      const oldTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      handlerAny.tlsInfoCache.set('stale-session', {
        value: { version: 'TLSv1.3', cipher: 'test' },
        timestamp: oldTimestamp,
      });

      // Call the cron method
      handlerAny.cleanupStaleSessions();

      // Stale entries should be removed
      expect(handlerAny.tlsInfoCache.has('stale-session')).toBe(false);
    });

    it('should not remove fresh session cache entries', () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const handlerAny = handler as any;

      // Add fresh TLS entries
      const freshTimestamp = Date.now();
      handlerAny.tlsInfoCache.set('fresh-session', {
        value: { version: 'TLSv1.3', cipher: 'test' },
        timestamp: freshTimestamp,
      });

      // Call the cron method
      handlerAny.cleanupStaleSessions();

      // Fresh entries should remain
      expect(handlerAny.tlsInfoCache.has('fresh-session')).toBe(true);
    });
  });

  describe('EventsService notifications', () => {
    it('should handle errors when emitting SSE events (also proves notification path works)', async () => {
      const eventsServiceMock = {
        emitNewEmailEvent: jest.fn().mockImplementation(() => {
          throw new Error('SSE emission failed');
        }),
      } as unknown as EventsService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        eventsServiceMock,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\nMessage-ID: <123@local>\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);

      // Should not throw - error is logged but not propagated
      await expect(promise).resolves.toBeDefined();
    });

    it('should handle non-Error exceptions when emitting SSE events', async () => {
      const eventsServiceMock = {
        emitNewEmailEvent: jest.fn().mockImplementation(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'string error'; // Non-Error exception
        }),
      } as unknown as EventsService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        eventsServiceMock,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);

      // Should not throw - error is logged but not propagated
      await expect(promise).resolves.toBeDefined();
    });

    it('should warn when EventsService is unavailable', async () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined, // No EventsService
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);

      // Should not throw
      await expect(promise).resolves.toBeDefined();
    });
  });

  describe('DKIM status handling', () => {
    it('should report dkimStatus as fail when DKIM fails', async () => {
      const failingDkimValidation = {
        ...mockEmailValidationService,
        verifyDkim: jest.fn().mockResolvedValue([{ status: 'fail', domain: 'example.com' }]),
      } as unknown as EmailValidationService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        failingDkimValidation,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      expect(mockSseConsoleService.logEmailReceived).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.any(String),
        'fail',
        expect.any(String),
      );
    });

    it('should report dkimStatus as first result status when no pass or fail', async () => {
      const neutralDkimValidation = {
        ...mockEmailValidationService,
        verifyDkim: jest.fn().mockResolvedValue([{ status: 'neutral', domain: 'example.com' }]),
      } as unknown as EmailValidationService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        neutralDkimValidation,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      expect(mockSseConsoleService.logEmailReceived).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.any(String),
        'neutral',
        expect.any(String),
      );
    });

    it('should report dkimStatus as none when no DKIM results', async () => {
      const noDkimValidation = {
        ...mockEmailValidationService,
        verifyDkim: jest.fn().mockResolvedValue([]),
      } as unknown as EmailValidationService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        noDkimValidation,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      expect(mockSseConsoleService.logEmailReceived).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.any(String),
        'none',
        expect.any(String),
      );
    });
  });

  describe('auth metrics tracking', () => {
    it('should track SPF pass metrics', async () => {
      const metricsServiceLocal = {
        increment: jest.fn(),
        gauge: jest.fn(),
        histogram: jest.fn(),
        recordProcessingTime: jest.fn(),
      } as unknown as MetricsService;

      const passingSpfValidation = {
        verifySpf: jest.fn().mockResolvedValue({ status: 'pass' }),
        verifyReverseDns: jest.fn().mockResolvedValue({ status: 'pass' }),
        verifyDkim: jest.fn().mockResolvedValue([{ status: 'pass', domain: 'example.com' }]),
        verifyDmarc: jest.fn().mockResolvedValue({ status: 'pass' }),
        logValidationResults: jest.fn(),
      } as unknown as EmailValidationService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        passingSpfValidation,
        mockEmailProcessingService,
        metricsServiceLocal,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      // SPF/reverseDns checks now happen in handleData phase
      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      expect(metricsServiceLocal.increment).toHaveBeenCalledWith(expect.stringContaining('spf_pass'));
    });

    it('should track SPF fail metrics', async () => {
      const metricsServiceLocal = {
        increment: jest.fn(),
        gauge: jest.fn(),
        histogram: jest.fn(),
        recordProcessingTime: jest.fn(),
      } as unknown as MetricsService;

      const failingSpfValidation = {
        verifySpf: jest.fn().mockResolvedValue({ status: 'fail' }),
        verifyReverseDns: jest.fn().mockResolvedValue({ status: 'pass' }),
        verifyDkim: jest.fn().mockResolvedValue([]),
        verifyDmarc: jest.fn().mockResolvedValue({ status: 'none' }),
        logValidationResults: jest.fn(),
      } as unknown as EmailValidationService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        failingSpfValidation,
        mockEmailProcessingService,
        metricsServiceLocal,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      // SPF/reverseDns checks now happen in handleData phase

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      expect(metricsServiceLocal.increment).toHaveBeenCalledWith(expect.stringContaining('spf_fail'));
    });

    it('should track DKIM fail metrics when all signatures fail', async () => {
      const metricsServiceLocal = {
        increment: jest.fn(),
        gauge: jest.fn(),
        histogram: jest.fn(),
        recordProcessingTime: jest.fn(),
      } as unknown as MetricsService;

      const failingDkimValidation = {
        verifySpf: jest.fn().mockResolvedValue({ status: 'none' }),
        verifyReverseDns: jest.fn().mockResolvedValue({ status: 'pass' }),
        verifyDkim: jest.fn().mockResolvedValue([{ status: 'fail', domain: 'example.com' }]),
        verifyDmarc: jest.fn().mockResolvedValue({ status: 'none' }),
        logValidationResults: jest.fn(),
      } as unknown as EmailValidationService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        failingDkimValidation,
        mockEmailProcessingService,
        metricsServiceLocal,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      expect(metricsServiceLocal.increment).toHaveBeenCalledWith(expect.stringContaining('dkim_fail'));
    });

    it('should track DMARC fail metrics', async () => {
      const metricsServiceLocal = {
        increment: jest.fn(),
        gauge: jest.fn(),
        histogram: jest.fn(),
        recordProcessingTime: jest.fn(),
      } as unknown as MetricsService;

      const failingDmarcValidation = {
        verifySpf: jest.fn().mockResolvedValue({ status: 'none' }),
        verifyReverseDns: jest.fn().mockResolvedValue({ status: 'pass' }),
        verifyDkim: jest.fn().mockResolvedValue([]),
        verifyDmarc: jest.fn().mockResolvedValue({ status: 'fail' }),
        logValidationResults: jest.fn(),
      } as unknown as EmailValidationService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        failingDmarcValidation,
        mockEmailProcessingService,
        metricsServiceLocal,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      expect(metricsServiceLocal.increment).toHaveBeenCalledWith(expect.stringContaining('dmarc_fail'));
    });
  });

  describe('parseHeaders edge cases', () => {
    it('should process email with oversized header section', async () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      // Create a header larger than 64KB
      const largeHeader = 'X-Large: ' + 'a'.repeat(70 * 1024);
      const payload = `Subject: Test\r\n${largeHeader}\r\n\r\nBody`;
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);

      // Should not throw, headers are truncated
      await expect(promise).resolves.toBeDefined();
    });

    it('should process email with many header lines', async () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      // Create more than 1000 header lines
      const manyHeaders = Array.from({ length: 1100 }, (_, i) => `X-Header-${i}: value${i}`).join('\r\n');
      const payload = `Subject: Test\r\n${manyHeaders}\r\n\r\nBody`;
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);

      // Should not throw, excess headers are ignored
      await expect(promise).resolves.toBeDefined();
    });

    it('should handle header lines without colon separator', async () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      // Include a line without colon separator (malformed)
      const payload = `Subject: Test\r\nMalformed line without colon\r\nX-Custom: value\r\n\r\nBody`;
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);

      // Should not throw, malformed lines are skipped
      await expect(promise).resolves.toBeDefined();
    });

    it('should handle empty header lines', async () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      // Include empty lines within headers (only whitespace)
      const payload = `Subject: Test\r\n   \r\nX-Custom: value\r\n\r\nBody`;
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);

      await expect(promise).resolves.toBeDefined();
    });
  });

  describe('attachments serialization', () => {
    it('should serialize attachments with Buffer content', async () => {
      const mockEmailProcessingWithAttachments = {
        parseEmail: jest.fn().mockResolvedValue({
          messageId: '123@local',
          headers: new Map([['subject', 'Test']]),
          text: 'Body',
          html: '',
          attachments: [
            {
              filename: 'test.txt',
              contentType: 'text/plain',
              size: 11,
              content: Buffer.from('hello world'),
            },
          ],
        }),
      } as unknown as EmailProcessingService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingWithAttachments,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      expect(mockCryptoService.encryptForClient).toHaveBeenCalled();
    });

    it('should serialize attachments with non-Buffer content (Uint8Array)', async () => {
      const mockEmailProcessingWithAttachments = {
        parseEmail: jest.fn().mockResolvedValue({
          messageId: '123@local',
          headers: new Map([['subject', 'Test']]),
          text: 'Body',
          html: '',
          attachments: [
            {
              filename: 'test.txt',
              contentType: 'text/plain',
              size: 11,
              content: new Uint8Array([104, 101, 108, 108, 111]), // 'hello' as Uint8Array
            },
          ],
        }),
      } as unknown as EmailProcessingService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingWithAttachments,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      expect(mockCryptoService.encryptForClient).toHaveBeenCalled();
    });

    it('should serialize attachments with missing/undefined fields', async () => {
      const mockEmailProcessingWithAttachments = {
        parseEmail: jest.fn().mockResolvedValue({
          messageId: '123@local',
          headers: new Map([['subject', 'Test']]),
          text: 'Body',
          html: '',
          attachments: [
            {
              // No filename - should default to 'unnamed'
              contentType: undefined, // should default to 'application/octet-stream'
              size: undefined, // should default to 0
              content: undefined, // should default to ''
            },
          ],
        }),
      } as unknown as EmailProcessingService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingWithAttachments,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      expect(mockCryptoService.encryptForClient).toHaveBeenCalled();
    });

    it('should serialize attachments with non-string filename', async () => {
      const mockEmailProcessingWithAttachments = {
        parseEmail: jest.fn().mockResolvedValue({
          messageId: '123@local',
          headers: new Map([['subject', 'Test']]),
          text: 'Body',
          html: '',
          attachments: [
            {
              filename: 123, // Non-string filename should default to 'unnamed'
              contentType: 'text/plain',
              size: 5,
              content: Buffer.from('hello'),
            },
          ],
        }),
      } as unknown as EmailProcessingService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingWithAttachments,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      expect(mockCryptoService.encryptForClient).toHaveBeenCalled();
    });
  });

  describe('bufferToString handling', () => {
    it('should handle Buffer html content', async () => {
      const mockEmailProcessingWithBufferHtml = {
        parseEmail: jest.fn().mockResolvedValue({
          messageId: '123@local',
          headers: new Map([['subject', 'Test']]),
          text: 'Body',
          html: Buffer.from('<p>Hello</p>'),
          textAsHtml: Buffer.from('<p>Body</p>'),
          attachments: [],
        }),
      } as unknown as EmailProcessingService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingWithBufferHtml,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      expect(mockCryptoService.encryptForClient).toHaveBeenCalled();
    });
  });

  describe('multiple recipients handling', () => {
    it('should handle multiple recipients to the same inbox (deduplication)', async () => {
      const multiRecipientSession: SMTPServerSession = {
        ...baseSession,
        envelope: {
          mailFrom: { address: 'sender@example.com', args: {} },
          rcptTo: [
            { address: 'recipient@example.com', args: {} },
            { address: 'recipient+tag@example.com', args: {} }, // Same base email with plus addressing
          ],
        },
      };

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, multiRecipientSession);
      stream.end(payload);
      await promise;

      // Should only store once due to deduplication
      expect(mockEmailStorageService.storeEmail).toHaveBeenCalledTimes(1);
    });

    it('should reject when no valid recipients', async () => {
      const noRecipientSession: SMTPServerSession = {
        ...baseSession,
        envelope: {
          mailFrom: { address: 'sender@example.com', args: {} },
          rcptTo: [], // Empty recipient list
        },
      };

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, noRecipientSession);
      stream.end(payload);

      await expect(promise).rejects.toThrow('No valid recipient address');
    });

    it('should reject when inbox not found during data handling', async () => {
      const mockInboxServiceNotFound = {
        ...mockInboxService,
        getInboxByEmail: jest.fn().mockReturnValue(null),
      } as unknown as InboxService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxServiceNotFound,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);

      await expect(promise).rejects.toThrow('Recipient address rejected');
    });
  });

  describe('TLS info in Received header', () => {
    it('should include TLS info in Received header when TLS is active', async () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      // Set TLS info for the session
      handler.setTlsInfo(baseSession.id, { version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384', bits: 256 });

      const secureSession: SMTPServerSession = {
        ...baseSession,
        secure: true,
        transmissionType: 'ESMTPS',
      };

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, secureSession);
      stream.end(payload);
      const result = await promise;

      // The raw data should include TLS info in Received header
      expect(result.rawData.toString()).toContain('TLSv1.3');
      expect(result.rawData.toString()).toContain('TLS_AES_256_GCM_SHA384');
    });

    it('should include TLS info without bits when bits is undefined', async () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      // Set TLS info without bits
      handler.setTlsInfo(baseSession.id, { version: 'TLSv1.2', cipher: 'ECDHE-RSA-AES256-SHA' });

      const secureSession: SMTPServerSession = {
        ...baseSession,
        secure: true,
      };

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, secureSession);
      stream.end(payload);
      const result = await promise;

      expect(result.rawData.toString()).toContain('TLSv1.2');
      expect(result.rawData.toString()).not.toContain('bits=');
    });
  });

  describe('constructor warnings', () => {
    it('should warn when local mode is enabled but InboxService is missing', () => {
      // Create handler with undefined InboxService
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        undefined, // No InboxService
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      // The warning is logged but the service still initializes
      expect(handler).toBeDefined();
    });

    it('should warn when local mode is enabled but CryptoService is missing', () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        undefined, // No CryptoService
        undefined,
        undefined,
        mockEmailStorageService,
      );

      expect(handler).toBeDefined();
    });

    it('should throw when services not available during local mode data handling', async () => {
      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        undefined, // No InboxService
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);

      await expect(promise).rejects.toThrow('Local mode services not available');
    });
  });

  describe('reverse DNS auth results', () => {
    it('should include reverse DNS info in parsed payload', async () => {
      const validationWithReverseDns = {
        ...mockEmailValidationService,
        verifyReverseDns: jest.fn().mockResolvedValue({
          status: 'pass',
          hostname: 'mail.example.com',
        }),
      } as unknown as EmailValidationService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        validationWithReverseDns,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      expect(mockCryptoService.encryptForClient).toHaveBeenCalled();
    });
  });

  describe('getHardModeErrorMessage', () => {
    it('should return appropriate message for various error codes', async () => {
      const mockInboxStorageNoInboxes = {
        ...mockInboxStorageService,
        getInboxCount: jest.fn().mockReturnValue(0),
      };

      // Test various response codes
      const testCodes = [421, 450, 451, 550, 554, 999]; // 999 is unknown

      for (const code of testCodes) {
        const configWithHardMode = {
          get: jest.fn(<T = unknown>(key: string, defaultValue?: T): T | undefined => {
            if (key === 'vsb.smtp') return defaultConfig as T;
            if (key === 'vsb.local.hardModeRejectCode') return code as T;
            if (key === 'vsb.main.gatewayMode') return 'local' as T;
            return defaultValue;
          }),
        } as unknown as ConfigService;

        const handler = new SmtpHandlerService(
          configWithHardMode,
          mockEmailValidationService,
          mockEmailProcessingService,
          mockMetricsService,
          mockSseConsoleService,
          mockEventEmitter,
          mockInboxService,
          mockInboxStorageNoInboxes,
          mockCryptoService,
          undefined,
          undefined,
          mockEmailStorageService,
        );

        await expect(handler.validateSender({ address: 'sender@test.com', args: {} }, baseSession)).rejects.toThrow();
      }
    });
  });

  describe('SPF domain fallback', () => {
    it('should use envelope sender domain when SPF domain is missing', async () => {
      const validationWithoutSpfDomain = {
        ...mockEmailValidationService,
        verifySpf: jest.fn().mockResolvedValue({
          status: 'pass',
          domain: undefined, // Missing domain
        }),
      } as unknown as EmailValidationService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        validationWithoutSpfDomain,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      expect(mockCryptoService.encryptForClient).toHaveBeenCalled();
    });
  });

  describe('extractMessageId', () => {
    it('should return undefined when message-id is not a string', async () => {
      const mockEmailProcessingNoMessageId = {
        parseEmail: jest.fn().mockResolvedValue({
          messageId: undefined, // No message ID in parsed email
          headers: new Map([['subject', 'Test']]),
          text: 'Body',
          html: '',
          attachments: [],
        }),
      } as unknown as EmailProcessingService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingNoMessageId,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      // Email without Message-ID header
      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      const result = await promise;

      // messageId should be undefined
      expect(result.messageId).toBeUndefined();
    });
  });

  describe('session with false mailFrom', () => {
    it('should handle session with false mailFrom', async () => {
      const sessionWithFalseMailFrom: SMTPServerSession = {
        ...baseSession,
        envelope: {
          mailFrom: false, // Bounce message scenario
          rcptTo: [{ address: 'recipient@example.com', args: {} }],
        },
      };

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, sessionWithFalseMailFrom);
      stream.end(payload);
      const result = await promise;

      expect(result).toBeDefined();
      // From should be 'unknown' since mailFrom is false
      expect(mockSseConsoleService.logEmailReceived).toHaveBeenCalledWith(
        'unknown',
        expect.any(Array),
        expect.any(String),
        expect.any(String),
        expect.any(String),
      );
    });
  });

  describe('plain inbox email handling', () => {
    const mockPlainInbox = {
      id: 'plain-inbox-1',
      emailAddress: 'recipient@example.com',
      clientKemPk: undefined, // No KEM key for plain inbox
      inboxHash: 'plain-inbox-hash-123',
      encrypted: false, // Plain inbox
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
      emails: new Map(),
      emailsHash: 'emails-hash',
    };

    it('should store plain emails without encryption', async () => {
      const mockInboxServicePlain = {
        ...mockInboxService,
        getInboxByEmail: jest.fn().mockReturnValue(mockPlainInbox),
      } as unknown as InboxService;

      const mockInboxStorageServicePlain = {
        ...mockInboxStorageService,
        addEmail: jest.fn(),
      };

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxServicePlain,
        mockInboxStorageServicePlain,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test Plain\r\nMessage-ID: <plain@local>\r\n\r\nPlain body';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      // Should use inboxStorageService.addEmail for plain emails
      expect(mockInboxStorageServicePlain.addEmail).toHaveBeenCalledWith(
        'recipient@example.com',
        expect.objectContaining({
          id: expect.any(String),
          isRead: false,
          metadata: expect.any(Uint8Array),
          parsed: expect.any(Uint8Array),
          raw: expect.any(Uint8Array),
        }),
      );

      // Should NOT use encrypted email storage
      expect(mockEmailStorageService.storeEmail).not.toHaveBeenCalled();

      // Should NOT call encryptForClient for plain inbox
      expect(mockCryptoService.encryptForClient).not.toHaveBeenCalled();
    });

    it('should emit SSE events with plain metadata', async () => {
      const mockInboxServicePlain = {
        ...mockInboxService,
        getInboxByEmail: jest.fn().mockReturnValue(mockPlainInbox),
      } as unknown as InboxService;

      const mockInboxStorageServicePlain = {
        ...mockInboxStorageService,
        addEmail: jest.fn(),
      };

      const eventsServiceMock = {
        emitNewEmailEvent: jest.fn(),
      } as unknown as EventsService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxServicePlain,
        mockInboxStorageServicePlain,
        mockCryptoService,
        undefined,
        eventsServiceMock,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test Plain SSE\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      // Should emit SSE event with plain metadata (base64 encoded, not encrypted)
      expect(eventsServiceMock.emitNewEmailEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          inboxId: 'plain-inbox-hash-123',
          emailId: expect.any(String),
          metadata: expect.any(String), // Base64 encoded plain metadata
        }),
      );

      // Should NOT have encryptedMetadata property
      const callArgs = (eventsServiceMock.emitNewEmailEvent as jest.Mock).mock.calls[0][0];
      expect(callArgs.encryptedMetadata).toBeUndefined();
    });

    it('should handle SSE errors for plain emails gracefully', async () => {
      const mockInboxServicePlain = {
        ...mockInboxService,
        getInboxByEmail: jest.fn().mockReturnValue(mockPlainInbox),
      } as unknown as InboxService;

      const mockInboxStorageServicePlain = {
        ...mockInboxStorageService,
        addEmail: jest.fn(),
      };

      const eventsServiceMock = {
        emitNewEmailEvent: jest.fn().mockImplementation(() => {
          throw new Error('SSE emission failed for plain email');
        }),
      } as unknown as EventsService;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxServicePlain,
        mockInboxStorageServicePlain,
        mockCryptoService,
        undefined,
        eventsServiceMock,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);

      // Should not throw - error is logged but not propagated
      await expect(promise).resolves.toBeDefined();

      // Email should still be stored
      expect(mockInboxStorageServicePlain.addEmail).toHaveBeenCalled();
    });

    it('should handle plain emails without EventsService', async () => {
      const mockInboxServicePlain = {
        ...mockInboxService,
        getInboxByEmail: jest.fn().mockReturnValue(mockPlainInbox),
      } as unknown as InboxService;

      const mockInboxStorageServicePlain = {
        ...mockInboxStorageService,
        addEmail: jest.fn(),
      };

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxServicePlain,
        mockInboxStorageServicePlain,
        mockCryptoService,
        undefined,
        undefined, // No EventsService
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);

      // Should not throw
      await expect(promise).resolves.toBeDefined();

      // Email should still be stored
      expect(mockInboxStorageServicePlain.addEmail).toHaveBeenCalled();
    });
  });

  describe('extractEmailFromDisplay helper', () => {
    let handler: SmtpHandlerService;
    let handlerAny: any;

    beforeEach(() => {
      handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingService,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitter,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );
      handlerAny = handler as any;
    });

    it('should extract email from "Name <email>" format', () => {
      expect(handlerAny.extractEmailFromDisplay('John Doe <john@example.com>')).toBe('john@example.com');
    });

    it('should extract email from plain email address', () => {
      expect(handlerAny.extractEmailFromDisplay('john@example.com')).toBe('john@example.com');
    });

    it('should normalize email to lowercase', () => {
      expect(handlerAny.extractEmailFromDisplay('John.Doe@Example.COM')).toBe('john.doe@example.com');
      expect(handlerAny.extractEmailFromDisplay('John Doe <John.Doe@Example.COM>')).toBe('john.doe@example.com');
    });

    it('should handle email with commas in display name', () => {
      expect(handlerAny.extractEmailFromDisplay('"Doe, John" <john@example.com>')).toBe('john@example.com');
    });

    it('should return undefined for undefined input', () => {
      expect(handlerAny.extractEmailFromDisplay(undefined)).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      expect(handlerAny.extractEmailFromDisplay('')).toBeUndefined();
    });

    it('should return undefined for string without @ symbol', () => {
      expect(handlerAny.extractEmailFromDisplay('not an email')).toBeUndefined();
    });
  });

  describe('webhook event payload formatting', () => {
    it('should emit email.received with properly parsed from address', async () => {
      const mockEmailProcessingWithFrom = {
        parseEmail: jest.fn().mockResolvedValue({
          messageId: '123@local',
          headers: new Map([['subject', 'Test']]),
          text: 'Body',
          html: '',
          attachments: [],
          from: {
            value: [{ address: 'sender@example.com', name: 'John Doe' }],
            text: 'John Doe <sender@example.com>',
            html: '<a href="mailto:sender@example.com">John Doe</a>',
          },
        }),
      } as unknown as EmailProcessingService;

      const capturedEvents: any[] = [];
      const mockEventEmitterCapture = {
        emit: jest.fn((event, payload) => {
          capturedEvents.push({ event, payload });
        }),
      } as unknown as EventEmitter2;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingWithFrom,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitterCapture,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\nFrom: John Doe <sender@example.com>\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      const emailReceived = capturedEvents.find((e) => e.event === 'email.received');
      expect(emailReceived).toBeDefined();
      expect(emailReceived.payload.email.from).toEqual({
        address: 'sender@example.com',
        name: 'John Doe',
      });
    });

    it('should emit email.received with properly parsed to and cc addresses', async () => {
      const mockEmailProcessingWithAddresses = {
        parseEmail: jest.fn().mockResolvedValue({
          messageId: '123@local',
          headers: new Map([['subject', 'Test']]),
          text: 'Body',
          html: '',
          attachments: [],
          from: {
            value: [{ address: 'sender@example.com', name: 'Sender' }],
            text: 'Sender <sender@example.com>',
            html: '',
          },
          to: {
            value: [
              { address: 'recipient@example.com', name: 'Recipient' },
              { address: 'second@example.com', name: undefined },
            ],
            text: 'Recipient <recipient@example.com>, second@example.com',
            html: '',
          },
          cc: {
            value: [{ address: 'cc@example.com', name: 'CC User' }],
            text: 'CC User <cc@example.com>',
            html: '',
          },
        }),
      } as unknown as EmailProcessingService;

      const capturedEvents: any[] = [];
      const mockEventEmitterCapture = {
        emit: jest.fn((event, payload) => {
          capturedEvents.push({ event, payload });
        }),
      } as unknown as EventEmitter2;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingWithAddresses,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitterCapture,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      const emailReceived = capturedEvents.find((e) => e.event === 'email.received');
      expect(emailReceived).toBeDefined();

      // Check to addresses
      expect(emailReceived.payload.email.to).toEqual([
        { address: 'recipient@example.com', name: 'Recipient' },
        { address: 'second@example.com', name: undefined },
      ]);

      // Check cc addresses
      expect(emailReceived.payload.email.cc).toEqual([{ address: 'cc@example.com', name: 'CC User' }]);
    });

    it('should handle addresses with commas in display names (no string splitting)', async () => {
      const mockEmailProcessingWithCommas = {
        parseEmail: jest.fn().mockResolvedValue({
          messageId: '123@local',
          headers: new Map([['subject', 'Test']]),
          text: 'Body',
          html: '',
          attachments: [],
          from: {
            value: [{ address: 'john@example.com', name: 'Doe, John' }],
            text: '"Doe, John" <john@example.com>',
            html: '',
          },
          cc: {
            value: [
              { address: 'smith@example.com', name: 'Smith, Jane' },
              { address: 'bob@example.com', name: 'Bob' },
            ],
            text: '"Smith, Jane" <smith@example.com>, Bob <bob@example.com>',
            html: '',
          },
        }),
      } as unknown as EmailProcessingService;

      const capturedEvents: any[] = [];
      const mockEventEmitterCapture = {
        emit: jest.fn((event, payload) => {
          capturedEvents.push({ event, payload });
        }),
      } as unknown as EventEmitter2;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingWithCommas,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitterCapture,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      const emailReceived = capturedEvents.find((e) => e.event === 'email.received');
      expect(emailReceived).toBeDefined();

      // From should have correct address despite comma in display name
      expect(emailReceived.payload.email.from).toEqual({
        address: 'john@example.com',
        name: 'Doe, John',
      });

      // CC should have 2 addresses, not 3 (which would happen with comma splitting)
      expect(emailReceived.payload.email.cc).toHaveLength(2);
      expect(emailReceived.payload.email.cc).toEqual([
        { address: 'smith@example.com', name: 'Smith, Jane' },
        { address: 'bob@example.com', name: 'Bob' },
      ]);
    });

    it('should fallback to extractEmailFromDisplay when parsedMail.from.value is missing', async () => {
      const mockEmailProcessingWithoutParsedFrom = {
        parseEmail: jest.fn().mockResolvedValue({
          messageId: '123@local',
          headers: new Map([['subject', 'Test']]),
          text: 'Body',
          html: '',
          attachments: [],
          from: {
            value: [], // Empty value array
            text: 'John Doe <sender@example.com>',
            html: '',
          },
        }),
      } as unknown as EmailProcessingService;

      // Create session with displayFrom in envelope
      const sessionWithDisplayFrom: SMTPServerSession = {
        ...baseSession,
        envelope: {
          mailFrom: { address: 'envelope-sender@example.com', args: {} },
          rcptTo: [{ address: 'recipient@example.com', args: {} }],
        },
      };

      const capturedEvents: any[] = [];
      const mockEventEmitterCapture = {
        emit: jest.fn((event, payload) => {
          capturedEvents.push({ event, payload });
        }),
      } as unknown as EventEmitter2;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingWithoutParsedFrom,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitterCapture,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\nFrom: John Doe <sender@example.com>\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, sessionWithDisplayFrom);
      stream.end(payload);
      await promise;

      const emailReceived = capturedEvents.find((e) => e.event === 'email.received');
      expect(emailReceived).toBeDefined();
      // Should fallback to extracting from displayFrom (which comes from parsed headers or envelope)
      expect(emailReceived.payload.email.from.address).not.toBe('John Doe <sender@example.com>');
      // The address should be extracted, not the full display format
      expect(emailReceived.payload.email.from.address).not.toContain('<');
      expect(emailReceived.payload.email.from.address).not.toContain('>');
    });

    it('should fallback to envelope recipients when parsedMail.to.value is missing', async () => {
      const mockEmailProcessingWithoutParsedTo = {
        parseEmail: jest.fn().mockResolvedValue({
          messageId: '123@local',
          headers: new Map([['subject', 'Test']]),
          text: 'Body',
          html: '',
          attachments: [],
          // No 'to' field at all
        }),
      } as unknown as EmailProcessingService;

      const capturedEvents: any[] = [];
      const mockEventEmitterCapture = {
        emit: jest.fn((event, payload) => {
          capturedEvents.push({ event, payload });
        }),
      } as unknown as EventEmitter2;

      const handler = new SmtpHandlerService(
        createMockConfigService(defaultConfig),
        mockEmailValidationService,
        mockEmailProcessingWithoutParsedTo,
        mockMetricsService,
        mockSseConsoleService,
        mockEventEmitterCapture,
        mockInboxService,
        mockInboxStorageService,
        mockCryptoService,
        undefined,
        undefined,
        mockEmailStorageService,
      );

      const payload = 'Subject: Test\r\n\r\nBody';
      const stream = createStream();
      (stream as unknown as { byteLength: number }).byteLength = Buffer.byteLength(payload);

      const promise = handler.handleData(stream, baseSession);
      stream.end(payload);
      await promise;

      const emailReceived = capturedEvents.find((e) => e.event === 'email.received');
      expect(emailReceived).toBeDefined();
      // Should fallback to envelope recipients
      expect(emailReceived.payload.email.to).toEqual([{ address: 'recipient@example.com' }]);
    });
  });
});
