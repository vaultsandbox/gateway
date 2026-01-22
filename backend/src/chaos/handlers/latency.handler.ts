/**
 * Latency Injection Handler
 *
 * Injects configurable delays into SMTP responses to simulate
 * slow network/server responses.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { LatencyConfig, ChaosAction } from '../interfaces/chaos-config.interface';

@Injectable()
export class LatencyHandler {
  private readonly logger = new Logger(LatencyHandler.name);

  /**
   * Evaluate latency chaos configuration and determine if delay should be applied.
   *
   * @param config - Latency chaos configuration
   * @returns ChaosAction with delay details or 'continue'
   */
  evaluate(config: LatencyConfig): { action: ChaosAction; details?: string } {
    /* v8 ignore next 3 - defensive guard, handler only called when enabled */
    if (!config.enabled) {
      return { action: { action: 'continue' } };
    }

    // Check probability
    if (config.probability < 1.0 && Math.random() > config.probability) {
      this.logger.debug(`Latency chaos skipped (probability=${config.probability})`);
      return { action: { action: 'continue' } };
    }

    // Calculate delay
    let delayMs: number;
    if (config.jitter && config.minDelayMs < config.maxDelayMs) {
      // Random delay between min and max
      delayMs = config.minDelayMs + Math.floor(Math.random() * (config.maxDelayMs - config.minDelayMs));
    } else {
      // Fixed delay at max
      delayMs = config.maxDelayMs;
    }

    const details = `${delayMs}ms delay injected`;
    this.logger.debug(`Latency chaos triggered: ${details}`);

    return {
      action: { action: 'delay', delayMs },
      details,
    };
  }
}
