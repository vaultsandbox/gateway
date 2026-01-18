import {
  IsString,
  IsOptional,
  IsArray,
  IsUrl,
  MaxLength,
  ArrayMaxSize,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ALL_WEBHOOK_EVENTS, WebhookEventType } from '../constants/webhook-events';
import { CustomTemplateDto, FilterConfigDto } from './create-webhook.dto';

export class UpdateWebhookDto {
  @ApiPropertyOptional({
    description: 'Target URL for webhook delivery',
    example: 'https://api.example.com/hooks/email-v2',
    maxLength: 2048,
  })
  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_tld: false })
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({
    description: 'Array of event types to subscribe to',
    example: ['email.received'],
    enum: ALL_WEBHOOK_EVENTS,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  events?: WebhookEventType[];

  @ApiPropertyOptional({
    description: 'Payload template. Use built-in template name (slack, discord, teams) or custom template object.',
    example: 'discord',
  })
  @IsOptional()
  template?: string | CustomTemplateDto | null;

  @ApiPropertyOptional({
    description: 'Filter configuration to trigger webhook only for matching events. Set to null to remove filter.',
    type: FilterConfigDto,
    example: {
      mode: 'any',
      rules: [{ field: 'subject', operator: 'contains', value: 'urgent' }],
    },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FilterConfigDto)
  filter?: FilterConfigDto | null;

  @ApiPropertyOptional({
    description: 'Human-readable description for the webhook',
    example: 'Updated email notification endpoint',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description: 'Enable or disable the webhook',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
