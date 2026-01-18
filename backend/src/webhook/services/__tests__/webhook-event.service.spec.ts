import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhookEventService } from '../webhook-event.service';
import { WebhookStorageService } from '../../storage/webhook-storage.service';
import { WebhookDeliveryService } from '../webhook-delivery.service';
import { WebhookFilterService } from '../webhook-filter.service';
import { silenceNestLogger } from '../../../../test/helpers/silence-logger';
import { Webhook } from '../../interfaces/webhook.interface';

describe('WebhookEventService', () => {
  let service: WebhookEventService;
  const restoreLogger = silenceNestLogger();

  const createMockConfigService = (overrides: Record<string, unknown> = {}) => {
    const config: Record<string, unknown> = {
      'vsb.webhook.enabled': true,
      'vsb.webhook.maxHeaders': 50,
      'vsb.webhook.maxHeaderValueLen': 1000,
      ...overrides,
    };
    return {
      get: jest.fn((key: string) => config[key]),
    };
  };

  const createMockWebhook = (overrides: Partial<Webhook> = {}): Webhook => ({
    id: 'whk_test123',
    url: 'https://example.com/webhook',
    secret: 'test-secret',
    events: ['email.received'],
    enabled: true,
    scope: 'global',
    createdAt: new Date(),
    stats: {
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      consecutiveFailures: 0,
    },
    ...overrides,
  });

  const mockStorageService = {
    getWebhooksForEvent: jest.fn().mockReturnValue([]),
  };

  const mockDeliveryService = {
    deliver: jest.fn().mockResolvedValue(undefined),
  };

  const mockFilterService = {
    matches: jest.fn().mockReturnValue(true),
  };

  afterAll(() => restoreLogger());

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookEventService,
        { provide: ConfigService, useValue: createMockConfigService() },
        { provide: WebhookStorageService, useValue: mockStorageService },
        { provide: WebhookDeliveryService, useValue: mockDeliveryService },
        { provide: WebhookFilterService, useValue: mockFilterService },
      ],
    }).compile();

    service = module.get<WebhookEventService>(WebhookEventService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleEmailReceived', () => {
    it('should dispatch email.received event to matching webhooks', () => {
      const webhook = createMockWebhook();
      mockStorageService.getWebhooksForEvent.mockReturnValue([webhook]);

      service.handleEmailReceived({
        email: {
          id: 'msg_123',
          from: { address: 'sender@example.com', name: 'Sender' },
          to: [{ address: 'test@inbox.com' }],
          subject: 'Test Subject',
          text: 'Hello world',
          html: '<p>Hello world</p>',
          headers: { 'message-id': '<test@example.com>' },
          attachments: [],
          receivedAt: new Date(),
        },
        inboxHash: 'inbox_hash_123',
        inboxEmail: 'test@inbox.com',
      });

      expect(mockStorageService.getWebhooksForEvent).toHaveBeenCalledWith('email.received', 'inbox_hash_123');
      expect(mockDeliveryService.deliver).toHaveBeenCalled();
    });

    it('should not dispatch when webhooks are disabled', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhookEventService,
          { provide: ConfigService, useValue: createMockConfigService({ 'vsb.webhook.enabled': false }) },
          { provide: WebhookStorageService, useValue: mockStorageService },
          { provide: WebhookDeliveryService, useValue: mockDeliveryService },
          { provide: WebhookFilterService, useValue: mockFilterService },
        ],
      }).compile();

      const disabledService = module.get<WebhookEventService>(WebhookEventService);

      disabledService.handleEmailReceived({
        email: {
          id: 'msg_123',
          from: 'sender@example.com',
          to: ['test@inbox.com'],
          subject: 'Test',
        },
        inboxHash: 'inbox_hash_123',
        inboxEmail: 'test@inbox.com',
      });

      expect(mockStorageService.getWebhooksForEvent).not.toHaveBeenCalled();
    });

    it('should handle email auth data', () => {
      const webhook = createMockWebhook();
      mockStorageService.getWebhooksForEvent.mockReturnValue([webhook]);

      service.handleEmailReceived({
        email: {
          id: 'msg_123',
          from: 'sender@example.com',
          to: ['test@inbox.com'],
          subject: 'Test',
          auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
        },
        inboxHash: 'inbox_hash_123',
        inboxEmail: 'test@inbox.com',
      });

      expect(mockDeliveryService.deliver).toHaveBeenCalled();
      const eventArg = mockDeliveryService.deliver.mock.calls[0][1];
      expect(eventArg.data.auth).toEqual({ spf: 'pass', dkim: 'pass', dmarc: 'pass' });
    });
  });

  describe('handleEmailStored', () => {
    it('should dispatch email.stored event to matching webhooks', () => {
      const webhook = createMockWebhook({ events: ['email.stored'] });
      mockStorageService.getWebhooksForEvent.mockReturnValue([webhook]);

      service.handleEmailStored({
        emailId: 'msg_123',
        inboxHash: 'inbox_hash_123',
        inboxEmail: 'test@inbox.com',
      });

      expect(mockStorageService.getWebhooksForEvent).toHaveBeenCalledWith('email.stored', 'inbox_hash_123');
      expect(mockDeliveryService.deliver).toHaveBeenCalled();
      const eventArg = mockDeliveryService.deliver.mock.calls[0][1];
      expect(eventArg.type).toBe('email.stored');
      expect(eventArg.data.id).toBe('msg_123');
    });

    it('should not dispatch when webhooks are disabled', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhookEventService,
          { provide: ConfigService, useValue: createMockConfigService({ 'vsb.webhook.enabled': false }) },
          { provide: WebhookStorageService, useValue: mockStorageService },
          { provide: WebhookDeliveryService, useValue: mockDeliveryService },
          { provide: WebhookFilterService, useValue: mockFilterService },
        ],
      }).compile();

      const disabledService = module.get<WebhookEventService>(WebhookEventService);

      disabledService.handleEmailStored({
        emailId: 'msg_123',
        inboxHash: 'inbox_hash_123',
        inboxEmail: 'test@inbox.com',
      });

      expect(mockStorageService.getWebhooksForEvent).not.toHaveBeenCalled();
    });
  });

  describe('handleEmailDeleted', () => {
    it('should dispatch email.deleted event to matching webhooks', () => {
      const webhook = createMockWebhook({ events: ['email.deleted'] });
      mockStorageService.getWebhooksForEvent.mockReturnValue([webhook]);

      service.handleEmailDeleted({
        emailId: 'msg_123',
        inboxHash: 'inbox_hash_123',
        inboxEmail: 'test@inbox.com',
        reason: 'manual',
      });

      expect(mockStorageService.getWebhooksForEvent).toHaveBeenCalledWith('email.deleted', 'inbox_hash_123');
      expect(mockDeliveryService.deliver).toHaveBeenCalled();
      const eventArg = mockDeliveryService.deliver.mock.calls[0][1];
      expect(eventArg.type).toBe('email.deleted');
      expect(eventArg.data.reason).toBe('manual');
    });

    it('should not dispatch when webhooks are disabled', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhookEventService,
          { provide: ConfigService, useValue: createMockConfigService({ 'vsb.webhook.enabled': false }) },
          { provide: WebhookStorageService, useValue: mockStorageService },
          { provide: WebhookDeliveryService, useValue: mockDeliveryService },
          { provide: WebhookFilterService, useValue: mockFilterService },
        ],
      }).compile();

      const disabledService = module.get<WebhookEventService>(WebhookEventService);

      disabledService.handleEmailDeleted({
        emailId: 'msg_123',
        inboxHash: 'inbox_hash_123',
        inboxEmail: 'test@inbox.com',
        reason: 'ttl',
      });

      expect(mockStorageService.getWebhooksForEvent).not.toHaveBeenCalled();
    });
  });

  describe('dispatch', () => {
    it('should not dispatch when no webhooks are subscribed', () => {
      mockStorageService.getWebhooksForEvent.mockReturnValue([]);

      service.handleEmailReceived({
        email: {
          id: 'msg_123',
          from: 'sender@example.com',
          to: ['test@inbox.com'],
          subject: 'Test',
        },
        inboxHash: 'inbox_hash_123',
        inboxEmail: 'test@inbox.com',
      });

      expect(mockDeliveryService.deliver).not.toHaveBeenCalled();
    });

    it('should filter out webhooks that do not match filter rules', () => {
      const webhook1 = createMockWebhook({ id: 'whk_1', filter: { rules: [], mode: 'all' } });
      const webhook2 = createMockWebhook({ id: 'whk_2', filter: { rules: [], mode: 'all' } });
      mockStorageService.getWebhooksForEvent.mockReturnValue([webhook1, webhook2]);
      mockFilterService.matches.mockImplementation((_event, filter) => {
        // Only first webhook matches
        return filter === webhook1.filter;
      });

      service.handleEmailReceived({
        email: {
          id: 'msg_123',
          from: 'sender@example.com',
          to: ['test@inbox.com'],
          subject: 'Test',
        },
        inboxHash: 'inbox_hash_123',
        inboxEmail: 'test@inbox.com',
      });

      expect(mockDeliveryService.deliver).toHaveBeenCalledTimes(1);
      expect(mockDeliveryService.deliver).toHaveBeenCalledWith(webhook1, expect.any(Object));
    });

    it('should not dispatch when all webhooks are filtered out', () => {
      const webhook = createMockWebhook({ filter: { rules: [], mode: 'all' } });
      mockStorageService.getWebhooksForEvent.mockReturnValue([webhook]);
      mockFilterService.matches.mockReturnValue(false);

      service.handleEmailReceived({
        email: {
          id: 'msg_123',
          from: 'sender@example.com',
          to: ['test@inbox.com'],
          subject: 'Test',
        },
        inboxHash: 'inbox_hash_123',
        inboxEmail: 'test@inbox.com',
      });

      expect(mockDeliveryService.deliver).not.toHaveBeenCalled();
    });

    it('should handle delivery errors gracefully', () => {
      const webhook = createMockWebhook();
      mockStorageService.getWebhooksForEvent.mockReturnValue([webhook]);
      mockDeliveryService.deliver.mockRejectedValue(new Error('Delivery failed'));

      // Should not throw
      expect(() => {
        service.handleEmailReceived({
          email: {
            id: 'msg_123',
            from: 'sender@example.com',
            to: ['test@inbox.com'],
            subject: 'Test',
          },
          inboxHash: 'inbox_hash_123',
          inboxEmail: 'test@inbox.com',
        });
      }).not.toThrow();
    });
  });

  describe('normalizeEmailAddress', () => {
    const callNormalizeEmailAddress = (svc: WebhookEventService, addr: { address: string; name?: string } | string) => {
      return (
        svc as unknown as {
          normalizeEmailAddress: (addr: { address: string; name?: string } | string) => {
            address: string;
            name?: string;
          };
        }
      ).normalizeEmailAddress(addr);
    };

    it('should normalize string address', () => {
      const result = callNormalizeEmailAddress(service, 'test@example.com');
      expect(result).toEqual({ address: 'test@example.com' });
    });

    it('should normalize object address with name', () => {
      const result = callNormalizeEmailAddress(service, { address: 'test@example.com', name: 'Test User' });
      expect(result).toEqual({ address: 'test@example.com', name: 'Test User' });
    });

    it('should handle empty name as undefined', () => {
      const result = callNormalizeEmailAddress(service, { address: 'test@example.com', name: '' });
      expect(result).toEqual({ address: 'test@example.com', name: undefined });
    });
  });

  describe('createSnippet', () => {
    const callCreateSnippet = (svc: WebhookEventService, text?: string) => {
      return (svc as unknown as { createSnippet: (text?: string) => string }).createSnippet(text);
    };

    it('should return empty string for undefined text', () => {
      const result = callCreateSnippet(service, undefined);
      expect(result).toBe('');
    });

    it('should return empty string for empty text', () => {
      const result = callCreateSnippet(service, '');
      expect(result).toBe('');
    });

    it('should normalize whitespace', () => {
      const result = callCreateSnippet(service, 'Hello\n\nworld\t\tthere');
      expect(result).toBe('Hello world there');
    });

    it('should truncate long text to 200 chars with ellipsis', () => {
      const longText = 'x'.repeat(300);
      const result = callCreateSnippet(service, longText);
      expect(result.length).toBe(200);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should not truncate text under 200 chars', () => {
      const shortText = 'Hello world';
      const result = callCreateSnippet(service, shortText);
      expect(result).toBe('Hello world');
    });
  });

  describe('normalizeAttachments', () => {
    const callNormalizeAttachments = (
      svc: WebhookEventService,
      attachments?: Array<{ filename?: string; contentType?: string; size?: number; contentId?: string }>,
    ) => {
      return (
        svc as unknown as {
          normalizeAttachments: (
            attachments?: Array<{ filename?: string; contentType?: string; size?: number; contentId?: string }>,
          ) => Array<{ filename: string; contentType: string; size: number; contentId?: string }>;
        }
      ).normalizeAttachments(attachments);
    };

    it('should return empty array for undefined attachments', () => {
      const result = callNormalizeAttachments(service, undefined);
      expect(result).toEqual([]);
    });

    it('should return empty array for empty attachments', () => {
      const result = callNormalizeAttachments(service, []);
      expect(result).toEqual([]);
    });

    it('should normalize attachment with all fields', () => {
      const result = callNormalizeAttachments(service, [
        { filename: 'test.pdf', contentType: 'application/pdf', size: 1024, contentId: 'cid123' },
      ]);
      expect(result).toEqual([
        { filename: 'test.pdf', contentType: 'application/pdf', size: 1024, contentId: 'cid123' },
      ]);
    });

    it('should provide default values for missing fields', () => {
      const result = callNormalizeAttachments(service, [{}]);
      expect(result).toEqual([
        { filename: 'unnamed', contentType: 'application/octet-stream', size: 0, contentId: undefined },
      ]);
    });

    it('should handle mixed attachments', () => {
      const result = callNormalizeAttachments(service, [
        { filename: 'doc.pdf' },
        { contentType: 'image/png', size: 500 },
      ]);
      expect(result).toEqual([
        { filename: 'doc.pdf', contentType: 'application/octet-stream', size: 0, contentId: undefined },
        { filename: 'unnamed', contentType: 'image/png', size: 500, contentId: undefined },
      ]);
    });
  });

  describe('mapEmailReceivedData', () => {
    it('should handle cc recipients', () => {
      const webhook = createMockWebhook();
      mockStorageService.getWebhooksForEvent.mockReturnValue([webhook]);

      service.handleEmailReceived({
        email: {
          id: 'msg_123',
          from: 'sender@example.com',
          to: ['test@inbox.com'],
          cc: [{ address: 'cc@example.com', name: 'CC User' }],
          subject: 'Test',
        },
        inboxHash: 'inbox_hash_123',
        inboxEmail: 'test@inbox.com',
      });

      const eventArg = mockDeliveryService.deliver.mock.calls[0][1];
      expect(eventArg.data.cc).toEqual([{ address: 'cc@example.com', name: 'CC User' }]);
    });

    it('should handle missing subject', () => {
      const webhook = createMockWebhook();
      mockStorageService.getWebhooksForEvent.mockReturnValue([webhook]);

      service.handleEmailReceived({
        email: {
          id: 'msg_123',
          from: 'sender@example.com',
          to: ['test@inbox.com'],
          subject: '',
        },
        inboxHash: 'inbox_hash_123',
        inboxEmail: 'test@inbox.com',
      });

      const eventArg = mockDeliveryService.deliver.mock.calls[0][1];
      expect(eventArg.data.subject).toBe('(no subject)');
    });

    it('should use current date when receivedAt is not provided', () => {
      const webhook = createMockWebhook();
      mockStorageService.getWebhooksForEvent.mockReturnValue([webhook]);
      const beforeTest = new Date();

      service.handleEmailReceived({
        email: {
          id: 'msg_123',
          from: 'sender@example.com',
          to: ['test@inbox.com'],
          subject: 'Test',
        },
        inboxHash: 'inbox_hash_123',
        inboxEmail: 'test@inbox.com',
      });

      const eventArg = mockDeliveryService.deliver.mock.calls[0][1];
      const receivedAt = new Date(eventArg.data.receivedAt);
      expect(receivedAt.getTime()).toBeGreaterThanOrEqual(beforeTest.getTime());
    });
  });

  describe('normalizeHeaders', () => {
    // Access private method for testing
    const callNormalizeHeaders = (svc: WebhookEventService, headers?: Record<string, string>) => {
      return (
        svc as unknown as { normalizeHeaders: (h?: Record<string, string>) => Record<string, string> }
      ).normalizeHeaders(headers);
    };

    it('should return empty object for undefined headers', () => {
      const result = callNormalizeHeaders(service, undefined);
      expect(result).toEqual({});
    });

    it('should return empty object for empty headers', () => {
      const result = callNormalizeHeaders(service, {});
      expect(result).toEqual({});
    });

    it('should include all headers', () => {
      const headers = {
        'Message-ID': '<test@example.com>',
        'X-Custom-Header': 'custom-value',
        'X-Another-Header': 'another-value',
      };
      const result = callNormalizeHeaders(service, headers);
      expect(result).toEqual({
        'message-id': '<test@example.com>',
        'x-custom-header': 'custom-value',
        'x-another-header': 'another-value',
      });
    });

    it('should normalize header keys to lowercase', () => {
      const headers = {
        'Content-Type': 'text/plain',
        'X-UPPERCASE': 'value',
        'MiXeD-CaSe': 'test',
      };
      const result = callNormalizeHeaders(service, headers);
      expect(Object.keys(result)).toEqual(['content-type', 'x-uppercase', 'mixed-case']);
    });

    it('should coerce non-string values to strings', () => {
      const headers = {
        'x-number': 123 as unknown as string,
        'x-null': null as unknown as string,
        'x-undefined': undefined as unknown as string,
      };
      const result = callNormalizeHeaders(service, headers);
      expect(result['x-number']).toBe('123');
      expect(result['x-null']).toBe('');
      expect(result['x-undefined']).toBe('');
    });
  });

  describe('normalizeHeaders with limits', () => {
    const callNormalizeHeaders = (svc: WebhookEventService, headers?: Record<string, string>) => {
      return (
        svc as unknown as { normalizeHeaders: (h?: Record<string, string>) => Record<string, string> }
      ).normalizeHeaders(headers);
    };

    it('should respect maxHeaders limit', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhookEventService,
          { provide: ConfigService, useValue: createMockConfigService({ 'vsb.webhook.maxHeaders': 3 }) },
          { provide: WebhookStorageService, useValue: mockStorageService },
          { provide: WebhookDeliveryService, useValue: mockDeliveryService },
          { provide: WebhookFilterService, useValue: mockFilterService },
        ],
      }).compile();

      const limitedService = module.get<WebhookEventService>(WebhookEventService);

      const headers: Record<string, string> = {};
      for (let i = 0; i < 10; i++) {
        headers[`x-header-${i}`] = `value-${i}`;
      }

      const result = callNormalizeHeaders(limitedService, headers);
      expect(Object.keys(result).length).toBe(3);
    });

    it('should truncate long header values', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhookEventService,
          { provide: ConfigService, useValue: createMockConfigService({ 'vsb.webhook.maxHeaderValueLen': 10 }) },
          { provide: WebhookStorageService, useValue: mockStorageService },
          { provide: WebhookDeliveryService, useValue: mockDeliveryService },
          { provide: WebhookFilterService, useValue: mockFilterService },
        ],
      }).compile();

      const limitedService = module.get<WebhookEventService>(WebhookEventService);

      const headers = {
        'x-long-header': 'this is a very long header value that should be truncated',
      };

      const result = callNormalizeHeaders(limitedService, headers);
      expect(result['x-long-header']).toBe('this is a ');
      expect(result['x-long-header'].length).toBe(10);
    });

    it('should not truncate values within limit', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhookEventService,
          { provide: ConfigService, useValue: createMockConfigService({ 'vsb.webhook.maxHeaderValueLen': 100 }) },
          { provide: WebhookStorageService, useValue: mockStorageService },
          { provide: WebhookDeliveryService, useValue: mockDeliveryService },
          { provide: WebhookFilterService, useValue: mockFilterService },
        ],
      }).compile();

      const limitedService = module.get<WebhookEventService>(WebhookEventService);

      const headers = {
        'x-short-header': 'short value',
      };

      const result = callNormalizeHeaders(limitedService, headers);
      expect(result['x-short-header']).toBe('short value');
    });

    it('should apply both header count and value length limits', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhookEventService,
          {
            provide: ConfigService,
            useValue: createMockConfigService({
              'vsb.webhook.maxHeaders': 2,
              'vsb.webhook.maxHeaderValueLen': 5,
            }),
          },
          { provide: WebhookStorageService, useValue: mockStorageService },
          { provide: WebhookDeliveryService, useValue: mockDeliveryService },
          { provide: WebhookFilterService, useValue: mockFilterService },
        ],
      }).compile();

      const limitedService = module.get<WebhookEventService>(WebhookEventService);

      const headers: Record<string, string> = {
        'x-header-1': 'value-one-long',
        'x-header-2': 'value-two-long',
        'x-header-3': 'value-three',
      };

      const result = callNormalizeHeaders(limitedService, headers);
      expect(Object.keys(result).length).toBe(2);
      expect(result['x-header-1']).toBe('value');
      expect(result['x-header-2']).toBe('value');
    });

    it('should use default limits when config is undefined', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhookEventService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
            },
          },
          { provide: WebhookStorageService, useValue: mockStorageService },
          { provide: WebhookDeliveryService, useValue: mockDeliveryService },
          { provide: WebhookFilterService, useValue: mockFilterService },
        ],
      }).compile();

      const defaultService = module.get<WebhookEventService>(WebhookEventService);

      // Generate 60 headers (more than default 50)
      const headers: Record<string, string> = {};
      for (let i = 0; i < 60; i++) {
        headers[`x-header-${i}`] = `value-${i}`;
      }

      const result = callNormalizeHeaders(defaultService, headers);
      // Default maxHeaders is 50
      expect(Object.keys(result).length).toBe(50);
    });
  });
});
