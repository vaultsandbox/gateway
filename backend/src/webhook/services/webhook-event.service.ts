import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { WebhookStorageService } from '../storage/webhook-storage.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookFilterService } from './webhook-filter.service';
import { WEBHOOK_EVENTS, WebhookEventType } from '../constants/webhook-events';
import {
  WebhookEvent,
  EmailReceivedData,
  EmailStoredData,
  EmailDeletedData,
  EmailAddress,
  AttachmentMeta,
  EmailAuthResults,
} from '../interfaces/webhook-event.interface';
import { generateEventId } from '../utils/id-generator';

/**
 * Payload structure for email.received internal event
 */
interface EmailReceivedPayload {
  email: {
    id: string;
    from: { address: string; name?: string } | string;
    to: Array<{ address: string; name?: string } | string>;
    cc?: Array<{ address: string; name?: string } | string>;
    subject: string;
    text?: string;
    html?: string;
    headers?: Record<string, string>;
    attachments?: Array<{
      filename?: string;
      contentType?: string;
      size?: number;
      contentId?: string;
    }>;
    receivedAt?: Date;
    auth?: {
      spf?: string;
      dkim?: string;
      dmarc?: string;
    };
  };
  inboxHash: string;
  inboxEmail: string;
}

/**
 * Payload structure for email.stored internal event
 */
interface EmailStoredPayload {
  emailId: string;
  inboxHash: string;
  inboxEmail: string;
}

/**
 * Payload structure for email.deleted internal event
 */
interface EmailDeletedPayload {
  emailId: string;
  inboxHash: string;
  inboxEmail: string;
  reason: 'manual' | 'ttl' | 'eviction';
}

/**
 * Service responsible for receiving internal events and dispatching them
 * to matching webhooks. Uses NestJS EventEmitter2 for loose coupling
 * with other services.
 */
@Injectable()
export class WebhookEventService {
  private readonly logger = new Logger(WebhookEventService.name);
  private readonly webhooksEnabled: boolean;
  private readonly maxHeaders: number;
  private readonly maxHeaderValueLen: number;

  /* v8 ignore next 6 - false positive on constructor parameter properties */
  constructor(
    private readonly storageService: WebhookStorageService,
    private readonly deliveryService: WebhookDeliveryService,
    private readonly filterService: WebhookFilterService,
    private readonly configService: ConfigService,
  ) {
    this.webhooksEnabled = this.configService.get<boolean>('vsb.webhook.enabled') ?? true;
    this.maxHeaders = this.configService.get<number>('vsb.webhook.maxHeaders') ?? 50;
    this.maxHeaderValueLen = this.configService.get<number>('vsb.webhook.maxHeaderValueLen') ?? 1000;
  }

  // ============================================
  // Event Listeners
  // ============================================

  /**
   * Handle email.received event
   */
  @OnEvent('email.received')
  handleEmailReceived(payload: EmailReceivedPayload): void {
    if (!this.webhooksEnabled) return;

    const data = this.mapEmailReceivedData(payload);
    this.dispatch(WEBHOOK_EVENTS.EMAIL_RECEIVED, data, payload.inboxHash);
  }

  /**
   * Handle email.stored event
   */
  @OnEvent('email.stored')
  handleEmailStored(payload: EmailStoredPayload): void {
    if (!this.webhooksEnabled) return;

    const data: EmailStoredData = {
      id: payload.emailId,
      inboxId: payload.inboxHash,
      inboxEmail: payload.inboxEmail,
      storedAt: new Date().toISOString(),
    };
    this.dispatch(WEBHOOK_EVENTS.EMAIL_STORED, data, payload.inboxHash);
  }

  /**
   * Handle email.deleted event
   */
  @OnEvent('email.deleted')
  handleEmailDeleted(payload: EmailDeletedPayload): void {
    if (!this.webhooksEnabled) return;

    const data: EmailDeletedData = {
      id: payload.emailId,
      inboxId: payload.inboxHash,
      inboxEmail: payload.inboxEmail,
      reason: payload.reason,
      deletedAt: new Date().toISOString(),
    };
    this.dispatch(WEBHOOK_EVENTS.EMAIL_DELETED, data, payload.inboxHash);
  }

  // ============================================
  // Event Dispatching
  // ============================================

