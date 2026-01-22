/**
 * Greylist Chaos Handler
 *
 * Simulates greylisting behavior: reject first attempt(s) with temporary error,
 * accept after a configurable number of retries within a time window.
 *
 * Greylisting is a common anti-spam technique where mail servers temporarily
 * reject unknown senders, expecting legitimate senders to retry.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { GreylistConfig, ChaosAction } from '../interfaces/chaos-config.interface';
import { GreylistStateService } from '../state/greylist-state.service';
import { GREYLIST_ERROR } from '../constants/smtp-errors.constant';

export interface GreylistContext {
  inboxEmail: string;
  senderIp: string;
  senderEmail: string;
}

@Injectable()
export class GreylistHandler {
  private readonly logger = new Logger(GreylistHandler.name);

  /* v8 ignore next - false positive on constructor parameter */
  constructor(private readonly stateService: GreylistStateService) {}

  /**
   * Evaluate greylist chaos configuration and determine action.
   *
   * Flow:
   * 1. Build tracking key based on trackBy config
   * 2. Get or create entry for this key
   * 3. Increment attempt count
   * 4. If attempts < maxAttempts, reject with greylist error
   * 5. If attempts >= maxAttempts and within window, accept
   * 6. If outside window, reset and reject
   *
   * @param config - Greylist chaos configuration
   * @param context - Context with inbox, sender IP, and sender email
   * @returns ChaosAction with error or continue
   */
  evaluate(config: GreylistConfig, context: GreylistContext): { action: ChaosAction; details?: string } {
    if (!config.enabled) {
      return { action: { action: 'continue' } };
    }

    const { inboxEmail, senderIp, senderEmail } = context;
    const trackBy = config.trackBy || 'ip_sender';
    const maxAttempts = config.maxAttempts || 2;
    const retryWindowMs = config.retryWindowMs || 300000; // 5 minutes default

    // Build tracking key
    const key = this.stateService.buildTrackingKey(trackBy, inboxEmail, senderIp, senderEmail);

    // Check if existing entry is outside the retry window
    const entry = this.stateService.getOrCreateEntry(key, inboxEmail);
    const withinWindow = this.stateService.isWithinWindow(key, retryWindowMs);

    if (!withinWindow && entry.attempts > 0) {
      // Entry expired, reset it
      this.stateService.removeEntry(key);
      this.stateService.getOrCreateEntry(key, inboxEmail);
      this.logger.debug(`Greylist entry expired and reset: ${key}`);
    }

    // Increment attempts
    const attempts = this.stateService.incrementAttempts(key);

    // Check if we've reached the required attempts
    if (attempts >= maxAttempts) {
      // Success! Clear the entry and allow the email
      this.stateService.removeEntry(key);
      this.logger.debug(`Greylist passed after ${attempts} attempts: ${key}`);
      return {
        action: { action: 'continue' },
        details: `Greylisting passed after ${attempts} attempts`,
      };
    }

    // Reject with greylist error
    const details = `Greylisting: attempt ${attempts}/${maxAttempts}, retry in ${Math.ceil(retryWindowMs / 1000)}s`;
    this.logger.debug(`Greylist rejection: ${details} for ${key}`);

    return {
      action: {
        action: 'error',
        code: GREYLIST_ERROR.code,
        enhanced: GREYLIST_ERROR.enhanced,
        message: GREYLIST_ERROR.message,
      },
      details,
    };
  }
}
