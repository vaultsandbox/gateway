import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Webhook, WebhookTemplate, WebhookStats } from '../interfaces/webhook.interface';
import { WebhookFilterConfig } from '../interfaces/webhook-filter.interface';
import { WebhookStorageService } from '../storage/webhook-storage.service';
import { WebhookTemplateService } from './webhook-template.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookFilterService } from './webhook-filter.service';
import { InboxStorageService } from '../../inbox/storage/inbox-storage.service';
import { CreateWebhookDto, CustomTemplateDto, FilterConfigDto } from '../dto/create-webhook.dto';
import { UpdateWebhookDto } from '../dto/update-webhook.dto';
import {
  WebhookResponse,
  WebhookListResponse,
  TestWebhookResponse,
  RotateSecretResponse,
  WebhookMetricsResponse,
  WebhookTemplatesResponse,
} from '../dto/webhook-response.dto';
import { ALL_WEBHOOK_EVENTS, isValidWebhookEvent } from '../constants/webhook-events';
import { generateWebhookId, generateWebhookSecret } from '../utils/id-generator';

/**
 * Service for webhook CRUD operations and management.
 * Handles validation, limits, and coordination with other services.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly maxGlobalWebhooks: number;
  private readonly maxInboxWebhooks: number;
  private readonly allowHttp: boolean;
  private readonly requireAuthDefault: boolean;

  /* v8 ignore next 8 - false positive on constructor parameter properties */
  constructor(
    private readonly storageService: WebhookStorageService,
    private readonly templateService: WebhookTemplateService,
    private readonly deliveryService: WebhookDeliveryService,
    private readonly filterService: WebhookFilterService,
    private readonly inboxStorageService: InboxStorageService,
    private readonly configService: ConfigService,
  ) {
    /* v8 ignore next 4 - config defaults */
    this.maxGlobalWebhooks = this.configService.get<number>('vsb.webhook.maxGlobalWebhooks') ?? 100;
    this.maxInboxWebhooks = this.configService.get<number>('vsb.webhook.maxInboxWebhooks') ?? 50;
    this.allowHttp = this.configService.get<boolean>('vsb.webhook.allowHttp') ?? false;
    this.requireAuthDefault = this.configService.get<boolean>('vsb.webhook.requireAuthDefault') ?? false;
  }

  // ============================================
  // Global Webhook Operations
  // ============================================

  /**
   * Create a new global webhook
   */
  createGlobalWebhook(dto: CreateWebhookDto): WebhookResponse {
    // Validate limits
    if (this.storageService.getGlobalWebhookCount() >= this.maxGlobalWebhooks) {
      throw new ConflictException(`Maximum global webhooks limit reached (${this.maxGlobalWebhooks})`);
    }

    // Validate and create
    const webhook = this.createWebhookEntity(dto, 'global');
    this.storageService.createGlobalWebhook(webhook);

    this.logger.log(`Created global webhook ${webhook.id}`);
    return this.toResponse(webhook, true);
  }

  /**
   * List all global webhooks
   */
  listGlobalWebhooks(): WebhookListResponse {
    const webhooks = this.storageService.listGlobalWebhooks();
    return {
      webhooks: webhooks.map((w) => this.toResponse(w, false)),
      total: webhooks.length,
    };
  }

  /**
   * Get a global webhook by ID
   */
  getGlobalWebhook(id: string): WebhookResponse {
    const webhook = this.getGlobalWebhookOrThrow(id);
    return this.toResponse(webhook, true);
  }

  /**
   * Update a global webhook
   */
  updateGlobalWebhook(id: string, dto: UpdateWebhookDto): WebhookResponse {
    this.getGlobalWebhookOrThrow(id);
    const updates = this.buildUpdates(dto);
    const updated = this.storageService.updateWebhook(id, updates);

    this.logger.log(`Updated global webhook ${id}`);
    return this.toResponse(updated!, true);
  }

  /**
   * Delete a global webhook
   */
  deleteGlobalWebhook(id: string): void {
    const existed = this.storageService.deleteWebhook(id);
    if (existed) {
      this.deliveryService.cancelPendingRetries(id);
      this.logger.log(`Deleted global webhook ${id}`);
    }
  }

  /**
   * Test a global webhook
   */
  async testGlobalWebhook(id: string): Promise<TestWebhookResponse> {
    const webhook = this.getGlobalWebhookOrThrow(id);
    return this.testWebhook(webhook);
  }

  /**
   * Rotate the secret for a global webhook
   */
  rotateGlobalWebhookSecret(id: string): RotateSecretResponse {
    const webhook = this.getGlobalWebhookOrThrow(id);
    return this.rotateSecret(webhook);
  }

  // ============================================
  // Inbox Webhook Operations
  // ============================================

  /**
   * Create a new inbox webhook
   */
  createInboxWebhook(email: string, dto: CreateWebhookDto): WebhookResponse {
    const inbox = this.getInboxOrThrow(email);

    // Validate limits
    if (this.storageService.getInboxWebhookCount(inbox.inboxHash) >= this.maxInboxWebhooks) {
      throw new ConflictException(`Maximum webhooks limit reached for inbox (${this.maxInboxWebhooks})`);
    }

    // Validate and create
    const webhook = this.createWebhookEntity(dto, 'inbox', inbox.inboxHash, email);
    this.storageService.createInboxWebhook(inbox.inboxHash, webhook);

    this.logger.log(`Created inbox webhook ${webhook.id} for ${email}`);
    return this.toResponse(webhook, true);
  }

  /**
   * List all webhooks for an inbox
   */
  listInboxWebhooks(email: string): WebhookListResponse {
    const inbox = this.getInboxOrThrow(email);
    const webhooks = this.storageService.listInboxWebhooks(inbox.inboxHash);
    return {
      webhooks: webhooks.map((w) => this.toResponse(w, false)),
      total: webhooks.length,
    };
  }

  /**
   * Get an inbox webhook by ID
   */
  getInboxWebhook(email: string, id: string): WebhookResponse {
    const inbox = this.getInboxOrThrow(email);
    const webhook = this.getInboxWebhookOrThrow(inbox.inboxHash, id);
    return this.toResponse(webhook, true);
  }

  /**
   * Update an inbox webhook
   */
  updateInboxWebhook(email: string, id: string, dto: UpdateWebhookDto): WebhookResponse {
    const inbox = this.getInboxOrThrow(email);
    this.getInboxWebhookOrThrow(inbox.inboxHash, id);

    const updates = this.buildUpdates(dto);
    const updated = this.storageService.updateWebhook(id, updates);

    this.logger.log(`Updated inbox webhook ${id}`);
    return this.toResponse(updated!, true);
  }

  /**
   * Delete an inbox webhook
   */
  deleteInboxWebhook(email: string, id: string): void {
    const inbox = this.inboxStorageService.getInbox(email);
    if (!inbox) {
      // Inbox doesn't exist, webhook is already gone
      return;
    }

    const existed = this.storageService.deleteWebhook(id);
    if (existed) {
      this.deliveryService.cancelPendingRetries(id);
      this.logger.log(`Deleted inbox webhook ${id}`);
    }
  }

  /**
   * Test an inbox webhook
   */
  async testInboxWebhook(email: string, id: string): Promise<TestWebhookResponse> {
    const inbox = this.getInboxOrThrow(email);
    const webhook = this.getInboxWebhookOrThrow(inbox.inboxHash, id);
    return this.testWebhook(webhook);
  }

  /**
   * Rotate the secret for an inbox webhook
   */
  rotateInboxWebhookSecret(email: string, id: string): RotateSecretResponse {
    const inbox = this.getInboxOrThrow(email);
    const webhook = this.getInboxWebhookOrThrow(inbox.inboxHash, id);
    return this.rotateSecret(webhook);
  }

  // ============================================
  // Metrics
  // ============================================

  /**
   * Get aggregated webhook metrics
   */
  getMetrics(): WebhookMetricsResponse {
    const storageMetrics = this.storageService.getMetrics();
    const aggregated = this.storageService.getAggregatedMetrics();

    return {
      webhooks: {
        global: storageMetrics.globalWebhookCount,
        inbox: storageMetrics.inboxWebhookCount,
        enabled: aggregated.enabledCount,
        total: storageMetrics.totalWebhookCount,
      },
      deliveries: {
        total: aggregated.totalDeliveries,
        successful: aggregated.successfulDeliveries,
        failed: aggregated.failedDeliveries,
      },
    };
  }

  /**
   * Get available webhook templates
   */
  getTemplates(): WebhookTemplatesResponse {
    return {
      templates: this.templateService.getBuiltInTemplateOptions(),
    };
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Get inbox or throw NotFoundException
   */
  private getInboxOrThrow(email: string) {
    const inbox = this.inboxStorageService.getInbox(email);
    if (!inbox) {
      throw new NotFoundException(`Inbox ${email} not found`);
    }
    return inbox;
  }

  /**
   * Get global webhook or throw NotFoundException
   */
  private getGlobalWebhookOrThrow(id: string): Webhook {
    const webhook = this.storageService.getGlobalWebhook(id);
    if (!webhook) {
      throw new NotFoundException(`Webhook ${id} not found`);
    }
    return webhook;
  }

  /**
   * Get inbox webhook or throw NotFoundException
   */
  private getInboxWebhookOrThrow(inboxHash: string, id: string): Webhook {
    const webhook = this.storageService.getInboxWebhook(inboxHash, id);
    if (!webhook) {
      throw new NotFoundException(`Webhook ${id} not found`);
    }
    return webhook;
  }

  /**
   * Create a webhook entity from DTO
   */
  private createWebhookEntity(
    dto: CreateWebhookDto,
    scope: 'global' | 'inbox',
    inboxHash?: string,
    inboxEmail?: string,
  ): Webhook {
    // Validate URL
    this.validateUrl(dto.url);

    // Validate events
    this.validateEvents(dto.events);

    // Validate template
    const template = this.validateAndNormalizeTemplate(dto.template);

    // Validate and normalize filter
    const filter = dto.filter ? this.validateAndNormalizeFilter(dto.filter) : undefined;

    const now = new Date();
    const stats: WebhookStats = {
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      consecutiveFailures: 0,
    };

    return {
      id: generateWebhookId(),
      url: dto.url,
      events: dto.events,
      scope,
      inboxHash,
      inboxEmail,
      enabled: true,
      secret: generateWebhookSecret(),
      template,
      filter,
      description: dto.description,
      createdAt: now,
      stats,
    };
  }

  /**
   * Build update object from DTO
   */
  private buildUpdates(dto: UpdateWebhookDto): Partial<Webhook> {
    const updates: Partial<Webhook> = {};

    if (dto.url !== undefined) {
      this.validateUrl(dto.url);
      updates.url = dto.url;
    }

    if (dto.events !== undefined) {
      this.validateEvents(dto.events);
      updates.events = dto.events;
    }

    if (dto.template !== undefined) {
      updates.template = dto.template === null ? undefined : this.validateAndNormalizeTemplate(dto.template);
    }

    if (dto.filter !== undefined) {
      updates.filter = dto.filter === null ? undefined : this.validateAndNormalizeFilter(dto.filter);
    }

    if (dto.description !== undefined) {
      updates.description = dto.description;
    }

    if (dto.enabled !== undefined) {
      updates.enabled = dto.enabled;
    }

    return updates;
  }

  /**
   * Validate webhook URL
   */
  private validateUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Invalid webhook URL');
    }

    if (parsed.protocol === 'http:' && !this.allowHttp) {
      throw new BadRequestException('HTTPS is required for webhook URLs. HTTP is only allowed in development mode.');
    }
  }

  /**
   * Validate event types
   */
  private validateEvents(events: string[]): void {
    const invalid = events.filter((e) => !isValidWebhookEvent(e));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid event types: ${invalid.join(', ')}. Valid events: ${ALL_WEBHOOK_EVENTS.join(', ')}`,
      );
    }
  }

  /**
   * Validate and normalize template
   */
  private validateAndNormalizeTemplate(template?: string | CustomTemplateDto): WebhookTemplate | undefined {
    if (!template) return undefined;

    // Built-in template name
    if (typeof template === 'string') {
      if (!this.templateService.isBuiltInTemplate(template)) {
        throw new BadRequestException(
          `Unknown template: "${template}". Valid templates: ${this.templateService.getBuiltInTemplateNames().join(', ')}`,
        );
      }
      return template;
    }

    // Custom template
    const validation = this.templateService.validateTemplate({
      type: 'custom',
      body: template.body,
      contentType: template.contentType,
    });

    if (!validation.valid) {
      throw new BadRequestException(`Invalid template: ${validation.errors.join(', ')}`);
    }

    return {
      type: 'custom',
      body: template.body,
      contentType: template.contentType,
    };
  }

  /**
   * Validate and normalize filter configuration.
   * Resolves requireAuth default so stored filter is self-contained.
   */
  private validateAndNormalizeFilter(filter: FilterConfigDto): WebhookFilterConfig {
    const validation = this.filterService.validateFilter(filter as WebhookFilterConfig);
    if (!validation.valid) {
      throw new BadRequestException(`Invalid filter: ${validation.errors.join(', ')}`);
    }

    return {
      rules: filter.rules.map((rule) => ({
        // Field is validated by filterService.validateFilter() above
        field: rule.field as WebhookFilterConfig['rules'][number]['field'],
        operator: rule.operator,
        value: rule.value,
        caseSensitive: rule.caseSensitive ?? false,
      })),
      mode: filter.mode,
      // Explicitly resolve default so stored filter is self-contained
      requireAuth: filter.requireAuth ?? this.requireAuthDefault,
    };
  }

  /**
   * Test a webhook
   */
  private testWebhook(webhook: Webhook): Promise<TestWebhookResponse> {
    // TestWebhookResult and TestWebhookResponse have identical shapes
    return this.deliveryService.testWebhook(webhook);
  }

  /**
   * Rotate webhook secret
   */
  private rotateSecret(webhook: Webhook): RotateSecretResponse {
    const newSecret = generateWebhookSecret();
    const previousSecretExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    this.storageService.updateWebhook(webhook.id, {
      secret: newSecret,
      previousSecret: webhook.secret,
      previousSecretExpiresAt,
    });

    this.logger.log(`Rotated secret for webhook ${webhook.id}`);

    return {
      id: webhook.id,
      secret: newSecret,
      previousSecretValidUntil: previousSecretExpiresAt.toISOString(),
    };
  }

  /**
   * Convert webhook entity to API response
   */
  private toResponse(webhook: Webhook, includeSecret: boolean): WebhookResponse {
    const response: WebhookResponse = {
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      scope: webhook.scope,
      enabled: webhook.enabled,
      template: webhook.template,
      filter: webhook.filter,
      description: webhook.description,
      createdAt: webhook.createdAt.toISOString(),
      updatedAt: webhook.updatedAt?.toISOString(),
      lastDeliveryAt: webhook.stats.lastDeliveryAt?.toISOString(),
      lastDeliveryStatus: webhook.stats.lastDeliveryStatus,
    };

    if (webhook.scope === 'inbox') {
      response.inboxEmail = webhook.inboxEmail;
      response.inboxHash = webhook.inboxHash;
    }

    if (includeSecret) {
      response.secret = webhook.secret;
      response.stats = {
        totalDeliveries: webhook.stats.totalDeliveries,
        successfulDeliveries: webhook.stats.successfulDeliveries,
        failedDeliveries: webhook.stats.failedDeliveries,
      };
    }

    return response;
  }
}
