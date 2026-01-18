import { WebhookEventType } from '../constants/webhook-events';
import { WebhookFilterConfig } from './webhook-filter.interface';

/**
 * Webhook scope determines the event source
 */
export type WebhookScope = 'global' | 'inbox';

/**
 * Built-in template names
 */
export type BuiltInTemplate = 'slack' | 'discord' | 'teams' | 'simple' | 'notification' | 'zapier' | 'default';

/**
 * Custom template configuration
 */
export interface CustomTemplate {
  /** Custom template type marker */
  type: 'custom';

  /** JSON template string with {{variable}} placeholders */
  body: string;

  /** Optional content type override */
  contentType?: string;
}

/**
 * Webhook template configuration
 */
export type WebhookTemplate = BuiltInTemplate | CustomTemplate;

/**
 * Webhook delivery statistics
 */
export interface WebhookStats {
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  lastDeliveryAt?: Date;
  lastDeliveryStatus?: 'success' | 'failed';
  consecutiveFailures: number;
}

/**
 * Core webhook entity stored in memory
 */
export interface Webhook {
  /** Unique identifier with "whk_" prefix */
  id: string;

  /** Target URL for webhook delivery */
  url: string;

  /** List of events this webhook subscribes to */
  events: WebhookEventType[];

  /** Webhook scope - global or inbox-specific */
  scope: WebhookScope;

  /** For inbox webhooks, the inbox hash */
  inboxHash?: string;

  /** For inbox webhooks, the original email address */
  inboxEmail?: string;

  /** Whether the webhook is currently enabled */
  enabled: boolean;

  /** HMAC signing secret with "whsec_" prefix */
  secret: string;

  /** Previous secret (for rotation grace period) */
  previousSecret?: string;

  /** When the previous secret expires */
  previousSecretExpiresAt?: Date;

  /** Optional payload template */
  template?: WebhookTemplate;

  /** Optional filter configuration for smart filtering */
  filter?: WebhookFilterConfig;

  /** Human-readable description */
  description?: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt?: Date;

  /** Delivery statistics */
  stats: WebhookStats;
}

/**
 * Webhook storage metrics
 */
export interface WebhookStorageMetrics {
  globalWebhookCount: number;
  inboxWebhookCount: number;
  totalWebhookCount: number;
  inboxesWithWebhooks: number;
}

/**
 * Interface for services that need to be notified when an inbox is deleted.
 * Used to avoid circular dependencies between InboxStorageService and WebhookStorageService.
 */
export interface IWebhookStorageService {
  /**
   * Called when an inbox is deleted - should clean up all webhooks for that inbox.
   * @param inboxHash - The hash of the deleted inbox
   */
  onInboxDeleted(inboxHash: string): void;
}
