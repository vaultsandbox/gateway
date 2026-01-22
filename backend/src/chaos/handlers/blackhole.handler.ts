/**
 * Blackhole Chaos Handler
 *
 * Simulates blackhole behavior: accept email (return 250 OK) but don't store it
 * or trigger webhooks. This simulates scenarios where emails are silently lost.
 *
 * Useful for testing how applications handle:
 * - Silent delivery failures
 * - Lost emails without error indication
 * - Email tracking/confirmation mechanisms
 */

import { Injectable, Logger } from '@nestjs/common';
import type { BlackholeConfig, ChaosAction } from '../interfaces/chaos-config.interface';

@Injectable()
export class BlackholeHandler {
  private readonly logger = new Logger(BlackholeHandler.name);

  /**
   * Evaluate blackhole chaos configuration and determine action.
   *
   * When enabled, returns a blackhole action that instructs the SMTP handler
   * to accept the email but skip storage (and optionally webhooks).
   *
   * @param config - Blackhole chaos configuration
   * @returns ChaosAction with blackhole instruction or continue
   */
  evaluate(config: BlackholeConfig): { action: ChaosAction; details?: string } {
    /* v8 ignore next 3 - defensive guard, handler only called when enabled */
    if (!config.enabled) {
      return { action: { action: 'continue' } };
    }

    /* v8 ignore next - defensive fallback, triggerWebhooks always defined in normalized config */
    const triggerWebhooks = config.triggerWebhooks ?? false;
    const details = `Email blackholed (webhooks=${triggerWebhooks ? 'enabled' : 'suppressed'})`;

    this.logger.debug(`Blackhole chaos triggered: ${details}`);

    return {
      action: {
        action: 'blackhole',
        triggerWebhooks,
      },
      details,
    };
  }
}
