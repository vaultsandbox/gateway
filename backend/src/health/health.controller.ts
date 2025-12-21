import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheck, HealthCheckService, HttpHealthIndicator } from '@nestjs/terminus';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SmtpHealthIndicator } from './smtp.health';
import { CertificateHealthIndicator } from '../certificate/certificate.health';
import { HealthResponseDto } from './dto/health-response.dto';

/**
 * Controller for handling health checks.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  /**
   * Initializes the HealthController.
   * @param health The HealthCheckService.
   * @param http The HttpHealthIndicator.
   * @param smtp The SmtpHealthIndicator.
   * @param certificate The CertificateHealthIndicator.
   * @param configService The ConfigService.
   */
  constructor(
    private readonly health: HealthCheckService,
    private readonly http: HttpHealthIndicator,
    private readonly smtp: SmtpHealthIndicator,
    private readonly certificate: CertificateHealthIndicator,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Performs a health check.
   * @returns A promise that resolves to the health check result.
   */
  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Get Application Health Status',
    description:
      'Performs a health check on the application and its dependencies, such as SMTP server, backend connectivity, and certificate status.',
  })
  @ApiResponse({
    status: 200,
    description: 'The application is healthy. See the response body for detailed status of each component.',
    type: HealthResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: 'The application is unhealthy. One or more health checks failed.',
    type: HealthResponseDto,
  })
  check() {
    const backendUrl = this.configService.get<string>('vsb.main.backend.url');
    const gatewayMode = this.configService.get<string>('vsb.main.gatewayMode', 'local');

    return this.health.check([
      () => Promise.resolve({ server: { status: 'up' } }),
      () => this.smtp.isHealthy('smtp'),
      () => {
        if (gatewayMode === 'local') {
          return Promise.resolve({
            backend: { status: 'up', mode: 'local', checked: false },
          } as HealthIndicatorResult);
        }

        if (!backendUrl) {
          return Promise.resolve({
            backend: { status: 'up', configured: false },
          } as HealthIndicatorResult);
        }
        return this.http.pingCheck('backend', backendUrl);
      },
      () => this.certificate.isHealthy('certificate'),
    ]);
  }
}
