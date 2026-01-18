import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { createHmac } from 'crypto';
import { firstValueFrom, timeout, catchError } from 'rxjs';
import { AxiosError } from 'axios';
import { Webhook } from '../interfaces/webhook.interface';
import { WebhookEvent } from '../interfaces/webhook-event.interface';
import { RetryEntry, DeliveryResult, TestWebhookResult } from '../interfaces/webhook-delivery.interface';
import { WebhookTemplateService } from './webhook-template.service';
import { WebhookStorageService } from '../storage/webhook-storage.service';
import { generateDeliveryId } from '../utils/id-generator';

/**
 * Retry delays in milliseconds for each attempt
 * Attempt 1: immediate (initial try)
 * Attempt 2: +30 seconds
 * Attempt 3: +5 minutes
 * Attempt 4: +30 minutes
 * Attempt 5: +4 hours
 */
const RETRY_DELAYS_MS = [0, 30_000, 300_000, 1_800_000, 14_400_000];

/**
 * Service responsible for delivering webhooks over HTTP with retry logic.
 * Features:
 * - HMAC-SHA256 signature generation
 * - Exponential backoff retries
 * - Concurrent delivery limits (per-webhook and global)
 * - Automatic disabling of failing webhooks
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  /** Pending retries: deliveryId -> RetryEntry */
  private retryQueue = new Map<string, RetryEntry>();

  /** Concurrent delivery tracking per webhook */
  private activeDeliveries = new Map<string, number>();

  /** Per-webhook retry count tracking */
  private webhookRetryCount = new Map<string, number>();

  /** Total concurrent deliveries */
  private totalActiveDeliveries = 0;

  /** Configurable limits */
  private readonly maxRetries: number;
  private readonly deliveryTimeout: number;
  private readonly maxRetriesPerWebhook: number;

  /** Fixed limits to prevent resource exhaustion (not configurable) */
  private readonly maxRetryQueueSize = 10_000;
  private readonly maxConcurrentPerWebhook = 10;
  private readonly maxTotalConcurrent = 100;

  /** Auto-disable threshold: disable webhook after this many consecutive failures */
  private readonly autoDisableThreshold = 5;

  /* v8 ignore next 6 - false positive on constructor parameter properties */
  constructor(
    private readonly httpService: HttpService,
    private readonly templateService: WebhookTemplateService,
    private readonly storageService: WebhookStorageService,
    private readonly configService: ConfigService,
  ) {
    /* v8 ignore next 3 - config defaults */
    this.maxRetries = this.configService.get<number>('vsb.webhook.maxRetries') ?? 5;
    this.deliveryTimeout = this.configService.get<number>('vsb.webhook.deliveryTimeout') ?? 10000;
    this.maxRetriesPerWebhook = this.configService.get<number>('vsb.webhook.maxRetriesPerWebhook') ?? 100;
  }

  /**
   * Get content type from webhook template or default to application/json
   */
  private getContentType(webhook: Webhook): string {
    if (
      webhook.template &&
      typeof webhook.template === 'object' &&
      webhook.template.type === 'custom' &&
      webhook.template.contentType
    ) {
      return webhook.template.contentType;
    }
    return 'application/json';
  }

  /**
   * Build standard webhook request headers
   */
  private buildRequestHeaders(
    webhook: Webhook,
    eventType: string,
    deliveryId: string,
    timestamp: number,
    signature: string,
  ): Record<string, string> {
    return {
      'Content-Type': this.getContentType(webhook),
      'User-Agent': 'VaultSandbox-Webhook/1.0',
      'X-Vault-Signature': `sha256=${signature}`,
      'X-Vault-Event': eventType,
      'X-Vault-Delivery': deliveryId,
      'X-Vault-Timestamp': timestamp.toString(),
    };
  }

  /**
   * Deliver an event to a webhook endpoint
   */
  async deliver(webhook: Webhook, event: WebhookEvent): Promise<DeliveryResult> {
    // Check concurrent delivery limits
    if (!this.canDeliver(webhook.id)) {
      this.logger.warn(`Concurrent limit reached for webhook ${webhook.id}, queueing for retry`);
      this.scheduleRetry(webhook, event, 1);
      return { success: false, error: 'concurrent_limit', willRetry: true, nextAttempt: 1 };
    }

    return this.executeDelivery(webhook, event, 1);
  }

  /**
   * Execute the actual HTTP delivery
   * Stats are updated in the finally block to ensure exactly-once semantics
   */
  private async executeDelivery(webhook: Webhook, event: WebhookEvent, attempt: number): Promise<DeliveryResult> {
    this.incrementActiveDeliveries(webhook.id);
    const deliveryId = generateDeliveryId();
    const startTime = Date.now();

    // Track outcome for finally block - default to failure
    let outcome: 'success' | 'failure' = 'failure';
    let result: DeliveryResult;

    try {
      // Apply template transformation
      const payload = this.templateService.transform(event, webhook.template);

      // Generate signature
      const timestamp = Math.floor(Date.now() / 1000);
      const signaturePayload = `${timestamp}.${payload}`;
      const signature = this.generateSignature(signaturePayload, webhook.secret);

      // Make HTTP request
      const headers = this.buildRequestHeaders(webhook, event.type, deliveryId, timestamp, signature);
      const response = await firstValueFrom(
        this.httpService
          .post(webhook.url, payload, {
            headers,
            timeout: this.deliveryTimeout,
          })
          .pipe(
            timeout(this.deliveryTimeout),
            catchError((error: AxiosError) => {
              throw error;
            }),
          ),
      );

      const responseTimeMs = Date.now() - startTime;
      const responseBody = this.truncateResponse(response.data);

      // Mark success - stats will be updated in finally
      outcome = 'success';

      this.logger.log(`Webhook ${webhook.id} delivered successfully (${response.status}) in ${responseTimeMs}ms`);

      result = {
        success: true,
        statusCode: response.status,
        responseTimeMs,
        responseBody,
      };
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;
      const axiosError = error as AxiosError;

      // Extract error details
      const statusCode = axiosError.response?.status;
      /* v8 ignore next - axios errors always have message */
      const errorMessage = axiosError.message || 'Unknown error';
      const responseBody = this.truncateResponse(axiosError.response?.data);

      // Schedule retry if applicable (outcome stays 'failure')
      const willRetry = attempt < this.maxRetries;
      if (willRetry) {
        this.scheduleRetry(webhook, event, attempt + 1);
        /* v8 ignore next 3 - only logs after max retries exhausted */
      } else {
        this.logger.warn(`Webhook ${webhook.id} exhausted all ${this.maxRetries} retry attempts`);
      }

      this.logger.warn(
        `Webhook ${webhook.id} delivery failed (attempt ${attempt}/${this.maxRetries}): ${errorMessage}`,
      );

      result = {
        success: false,
        statusCode,
        responseTimeMs,
        responseBody,
        error: errorMessage,
        willRetry,
        /* v8 ignore next - ternary branch when willRetry is false */
        nextAttempt: willRetry ? attempt + 1 : undefined,
      };
    } finally {
      // Stats updated exactly once, regardless of how we exit
      const statsResult = this.storageService.incrementStats(webhook.id, outcome);
      this.decrementActiveDeliveries(webhook.id);

      // Auto-disable webhook after threshold consecutive failures
      if (statsResult && statsResult.consecutiveFailures >= this.autoDisableThreshold) {
        this.autoDisableWebhook(webhook.id, statsResult.consecutiveFailures);
      }
    }

    return result;
  }

  /**
   * Test a webhook with a sample payload (does not affect stats)
   */
  async testWebhook(webhook: Webhook): Promise<TestWebhookResult> {
    const testEvent: WebhookEvent = {
      id: 'evt_test_000000000000000000000000000000',
      object: 'event',
      createdAt: Math.floor(Date.now() / 1000),
      /* v8 ignore next - webhooks always have at least one event */
      type: webhook.events[0] || 'email.received',
      data: {
        id: 'msg_test_000000000000000000000000000000',
        inboxId: 'test_inbox_hash',
        inboxEmail: 'test@sandbox.example.com',
        from: { address: 'sender@example.com', name: 'Test Sender' },
        to: [{ address: 'test@sandbox.example.com', name: 'Test Inbox' }],
        subject: 'Test webhook delivery',
        snippet: 'This is a test webhook delivery to verify your endpoint is working correctly.',
        receivedAt: new Date().toISOString(),
        headers: { 'message-id': '<test@example.com>' },
        attachments: [],
      },
    };

    const payload = this.templateService.transform(testEvent, webhook.template);
    const timestamp = Math.floor(Date.now() / 1000);
    const signaturePayload = `${timestamp}.${payload}`;
    const signature = this.generateSignature(signaturePayload, webhook.secret);
    const testDeliveryId = 'dlv_test_000000000000000000000000000000';
    const startTime = Date.now();

    try {
      const headers = this.buildRequestHeaders(webhook, testEvent.type, testDeliveryId, timestamp, signature);
      const response = await firstValueFrom(
        this.httpService
          .post(webhook.url, payload, {
            headers,
            timeout: this.deliveryTimeout,
          })
          .pipe(timeout(this.deliveryTimeout)),
      );

      return {
        success: true,
        statusCode: response.status,
        responseTime: Date.now() - startTime,
        responseBody: this.truncateResponse(response.data),
        payloadSent: JSON.parse(payload),
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      return {
        success: false,
        statusCode: axiosError.response?.status,
        responseTime: Date.now() - startTime,
        responseBody: this.truncateResponse(axiosError.response?.data),
        /* v8 ignore next - axios errors always have message */
        error: axiosError.message || 'Unknown error',
        payloadSent: JSON.parse(payload),
      };
    }
  }

  /**
   * Process the retry queue (runs every 30 seconds)
   * Uses Promise.allSettled to properly await all deliveries
   */
  /* v8 ignore next 2 - Cron decorator and method signature */
  @Cron('*/30 * * * * *')
  async processRetryQueue(): Promise<void> {
    const now = new Date();
    const toProcess: RetryEntry[] = [];

    // Find retries that are ready
    for (const [deliveryId, entry] of this.retryQueue.entries()) {
      if (entry.scheduledAt <= now) {
        toProcess.push(entry);
        this.retryQueue.delete(deliveryId);
        // Decrement per-webhook count when entry is removed from queue
        this.decrementWebhookRetryCount(entry.webhook.id);
      }
    }

    if (toProcess.length === 0) {
      return;
    }

    this.logger.log(`Processing ${toProcess.length} webhook retries`);

    // Process all retries and await completion
    const results = await Promise.allSettled(
      toProcess.map(async (entry) => {
        // Re-fetch webhook to check if still exists and enabled
        const webhook = this.storageService.getWebhook(entry.webhook.id);
        if (!webhook || !webhook.enabled) {
          this.logger.debug(`Skipping retry for deleted/disabled webhook ${entry.webhook.id}`);
          return { skipped: true, webhookId: entry.webhook.id };
        }

        if (!this.canDeliver(webhook.id)) {
          // Re-queue with same attempt number (scheduleRetry will increment count)
          this.scheduleRetry(webhook, entry.event, entry.attempt);
          return { requeued: true, webhookId: webhook.id };
        }

        return this.executeDelivery(webhook, entry.event, entry.attempt);
      }),
    );

    /* v8 ignore next 5 - defensive: executeDelivery has its own try-catch */
    // Log unexpected errors (executeDelivery has its own try-catch, so these should be rare)
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    for (const r of rejected) {
      this.logger.error(`Unexpected retry processing error: ${r.reason}`);
    }
  }

  /**
   * Cancel all pending retries for a webhook
   */
  cancelPendingRetries(webhookId: string): void {
    let cancelledCount = 0;
    for (const [deliveryId, entry] of this.retryQueue.entries()) {
      if (entry.webhook.id === webhookId) {
        this.retryQueue.delete(deliveryId);
        cancelledCount++;
      }
    }
    // Always clear the per-webhook retry count when webhook is deleted/disabled
    this.webhookRetryCount.delete(webhookId);
    if (cancelledCount > 0) {
      this.logger.debug(`Cancelled ${cancelledCount} pending retries for webhook ${webhookId}`);
    }
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Auto-disable a webhook after consecutive failures threshold is reached.
   * This prevents continuously retrying a webhook that's consistently failing.
   */
  private autoDisableWebhook(webhookId: string, consecutiveFailures: number): void {
    const updated = this.storageService.updateWebhook(webhookId, { enabled: false });
    if (updated) {
      this.cancelPendingRetries(webhookId);
      this.logger.warn(`Webhook ${webhookId} auto-disabled after ${consecutiveFailures} consecutive failures`);
    }
  }

  /**
   * Check if we can accept another delivery for this webhook
   */
  private canDeliver(webhookId: string): boolean {
    if (this.totalActiveDeliveries >= this.maxTotalConcurrent) {
      return false;
    }
    const webhookActive = this.activeDeliveries.get(webhookId) ?? 0;
    return webhookActive < this.maxConcurrentPerWebhook;
  }

  /**
   * Increment a counter in a map
   */
  private incrementMapCounter(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  /**
   * Decrement a counter in a map, removing the entry if it reaches zero
   */
  private decrementMapCounter(map: Map<string, number>, key: string): void {
    /* v8 ignore next - defensive fallback when key doesn't exist */
    const current = map.get(key) ?? 0;
    if (current <= 1) {
      map.delete(key);
    } else {
      map.set(key, current - 1);
    }
  }

  /**
   * Increment active delivery count
   */
  private incrementActiveDeliveries(webhookId: string): void {
    this.incrementMapCounter(this.activeDeliveries, webhookId);
    this.totalActiveDeliveries++;
  }

  /**
   * Decrement active delivery count
   */
  private decrementActiveDeliveries(webhookId: string): void {
    this.decrementMapCounter(this.activeDeliveries, webhookId);
    this.totalActiveDeliveries = Math.max(0, this.totalActiveDeliveries - 1);
  }

  /**
   * Decrement per-webhook retry count
   */
  private decrementWebhookRetryCount(webhookId: string): void {
    this.decrementMapCounter(this.webhookRetryCount, webhookId);
  }

  /**
   * Schedule a retry for failed delivery
   */
  private scheduleRetry(webhook: Webhook, event: WebhookEvent, attempt: number): void {
    // Check per-webhook retry limit
    const currentCount = this.webhookRetryCount.get(webhook.id) ?? 0;
    if (currentCount >= this.maxRetriesPerWebhook) {
      this.logger.warn(
        `Webhook ${webhook.id} has reached per-webhook retry limit (${this.maxRetriesPerWebhook}), skipping retry`,
      );
      return;
    }

    // Enforce retry queue memory limit
    if (this.retryQueue.size >= this.maxRetryQueueSize) {
      const oldestKey = this.retryQueue.keys().next().value as string | undefined;
      if (oldestKey) {
        const evictedEntry = this.retryQueue.get(oldestKey);
        this.retryQueue.delete(oldestKey);
        // Decrement count for evicted webhook
        if (evictedEntry) {
          this.decrementWebhookRetryCount(evictedEntry.webhook.id);
        }
        this.logger.warn(`Retry queue full, evicted oldest entry: ${oldestKey}`);
      }
    }

    const deliveryId = generateDeliveryId();
    const scheduledAt = this.calculateNextRetry(attempt);

    this.retryQueue.set(deliveryId, {
      webhook,
      event,
      attempt,
      scheduledAt,
    });
    this.incrementMapCounter(this.webhookRetryCount, webhook.id);

    this.logger.debug(
      `Scheduled retry ${attempt}/${this.maxRetries} for webhook ${webhook.id} at ${scheduledAt.toISOString()}`,
    );
  }

  /**
   * Calculate when the next retry should occur
   */
  private calculateNextRetry(attempt: number): Date {
    const delayIndex = Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1);
    const delayMs = RETRY_DELAYS_MS[delayIndex];
    return new Date(Date.now() + delayMs);
  }

  /**
   * Generate HMAC-SHA256 signature
   */
  private generateSignature(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Truncate response body for logging/storage (max 1KB)
   */
  private truncateResponse(data: unknown): string | undefined {
    if (data === undefined || data === null) {
      return undefined;
    }
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    if (str.length > 1024) {
      return str.substring(0, 1024) + '... (truncated)';
    }
    return str;
  }

  /**
   * Get retry queue size (for metrics/debugging)
   */
  getRetryQueueSize(): number {
    return this.retryQueue.size;
  }

  /**
   * Get active delivery counts (for metrics/debugging)
   */
  getActiveDeliveryCounts(): { total: number; perWebhook: Map<string, number> } {
    return {
      total: this.totalActiveDeliveries,
      perWebhook: new Map(this.activeDeliveries),
    };
  }
}
