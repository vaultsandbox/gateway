import { Controller, Get, UseGuards, HttpCode, HttpStatus, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApiTags, ApiSecurity, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';
import { ApiKeyGuard } from '../inbox/guards/api-key.guard';
import { MetricsResponseDto } from './dto/metrics-response.dto';
import { EmailStorageService } from '../smtp/storage/email-storage.service';
import { StorageMetricsResponseDto } from './dto/storage-metrics-response.dto';

@ApiTags('Metrics')
@ApiSecurity('api-key')
@Controller('api/metrics')
export class MetricsController {
  /* v8 ignore next 5 - false positive on constructor parameter properties */
  constructor(
    private readonly metricsService: MetricsService,
    @Optional() private readonly emailStorageService?: EmailStorageService,
    private readonly moduleRef?: ModuleRef,
  ) {}

  /**
   * GET /api/metrics
   * Returns server metrics including uptime, connections, email stats, auth results, and certificates
   * Requires X-API-Key header
   */
  @Get()
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get Application Metrics',
    description:
      'Returns a snapshot of real-time server metrics, including uptime, connection counts, email statistics, and certificate status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Metrics retrieved successfully.',
    type: MetricsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  getMetrics() {
    return this.metricsService.getMetrics();
  }

  /**
   * GET /api/metrics/storage
   * Returns email storage metrics including memory usage, eviction stats, and email counts
   * Requires X-API-Key header
   */
  @Get('storage')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get Email Storage Metrics',
    description:
      'Returns real-time storage metrics including memory utilization, email counts, eviction statistics, and tombstone tracking.',
  })
  @ApiResponse({
    status: 200,
    description: 'Storage metrics retrieved successfully.',
    type: StorageMetricsResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key is missing or invalid.' })
  getStorageMetrics() {
    const storageService = this.resolveEmailStorageService();

    if (!storageService) {
      return {
        error: 'Email storage service not available',
        reason: 'Gateway may not be running in local mode or storage service not initialized',
      };
    }
    return storageService.getMetrics();
  }

  /**
   * Lazily resolve EmailStorageService without requiring a hard module dependency.
   */
  private resolveEmailStorageService(): EmailStorageService | undefined {
    if (this.emailStorageService) {
      return this.emailStorageService;
    }

    if (!this.moduleRef) {
      return undefined;
    }

    try {
      // strict: false allows lookup across modules without explicit import

      const resolved = this.moduleRef.get(EmailStorageService, { strict: false });
      return resolved ?? undefined;
    } catch {
      return undefined;
    }
  }
}
