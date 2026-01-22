import { IsBoolean, IsOptional, IsNumber, IsString, IsArray, IsIn, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Latency configuration DTO
 */
export class LatencyConfigDto {
  @ApiProperty({ description: 'Enable latency injection' })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({ description: 'Minimum delay in milliseconds', default: 500 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minDelayMs?: number;

  @ApiPropertyOptional({ description: 'Maximum delay in milliseconds', default: 10000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(60000)
  maxDelayMs?: number;

  @ApiPropertyOptional({ description: 'Randomize delay within range', default: true })
  @IsOptional()
  @IsBoolean()
  jitter?: boolean;

  @ApiPropertyOptional({ description: 'Probability of applying delay (0.0-1.0)', default: 1.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  probability?: number;
}

/**
 * Connection drop configuration DTO
 */
export class ConnectionDropConfigDto {
  @ApiProperty({ description: 'Enable connection dropping' })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({ description: 'Probability of dropping connection (0.0-1.0)', default: 1.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  probability?: number;

  @ApiPropertyOptional({ description: 'Graceful close (FIN) vs hard close (RST)', default: true })
  @IsOptional()
  @IsBoolean()
  graceful?: boolean;
}

/**
 * Random error configuration DTO
 */
export class RandomErrorConfigDto {
  @ApiProperty({ description: 'Enable random error generation' })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({ description: 'Error rate (0.0-1.0)', default: 0.1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  errorRate?: number;

  @ApiPropertyOptional({ description: 'Types of errors to return', default: ['temporary'] })
  @IsOptional()
  @IsArray()
  @IsIn(['temporary', 'permanent'], { each: true })
  errorTypes?: ('temporary' | 'permanent')[];
}

/**
 * Greylist configuration DTO
 */
export class GreylistConfigDto {
  @ApiProperty({ description: 'Enable greylisting simulation' })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({ description: 'Retry window in milliseconds', default: 300000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  retryWindowMs?: number;

  @ApiPropertyOptional({ description: 'Accept after N attempts', default: 2 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxAttempts?: number;

  @ApiPropertyOptional({ description: 'How to track attempts', enum: ['ip', 'sender', 'ip_sender'] })
  @IsOptional()
  @IsIn(['ip', 'sender', 'ip_sender'])
  trackBy?: 'ip' | 'sender' | 'ip_sender';
}

/**
 * Blackhole configuration DTO
 */
export class BlackholeConfigDto {
  @ApiProperty({ description: 'Enable blackhole mode' })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({ description: 'Whether to still trigger webhooks', default: false })
  @IsOptional()
  @IsBoolean()
  triggerWebhooks?: boolean;
}

/**
 * Complete inbox chaos configuration DTO for API requests
 */
export class CreateChaosConfigDto {
  @ApiProperty({ description: 'Master switch for chaos on this inbox' })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({ description: 'ISO timestamp for auto-disable' })
  @IsOptional()
  @IsString()
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Latency injection config' })
  @IsOptional()
  @ValidateNested()
  @Type(() => LatencyConfigDto)
  latency?: LatencyConfigDto;

  @ApiPropertyOptional({ description: 'Connection drop config' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConnectionDropConfigDto)
  connectionDrop?: ConnectionDropConfigDto;

  @ApiPropertyOptional({ description: 'Random error config' })
  @IsOptional()
  @ValidateNested()
  @Type(() => RandomErrorConfigDto)
  randomError?: RandomErrorConfigDto;

  @ApiPropertyOptional({ description: 'Greylist config' })
  @IsOptional()
  @ValidateNested()
  @Type(() => GreylistConfigDto)
  greylist?: GreylistConfigDto;

  @ApiPropertyOptional({ description: 'Blackhole config' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BlackholeConfigDto)
  blackhole?: BlackholeConfigDto;
}
