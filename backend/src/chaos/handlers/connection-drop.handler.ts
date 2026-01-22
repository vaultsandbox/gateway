/**
 * Connection Drop Handler
 *
 * Simulates abrupt TCP connection failures by dropping
 * the connection either gracefully (FIN) or abruptly (RST).
 *
 * The connection is dropped after receiving the complete email
 * but before sending the 250 OK response, simulating the classic
 * "did it send or didn't it?" ambiguity that applications need to handle.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { ConnectionDropConfig, ChaosAction } from '../interfaces/chaos-config.interface';

@Injectable()
export class ConnectionDropHandler {
  private readonly logger = new Logger(ConnectionDropHandler.name);

  /**
   * Evaluate connection drop chaos configuration.
   *
   * @param config - Connection drop chaos configuration
   * @returns ChaosAction with drop details or 'continue'
   */
  evaluate(config: ConnectionDropConfig): { action: ChaosAction; details?: string } {
    /* v8 ignore next 3 - defensive guard, handler only called when enabled */
    if (!config.enabled) {
      return { action: { action: 'continue' } };
    }

    // Check probability
    if (config.probability < 1.0 && Math.random() > config.probability) {
      this.logger.debug(`Connection drop skipped (probability=${config.probability})`);
      return { action: { action: 'continue' } };
    }

    const dropType = config.graceful ? 'graceful (FIN)' : 'abrupt (RST)';
    const details = `Connection drop, ${dropType}`;
    this.logger.debug(`Connection drop chaos triggered: ${details}`);

    return {
      action: { action: 'drop', graceful: config.graceful },
      details,
    };
  }
}
