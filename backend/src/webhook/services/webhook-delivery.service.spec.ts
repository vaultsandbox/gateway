import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookTemplateService } from './webhook-template.service';
import { WebhookStorageService } from '../storage/webhook-storage.service';
import { Webhook } from '../interfaces/webhook.interface';
import { WebhookEvent } from '../interfaces/webhook-event.interface';

describe('WebhookDeliveryService', () => {
  let service: WebhookDeliveryService;
  let httpService: jest.Mocked<HttpService>;
  let storageService: WebhookStorageService;

  // Helper to make all queued retries ready for processing by setting scheduledAt to the past
  const makeRetriesReady = () => {
    const retryQueue = (service as unknown as { retryQueue: Map<string, { scheduledAt: Date }> }).retryQueue;
    for (const entry of retryQueue.values()) {
      entry.scheduledAt = new Date(0); // Set to past
    }
  };

  const createTestWebhook = (overrides: Partial<Webhook> = {}): Webhook => ({
    id: 'whk_test123',
    name: 'Test Webhook',
    url: 'https://example.com/webhook',
    secret: 'test-secret-key',
    events: ['email.received'],
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    stats: {
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      consecutiveFailures: 0,
      lastDeliveryAt: undefined,
      lastDeliveryStatus: undefined,
    },
    ...overrides,
  });

  const createTestEvent = (): WebhookEvent => ({
    id: 'evt_test123',
    object: 'event',
    createdAt: Math.floor(Date.now() / 1000),
    type: 'email.received',
    data: {
      id: 'msg_test123',
      inboxId: 'inbox_hash',
      inboxEmail: 'test@example.com',
      from: { address: 'sender@example.com' },
      to: [{ address: 'test@example.com' }],
      subject: 'Test Subject',
      snippet: 'Test snippet',
      receivedAt: new Date().toISOString(),
      headers: {},
      attachments: [],
    },
  });

  const createSuccessResponse = (): AxiosResponse => ({
    data: { ok: true },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: {} } as InternalAxiosRequestConfig,
  });

  const createErrorResponse = (status: number): AxiosError => {
    const error = new Error('Request failed') as AxiosError;
    error.isAxiosError = true;
    error.response = {
      data: { error: 'Internal Server Error' },
      status,
      statusText: 'Internal Server Error',
      headers: {},
      config: { headers: {} } as InternalAxiosRequestConfig,
    };
    error.message = `Request failed with status code ${status}`;
    return error;
  };

  beforeEach(async () => {
    const mockHttpService = {
      post: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, number> = {
          'vsb.webhook.maxRetries': 5,
          'vsb.webhook.deliveryTimeout': 10000,
        };
        return config[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDeliveryService,
        WebhookTemplateService,
        WebhookStorageService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<WebhookDeliveryService>(WebhookDeliveryService);
    httpService = module.get(HttpService);
    storageService = module.get<WebhookStorageService>(WebhookStorageService);
  });

  describe('stats exactly-once semantics', () => {
    it('should increment success stats exactly once on successful delivery', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      httpService.post.mockReturnValue(of(createSuccessResponse()));

      const result = await service.deliver(webhook, createTestEvent());

      expect(result.success).toBe(true);

      const updatedWebhook = storageService.getWebhook(webhook.id);
      expect(updatedWebhook!.stats.totalDeliveries).toBe(1);
      expect(updatedWebhook!.stats.successfulDeliveries).toBe(1);
      expect(updatedWebhook!.stats.failedDeliveries).toBe(0);
      expect(updatedWebhook!.stats.consecutiveFailures).toBe(0);
      expect(updatedWebhook!.stats.lastDeliveryStatus).toBe('success');
    });

    it('should increment failure stats exactly once on failed delivery', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      httpService.post.mockReturnValue(throwError(() => createErrorResponse(500)));

      const result = await service.deliver(webhook, createTestEvent());

      expect(result.success).toBe(false);

      const updatedWebhook = storageService.getWebhook(webhook.id);
      expect(updatedWebhook!.stats.totalDeliveries).toBe(1);
      expect(updatedWebhook!.stats.successfulDeliveries).toBe(0);
      expect(updatedWebhook!.stats.failedDeliveries).toBe(1);
      expect(updatedWebhook!.stats.consecutiveFailures).toBe(1);
      expect(updatedWebhook!.stats.lastDeliveryStatus).toBe('failed');
    });

    it('should increment stats exactly once even when template transformation fails', async () => {
      const webhook = createTestWebhook({
        template: {
          type: 'custom',
          body: '{{invalid.deep.', // Invalid template syntax
        },
      });
      storageService.createGlobalWebhook(webhook);

      // Template service should throw during transform
      const result = await service.deliver(webhook, createTestEvent());

      expect(result.success).toBe(false);

      const updatedWebhook = storageService.getWebhook(webhook.id);
      expect(updatedWebhook!.stats.totalDeliveries).toBe(1);
      expect(updatedWebhook!.stats.failedDeliveries).toBe(1);
    });

    it('should not double-count stats on consecutive failures', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      httpService.post.mockReturnValue(throwError(() => createErrorResponse(500)));

      // First failure
      await service.deliver(webhook, createTestEvent());
      // Second failure
      await service.deliver(webhook, createTestEvent());
      // Third failure
      await service.deliver(webhook, createTestEvent());

      const updatedWebhook = storageService.getWebhook(webhook.id);
      expect(updatedWebhook!.stats.totalDeliveries).toBe(3);
      expect(updatedWebhook!.stats.failedDeliveries).toBe(3);
      expect(updatedWebhook!.stats.consecutiveFailures).toBe(3);
    });

    it('should reset consecutiveFailures on success after failures', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      // Two failures
      httpService.post.mockReturnValue(throwError(() => createErrorResponse(500)));
      await service.deliver(webhook, createTestEvent());
      await service.deliver(webhook, createTestEvent());

      let updatedWebhook = storageService.getWebhook(webhook.id);
      expect(updatedWebhook!.stats.consecutiveFailures).toBe(2);

      // Then a success
      httpService.post.mockReturnValue(of(createSuccessResponse()));
      await service.deliver(webhook, createTestEvent());

      updatedWebhook = storageService.getWebhook(webhook.id);
      expect(updatedWebhook!.stats.totalDeliveries).toBe(3);
      expect(updatedWebhook!.stats.successfulDeliveries).toBe(1);
      expect(updatedWebhook!.stats.failedDeliveries).toBe(2);
      expect(updatedWebhook!.stats.consecutiveFailures).toBe(0);
      expect(updatedWebhook!.stats.lastDeliveryStatus).toBe('success');
    });
  });

  describe('retry scheduling', () => {
    it('should schedule retry on failure when attempts remain', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      httpService.post.mockReturnValue(throwError(() => createErrorResponse(500)));

      const result = await service.deliver(webhook, createTestEvent());

      expect(result.willRetry).toBe(true);
      expect(result.nextAttempt).toBe(2);
      expect(service.getRetryQueueSize()).toBe(1);
    });

    it('should not schedule retry when max attempts reached', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      httpService.post.mockReturnValue(throwError(() => createErrorResponse(500)));

      // Exhaust all retries (5 attempts)
      for (let i = 0; i < 5; i++) {
        await service.deliver(webhook, createTestEvent());
        // Process retry queue to execute retries
        await service.processRetryQueue();
      }

      // After 5 failures, no more retries should be scheduled
      const updatedWebhook = storageService.getWebhook(webhook.id);
      expect(updatedWebhook!.stats.failedDeliveries).toBeGreaterThanOrEqual(5);
    });
  });

  describe('processRetryQueue', () => {
    it('should skip retries for disabled webhooks without updating stats', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      httpService.post.mockReturnValue(throwError(() => createErrorResponse(500)));

      // Trigger initial failure to queue retry
      await service.deliver(webhook, createTestEvent());

      const statsAfterInitial = { ...storageService.getWebhook(webhook.id)!.stats };
      expect(statsAfterInitial.totalDeliveries).toBe(1);
      expect(service.getRetryQueueSize()).toBe(1);

      // Disable webhook before retry executes
      storageService.updateWebhook(webhook.id, { enabled: false });

      // Make retries ready for processing (bypass scheduling delay)
      makeRetriesReady();

      // Process retry queue
      await service.processRetryQueue();

      // Stats should NOT have changed (retry was skipped)
      const updatedWebhook = storageService.getWebhook(webhook.id);
      expect(updatedWebhook!.stats.totalDeliveries).toBe(statsAfterInitial.totalDeliveries);
      expect(service.getRetryQueueSize()).toBe(0);
    });

    it('should skip retries for deleted webhooks', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      httpService.post.mockReturnValue(throwError(() => createErrorResponse(500)));

      // Trigger initial failure to queue retry
      await service.deliver(webhook, createTestEvent());
      expect(service.getRetryQueueSize()).toBe(1);

      // Delete webhook before retry executes
      storageService.deleteWebhook(webhook.id);

      // Make retries ready for processing (bypass scheduling delay)
      makeRetriesReady();

      // Process retry queue - should not throw
      await service.processRetryQueue();

      // Queue should be empty
      expect(service.getRetryQueueSize()).toBe(0);
    });

    it('should process multiple retries in parallel', async () => {
      // Create multiple webhooks
      const webhooks = [
        createTestWebhook({ id: 'whk_test1', name: 'Webhook 1' }),
        createTestWebhook({ id: 'whk_test2', name: 'Webhook 2' }),
        createTestWebhook({ id: 'whk_test3', name: 'Webhook 3' }),
      ];

      for (const webhook of webhooks) {
        storageService.createGlobalWebhook(webhook);
      }

      // Fail initial deliveries to queue retries
      httpService.post.mockReturnValue(throwError(() => createErrorResponse(500)));

      for (const webhook of webhooks) {
        await service.deliver(webhook, createTestEvent());
      }

      expect(service.getRetryQueueSize()).toBe(3);

      // Now make all succeed
      httpService.post.mockReturnValue(of(createSuccessResponse()));

      // Make retries ready for processing (bypass scheduling delay)
      makeRetriesReady();

      // Process all retries
      await service.processRetryQueue();

      // All webhooks should have 2 deliveries (1 failure + 1 success from retry)
      for (const webhook of webhooks) {
        const updated = storageService.getWebhook(webhook.id);
        expect(updated!.stats.totalDeliveries).toBe(2);
        expect(updated!.stats.successfulDeliveries).toBe(1);
        expect(updated!.stats.failedDeliveries).toBe(1);
      }
    });

    it('should return immediately when retry queue is empty', async () => {
      expect(service.getRetryQueueSize()).toBe(0);

      // Should complete without error
      await service.processRetryQueue();

      expect(service.getRetryQueueSize()).toBe(0);
    });
  });

  describe('concurrent delivery limits', () => {
    it('should queue delivery when concurrent limit reached', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      // Return an immediate success response
      httpService.post.mockReturnValue(of(createSuccessResponse()));

      // Mock canDeliver to return false after 10 calls to simulate limit
      let callCount = 0;
      const originalCanDeliver = (service as unknown as { canDeliver: (id: string) => boolean }).canDeliver.bind(
        service,
      );
      jest
        .spyOn(service as unknown as { canDeliver: (id: string) => boolean }, 'canDeliver')
        .mockImplementation((id: string) => {
          callCount++;
          if (callCount > 10) {
            return false;
          }
          return originalCanDeliver(id);
        });

      // Start many concurrent deliveries (more than the limit)
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 15; i++) {
        promises.push(service.deliver(webhook, createTestEvent()));
      }

      // Wait for all promises to complete
      await Promise.all(promises);

      // Some deliveries should be queued due to concurrent limit
      expect(service.getRetryQueueSize()).toBeGreaterThan(0);
    });

    it('should block when total concurrent deliveries exceed max', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      // Force total active deliveries to be at the limit
      const totalActive = service as unknown as { totalActiveDeliveries: number };
      totalActive.totalActiveDeliveries = 100;

      const result = await service.deliver(webhook, createTestEvent());

      expect(result.success).toBe(false);
      expect(result.error).toBe('concurrent_limit');
      expect(result.willRetry).toBe(true);

      // Reset for cleanup
      totalActive.totalActiveDeliveries = 0;
    });
  });

  describe('testWebhook', () => {
    it('should send test payload and return success result', async () => {
      const webhook = createTestWebhook();
      httpService.post.mockReturnValue(of(createSuccessResponse()));

      const result = await service.testWebhook(webhook);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.responseTime).toBeDefined();
      expect(result.payloadSent).toBeDefined();
      expect(httpService.post).toHaveBeenCalledWith(
        webhook.url,
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Vault-Event': 'email.received',
          }),
        }),
      );
    });

    it('should return failure result on HTTP error', async () => {
      const webhook = createTestWebhook();
      httpService.post.mockReturnValue(throwError(() => createErrorResponse(500)));

      const result = await service.testWebhook(webhook);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.error).toBeDefined();
      expect(result.payloadSent).toBeDefined();
    });

    it('should use first subscribed event type for test event', async () => {
      const webhook = createTestWebhook({ events: ['email.stored', 'email.received'] });
      httpService.post.mockReturnValue(of(createSuccessResponse()));

      await service.testWebhook(webhook);

      expect(httpService.post).toHaveBeenCalledWith(
        webhook.url,
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Vault-Event': 'email.stored',
          }),
        }),
      );
    });
  });

  describe('getContentType', () => {
    it('should return custom contentType when template specifies one', async () => {
      const webhook = createTestWebhook({
        template: {
          type: 'custom',
          body: '{"test": "{{data.id}}"}',
          contentType: 'application/xml',
        },
      });
      storageService.createGlobalWebhook(webhook);
      httpService.post.mockReturnValue(of(createSuccessResponse()));

      await service.deliver(webhook, createTestEvent());

      expect(httpService.post).toHaveBeenCalledWith(
        webhook.url,
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/xml',
          }),
        }),
      );
    });

    it('should default to application/json when no template', async () => {
      const webhook = createTestWebhook({ template: undefined });
      storageService.createGlobalWebhook(webhook);
      httpService.post.mockReturnValue(of(createSuccessResponse()));

      await service.deliver(webhook, createTestEvent());

      expect(httpService.post).toHaveBeenCalledWith(
        webhook.url,
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });
  });

  describe('truncateResponse', () => {
    it('should truncate response body longer than 1KB', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      const longResponse = { data: 'x'.repeat(2000) };
      httpService.post.mockReturnValue(
        of({
          ...createSuccessResponse(),
          data: longResponse,
        }),
      );

      const result = await service.deliver(webhook, createTestEvent());

      expect(result.responseBody).toContain('... (truncated)');
      expect(result.responseBody!.length).toBeLessThanOrEqual(1024 + 15); // 1024 + "... (truncated)"
    });

    it('should not truncate response body under 1KB', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      const shortResponse = { data: 'short' };
      httpService.post.mockReturnValue(
        of({
          ...createSuccessResponse(),
          data: shortResponse,
        }),
      );

      const result = await service.deliver(webhook, createTestEvent());

      expect(result.responseBody).not.toContain('truncated');
    });
  });

  describe('getActiveDeliveryCounts', () => {
    it('should return total and per-webhook delivery counts', () => {
      const counts = service.getActiveDeliveryCounts();

      expect(counts).toHaveProperty('total');
      expect(counts).toHaveProperty('perWebhook');
      expect(counts.perWebhook instanceof Map).toBe(true);
    });
  });

  describe('per-webhook retry limits', () => {
    it('should skip retry when per-webhook retry limit is reached', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      // Force the webhook retry count to be at the limit
      const webhookRetryCount = (service as unknown as { webhookRetryCount: Map<string, number> }).webhookRetryCount;
      webhookRetryCount.set(webhook.id, 100); // Default maxRetriesPerWebhook is 100

      httpService.post.mockReturnValue(throwError(() => createErrorResponse(500)));

      const initialQueueSize = service.getRetryQueueSize();
      await service.deliver(webhook, createTestEvent());

      // Should not have added to retry queue due to limit
      expect(service.getRetryQueueSize()).toBe(initialQueueSize);

      // Cleanup
      webhookRetryCount.delete(webhook.id);
    });
  });

  describe('retry queue eviction', () => {
    it('should evict oldest entry when retry queue is full', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      // Set queue size limit very low and fill the queue
      const maxRetryQueueSize = service as unknown as { maxRetryQueueSize: number };
      const originalMax = maxRetryQueueSize.maxRetryQueueSize;
      (service as unknown as { maxRetryQueueSize: number }).maxRetryQueueSize = 2;

      httpService.post.mockReturnValue(throwError(() => createErrorResponse(500)));

      // Queue 3 retries when max is 2 - oldest should be evicted
      await service.deliver(webhook, createTestEvent());
      await service.deliver(webhook, createTestEvent());
      await service.deliver(webhook, createTestEvent());

      // Queue should be at max size (oldest evicted)
      expect(service.getRetryQueueSize()).toBe(2);

      // Restore original
      (service as unknown as { maxRetryQueueSize: number }).maxRetryQueueSize = originalMax;
    });
  });

  describe('processRetryQueue edge cases', () => {
    it('should re-queue when canDeliver returns false during retry', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      httpService.post.mockReturnValue(throwError(() => createErrorResponse(500)));

      // Queue a retry
      await service.deliver(webhook, createTestEvent());
      expect(service.getRetryQueueSize()).toBe(1);

      // Make retry ready
      makeRetriesReady();

      // Mock canDeliver to return false
      jest.spyOn(service as unknown as { canDeliver: (id: string) => boolean }, 'canDeliver').mockReturnValue(false);

      // Process - should re-queue since canDeliver is false
      await service.processRetryQueue();

      // Should still have entry in queue (re-queued)
      expect(service.getRetryQueueSize()).toBe(1);
    });
  });

  describe('cancelPendingRetries', () => {
    it('should cancel all pending retries for a webhook', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      httpService.post.mockReturnValue(throwError(() => createErrorResponse(500)));

      // Queue multiple retries
      await service.deliver(webhook, createTestEvent());
      await service.deliver(webhook, createTestEvent());

      expect(service.getRetryQueueSize()).toBe(2);

      service.cancelPendingRetries(webhook.id);

      expect(service.getRetryQueueSize()).toBe(0);
    });

    it('should not affect retries for other webhooks', async () => {
      const webhook1 = createTestWebhook({ id: 'whk_1' });
      const webhook2 = createTestWebhook({ id: 'whk_2' });
      storageService.createGlobalWebhook(webhook1);
      storageService.createGlobalWebhook(webhook2);

      httpService.post.mockReturnValue(throwError(() => createErrorResponse(500)));

      await service.deliver(webhook1, createTestEvent());
      await service.deliver(webhook2, createTestEvent());

      expect(service.getRetryQueueSize()).toBe(2);

      service.cancelPendingRetries(webhook1.id);

      expect(service.getRetryQueueSize()).toBe(1);
    });
  });

  describe('auto-disable after consecutive failures', () => {
    it('should auto-disable webhook after 5 consecutive failures', async () => {
      const webhook = createTestWebhook();
      storageService.createGlobalWebhook(webhook);

      httpService.post.mockReturnValue(throwError(() => createErrorResponse(500)));

      // Trigger 5 consecutive failures
      for (let i = 0; i < 5; i++) {
        await service.deliver(webhook, createTestEvent());
      }

      const updated = storageService.getWebhook(webhook.id);
      expect(updated!.enabled).toBe(false);
    });
  });
});
