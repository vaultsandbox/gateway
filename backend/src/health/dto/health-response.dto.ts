import { ApiProperty } from '@nestjs/swagger';

/**
 * Response for GET /health endpoint
 * Contains health status of the application and its dependencies
 */
export class HealthResponseDto {
  @ApiProperty({
    description: 'Overall health status',
    example: 'ok',
    enum: ['ok', 'error'],
  })
  status: string;

  @ApiProperty({
    description: 'Detailed information about each health indicator when healthy',
    example: {
      server: { status: 'up' },
      smtp: { status: 'up', port: 587 },
      backend: { status: 'up', mode: 'local' },
      certificate: { status: 'up', daysUntilExpiry: 45 },
    },
    required: false,
  })
  info?: Record<string, any>;

  @ApiProperty({
    description: 'Error information if health check failed',
    example: {
      smtp: { status: 'down', message: 'Connection refused' },
    },
    required: false,
  })
  error?: Record<string, any>;

  @ApiProperty({
    description: 'Detailed health check results for all indicators',
    example: {
      server: { status: 'up' },
      smtp: { status: 'up', port: 587 },
      backend: { status: 'up', mode: 'local' },
      certificate: { status: 'up', daysUntilExpiry: 45 },
    },
  })
  details: Record<string, any>;
}
