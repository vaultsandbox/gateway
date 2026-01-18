import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Webhook, WebhookStorageMetrics, IWebhookStorageService } from '../interfaces/webhook.interface';
import { WebhookEventType } from '../constants/webhook-events';
import { InboxStorageService } from '../../inbox/storage/inbox-storage.service';

/**
 * In-memory storage service for webhooks.
 * Maintains separate storage for global webhooks and inbox-scoped webhooks.
 */
@Injectable()
export class WebhookStorageService implements OnModuleInit, IWebhookStorageService {
  private readonly logger = new Logger(WebhookStorageService.name);

  /** Global webhooks (not scoped to any inbox): webhookId -> Webhook */
  private globalWebhooks = new Map<string, Webhook>();

  /** Inbox-scoped webhooks: inboxHash -> (webhookId -> Webhook) */
  private inboxWebhooks = new Map<string, Map<string, Webhook>>();

  /** Reverse lookup: webhookId -> inboxHash (for inbox webhooks only) */
  private webhookToInbox = new Map<string, string>();

  /* v8 ignore next 3 - false positive on constructor parameter properties */
  constructor(@Optional() private readonly inboxStorageService?: InboxStorageService) {}

  /**
   * Register with InboxStorageService for deletion notifications
   */
  onModuleInit(): void {
    if (this.inboxStorageService) {
      this.inboxStorageService.setWebhookStorageService(this);
      this.logger.log('Registered with InboxStorageService for deletion notifications');
    }
  }

  // ============================================
  // Global Webhook Operations
  // ============================================

  /**
   * Store a new global webhook
   */
  createGlobalWebhook(webhook: Webhook): Webhook {
    this.globalWebhooks.set(webhook.id, webhook);
    this.logger.log(`Created global webhook ${webhook.id}`);
    return webhook;
  }

  /**
   * Get a global webhook by ID
   */
  getGlobalWebhook(id: string): Webhook | undefined {
    return this.globalWebhooks.get(id);
  }

  /**
   * List all global webhooks
   */
  listGlobalWebhooks(): Webhook[] {
    return Array.from(this.globalWebhooks.values());
  }

  /**
   * Get count of global webhooks
   */
  getGlobalWebhookCount(): number {
    return this.globalWebhooks.size;
  }

  // ============================================
  // Inbox Webhook Operations
  // ============================================

  /**
   * Store a new inbox webhook
   */
  createInboxWebhook(inboxHash: string, webhook: Webhook): Webhook {
    let inboxMap = this.inboxWebhooks.get(inboxHash);
    if (!inboxMap) {
      inboxMap = new Map();
      this.inboxWebhooks.set(inboxHash, inboxMap);
    }
    inboxMap.set(webhook.id, webhook);
    this.webhookToInbox.set(webhook.id, inboxHash);
    this.logger.log(`Created inbox webhook ${webhook.id} for inbox ${inboxHash}`);
    return webhook;
  }

  /**
   * Get an inbox webhook by ID
   */
  getInboxWebhook(inboxHash: string, id: string): Webhook | undefined {
    const inboxMap = this.inboxWebhooks.get(inboxHash);
    return inboxMap?.get(id);
  }

  /**
   * List all webhooks for an inbox
   */
  listInboxWebhooks(inboxHash: string): Webhook[] {
    const inboxMap = this.inboxWebhooks.get(inboxHash);
    return inboxMap ? Array.from(inboxMap.values()) : [];
  }

  /**
   * Get count of webhooks for an inbox
   */
  getInboxWebhookCount(inboxHash: string): number {
    const inboxMap = this.inboxWebhooks.get(inboxHash);
    return inboxMap?.size ?? 0;
  }

  /**
   * Get total count of inbox webhooks across all inboxes
   */
  getTotalInboxWebhookCount(): number {
    let total = 0;
    for (const inboxMap of this.inboxWebhooks.values()) {
      total += inboxMap.size;
    }
    return total;
  }

  // ============================================
  // Generic Operations (work with both types)
  // ============================================

  /**
   * Get any webhook by ID (global or inbox)
   */
  getWebhook(id: string): Webhook | undefined {
    // First try global
    const globalWebhook = this.globalWebhooks.get(id);
    if (globalWebhook) {
      return globalWebhook;
    }

    // Then try inbox webhooks
    const inboxHash = this.webhookToInbox.get(id);
    if (inboxHash) {
      return this.inboxWebhooks.get(inboxHash)?.get(id);
    }

    return undefined;
  }

  /**
   * Helper: Look up inbox webhook by ID using reverse lookup map.
   */
  private lookupInboxWebhook(webhookId: string): Webhook | undefined {
    const inboxHash = this.webhookToInbox.get(webhookId);
    if (!inboxHash) return undefined;
    return this.inboxWebhooks.get(inboxHash)?.get(webhookId);
  }

  /**
   * Atomically increment webhook stats by directly mutating the stored object.
   * This avoids race conditions from read-modify-write patterns.
   *
   * @param webhookId - Webhook to update
   * @param outcome - 'success' or 'failure' (totalDeliveries always incremented)
   * @returns Object with consecutiveFailures count, or undefined if webhook not found
   */
  incrementStats(webhookId: string, outcome: 'success' | 'failure'): { consecutiveFailures: number } | undefined {
    const webhook = this.globalWebhooks.get(webhookId) || this.lookupInboxWebhook(webhookId);
    if (!webhook) return undefined;

    // Direct mutation of the stored object - no race window
    webhook.stats.totalDeliveries++;
    webhook.stats.lastDeliveryAt = new Date();

    if (outcome === 'success') {
      webhook.stats.successfulDeliveries++;
      webhook.stats.consecutiveFailures = 0;
      webhook.stats.lastDeliveryStatus = 'success';
    } else {
      webhook.stats.failedDeliveries++;
      webhook.stats.consecutiveFailures++;
      webhook.stats.lastDeliveryStatus = 'failed';
    }

    return { consecutiveFailures: webhook.stats.consecutiveFailures };
  }

