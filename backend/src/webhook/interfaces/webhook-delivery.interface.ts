import { Webhook } from './webhook.interface';
import { WebhookEvent } from './webhook-event.interface';

/**
 * Delivery status for tracking webhook deliveries
 */
export type DeliveryStatus = 'pending' | 'in_progress' | 'success' | 'retrying' | 'failed';

/**
 * Represents a single webhook delivery attempt
 */
export interface WebhookDelivery {
  /** Unique delivery ID with "dlv_" prefix */
  id: string;

  /** Associated webhook ID */
  webhookId: string;

  /** Event being delivered */
  event: WebhookEvent;

  /** Current attempt number (1-based) */
  attempt: number;

  /** Maximum attempts allowed */
  maxAttempts: number;

  /** Delivery status */
  status: DeliveryStatus;

  /** HTTP response status code */
  responseStatusCode?: number;

  /** Response body (truncated to 1KB) */
  responseBody?: string;

  /** Response time in milliseconds */
  responseTimeMs?: number;

  /** Error message if failed */
  error?: string;

  /** When delivery was created */
  createdAt: Date;

  /** When next retry is scheduled */
  nextRetryAt?: Date;

  /** When delivery completed (success or final failure) */
  completedAt?: Date;
}

/**
 * Entry in the retry queue
 */
export interface RetryEntry {
  /** The webhook to deliver to */
  webhook: Webhook;

  /** The event to deliver */
  event: WebhookEvent;

  /** Current attempt number */
  attempt: number;

  /** When this retry is scheduled */
  scheduledAt: Date;
}

/**
 * Result of a delivery attempt
 */
export interface DeliveryResult {
  /** Whether the delivery succeeded */
  success: boolean;

  /** HTTP status code (if request was made) */
  statusCode?: number;

  /** Response time in milliseconds */
  responseTimeMs?: number;

  /** Response body (truncated) */
  responseBody?: string;

  /** Error message (if failed) */
  error?: string;

  /** Whether the delivery was queued for retry */
  willRetry?: boolean;

  /** Next retry attempt number */
  nextAttempt?: number;
}

/**
 * Test webhook result
 */
export interface TestWebhookResult {
  /** Whether the test succeeded */
  success: boolean;

  /** HTTP status code */
  statusCode?: number;

  /** Response time in milliseconds */
  responseTime?: number;

  /** Response body */
  responseBody?: string;

  /** Error message (if failed) */
  error?: string;

  /** Payload that was sent */
  payloadSent?: unknown;
}
