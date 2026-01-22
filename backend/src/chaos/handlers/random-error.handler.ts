/**
 * Random Error Generator Handler
 *
 * Returns random SMTP errors for a configurable percentage
 * of requests to simulate various failure scenarios.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { RandomErrorConfig, ChaosAction } from '../interfaces/chaos-config.interface';
import { getRandomError } from '../constants/smtp-errors.constant';

@Injectable()
export class RandomErrorHandler {
  private readonly logger = new Logger(RandomErrorHandler.name);

  /**
   * Evaluate random error chaos configuration and determine if an error should be returned.
   *
   * @param config - Random error chaos configuration
   * @returns ChaosAction with error details or 'continue'
   */
  evaluate(config: RandomErrorConfig): { action: ChaosAction; details?: string } {
    /* v8 ignore next 3 - defensive guard, handler only called when enabled */
    if (!config.enabled) {
      return { action: { action: 'continue' } };
    }

    // Check error rate (probability of returning an error)
    if (Math.random() > config.errorRate) {
      this.logger.debug(`Random error skipped (errorRate=${config.errorRate})`);
      return { action: { action: 'continue' } };
    }

    // Get a random error from the configured types
    const error = getRandomError(config.errorTypes);

    const details = `${error.code} ${error.enhanced} ${error.message}`;
    this.logger.debug(`Random error chaos triggered: ${details}`);

    return {
      action: {
        action: 'error',
        code: error.code,
        enhanced: error.enhanced,
        message: error.message,
      },
      details,
    };
  }
}
