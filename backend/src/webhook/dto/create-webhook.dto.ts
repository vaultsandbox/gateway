import {
  IsString,
  IsOptional,
  IsArray,
  IsUrl,
  MaxLength,
  ArrayNotEmpty,
  ArrayMaxSize,
  IsIn,
  ValidateNested,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ALL_WEBHOOK_EVENTS, WebhookEventType, FILTER_OPERATORS } from '../constants';
import type { FilterOperator } from '../interfaces/webhook-filter.interface';

/**
 * Custom template DTO for nested validation
 */
export class CustomTemplateDto {
  @ApiProperty({
    description: 'Template type marker',
    enum: ['custom'],
    example: 'custom',
  })
  @IsIn(['custom'])
  type: 'custom';

  @ApiProperty({
    description: 'JSON template string with {{variable}} placeholders',
    example: '{"text": "Email from {{data.from.address}}"}',
    maxLength: 10000,
  })
  @IsString()
  @MaxLength(10000)
  body: string;

  @ApiPropertyOptional({
    description: 'Optional content type override',
    example: 'application/json',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contentType?: string;
}

/**
 * A single filter rule DTO
 */
export class FilterRuleDto {
  @ApiProperty({
    description:
      'Field to filter on. Supports: subject, from.address, from.name, to.address, to.name, body.text, body.html, header.X-Custom',
    example: 'from.address',
  })
  @IsString()
  @MaxLength(100)
  field: string;

  @ApiProperty({
    description: 'Operator for matching',
    enum: FILTER_OPERATORS,
    example: 'domain',
  })
  @IsEnum(FILTER_OPERATORS, {
    message: `operator must be one of: ${FILTER_OPERATORS.join(', ')}`,
  })
  operator: FilterOperator;

  @ApiProperty({
    description: 'Value to match against (empty string for exists operator)',
    example: 'github.com',
    maxLength: 1000,
  })
  @IsString()
  @MaxLength(1000)
  value: string;

  @ApiPropertyOptional({
    description: 'Whether to perform case-sensitive matching (default: false)',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  caseSensitive?: boolean;
}

/**
 * Filter configuration DTO
 */
export class FilterConfigDto {
  @ApiProperty({
    description: 'List of filter rules (max 10)',
    type: [FilterRuleDto],
    example: [
      { field: 'from.address', operator: 'domain', value: 'github.com' },
      { field: 'subject', operator: 'contains', value: 'pull request' },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FilterRuleDto)
  @ArrayMaxSize(10)
  rules: FilterRuleDto[];

  @ApiProperty({
    description: "How to combine rules: 'all' = AND logic (all must match), 'any' = OR logic (at least one must match)",
    enum: ['all', 'any'],
    example: 'all',
  })
  @IsIn(['all', 'any'])
  mode: 'all' | 'any';

  @ApiPropertyOptional({
    description: 'Require email to pass all enabled server auth checks (SPF/DKIM/DMARC)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  requireAuth?: boolean;
}

export class CreateWebhookDto {
  @ApiProperty({
    description: 'Target URL for webhook delivery. HTTPS required unless HTTP is explicitly allowed.',
    example: 'https://api.example.com/hooks/email',
    maxLength: 2048,
  })
  @IsUrl({ protocols: ['https', 'http'], require_tld: false })
  @MaxLength(2048)
  url: string;

  @ApiProperty({
    description: 'Array of event types to subscribe to',
    example: ['email.received', 'email.stored'],
    enum: ALL_WEBHOOK_EVENTS,
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  events: WebhookEventType[];

  @ApiPropertyOptional({
    description: 'Payload template. Use built-in template name (slack, discord, teams) or custom template object.',
    example: 'slack',
  })
  @IsOptional()
  template?: string | CustomTemplateDto;

  @ApiPropertyOptional({
    description: 'Filter configuration to trigger webhook only for matching events',
    type: FilterConfigDto,
    example: {
      mode: 'all',
      rules: [
        { field: 'from.address', operator: 'domain', value: 'github.com' },
        { field: 'subject', operator: 'contains', value: 'pull request' },
      ],
    },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FilterConfigDto)
  filter?: FilterConfigDto;

  @ApiPropertyOptional({
    description: 'Human-readable description for the webhook',
    example: 'Main email notification endpoint',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
