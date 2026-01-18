import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { WebhookService } from './services/webhook.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import {
  WebhookResponse,
  WebhookListResponse,
  TestWebhookResponse,
  RotateSecretResponse,
  WebhookMetricsResponse,
  WebhookTemplatesResponse,
} from './dto/webhook-response.dto';
import { ApiKeyGuard } from '../inbox/guards/api-key.guard';

/**
 * REST API controller for webhook management.
 * Provides endpoints for both global webhooks and inbox-scoped webhooks.
 */
@ApiTags('Webhooks')
@ApiBearerAuth('X-API-Key')
@Controller('api')
@UseGuards(ApiKeyGuard)
export class WebhookController {
  /* v8 ignore next - constructor injection */
  constructor(private readonly webhookService: WebhookService) {}

  // ============================================
  // Global Webhooks
  // ============================================

  /* v8 ignore next 7 - decorators */
  @Post('webhooks')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a global webhook' })
  @ApiResponse({ status: 201, description: 'Webhook created', type: WebhookResponse })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 409, description: 'Webhook limit reached' })
  createGlobalWebhook(@Body() dto: CreateWebhookDto): WebhookResponse {
    return this.webhookService.createGlobalWebhook(dto);
  }

  /* v8 ignore next 4 - decorators */
  @Get('webhooks')
  @ApiOperation({ summary: 'List all global webhooks' })
  @ApiResponse({ status: 200, description: 'List of webhooks', type: WebhookListResponse })
  listGlobalWebhooks(): WebhookListResponse {
    return this.webhookService.listGlobalWebhooks();
  }

  /* v8 ignore next 4 - decorators */
  @Get('webhooks/metrics')
  @ApiOperation({ summary: 'Get aggregated webhook metrics' })
  @ApiResponse({ status: 200, description: 'Webhook metrics', type: WebhookMetricsResponse })
  getWebhookMetrics(): WebhookMetricsResponse {
    return this.webhookService.getMetrics();
  }

  /* v8 ignore next 4 - decorators */
  @Get('webhooks/templates')
  @ApiOperation({ summary: 'Get available webhook templates' })
  @ApiResponse({ status: 200, description: 'Available templates', type: WebhookTemplatesResponse })
  getWebhookTemplates(): WebhookTemplatesResponse {
    return this.webhookService.getTemplates();
  }

  /* v8 ignore next 6 - decorators */
  @Get('webhooks/:id')
  @ApiOperation({ summary: 'Get a global webhook by ID' })
  @ApiParam({ name: 'id', description: 'Webhook ID' })
  @ApiResponse({ status: 200, description: 'Webhook details', type: WebhookResponse })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  getGlobalWebhook(@Param('id') id: string): WebhookResponse {
    return this.webhookService.getGlobalWebhook(id);
  }

  /* v8 ignore next 7 - decorators */
  @Patch('webhooks/:id')
  @ApiOperation({ summary: 'Update a global webhook' })
  @ApiParam({ name: 'id', description: 'Webhook ID' })
  @ApiResponse({ status: 200, description: 'Webhook updated', type: WebhookResponse })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  updateGlobalWebhook(@Param('id') id: string, @Body() dto: UpdateWebhookDto): WebhookResponse {
    return this.webhookService.updateGlobalWebhook(id, dto);
  }

  /* v8 ignore next 6 - decorators */
  @Delete('webhooks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a global webhook' })
  @ApiParam({ name: 'id', description: 'Webhook ID' })
  @ApiResponse({ status: 204, description: 'Webhook deleted' })
  deleteGlobalWebhook(@Param('id') id: string): void {
    this.webhookService.deleteGlobalWebhook(id);
  }

  /* v8 ignore next 6 - decorators */
  @Post('webhooks/:id/test')
  @ApiOperation({ summary: 'Send a test event to a global webhook' })
  @ApiParam({ name: 'id', description: 'Webhook ID' })
  @ApiResponse({ status: 200, description: 'Test result', type: TestWebhookResponse })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  async testGlobalWebhook(@Param('id') id: string): Promise<TestWebhookResponse> {
    return this.webhookService.testGlobalWebhook(id);
  }

  /* v8 ignore next 6 - decorators */
  @Post('webhooks/:id/rotate-secret')
  @ApiOperation({ summary: 'Rotate the signing secret for a global webhook' })
  @ApiParam({ name: 'id', description: 'Webhook ID' })
  @ApiResponse({ status: 200, description: 'New secret', type: RotateSecretResponse })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  rotateGlobalWebhookSecret(@Param('id') id: string): RotateSecretResponse {
    return this.webhookService.rotateGlobalWebhookSecret(id);
  }

  // ============================================
  // Inbox Webhooks
  // ============================================

  /* v8 ignore next 9 - decorators */
  @Post('inboxes/:email/webhooks')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a webhook for an inbox' })
  @ApiParam({ name: 'email', description: 'Inbox email address' })
  @ApiResponse({ status: 201, description: 'Webhook created', type: WebhookResponse })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 404, description: 'Inbox not found' })
  @ApiResponse({ status: 409, description: 'Webhook limit reached' })
  createInboxWebhook(@Param('email') email: string, @Body() dto: CreateWebhookDto): WebhookResponse {
    return this.webhookService.createInboxWebhook(email, dto);
  }

  /* v8 ignore next 6 - decorators */
  @Get('inboxes/:email/webhooks')
  @ApiOperation({ summary: 'List all webhooks for an inbox' })
  @ApiParam({ name: 'email', description: 'Inbox email address' })
  @ApiResponse({ status: 200, description: 'List of webhooks', type: WebhookListResponse })
  @ApiResponse({ status: 404, description: 'Inbox not found' })
  listInboxWebhooks(@Param('email') email: string): WebhookListResponse {
    return this.webhookService.listInboxWebhooks(email);
  }

  /* v8 ignore next 7 - decorators */
  @Get('inboxes/:email/webhooks/:id')
  @ApiOperation({ summary: 'Get an inbox webhook by ID' })
  @ApiParam({ name: 'email', description: 'Inbox email address' })
  @ApiParam({ name: 'id', description: 'Webhook ID' })
  @ApiResponse({ status: 200, description: 'Webhook details', type: WebhookResponse })
  @ApiResponse({ status: 404, description: 'Inbox or webhook not found' })
  getInboxWebhook(@Param('email') email: string, @Param('id') id: string): WebhookResponse {
    return this.webhookService.getInboxWebhook(email, id);
  }

  /* v8 ignore next 12 - decorators */
  @Patch('inboxes/:email/webhooks/:id')
  @ApiOperation({ summary: 'Update an inbox webhook' })
  @ApiParam({ name: 'email', description: 'Inbox email address' })
  @ApiParam({ name: 'id', description: 'Webhook ID' })
  @ApiResponse({ status: 200, description: 'Webhook updated', type: WebhookResponse })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 404, description: 'Inbox or webhook not found' })
  updateInboxWebhook(
    @Param('email') email: string,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ): WebhookResponse {
    return this.webhookService.updateInboxWebhook(email, id, dto);
  }

  /* v8 ignore next 7 - decorators */
  @Delete('inboxes/:email/webhooks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an inbox webhook' })
  @ApiParam({ name: 'email', description: 'Inbox email address' })
  @ApiParam({ name: 'id', description: 'Webhook ID' })
  @ApiResponse({ status: 204, description: 'Webhook deleted' })
  deleteInboxWebhook(@Param('email') email: string, @Param('id') id: string): void {
    this.webhookService.deleteInboxWebhook(email, id);
  }

  /* v8 ignore next 7 - decorators */
  @Post('inboxes/:email/webhooks/:id/test')
  @ApiOperation({ summary: 'Send a test event to an inbox webhook' })
  @ApiParam({ name: 'email', description: 'Inbox email address' })
  @ApiParam({ name: 'id', description: 'Webhook ID' })
  @ApiResponse({ status: 200, description: 'Test result', type: TestWebhookResponse })
  @ApiResponse({ status: 404, description: 'Inbox or webhook not found' })
  async testInboxWebhook(@Param('email') email: string, @Param('id') id: string): Promise<TestWebhookResponse> {
    return this.webhookService.testInboxWebhook(email, id);
  }

  /* v8 ignore next 7 - decorators */
  @Post('inboxes/:email/webhooks/:id/rotate-secret')
  @ApiOperation({ summary: 'Rotate the signing secret for an inbox webhook' })
  @ApiParam({ name: 'email', description: 'Inbox email address' })
  @ApiParam({ name: 'id', description: 'Webhook ID' })
  @ApiResponse({ status: 200, description: 'New secret', type: RotateSecretResponse })
  @ApiResponse({ status: 404, description: 'Inbox or webhook not found' })
  rotateInboxWebhookSecret(@Param('email') email: string, @Param('id') id: string): RotateSecretResponse {
    return this.webhookService.rotateInboxWebhookSecret(email, id);
  }
}
