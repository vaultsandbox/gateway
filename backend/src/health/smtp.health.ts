import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { SmtpService } from '../smtp/smtp.service';

/**
 * Health indicator for the SMTP service.
 */
@Injectable()
export class SmtpHealthIndicator {
  /**
   * Initializes the SmtpHealthIndicator.
   * @param smtpService The SmtpService.
   * @param healthIndicatorService The HealthIndicatorService.
   */
  constructor(
    private readonly smtpService: SmtpService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  /**
   * Checks if the SMTP service is healthy.
   * @param key The key to use for the health indicator result.
   * @returns A promise that resolves to the health indicator result.
   */
  isHealthy(key: string) {
    const isListening = this.smtpService.isListening();
    const indicator = this.healthIndicatorService.check(key);

    const details = {
      listening: isListening,
    };

    if (isListening) {
      return Promise.resolve(indicator.up(details));
    }

    return Promise.resolve(indicator.down(details));
  }
}
