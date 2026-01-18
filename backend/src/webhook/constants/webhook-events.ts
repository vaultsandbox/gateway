/**
 * All supported webhook event types
 */
export const WEBHOOK_EVENTS = {
  // Email lifecycle events
  EMAIL_RECEIVED: 'email.received',
  EMAIL_STORED: 'email.stored',
  EMAIL_DELETED: 'email.deleted',
} as const;

/**
 * Webhook event type (union of all event string values)
 */
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[keyof typeof WEBHOOK_EVENTS];

/**
 * Array of all webhook event types for validation
 */
export const ALL_WEBHOOK_EVENTS: WebhookEventType[] = Object.values(WEBHOOK_EVENTS);

/**
 * Check if a string is a valid webhook event type
 */
export function isValidWebhookEvent(event: string): event is WebhookEventType {
  return ALL_WEBHOOK_EVENTS.includes(event as WebhookEventType);
}

/**
 * Email-related events (those that have inbox context)
 */
export const EMAIL_EVENTS: WebhookEventType[] = [
  WEBHOOK_EVENTS.EMAIL_RECEIVED,
  WEBHOOK_EVENTS.EMAIL_STORED,
  WEBHOOK_EVENTS.EMAIL_DELETED,
];

/**
 * Check if an event is email-related (has inbox context)
 */
export function isEmailEvent(event: WebhookEventType): boolean {
  return EMAIL_EVENTS.includes(event);
}
