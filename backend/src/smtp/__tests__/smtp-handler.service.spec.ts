import { PassThrough } from 'stream';
import { SMTPServerDataStream, SMTPServerSession } from 'smtp-server';
import { ConfigService } from '@nestjs/config';

import { SmtpHandlerService } from '../smtp-handler.service';
import type { SmtpConfig } from '../interfaces/smtp-config.interface';
import { EmailValidationService } from '../email-validation.service';
import { EmailProcessingService } from '../email-processing.service';
import { MetricsService } from '../../metrics/metrics.service';
import { InboxService } from '../../inbox/inbox.service';
import { CryptoService } from '../../crypto/crypto.service';
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

const mockInboxService = {
  storeEmail: jest.fn().mockResolvedValue(undefined),
  getInboxByEmail: jest.fn().mockReturnValue({
    id: 'inbox-1',
    email: 'recipient@example.com',
    publicKey: Buffer.from('public-key'),
    clientKemPk: Buffer.from('client-kem-public-key'),
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
  });

  it('rejects invalid email addresses', async () => {
    const handler = new SmtpHandlerService(
      createMockConfigService(defaultConfig),
      mockEmailValidationService,
      mockEmailProcessingService,
      mockMetricsService,
      mockSseConsoleService,
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
});
