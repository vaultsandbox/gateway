import { Test, TestingModule } from '@nestjs/testing';
import { WebhookStorageService } from '../webhook-storage.service';
import { InboxStorageService } from '../../../inbox/storage/inbox-storage.service';
import { Webhook } from '../../interfaces/webhook.interface';
import { silenceNestLogger } from '../../../../test/helpers/silence-logger';

describe('WebhookStorageService', () => {
  let service: WebhookStorageService;
  let inboxStorageService: jest.Mocked<InboxStorageService>;
  const restoreLogger = silenceNestLogger();

  const createTestWebhook = (overrides: Partial<Webhook> = {}): Webhook => ({
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

  afterAll(() => restoreLogger());

  beforeEach(async () => {
    const mockInboxStorageService = {
      setWebhookStorageService: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [WebhookStorageService, { provide: InboxStorageService, useValue: mockInboxStorageService }],
    }).compile();

    service = module.get<WebhookStorageService>(WebhookStorageService);
    inboxStorageService = module.get(InboxStorageService);
  });

  afterEach(() => {
    service.clearAll();
  });

  describe('onModuleInit', () => {
    it('should register with InboxStorageService', () => {
      service.onModuleInit();

      expect(inboxStorageService.setWebhookStorageService).toHaveBeenCalledWith(service);
    });

    it('should handle missing InboxStorageService gracefully', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [WebhookStorageService],
      }).compile();

      const serviceWithoutInbox = module.get<WebhookStorageService>(WebhookStorageService);

      expect(() => serviceWithoutInbox.onModuleInit()).not.toThrow();
    });
  });

  describe('Global Webhook Operations', () => {
    describe('createGlobalWebhook', () => {
      it('should create and store a global webhook', () => {
        const webhook = createTestWebhook();

        const result = service.createGlobalWebhook(webhook);

        expect(result).toEqual(webhook);
        expect(service.getGlobalWebhook(webhook.id)).toEqual(webhook);
      });
    });

    describe('getGlobalWebhook', () => {
      it('should return undefined for non-existent webhook', () => {
        const result = service.getGlobalWebhook('whk_notfound');

        expect(result).toBeUndefined();
      });

      it('should return the webhook if found', () => {
        const webhook = createTestWebhook();
        service.createGlobalWebhook(webhook);

        const result = service.getGlobalWebhook(webhook.id);

        expect(result).toEqual(webhook);
      });
    });

    describe('listGlobalWebhooks', () => {
      it('should return empty array when no webhooks exist', () => {
        const result = service.listGlobalWebhooks();

        expect(result).toEqual([]);
      });

      it('should return all global webhooks', () => {
        const webhook1 = createTestWebhook({ id: 'whk_1' });
        const webhook2 = createTestWebhook({ id: 'whk_2' });
        service.createGlobalWebhook(webhook1);
        service.createGlobalWebhook(webhook2);

        const result = service.listGlobalWebhooks();

        expect(result).toHaveLength(2);
        expect(result).toContainEqual(webhook1);
        expect(result).toContainEqual(webhook2);
      });
    });

    describe('getGlobalWebhookCount', () => {
      it('should return 0 when no webhooks exist', () => {
        expect(service.getGlobalWebhookCount()).toBe(0);
      });

      it('should return correct count', () => {
        service.createGlobalWebhook(createTestWebhook({ id: 'whk_1' }));
        service.createGlobalWebhook(createTestWebhook({ id: 'whk_2' }));

        expect(service.getGlobalWebhookCount()).toBe(2);
      });
    });
  });

  describe('Inbox Webhook Operations', () => {
    describe('createInboxWebhook', () => {
      it('should create and store an inbox webhook', () => {
        const webhook = createTestWebhook({ scope: 'inbox', inboxHash: 'inbox_hash' });

        const result = service.createInboxWebhook('inbox_hash', webhook);

        expect(result).toEqual(webhook);
        expect(service.getInboxWebhook('inbox_hash', webhook.id)).toEqual(webhook);
      });

      it('should create inbox map if not exists', () => {
        const webhook1 = createTestWebhook({ id: 'whk_1', scope: 'inbox' });
        const webhook2 = createTestWebhook({ id: 'whk_2', scope: 'inbox' });

        service.createInboxWebhook('inbox_hash', webhook1);
        service.createInboxWebhook('inbox_hash', webhook2);

        expect(service.getInboxWebhookCount('inbox_hash')).toBe(2);
      });
    });

    describe('getInboxWebhook', () => {
      it('should return undefined for non-existent inbox', () => {
        const result = service.getInboxWebhook('nonexistent_inbox', 'whk_test');

        expect(result).toBeUndefined();
      });

      it('should return undefined for non-existent webhook in existing inbox', () => {
        const webhook = createTestWebhook({ scope: 'inbox' });
        service.createInboxWebhook('inbox_hash', webhook);

        const result = service.getInboxWebhook('inbox_hash', 'whk_notfound');

        expect(result).toBeUndefined();
      });
    });

    describe('listInboxWebhooks', () => {
      it('should return empty array for non-existent inbox', () => {
        const result = service.listInboxWebhooks('nonexistent_inbox');

        expect(result).toEqual([]);
      });

      it('should return all webhooks for an inbox', () => {
        const webhook1 = createTestWebhook({ id: 'whk_1', scope: 'inbox' });
        const webhook2 = createTestWebhook({ id: 'whk_2', scope: 'inbox' });
        service.createInboxWebhook('inbox_hash', webhook1);
        service.createInboxWebhook('inbox_hash', webhook2);

        const result = service.listInboxWebhooks('inbox_hash');

        expect(result).toHaveLength(2);
      });
    });

    describe('getInboxWebhookCount', () => {
      it('should return 0 for non-existent inbox', () => {
        expect(service.getInboxWebhookCount('nonexistent_inbox')).toBe(0);
      });

      it('should return correct count for inbox', () => {
        service.createInboxWebhook('inbox_hash', createTestWebhook({ id: 'whk_1' }));
        service.createInboxWebhook('inbox_hash', createTestWebhook({ id: 'whk_2' }));

        expect(service.getInboxWebhookCount('inbox_hash')).toBe(2);
      });
    });

    describe('getTotalInboxWebhookCount', () => {
      it('should return 0 when no inbox webhooks exist', () => {
        expect(service.getTotalInboxWebhookCount()).toBe(0);
      });

      it('should return total count across all inboxes', () => {
        service.createInboxWebhook('inbox_1', createTestWebhook({ id: 'whk_1' }));
        service.createInboxWebhook('inbox_1', createTestWebhook({ id: 'whk_2' }));
        service.createInboxWebhook('inbox_2', createTestWebhook({ id: 'whk_3' }));

        expect(service.getTotalInboxWebhookCount()).toBe(3);
      });
    });
  });

  describe('Generic Operations', () => {
    describe('getWebhook', () => {
      it('should return global webhook', () => {
        const webhook = createTestWebhook();
        service.createGlobalWebhook(webhook);

        const result = service.getWebhook(webhook.id);

        expect(result).toEqual(webhook);
      });

      it('should return inbox webhook', () => {
        const webhook = createTestWebhook({ scope: 'inbox' });
        service.createInboxWebhook('inbox_hash', webhook);

        const result = service.getWebhook(webhook.id);

        expect(result).toEqual(webhook);
      });

      it('should return undefined for non-existent webhook', () => {
        const result = service.getWebhook('whk_notfound');

        expect(result).toBeUndefined();
      });
    });

    describe('incrementStats', () => {
      it('should increment success stats for global webhook', () => {
        const webhook = createTestWebhook();
        service.createGlobalWebhook(webhook);

        const result = service.incrementStats(webhook.id, 'success');

        expect(result).toEqual({ consecutiveFailures: 0 });
        const updated = service.getWebhook(webhook.id);
        expect(updated!.stats.totalDeliveries).toBe(1);
        expect(updated!.stats.successfulDeliveries).toBe(1);
        expect(updated!.stats.failedDeliveries).toBe(0);
        expect(updated!.stats.consecutiveFailures).toBe(0);
        expect(updated!.stats.lastDeliveryStatus).toBe('success');
      });

      it('should increment failure stats for global webhook', () => {
        const webhook = createTestWebhook();
        service.createGlobalWebhook(webhook);

        const result = service.incrementStats(webhook.id, 'failure');

        expect(result).toEqual({ consecutiveFailures: 1 });
        const updated = service.getWebhook(webhook.id);
        expect(updated!.stats.totalDeliveries).toBe(1);
        expect(updated!.stats.successfulDeliveries).toBe(0);
        expect(updated!.stats.failedDeliveries).toBe(1);
        expect(updated!.stats.consecutiveFailures).toBe(1);
        expect(updated!.stats.lastDeliveryStatus).toBe('failed');
      });

      it('should increment stats for inbox webhook', () => {
        const webhook = createTestWebhook({ scope: 'inbox' });
        service.createInboxWebhook('inbox_hash', webhook);

        const result = service.incrementStats(webhook.id, 'success');

        expect(result).toEqual({ consecutiveFailures: 0 });
      });

      it('should reset consecutiveFailures on success after failures', () => {
        const webhook = createTestWebhook();
        service.createGlobalWebhook(webhook);

        service.incrementStats(webhook.id, 'failure');
        service.incrementStats(webhook.id, 'failure');
        service.incrementStats(webhook.id, 'success');

        const updated = service.getWebhook(webhook.id);
        expect(updated!.stats.consecutiveFailures).toBe(0);
      });

      it('should return undefined for non-existent webhook', () => {
        const result = service.incrementStats('whk_notfound', 'success');

        expect(result).toBeUndefined();
      });
    });

    describe('updateWebhook', () => {
      it('should update a global webhook', () => {
        const webhook = createTestWebhook();
        service.createGlobalWebhook(webhook);

        const result = service.updateWebhook(webhook.id, { enabled: false });

        expect(result).toBeDefined();
        expect(result!.enabled).toBe(false);
        expect(result!.updatedAt).toBeDefined();
      });

      it('should update an inbox webhook', () => {
        const webhook = createTestWebhook({ scope: 'inbox' });
        service.createInboxWebhook('inbox_hash', webhook);

        const result = service.updateWebhook(webhook.id, { enabled: false });

        expect(result).toBeDefined();
        expect(result!.enabled).toBe(false);
      });

      it('should return undefined for non-existent webhook', () => {
        const result = service.updateWebhook('whk_notfound', { enabled: false });

        expect(result).toBeUndefined();
      });
    });

    describe('deleteWebhook', () => {
      it('should delete a global webhook', () => {
        const webhook = createTestWebhook();
        service.createGlobalWebhook(webhook);

        const result = service.deleteWebhook(webhook.id);

        expect(result).toBe(true);
        expect(service.getWebhook(webhook.id)).toBeUndefined();
      });

      it('should delete an inbox webhook', () => {
        const webhook = createTestWebhook({ scope: 'inbox' });
        service.createInboxWebhook('inbox_hash', webhook);

        const result = service.deleteWebhook(webhook.id);

        expect(result).toBe(true);
        expect(service.getWebhook(webhook.id)).toBeUndefined();
      });

      it('should clean up empty inbox map after deletion', () => {
        const webhook = createTestWebhook({ scope: 'inbox' });
        service.createInboxWebhook('inbox_hash', webhook);

        service.deleteWebhook(webhook.id);

        expect(service.getInboxWebhookCount('inbox_hash')).toBe(0);
      });

      it('should return false for non-existent webhook', () => {
        const result = service.deleteWebhook('whk_notfound');

        expect(result).toBe(false);
      });

      it('should return false when webhookToInbox has entry but inbox map does not', () => {
        // This is a defensive edge case - create a webhook then manually corrupt state
        const webhook = createTestWebhook({ scope: 'inbox' });
        service.createInboxWebhook('inbox_hash', webhook);

        // Manually delete from inbox map but keep reverse lookup
        const inboxMap = (service as unknown as { inboxWebhooks: Map<string, Map<string, Webhook>> }).inboxWebhooks.get(
          'inbox_hash',
        );
        inboxMap?.delete(webhook.id);

        const result = service.deleteWebhook(webhook.id);

        expect(result).toBe(false);
      });
    });
  });

  describe('Event Matching', () => {
    describe('getWebhooksForEvent', () => {
      it('should return empty array when no webhooks match', () => {
        const result = service.getWebhooksForEvent('email.received');

        expect(result).toEqual([]);
      });

      it('should return matching global webhooks', () => {
        const webhook1 = createTestWebhook({ id: 'whk_1', events: ['email.received'] });
        const webhook2 = createTestWebhook({ id: 'whk_2', events: ['email.stored'] });
        service.createGlobalWebhook(webhook1);
        service.createGlobalWebhook(webhook2);

        const result = service.getWebhooksForEvent('email.received');

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('whk_1');
      });

      it('should skip disabled webhooks', () => {
        const webhook = createTestWebhook({ enabled: false });
        service.createGlobalWebhook(webhook);

        const result = service.getWebhooksForEvent('email.received');

        expect(result).toEqual([]);
      });

      it('should include inbox webhooks when inboxHash provided', () => {
        const globalWebhook = createTestWebhook({ id: 'whk_global' });
        const inboxWebhook = createTestWebhook({ id: 'whk_inbox', scope: 'inbox' });
        service.createGlobalWebhook(globalWebhook);
        service.createInboxWebhook('inbox_hash', inboxWebhook);

        const result = service.getWebhooksForEvent('email.received', 'inbox_hash');

        expect(result).toHaveLength(2);
      });

      it('should not include inbox webhooks from other inboxes', () => {
        const inboxWebhook1 = createTestWebhook({ id: 'whk_1', scope: 'inbox' });
        const inboxWebhook2 = createTestWebhook({ id: 'whk_2', scope: 'inbox' });
        service.createInboxWebhook('inbox_1', inboxWebhook1);
        service.createInboxWebhook('inbox_2', inboxWebhook2);

        const result = service.getWebhooksForEvent('email.received', 'inbox_1');

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('whk_1');
      });

      it('should handle non-existent inbox gracefully', () => {
        const globalWebhook = createTestWebhook();
        service.createGlobalWebhook(globalWebhook);

        const result = service.getWebhooksForEvent('email.received', 'nonexistent_inbox');

        expect(result).toHaveLength(1);
      });

      it('should skip disabled inbox webhooks', () => {
        const inboxWebhook = createTestWebhook({ scope: 'inbox', enabled: false });
        service.createInboxWebhook('inbox_hash', inboxWebhook);

        const result = service.getWebhooksForEvent('email.received', 'inbox_hash');

        expect(result).toEqual([]);
      });
    });
  });

  describe('Cascading Delete', () => {
    describe('onInboxDeleted', () => {
      it('should delete all webhooks for an inbox', () => {
        const webhook1 = createTestWebhook({ id: 'whk_1', scope: 'inbox' });
        const webhook2 = createTestWebhook({ id: 'whk_2', scope: 'inbox' });
        service.createInboxWebhook('inbox_hash', webhook1);
        service.createInboxWebhook('inbox_hash', webhook2);

        service.onInboxDeleted('inbox_hash');

        expect(service.getInboxWebhookCount('inbox_hash')).toBe(0);
        expect(service.getWebhook('whk_1')).toBeUndefined();
        expect(service.getWebhook('whk_2')).toBeUndefined();
      });

      it('should not affect other inboxes', () => {
        const webhook1 = createTestWebhook({ id: 'whk_1', scope: 'inbox' });
        const webhook2 = createTestWebhook({ id: 'whk_2', scope: 'inbox' });
        service.createInboxWebhook('inbox_1', webhook1);
        service.createInboxWebhook('inbox_2', webhook2);

        service.onInboxDeleted('inbox_1');

        expect(service.getWebhook('whk_1')).toBeUndefined();
        expect(service.getWebhook('whk_2')).toBeDefined();
      });

      it('should handle non-existent inbox gracefully', () => {
        expect(() => service.onInboxDeleted('nonexistent_inbox')).not.toThrow();
      });
    });
  });

  describe('Metrics', () => {
    describe('getMetrics', () => {
      it('should return correct metrics', () => {
        service.createGlobalWebhook(createTestWebhook({ id: 'whk_1' }));
        service.createInboxWebhook('inbox_1', createTestWebhook({ id: 'whk_2' }));
        service.createInboxWebhook('inbox_2', createTestWebhook({ id: 'whk_3' }));

        const result = service.getMetrics();

        expect(result.globalWebhookCount).toBe(1);
        expect(result.inboxWebhookCount).toBe(2);
        expect(result.totalWebhookCount).toBe(3);
        expect(result.inboxesWithWebhooks).toBe(2);
      });
    });

    describe('getAggregatedMetrics', () => {
      it('should aggregate metrics across all webhooks', () => {
        const webhook1 = createTestWebhook({
          id: 'whk_1',
          enabled: true,
          stats: {
            totalDeliveries: 10,
            successfulDeliveries: 8,
            failedDeliveries: 2,
            consecutiveFailures: 0,
          },
        });
        const webhook2 = createTestWebhook({
          id: 'whk_2',
          enabled: false,
          scope: 'inbox',
          stats: {
            totalDeliveries: 5,
            successfulDeliveries: 4,
            failedDeliveries: 1,
            consecutiveFailures: 1,
          },
        });
        service.createGlobalWebhook(webhook1);
        service.createInboxWebhook('inbox_hash', webhook2);

        const result = service.getAggregatedMetrics();

        expect(result.enabledCount).toBe(1);
        expect(result.totalDeliveries).toBe(15);
        expect(result.successfulDeliveries).toBe(12);
        expect(result.failedDeliveries).toBe(3);
      });
    });
  });

  describe('clearAll', () => {
    it('should clear all webhooks', () => {
      service.createGlobalWebhook(createTestWebhook({ id: 'whk_1' }));
      service.createInboxWebhook('inbox_hash', createTestWebhook({ id: 'whk_2' }));

      service.clearAll();

      expect(service.getGlobalWebhookCount()).toBe(0);
      expect(service.getTotalInboxWebhookCount()).toBe(0);
    });
  });
});