  /**
   * Update a webhook (preserves location - global or inbox)
   */
  updateWebhook(id: string, updates: Partial<Webhook>): Webhook | undefined {
    const webhook = this.getWebhook(id);
    if (!webhook) return undefined;

    const updated = { ...webhook, ...updates, updatedAt: new Date() };

    // Check source of truth for location rather than webhook.scope
    if (this.globalWebhooks.has(id)) {
      this.globalWebhooks.set(id, updated);
      this.logger.log(`Updated global webhook ${id}`);
    } else {
      const inboxHash = this.webhookToInbox.get(id);
      this.inboxWebhooks.get(inboxHash!)!.set(id, updated);
      this.logger.log(`Updated inbox webhook ${id}`);
    }

    return updated;
  }

  /**
   * Delete a webhook (global or inbox)
   */
  deleteWebhook(id: string): boolean {
    // Try global first
    if (this.globalWebhooks.has(id)) {
      this.globalWebhooks.delete(id);
      this.logger.log(`Deleted global webhook ${id}`);
      return true;
    }

    // Try inbox webhooks
    const inboxHash = this.webhookToInbox.get(id);
    if (inboxHash) {
      const inboxMap = this.inboxWebhooks.get(inboxHash);
      if (inboxMap?.has(id)) {
        inboxMap.delete(id);
        this.webhookToInbox.delete(id);
        // Clean up empty inbox map
        if (inboxMap.size === 0) {
          this.inboxWebhooks.delete(inboxHash);
        }
        this.logger.log(`Deleted inbox webhook ${id}`);
        return true;
      }
    }

    return false;
  }

  // ============================================
  // Event Matching
  // ============================================

  /**
   * Get all webhooks that should receive a specific event.
   * Returns both global webhooks subscribed to the event and
   * inbox webhooks for the specific inbox (if provided).
   */
  getWebhooksForEvent(event: WebhookEventType, inboxHash?: string): Webhook[] {
    const result: Webhook[] = [];

    // Add matching global webhooks
    for (const webhook of this.globalWebhooks.values()) {
      if (webhook.enabled && webhook.events.includes(event)) {
        result.push(webhook);
      }
    }

    // Add matching inbox webhooks (if inbox specified)
    if (inboxHash) {
      const inboxMap = this.inboxWebhooks.get(inboxHash);
      if (inboxMap) {
        for (const webhook of inboxMap.values()) {
          if (webhook.enabled && webhook.events.includes(event)) {
            result.push(webhook);
          }
        }
      }
    }

    return result;
  }

  // ============================================
  // Cascading Delete (called from InboxStorageService)
  // ============================================

  /**
   * Called when an inbox is deleted - removes all webhooks for that inbox.
   * Implements IWebhookStorageService interface.
   */
  onInboxDeleted(inboxHash: string): void {
    const inboxMap = this.inboxWebhooks.get(inboxHash);
    if (inboxMap) {
      const webhookCount = inboxMap.size;

      // Remove reverse lookup entries
      for (const webhookId of inboxMap.keys()) {
        this.webhookToInbox.delete(webhookId);
      }

      // Delete all webhooks for this inbox
      this.inboxWebhooks.delete(inboxHash);
      this.logger.log(`Deleted ${webhookCount} webhooks for deleted inbox ${inboxHash}`);
    }
  }

  // ============================================
  // Metrics
  // ============================================

  /**
   * Get storage metrics
   */
  getMetrics(): WebhookStorageMetrics {
    return {
      globalWebhookCount: this.globalWebhooks.size,
      inboxWebhookCount: this.getTotalInboxWebhookCount(),
      totalWebhookCount: this.globalWebhooks.size + this.getTotalInboxWebhookCount(),
      inboxesWithWebhooks: this.inboxWebhooks.size,
    };
  }

  /**
   * Get aggregated metrics across all webhooks.
   * Iterates all webhooks to compute totals - use sparingly.
   */
  getAggregatedMetrics(): {
    enabledCount: number;
    totalDeliveries: number;
    successfulDeliveries: number;
    failedDeliveries: number;
  } {
    let enabledCount = 0;
    let totalDeliveries = 0;
    let successfulDeliveries = 0;
    let failedDeliveries = 0;

    // Aggregate global webhooks
    for (const webhook of this.globalWebhooks.values()) {
      if (webhook.enabled) enabledCount++;
      totalDeliveries += webhook.stats.totalDeliveries;
      successfulDeliveries += webhook.stats.successfulDeliveries;
      failedDeliveries += webhook.stats.failedDeliveries;
    }

    // Aggregate inbox webhooks
    for (const inboxMap of this.inboxWebhooks.values()) {
      for (const webhook of inboxMap.values()) {
        if (webhook.enabled) enabledCount++;
        totalDeliveries += webhook.stats.totalDeliveries;
        successfulDeliveries += webhook.stats.successfulDeliveries;
        failedDeliveries += webhook.stats.failedDeliveries;
      }
    }

    return { enabledCount, totalDeliveries, successfulDeliveries, failedDeliveries };
  }

  /**
   * Clear all webhooks (useful for testing)
   */
  clearAll(): void {
    const globalCount = this.globalWebhooks.size;
    const inboxCount = this.getTotalInboxWebhookCount();

    this.globalWebhooks.clear();
    this.inboxWebhooks.clear();
    this.webhookToInbox.clear();

    this.logger.log(`Cleared all webhooks: ${globalCount} global, ${inboxCount} inbox`);
  }
}
