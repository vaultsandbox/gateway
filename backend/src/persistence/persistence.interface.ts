/**
 * Persistence Module Interfaces
 *
 * Defines the data structures for persisted inbox and webhook data.
 * These interfaces represent the JSON schema stored on disk.
 *
 * IMPORTANT: Emails are NOT persisted - only inbox metadata and webhook configurations.
 */

import type { InboxChaosConfig } from '../chaos/interfaces/chaos-config.interface';
import type { WebhookEventType } from '../webhook/constants/webhook-events';
import type { WebhookFilterConfig } from '../webhook/interfaces/webhook-filter.interface';
import type { WebhookTemplate } from '../webhook/interfaces/webhook.interface';

/**
 * Persisted inbox metadata.
 * Stored in: {persistencePath}/inboxes/{inboxHash}/inbox.json
 *
 * Note: Emails are NOT persisted - only metadata needed to restore the inbox.
 */
export interface PersistedInbox {
  /** Schema version for future migrations */
  version: number;

  /** Full email address (e.g., "abc123@example.com") */
  emailAddress: string;

  /** Base64URL hash of the inbox for identification */
  inboxHash: string;

  /** Client ML-KEM public key for encrypted inboxes (Base64URL) */
  clientKemPk?: string;

  /** Whether this inbox uses encryption */
  encrypted: boolean;

  /** Whether email authentication is enabled */
  emailAuth: boolean;

  /** Whether spam analysis is enabled */
  spamAnalysis?: boolean;

  /** Chaos engineering configuration */
  chaos?: InboxChaosConfig;

  /** ISO 8601 timestamp when inbox was created */
  createdAt: string;

  /** ISO 8601 timestamp when inbox expires, or null for never */
  expiresAt: string | null;
}

/**
 * Persisted inbox webhook data.
 * Stored in: {persistencePath}/inboxes/{inboxHash}/webhooks/whk_{id}.json
 *
 * Note: Delivery stats are NOT persisted - they reset on restart.
 */
export interface PersistedInboxWebhook {
  /** Schema version for future migrations */
  version: number;

  /** Webhook ID with "whk_" prefix */
  id: string;

  /** Target URL for webhook delivery */
  url: string;

  /** List of events this webhook subscribes to */
  events: WebhookEventType[];

  /** Webhook scope - always 'inbox' for inbox webhooks */
  scope: 'inbox';

  /** The inbox hash this webhook belongs to */
  inboxHash: string;

  /** The original email address of the inbox */
  inboxEmail: string;

  /** Whether the webhook is enabled */
  enabled: boolean;

  /** HMAC signing secret */
  secret: string;

  /** Previous secret for rotation grace period */
  previousSecret?: string;

  /** ISO 8601 timestamp when previous secret expires */
  previousSecretExpiresAt?: string;

  /** Optional payload template */
  template?: WebhookTemplate;

  /** Optional filter configuration */
  filter?: WebhookFilterConfig;

  /** Human-readable description */
  description?: string;

  /** ISO 8601 timestamp when webhook was created */
  createdAt: string;

  /** ISO 8601 timestamp when webhook was last updated */
  updatedAt?: string;
}

/**
 * Persisted global webhook data.
 * Stored in: {persistencePath}/global-webhooks/whk_{id}.json
 *
 * Note: Delivery stats are NOT persisted - they reset on restart.
 */
export interface PersistedGlobalWebhook {
  /** Schema version for future migrations */
  version: number;

  /** Webhook ID with "whk_" prefix */
  id: string;

  /** Target URL for webhook delivery */
  url: string;

  /** List of events this webhook subscribes to */
  events: WebhookEventType[];

  /** Webhook scope - always 'global' for global webhooks */
  scope: 'global';

  /** Whether the webhook is enabled */
  enabled: boolean;

  /** HMAC signing secret */
  secret: string;

  /** Previous secret for rotation grace period */
  previousSecret?: string;

  /** ISO 8601 timestamp when previous secret expires */
  previousSecretExpiresAt?: string;

  /** Optional payload template */
  template?: WebhookTemplate;

  /** Optional filter configuration */
  filter?: WebhookFilterConfig;

  /** Human-readable description */
  description?: string;

  /** ISO 8601 timestamp when webhook was created */
  createdAt: string;

  /** ISO 8601 timestamp when webhook was last updated */
  updatedAt?: string;
}

/**
 * Union type for persisted webhooks.
 * Use the 'scope' field to discriminate between inbox and global webhooks.
 */
export type PersistedWebhook = PersistedInboxWebhook | PersistedGlobalWebhook;

/**
 * Type guard to check if a persisted webhook is a global webhook
 */
export function isPersistedGlobalWebhook(webhook: PersistedWebhook): webhook is PersistedGlobalWebhook {
  return webhook.scope === 'global';
}

/**
 * Type guard to check if a persisted webhook is an inbox webhook
 */
export function isPersistedInboxWebhook(webhook: PersistedWebhook): webhook is PersistedInboxWebhook {
  return webhook.scope === 'inbox';
}

import type { PersistencePolicy } from '../config/config.constants';

/**
 * Persistence configuration interface
 */
export interface PersistenceConfig {
  /** Persistence policy (enabled, disabled, always, never) */
  policy: PersistencePolicy;

  /** Base path for persistent storage */
  path: string;

  /** Whether global webhooks should be persisted */
  persistentGlobalWebhooks: boolean;
}
