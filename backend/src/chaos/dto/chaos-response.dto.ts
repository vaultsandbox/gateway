import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response DTO for chaos configuration
 */
export class ChaosConfigResponseDto {
  @ApiProperty({ description: 'Whether chaos is enabled for this inbox' })
  enabled: boolean;

  @ApiPropertyOptional({ description: 'ISO timestamp for auto-disable' })
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Latency injection configuration' })
  latency?: {
    enabled: boolean;
    minDelayMs: number;
    maxDelayMs: number;
    jitter: boolean;
    probability: number;
  };

  @ApiPropertyOptional({ description: 'Connection drop configuration' })
  connectionDrop?: {
    enabled: boolean;
    probability: number;
    graceful: boolean;
  };

  @ApiPropertyOptional({ description: 'Random error configuration' })
  randomError?: {
    enabled: boolean;
    errorRate: number;
    errorTypes: ('temporary' | 'permanent')[];
  };

  @ApiPropertyOptional({ description: 'Greylist configuration' })
  greylist?: {
    enabled: boolean;
    retryWindowMs: number;
    maxAttempts: number;
    trackBy: 'ip' | 'sender' | 'ip_sender';
  };

  @ApiPropertyOptional({ description: 'Blackhole configuration' })
  blackhole?: {
    enabled: boolean;
    triggerWebhooks: boolean;
  };
}

/**
 * Response DTO when chaos is disabled globally
 */
export class ChaosDisabledResponseDto {
  @ApiProperty({ description: 'Error message' })
  message: string;

  @ApiProperty({ description: 'HTTP status code' })
  statusCode: number;
}