  /**
   * Dispatch an event to all matching webhooks
   */
  private dispatch<T>(eventType: WebhookEventType, data: T, inboxHash?: string): void {
    // Find all webhooks that should receive this event
    const webhooks = this.storageService.getWebhooksForEvent(eventType, inboxHash);

    if (webhooks.length === 0) {
      this.logger.debug(`No webhooks subscribed to ${eventType}`);
      return;
    }

    // Build the event envelope
    const event: WebhookEvent<T> = {
      id: generateEventId(),
      object: 'event',
      createdAt: Math.floor(Date.now() / 1000),
      type: eventType,
      data,
    };

    // Filter webhooks based on their filter configuration
    const matchingWebhooks = webhooks.filter((webhook) => {
      if (!webhook.filter) {
        return true; // No filter = match all
      }

      const matches = this.filterService.matches(event, webhook.filter);
      if (!matches) {
        this.logger.debug(`Event ${event.id} filtered out for webhook ${webhook.id}`);
      }
      return matches;
    });

    if (matchingWebhooks.length === 0) {
      this.logger.debug(`No webhooks matched filters for ${eventType}`);
      return;
    }

    this.logger.log(
      `Dispatching ${eventType} to ${matchingWebhooks.length} webhook(s) (${webhooks.length - matchingWebhooks.length} filtered out)`,
    );

    // Deliver to each matching webhook asynchronously
    for (const webhook of matchingWebhooks) {
      this.deliveryService.deliver(webhook, event).catch((error: Error) => {
        this.logger.error(`Failed to deliver ${eventType} to webhook ${webhook.id}: ${error.message}`);
      });
    }
  }

  // ============================================
  // Data Mapping Helpers
  // ============================================

  /**
   * Map internal email data to webhook payload format
   */
  private mapEmailReceivedData(payload: EmailReceivedPayload): EmailReceivedData {
    const email = payload.email;

    return {
      id: email.id,
      inboxId: payload.inboxHash,
      inboxEmail: payload.inboxEmail,
      from: this.normalizeEmailAddress(email.from),
      to: this.normalizeEmailAddresses(email.to),
      cc: email.cc ? this.normalizeEmailAddresses(email.cc) : undefined,
      subject: email.subject || '(no subject)',
      snippet: this.createSnippet(email.text),
      textBody: email.text,
      htmlBody: email.html,
      headers: this.normalizeHeaders(email.headers),
      attachments: this.normalizeAttachments(email.attachments),
      auth: email.auth
        ? {
            spf: email.auth.spf as EmailAuthResults['spf'],
            dkim: email.auth.dkim as EmailAuthResults['dkim'],
            dmarc: email.auth.dmarc as EmailAuthResults['dmarc'],
          }
        : undefined,
      receivedAt: (email.receivedAt ?? new Date()).toISOString(),
    };
  }

  /**
   * Normalize email address to standard format
   */
  private normalizeEmailAddress(addr: { address: string; name?: string } | string): EmailAddress {
    if (typeof addr === 'string') {
      return { address: addr };
    }
    return {
      address: addr.address,
      name: addr.name || undefined,
    };
  }

  /**
   * Normalize array of email addresses
   */
  private normalizeEmailAddresses(addrs: Array<{ address: string; name?: string } | string>): EmailAddress[] {
    return addrs.map((addr) => this.normalizeEmailAddress(addr));
  }

  /**
   * Create a snippet from text (first 200 characters)
   */
  private createSnippet(text?: string): string {
    if (!text) return '';
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 200) return normalized;
    return normalized.substring(0, 197) + '...';
  }

  /**
   * Normalize headers to simple key-value format.
   * Includes all headers with safety caps on count and value length.
   */
  private normalizeHeaders(headers?: Record<string, string>): Record<string, string> {
    if (!headers) return {};

    const result: Record<string, string> = {};
    let count = 0;

    for (const [key, value] of Object.entries(headers)) {
      if (count >= this.maxHeaders) break;

      const lowerKey = key.toLowerCase();
      const stringValue = String(value ?? '');
      const truncatedValue =
        stringValue.length > this.maxHeaderValueLen ? stringValue.substring(0, this.maxHeaderValueLen) : stringValue;

      result[lowerKey] = truncatedValue;
      count++;
    }
    return result;
  }

  /**
   * Normalize attachments to metadata-only format
   */
  private normalizeAttachments(
    attachments?: Array<{
      filename?: string;
      contentType?: string;
      size?: number;
      contentId?: string;
    }>,
  ): AttachmentMeta[] {
    if (!attachments) return [];

    return attachments.map((att) => ({
      filename: att.filename || 'unnamed',
      contentType: att.contentType || 'application/octet-stream',
      size: att.size || 0,
      contentId: att.contentId,
    }));
  }
}
