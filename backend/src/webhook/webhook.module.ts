/* v8 ignore start - NestJS module definition */
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './services/webhook.service';
import { WebhookEventService } from './services/webhook-event.service';
import { WebhookDeliveryService } from './services/webhook-delivery.service';
import { WebhookTemplateService } from './services/webhook-template.service';
import { WebhookFilterService } from './services/webhook-filter.service';
import { WebhookStorageService } from './storage/webhook-storage.service';
import { InboxModule } from '../inbox/inbox.module';

/**
 * Module for webhook management and event delivery.
 *
 * Features:
 * - Global webhooks (receive events from all inboxes)
 * - Inbox webhooks (scoped to specific inboxes)
 * - HMAC-SHA256 signature verification
 * - Exponential backoff retry logic
 * - Template-based payload transformation (Slack, Discord, Teams)
 * - Smart filtering (subject, from/to address, headers, body content)
 *
 * Dependencies:
 * - HttpModule: For HTTP delivery to webhook endpoints
 * - InboxModule: For inbox validation and cascading deletes
 * - ScheduleModule: For retry queue processing (provided globally)
 * - EventEmitterModule: For event subscription (provided globally)
 */
@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 3,
    }),
    InboxModule,
  ],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    WebhookEventService,
    WebhookDeliveryService,
    WebhookTemplateService,
    WebhookFilterService,
    WebhookStorageService,
  ],
  exports: [WebhookService, WebhookEventService, WebhookStorageService],
})
export class WebhookModule {}
/* v8 ignore stop */
