import { randomBytes, randomUUID } from 'crypto';

/**
 * Generate a unique webhook ID with "whk_" prefix
 */
export function generateWebhookId(): string {
  return `whk_${randomUUID().replace(/-/g, '')}`;
}

/**
 * Generate a cryptographically secure webhook signing secret with "whsec_" prefix
 * The secret is 64 hex characters (32 bytes of entropy)
 */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('hex')}`;
}

/**
 * Generate a unique event ID with "evt_" prefix
 */
export function generateEventId(): string {
  return `evt_${randomUUID().replace(/-/g, '')}`;
}

/**
 * Generate a unique delivery ID with "dlv_" prefix
 */
export function generateDeliveryId(): string {
  return `dlv_${randomUUID().replace(/-/g, '')}`;
}
