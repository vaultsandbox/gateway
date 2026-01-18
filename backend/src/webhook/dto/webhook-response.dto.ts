import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { WebhookEventType } from '../constants/webhook-events';
import type { WebhookScope, WebhookTemplate } from '../interfaces/webhook.interface';
import { FilterConfigDto } from './create-webhook.dto';

/**
 * Webhook counts by scope
 */
export class WebhookCountsDto {
  @ApiProperty({ description: 'Number of global webhooks', example: 3 })
  global: number;

  @ApiProperty({ description: 'Number of inbox-scoped webhooks', example: 12 })
  inbox: number;

  @ApiProperty({ description: 'Number of currently enabled webhooks', example: 14 })
  enabled: number;

  @ApiProperty({ description: 'Total number of webhooks (global + inbox)', example: 15 })
  total: number;
}

/**
 * Aggregated delivery statistics
 */
export class WebhookDeliveryStatsDto {
  @ApiProperty({ description: 'Total delivery attempts across all webhooks', example: 1250 })
  total: number;

  @ApiProperty({ description: 'Successful deliveries across all webhooks', example: 1180 })
  successful: number;

  @ApiProperty({ description: 'Failed deliveries across all webhooks', example: 70 })
  failed: number;
}

/**
 * Response for GET /api/webhooks/metrics endpoint
 */
export class WebhookMetricsResponse {
  @ApiProperty({ description: 'Webhook counts by scope', type: WebhookCountsDto })
  webhooks: WebhookCountsDto;

  @ApiProperty({ description: 'Aggregated delivery statistics', type: WebhookDeliveryStatsDto })
  deliveries: WebhookDeliveryStatsDto;
}

/**
 * Template option for dropdown selection
 */
export class WebhookTemplateOption {
  @ApiProperty({ description: 'Display label for the template', example: 'Discord' })
  label: string;

  @ApiProperty({ description: 'Template value/identifier', example: 'discord' })
  value: string;
}

/**
 * Response for GET /api/webhooks/templates endpoint
 */
export class WebhookTemplatesResponse {
  @ApiProperty({ description: 'Available webhook templates', type: [WebhookTemplateOption] })
  templates: WebhookTemplateOption[];
}

/**
 * Statistics response shape
 */
export class WebhookStatsResponse {
  @ApiProperty({ description: 'Total delivery attempts' })
  totalDeliveries: number;

  @ApiProperty({ description: 'Successful deliveries' })
  successfulDeliveries: number;

  @ApiProperty({ description: 'Failed deliveries' })
  failedDeliveries: number;
}

/**
 * Single webhook response
 */
export class WebhookResponse {
  @ApiProperty({ description: 'Unique webhook ID with "whk_" prefix', example: 'whk_abc123def456' })
  id: string;

  @ApiProperty({ description: 'Target URL for webhook delivery', example: 'https://api.example.com/hooks' })
  url: string;

  @ApiProperty({
    description: 'Subscribed event types',
    example: ['email.received', 'email.stored'],
    isArray: true,
  })
  events: WebhookEventType[];

  @ApiProperty({ description: 'Webhook scope', enum: ['global', 'inbox'], example: 'global' })
  scope: WebhookScope;

  @ApiPropertyOptional({
    description: 'Inbox email address (only for inbox webhooks)',
    example: 'test@sandbox.local',
  })
  inboxEmail?: string;

  @ApiPropertyOptional({ description: 'Inbox hash (only for inbox webhooks)', example: 'abc123...' })
  inboxHash?: string;

  @ApiProperty({ description: 'Whether the webhook is enabled', example: true })
  enabled: boolean;

  @ApiPropertyOptional({
    description: 'HMAC signing secret (only returned on create and get detail)',
    example: 'whsec_xxxx...',
  })
  secret?: string;

  @ApiPropertyOptional({ description: 'Payload template configuration' })
  template?: WebhookTemplate;

  @ApiPropertyOptional({
    description: 'Filter configuration for event matching',
    type: FilterConfigDto,
  })
  filter?: FilterConfigDto;

  @ApiPropertyOptional({ description: 'Human-readable description', example: 'Main notification endpoint' })
  description?: string;

  @ApiProperty({ description: 'Creation timestamp', example: '2024-05-11T10:30:00.000Z' })
  createdAt: string;

  @ApiPropertyOptional({ description: 'Last update timestamp', example: '2024-05-11T14:00:00.000Z' })
  updatedAt?: string;

  @ApiPropertyOptional({ description: 'Last delivery timestamp', example: '2024-05-11T12:45:00.000Z' })
  lastDeliveryAt?: string;

  @ApiPropertyOptional({
    description: 'Last delivery status',
    enum: ['success', 'failed'],
    example: 'success',
  })
  lastDeliveryStatus?: 'success' | 'failed';

  @ApiPropertyOptional({ description: 'Delivery statistics', type: WebhookStatsResponse })
  stats?: WebhookStatsResponse;
}

/**
 * List webhooks response
 */
export class WebhookListResponse {
  @ApiProperty({ description: 'Array of webhooks', type: [WebhookResponse] })
  webhooks: WebhookResponse[];

  @ApiProperty({ description: 'Total count of webhooks', example: 5 })
  total: number;
}

/**
 * Test webhook result response
 */
export class TestWebhookResponse {
  @ApiProperty({ description: 'Whether the test succeeded', example: true })
  success: boolean;

  @ApiPropertyOptional({ description: 'HTTP status code from the webhook endpoint', example: 200 })
  statusCode?: number;

  @ApiPropertyOptional({ description: 'Response time in milliseconds', example: 145 })
  responseTime?: number;

  @ApiPropertyOptional({ description: 'Response body from the webhook endpoint' })
  responseBody?: string;

  @ApiPropertyOptional({
    description: 'Error message if the test failed',
    example: 'Connection timeout',
  })
  error?: string;

  @ApiPropertyOptional({ description: 'The payload that was sent to the webhook endpoint' })
  payloadSent?: unknown;
}

/**
 * Rotate secret response
 */
export class RotateSecretResponse {
  @ApiProperty({ description: 'Webhook ID', example: 'whk_abc123def456' })
  id: string;

  @ApiProperty({ description: 'New signing secret', example: 'whsec_newxxxx...' })
  secret: string;

  @ApiProperty({
    description: 'When the previous secret expires (1 hour grace period)',
    example: '2024-05-11T15:00:00.000Z',
  })
  previousSecretValidUntil: string;
}
