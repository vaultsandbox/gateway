import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { WebhookService } from '../webhook.service';
import { WebhookStorageService } from '../../storage/webhook-storage.service';
import { WebhookTemplateService } from '../webhook-template.service';
import { WebhookDeliveryService } from '../webhook-delivery.service';
import { WebhookFilterService } from '../webhook-filter.service';
import { InboxStorageService } from '../../../inbox/storage/inbox-storage.service';
import { CreateWebhookDto } from '../../dto/create-webhook.dto';
import { UpdateWebhookDto } from '../../dto/update-webhook.dto';
import { Webhook } from '../../interfaces/webhook.interface';
import { silenceNestLogger } from '../../../../test/helpers/silence-logger';

describe('WebhookService', () => {
  let service: WebhookService;
  let storageService: jest.Mocked<WebhookStorageService>;
  let templateService: jest.Mocked<WebhookTemplateService>;
  let deliveryService: jest.Mocked<WebhookDeliveryService>;
  let filterService: jest.Mocked<WebhookFilterService>;
  let inboxStorageService: jest.Mocked<InboxStorageService>;
  const restoreLogger = silenceNestLogger();

  const createMockConfigService = (overrides: Record<string, unknown> = {}) => {
    const config: Record<string, unknown> = {
      'vsb.webhook.maxGlobalWebhooks': 100,
      'vsb.webhook.maxInboxWebhooks': 50,
      'vsb.webhook.allowHttp': false,
      'vsb.webhook.requireAuthDefault': false,
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
      totalDeliveries: 10,
      successfulDeliveries: 8,
      failedDeliveries: 2,
      consecutiveFailures: 0,
    },
    ...overrides,
  });

  const createMockInbox = () => ({
    inboxHash: 'inbox_hash_123',
    email: 'test@inbox.example.com',
    createdAt: new Date(),
  });

  afterAll(() => restoreLogger());

  beforeEach(async () => {
    const mockStorageService = {
      getGlobalWebhookCount: jest.fn().mockReturnValue(0),
      getInboxWebhookCount: jest.fn().mockReturnValue(0),
      createGlobalWebhook: jest.fn(),
      createInboxWebhook: jest.fn(),
      listGlobalWebhooks: jest.fn().mockReturnValue([]),
      listInboxWebhooks: jest.fn().mockReturnValue([]),
      getGlobalWebhook: jest.fn(),
      getInboxWebhook: jest.fn(),
      getWebhook: jest.fn(),
      updateWebhook: jest.fn(),
      deleteWebhook: jest.fn(),
      getMetrics: jest.fn().mockReturnValue({
        globalWebhookCount: 0,
        inboxWebhookCount: 0,
        totalWebhookCount: 0,
      }),
      getAggregatedMetrics: jest.fn().mockReturnValue({
        enabledCount: 0,
        totalDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
      }),
    };

    const mockTemplateService = {
      isBuiltInTemplate: jest.fn().mockReturnValue(true),
      getBuiltInTemplateNames: jest.fn().mockReturnValue(['default', 'slack']),
      getBuiltInTemplateOptions: jest.fn().mockReturnValue([
        { label: 'Default', value: 'default' },
        { label: 'Slack', value: 'slack' },
      ]),
      validateTemplate: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    };

    const mockDeliveryService = {
      cancelPendingRetries: jest.fn(),
      testWebhook: jest.fn().mockResolvedValue({
        success: true,
        statusCode: 200,
        responseTime: 100,
        payloadSent: {},
      }),
    };

    const mockFilterService = {
      validateFilter: jest.fn().mockReturnValue({ valid: true, errors: [] }),
    };

    const mockInboxStorageService = {
      getInbox: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: ConfigService, useValue: createMockConfigService() },
        { provide: WebhookStorageService, useValue: mockStorageService },
        { provide: WebhookTemplateService, useValue: mockTemplateService },
        { provide: WebhookDeliveryService, useValue: mockDeliveryService },
        { provide: WebhookFilterService, useValue: mockFilterService },
        { provide: InboxStorageService, useValue: mockInboxStorageService },
      ],
    }).compile();

    service = module.get<WebhookService>(WebhookService);
    storageService = module.get(WebhookStorageService);
    templateService = module.get(WebhookTemplateService);
    deliveryService = module.get(WebhookDeliveryService);
    filterService = module.get(WebhookFilterService);
    inboxStorageService = module.get(InboxStorageService);
  });

  describe('createGlobalWebhook', () => {
    it('should create a global webhook', () => {
      const dto: CreateWebhookDto = {
        url: 'https://example.com/webhook',
        events: ['email.received'],
      };

      const result = service.createGlobalWebhook(dto);

      expect(storageService.createGlobalWebhook).toHaveBeenCalled();
      expect(result.url).toBe(dto.url);
      expect(result.events).toEqual(dto.events);
      expect(result.secret).toBeDefined();
    });

    it('should throw ConflictException when limit reached', () => {
      storageService.getGlobalWebhookCount.mockReturnValue(100);

      const dto: CreateWebhookDto = {
        url: 'https://example.com/webhook',
        events: ['email.received'],
      };

      expect(() => service.createGlobalWebhook(dto)).toThrow(ConflictException);
    });

    it('should validate URL', () => {
      const dto: CreateWebhookDto = {
        url: 'not-a-valid-url',
        events: ['email.received'],
      };

      expect(() => service.createGlobalWebhook(dto)).toThrow(BadRequestException);
    });

    it('should reject HTTP URLs when allowHttp is false', () => {
      const dto: CreateWebhookDto = {
        url: 'http://example.com/webhook',
        events: ['email.received'],
      };

      expect(() => service.createGlobalWebhook(dto)).toThrow(BadRequestException);
    });

    it('should validate event types', () => {
      const dto: CreateWebhookDto = {
        url: 'https://example.com/webhook',
        events: ['invalid.event'],
      };

      expect(() => service.createGlobalWebhook(dto)).toThrow(BadRequestException);
    });

    it('should validate template', () => {
      templateService.isBuiltInTemplate.mockReturnValue(false);

      const dto: CreateWebhookDto = {
        url: 'https://example.com/webhook',
        events: ['email.received'],
        template: 'unknown_template',
      };

      expect(() => service.createGlobalWebhook(dto)).toThrow(BadRequestException);
    });

    it('should validate custom template', () => {
      templateService.validateTemplate.mockReturnValue({ valid: false, errors: ['Invalid template'] });

      const dto: CreateWebhookDto = {
        url: 'https://example.com/webhook',
        events: ['email.received'],
        template: { type: 'custom', body: 'invalid' },
      };

      expect(() => service.createGlobalWebhook(dto)).toThrow(BadRequestException);
    });

    it('should validate filter', () => {
      filterService.validateFilter.mockReturnValue({ valid: false, errors: ['Invalid filter'] });

      const dto: CreateWebhookDto = {
        url: 'https://example.com/webhook',
        events: ['email.received'],
        filter: { rules: [], mode: 'all' },
      };

      expect(() => service.createGlobalWebhook(dto)).toThrow(BadRequestException);
    });

    it('should include description when provided', () => {
      const dto: CreateWebhookDto = {
        url: 'https://example.com/webhook',
        events: ['email.received'],
        description: 'Test webhook',
      };

      const result = service.createGlobalWebhook(dto);

      expect(result.description).toBe('Test webhook');
    });

    it('should accept valid built-in template', () => {
      templateService.isBuiltInTemplate.mockReturnValue(true);

      const dto: CreateWebhookDto = {
        url: 'https://example.com/webhook',
        events: ['email.received'],
        template: 'slack',
      };

      const result = service.createGlobalWebhook(dto);

      expect(result.template).toBe('slack');
    });

    it('should accept valid custom template', () => {
      templateService.validateTemplate.mockReturnValue({ valid: true, errors: [] });

      const dto: CreateWebhookDto = {
        url: 'https://example.com/webhook',
        events: ['email.received'],
        template: { type: 'custom', body: '{"test": "{{data.id}}"}', contentType: 'application/json' },
      };

      const result = service.createGlobalWebhook(dto);

      expect(result.template).toEqual({
        type: 'custom',
        body: '{"test": "{{data.id}}"}',
        contentType: 'application/json',
      });
    });
  });

  describe('listGlobalWebhooks', () => {
    it('should list all global webhooks', () => {
      const webhooks = [createMockWebhook({ id: 'whk_1' }), createMockWebhook({ id: 'whk_2' })];
      storageService.listGlobalWebhooks.mockReturnValue(webhooks);

      const result = service.listGlobalWebhooks();

      expect(result.total).toBe(2);
      expect(result.webhooks).toHaveLength(2);
    });
  });

  describe('getGlobalWebhook', () => {
    it('should return a global webhook', () => {
      const webhook = createMockWebhook();
      storageService.getGlobalWebhook.mockReturnValue(webhook);

      const result = service.getGlobalWebhook('whk_test123');

      expect(result.id).toBe('whk_test123');
      expect(result.secret).toBeDefined();
      expect(result.stats).toBeDefined();
    });

    it('should throw NotFoundException when not found', () => {
      storageService.getGlobalWebhook.mockReturnValue(null);

      expect(() => service.getGlobalWebhook('whk_notfound')).toThrow(NotFoundException);
    });
  });

  describe('updateGlobalWebhook', () => {
    it('should update a global webhook', () => {
      const webhook = createMockWebhook();
      storageService.getGlobalWebhook.mockReturnValue(webhook);
      storageService.updateWebhook.mockReturnValue({ ...webhook, url: 'https://new.example.com/webhook' });

      const dto: UpdateWebhookDto = { url: 'https://new.example.com/webhook' };
      const result = service.updateGlobalWebhook('whk_test123', dto);

      expect(storageService.updateWebhook).toHaveBeenCalled();
      expect(result.url).toBe('https://new.example.com/webhook');
    });

    it('should validate URL on update', () => {
      const webhook = createMockWebhook();
      storageService.getGlobalWebhook.mockReturnValue(webhook);

      const dto: UpdateWebhookDto = { url: 'invalid-url' };

      expect(() => service.updateGlobalWebhook('whk_test123', dto)).toThrow(BadRequestException);
    });

    it('should validate events on update', () => {
      const webhook = createMockWebhook();
      storageService.getGlobalWebhook.mockReturnValue(webhook);

      const dto: UpdateWebhookDto = { events: ['invalid.event'] };

      expect(() => service.updateGlobalWebhook('whk_test123', dto)).toThrow(BadRequestException);
    });

    it('should allow clearing template with null', () => {
      const webhook = createMockWebhook({ template: 'slack' });
      storageService.getGlobalWebhook.mockReturnValue(webhook);
      storageService.updateWebhook.mockReturnValue({ ...webhook, template: undefined });

      const dto: UpdateWebhookDto = { template: null };
      service.updateGlobalWebhook('whk_test123', dto);

      expect(storageService.updateWebhook).toHaveBeenCalledWith(
        'whk_test123',
        expect.objectContaining({ template: undefined }),
      );
    });

    it('should allow clearing filter with null', () => {
      const webhook = createMockWebhook({ filter: { rules: [], mode: 'all' } });
      storageService.getGlobalWebhook.mockReturnValue(webhook);
      storageService.updateWebhook.mockReturnValue({ ...webhook, filter: undefined });

      const dto: UpdateWebhookDto = { filter: null };
      service.updateGlobalWebhook('whk_test123', dto);

      expect(storageService.updateWebhook).toHaveBeenCalledWith(
        'whk_test123',
        expect.objectContaining({ filter: undefined }),
      );
    });

    it('should update enabled status', () => {
      const webhook = createMockWebhook();
      storageService.getGlobalWebhook.mockReturnValue(webhook);
      storageService.updateWebhook.mockReturnValue({ ...webhook, enabled: false });

      const dto: UpdateWebhookDto = { enabled: false };
      const result = service.updateGlobalWebhook('whk_test123', dto);

      expect(result.enabled).toBe(false);
    });

    it('should update template to a built-in template', () => {
      const webhook = createMockWebhook();
      storageService.getGlobalWebhook.mockReturnValue(webhook);
      storageService.updateWebhook.mockReturnValue({ ...webhook, template: 'slack' });
      templateService.isBuiltInTemplate.mockReturnValue(true);

      const dto: UpdateWebhookDto = { template: 'slack' };
      const result = service.updateGlobalWebhook('whk_test123', dto);

      expect(result.template).toBe('slack');
    });

    it('should update template to a custom template', () => {
      const webhook = createMockWebhook();
      const customTemplate = { type: 'custom' as const, body: '{"test": "{{data.id}}"}' };
      storageService.getGlobalWebhook.mockReturnValue(webhook);
      storageService.updateWebhook.mockReturnValue({ ...webhook, template: customTemplate });
      templateService.validateTemplate.mockReturnValue({ valid: true, errors: [] });

      const dto: UpdateWebhookDto = { template: { type: 'custom', body: '{"test": "{{data.id}}"}' } };
      const result = service.updateGlobalWebhook('whk_test123', dto);

      expect(result.template).toEqual(customTemplate);
    });

    it('should update filter configuration', () => {
      const webhook = createMockWebhook();
      const newFilter = {
        rules: [{ field: 'subject', operator: 'contains', value: 'test', caseSensitive: false }],
        mode: 'all' as const,
        requireAuth: false,
      };
      storageService.getGlobalWebhook.mockReturnValue(webhook);
      storageService.updateWebhook.mockReturnValue({ ...webhook, filter: newFilter });

      const dto: UpdateWebhookDto = {
        filter: { rules: [{ field: 'subject', operator: 'contains', value: 'test' }], mode: 'all' },
      };
      const result = service.updateGlobalWebhook('whk_test123', dto);

      expect(result.filter).toEqual(newFilter);
    });
  });

  describe('deleteGlobalWebhook', () => {
    it('should delete a global webhook', () => {
      storageService.deleteWebhook.mockReturnValue(true);

      service.deleteGlobalWebhook('whk_test123');

      expect(storageService.deleteWebhook).toHaveBeenCalledWith('whk_test123');
      expect(deliveryService.cancelPendingRetries).toHaveBeenCalledWith('whk_test123');
    });

    it('should not cancel retries if webhook did not exist', () => {
      storageService.deleteWebhook.mockReturnValue(false);

      service.deleteGlobalWebhook('whk_notfound');

      expect(deliveryService.cancelPendingRetries).not.toHaveBeenCalled();
    });
  });

  describe('testGlobalWebhook', () => {
    it('should test a global webhook', async () => {
      const webhook = createMockWebhook();
      storageService.getGlobalWebhook.mockReturnValue(webhook);

      const result = await service.testGlobalWebhook('whk_test123');

      expect(deliveryService.testWebhook).toHaveBeenCalledWith(webhook);
      expect(result.success).toBe(true);
    });

    it('should throw NotFoundException when webhook not found', async () => {
      storageService.getGlobalWebhook.mockReturnValue(null);

      await expect(service.testGlobalWebhook('whk_notfound')).rejects.toThrow(NotFoundException);
    });
  });

  describe('rotateGlobalWebhookSecret', () => {
    it('should rotate the secret', () => {
      const webhook = createMockWebhook();
      storageService.getGlobalWebhook.mockReturnValue(webhook);

      const result = service.rotateGlobalWebhookSecret('whk_test123');

      expect(storageService.updateWebhook).toHaveBeenCalled();
      expect(result.id).toBe('whk_test123');
      expect(result.secret).toBeDefined();
      expect(result.previousSecretValidUntil).toBeDefined();
    });
  });

  describe('createInboxWebhook', () => {
    it('should create an inbox webhook', () => {
      const inbox = createMockInbox();
      inboxStorageService.getInbox.mockReturnValue(inbox);

      const dto: CreateWebhookDto = {
        url: 'https://example.com/webhook',
        events: ['email.received'],
      };

      const result = service.createInboxWebhook('test@inbox.example.com', dto);

      expect(storageService.createInboxWebhook).toHaveBeenCalledWith('inbox_hash_123', expect.any(Object));
      expect(result.scope).toBe('inbox');
    });

    it('should throw NotFoundException when inbox not found', () => {
      inboxStorageService.getInbox.mockReturnValue(null);

      const dto: CreateWebhookDto = {
        url: 'https://example.com/webhook',
        events: ['email.received'],
      };

      expect(() => service.createInboxWebhook('notfound@inbox.com', dto)).toThrow(NotFoundException);
    });

    it('should throw ConflictException when limit reached', () => {
      const inbox = createMockInbox();
      inboxStorageService.getInbox.mockReturnValue(inbox);
      storageService.getInboxWebhookCount.mockReturnValue(50);

      const dto: CreateWebhookDto = {
        url: 'https://example.com/webhook',
        events: ['email.received'],
      };

      expect(() => service.createInboxWebhook('test@inbox.example.com', dto)).toThrow(ConflictException);
    });
  });

  describe('listInboxWebhooks', () => {
    it('should list all inbox webhooks', () => {
      const inbox = createMockInbox();
      inboxStorageService.getInbox.mockReturnValue(inbox);
      const webhooks = [createMockWebhook({ scope: 'inbox' })];
      storageService.listInboxWebhooks.mockReturnValue(webhooks);

      const result = service.listInboxWebhooks('test@inbox.example.com');

      expect(result.total).toBe(1);
    });
  });

  describe('getInboxWebhook', () => {
    it('should return an inbox webhook', () => {
      const inbox = createMockInbox();
      const webhook = createMockWebhook({ scope: 'inbox', inboxHash: 'inbox_hash_123' });
      inboxStorageService.getInbox.mockReturnValue(inbox);
      storageService.getInboxWebhook.mockReturnValue(webhook);

      const result = service.getInboxWebhook('test@inbox.example.com', 'whk_test123');

      expect(result.id).toBe('whk_test123');
    });

    it('should throw NotFoundException when webhook not found', () => {
      const inbox = createMockInbox();
      inboxStorageService.getInbox.mockReturnValue(inbox);
      storageService.getInboxWebhook.mockReturnValue(null);

      expect(() => service.getInboxWebhook('test@inbox.example.com', 'whk_notfound')).toThrow(NotFoundException);
    });
  });

  describe('updateInboxWebhook', () => {
    it('should update an inbox webhook', () => {
      const inbox = createMockInbox();
      const webhook = createMockWebhook({ scope: 'inbox' });
      inboxStorageService.getInbox.mockReturnValue(inbox);
      storageService.getInboxWebhook.mockReturnValue(webhook);
      storageService.updateWebhook.mockReturnValue({ ...webhook, description: 'Updated' });

      const dto: UpdateWebhookDto = { description: 'Updated' };
      const result = service.updateInboxWebhook('test@inbox.example.com', 'whk_test123', dto);

      expect(result.description).toBe('Updated');
    });
  });

  describe('deleteInboxWebhook', () => {
    it('should delete an inbox webhook', () => {
      const inbox = createMockInbox();
      inboxStorageService.getInbox.mockReturnValue(inbox);
      storageService.deleteWebhook.mockReturnValue(true);

      service.deleteInboxWebhook('test@inbox.example.com', 'whk_test123');

      expect(storageService.deleteWebhook).toHaveBeenCalledWith('whk_test123');
      expect(deliveryService.cancelPendingRetries).toHaveBeenCalledWith('whk_test123');
    });

    it('should return silently when inbox not found', () => {
      inboxStorageService.getInbox.mockReturnValue(null);

      expect(() => service.deleteInboxWebhook('notfound@inbox.com', 'whk_test123')).not.toThrow();
      expect(storageService.deleteWebhook).not.toHaveBeenCalled();
    });
  });

  describe('testInboxWebhook', () => {
    it('should test an inbox webhook', async () => {
      const inbox = createMockInbox();
      const webhook = createMockWebhook({ scope: 'inbox' });
      inboxStorageService.getInbox.mockReturnValue(inbox);
      storageService.getInboxWebhook.mockReturnValue(webhook);

      const result = await service.testInboxWebhook('test@inbox.example.com', 'whk_test123');

      expect(result.success).toBe(true);
    });
  });

  describe('rotateInboxWebhookSecret', () => {
    it('should rotate the secret for an inbox webhook', () => {
      const inbox = createMockInbox();
      const webhook = createMockWebhook({ scope: 'inbox' });
      inboxStorageService.getInbox.mockReturnValue(inbox);
      storageService.getInboxWebhook.mockReturnValue(webhook);

      const result = service.rotateInboxWebhookSecret('test@inbox.example.com', 'whk_test123');

      expect(result.id).toBe('whk_test123');
      expect(result.secret).toBeDefined();
    });
  });

  describe('getMetrics', () => {
    it('should return aggregated metrics', () => {
      storageService.getMetrics.mockReturnValue({
        globalWebhookCount: 5,
        inboxWebhookCount: 10,
        totalWebhookCount: 15,
      });
      storageService.getAggregatedMetrics.mockReturnValue({
        enabledCount: 12,
        totalDeliveries: 100,
        successfulDeliveries: 90,
        failedDeliveries: 10,
      });

      const result = service.getMetrics();

      expect(result.webhooks.global).toBe(5);
      expect(result.webhooks.inbox).toBe(10);
      expect(result.webhooks.enabled).toBe(12);
      expect(result.webhooks.total).toBe(15);
      expect(result.deliveries.total).toBe(100);
      expect(result.deliveries.successful).toBe(90);
      expect(result.deliveries.failed).toBe(10);
    });
  });

  describe('getTemplates', () => {
    it('should return available templates', () => {
      const result = service.getTemplates();

      expect(result.templates).toBeDefined();
      expect(result.templates.length).toBeGreaterThan(0);
    });
  });

  describe('toResponse', () => {
    it('should include inbox info for inbox webhooks', () => {
      const inbox = createMockInbox();
      const webhook = createMockWebhook({
        scope: 'inbox',
        inboxHash: 'inbox_hash_123',
        inboxEmail: 'test@inbox.example.com',
      });
      inboxStorageService.getInbox.mockReturnValue(inbox);
      storageService.getInboxWebhook.mockReturnValue(webhook);

      const result = service.getInboxWebhook('test@inbox.example.com', 'whk_test123');

      expect(result.inboxEmail).toBe('test@inbox.example.com');
      expect(result.inboxHash).toBe('inbox_hash_123');
    });

    it('should include lastDeliveryAt and lastDeliveryStatus when present', () => {
      const webhook = createMockWebhook({
        stats: {
          totalDeliveries: 10,
          successfulDeliveries: 8,
          failedDeliveries: 2,
          consecutiveFailures: 0,
          lastDeliveryAt: new Date(),
          lastDeliveryStatus: 'success',
        },
      });
      storageService.getGlobalWebhook.mockReturnValue(webhook);

      const result = service.getGlobalWebhook('whk_test123');

      expect(result.lastDeliveryAt).toBeDefined();
      expect(result.lastDeliveryStatus).toBe('success');
    });

    it('should include updatedAt when present', () => {
      const webhook = createMockWebhook({
        updatedAt: new Date(),
      });
      storageService.getGlobalWebhook.mockReturnValue(webhook);

      const result = service.getGlobalWebhook('whk_test123');

      expect(result.updatedAt).toBeDefined();
    });
  });

  describe('HTTP URL with allowHttp enabled', () => {
    it('should allow HTTP URLs when allowHttp is true', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhookService,
          { provide: ConfigService, useValue: createMockConfigService({ 'vsb.webhook.allowHttp': true }) },
          { provide: WebhookStorageService, useValue: storageService },
          { provide: WebhookTemplateService, useValue: templateService },
          { provide: WebhookDeliveryService, useValue: deliveryService },
          { provide: WebhookFilterService, useValue: filterService },
          { provide: InboxStorageService, useValue: inboxStorageService },
        ],
      }).compile();

      const httpAllowedService = module.get<WebhookService>(WebhookService);

      const dto: CreateWebhookDto = {
        url: 'http://example.com/webhook',
        events: ['email.received'],
      };

      expect(() => httpAllowedService.createGlobalWebhook(dto)).not.toThrow();
    });
  });

  describe('filter with requireAuth', () => {
    it('should resolve requireAuth default when creating webhook with filter', () => {
      const dto: CreateWebhookDto = {
        url: 'https://example.com/webhook',
        events: ['email.received'],
        filter: {
          rules: [{ field: 'subject', operator: 'contains', value: 'test' }],
          mode: 'all',
        },
      };

      service.createGlobalWebhook(dto);

      expect(storageService.createGlobalWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.objectContaining({
            requireAuth: false, // Default from config
          }),
        }),
      );
    });
  });
});
