import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { CertificateService } from './certificate.service';

/**
 * A health indicator for the SSL certificate's status.
 * It checks if the certificate exists, is valid, and is not expiring soon.
 */
@Injectable()
export class CertificateHealthIndicator {
  /**
   * Constructor
   */
  constructor(
    private readonly certificateService: CertificateService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  /**
   * Checks the health of the certificate.
   * The service is considered healthy if the certificate exists, is valid, and does not expire within 7 days.
   * @param key - A key to represent this health indicator in the results.
   * @returns A promise that resolves to a health indicator result.
   */
  async isHealthy(key: string) {
    const status = await this.certificateService.getStatus();
    const daysUntilExpiry = status.daysUntilExpiry ?? 0;
    const isHealthy = status.exists && status.valid && daysUntilExpiry > 7;

    const indicator = this.healthIndicatorService.check(key);

    const details = {
      exists: status.exists,
      domain: status.domain,
      expiresAt: status.expiresAt,
      daysUntilExpiry: status.daysUntilExpiry,
      valid: status.valid,
    };

    if (isHealthy) {
      return indicator.up(details);
    }

    return indicator.down(details);
  }
}
