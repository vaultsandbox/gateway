import { WebhookEventType } from '../constants/webhook-events';

/**
 * Standard event envelope wrapping all webhook payloads
 */
export interface WebhookEvent<T = unknown> {
  /** Unique event ID with "evt_" prefix */
  id: string;

  /** Object type, always "event" */
  object: 'event';

  /** Unix timestamp of event creation */
  createdAt: number;

  /** Event type */
  type: WebhookEventType;

  /** Event-specific data */
  data: T;
}

/**
 * Email address with optional display name
 */
export interface EmailAddress {
  address: string;
  name?: string;
}

/**
 * Attachment metadata (content not included)
 */
export interface AttachmentMeta {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
}

/**
 * Email authentication results
 */
export interface EmailAuthResults {
  spf?: 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror';
  dkim?: 'pass' | 'fail' | 'none';
  dmarc?: 'pass' | 'fail' | 'none';
}

/**
 * Payload for email.received event
 */
export interface EmailReceivedData {
  /** Email ID with "msg_" prefix */
  id: string;

  /** Inbox hash */
  inboxId: string;

  /** Inbox email address */
  inboxEmail: string;

  /** Sender information */
  from: EmailAddress;

  /** Recipients (To) */
  to: EmailAddress[];

  /** CC recipients */
  cc?: EmailAddress[];

  /** Email subject */
  subject: string;

  /** First 200 characters of text body */
  snippet: string;

  /** Full text body (optional, user configurable) */
  textBody?: string;

  /** Full HTML body (optional, user configurable) */
  htmlBody?: string;

  /** Selected headers */
  headers: Record<string, string>;

  /** Attachment metadata */
  attachments: AttachmentMeta[];

  /** Email authentication results */
  auth?: EmailAuthResults;

  /** Received timestamp */
  receivedAt: string;
}

/**
 * Payload for email.stored event
 */
export interface EmailStoredData {
  /** Email ID */
  id: string;

  /** Inbox hash */
  inboxId: string;

  /** Inbox email address */
  inboxEmail: string;

  /** Storage timestamp */
  storedAt: string;
}

/**
 * Payload for email.deleted event
 */
export interface EmailDeletedData {
  /** Email ID */
  id: string;

  /** Inbox hash */
  inboxId: string;

  /** Inbox email address */
  inboxEmail: string;

  /** Deletion reason */
  reason: 'manual' | 'ttl' | 'eviction';

  /** Deletion timestamp */
  deletedAt: string;
}

/**
 * Template context available for substitution
 */
export interface TemplateContext {
  /** Event ID */
  id: string;

  /** Event type */
  type: WebhookEventType;

  /** Unix timestamp */
  createdAt: number;

  /** ISO timestamp */
  timestamp: string;

  /** Event data (varies by event type) */
  data: unknown;
}

/**
 * Validation result for templates
 */
export interface TemplateValidationResult {
  valid: boolean;
  errors: string[];
}
