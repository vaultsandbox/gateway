/**
 * Greylist State Service
 *
 * Manages state for greylisting chaos simulation. Tracks delivery attempts
 * per tracking key (IP, sender, or IP+sender combination) to implement
 * reject-then-accept pattern.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

/**
 * State entry for a greylist tracking key
 */
export interface GreylistEntry {
  firstSeenAt: Date;
  attempts: number;
  inboxEmail: string;
}

@Injectable()
export class GreylistStateService {
  private readonly logger = new Logger(GreylistStateService.name);
  private readonly state = new Map<string, GreylistEntry>();

  /**
   * Build a tracking key based on the trackBy configuration.
   *
   * @param trackBy - How to track: 'ip', 'sender', or 'ip_sender'
   * @param inboxEmail - Target inbox email address
   * @param senderIp - Sender's IP address
   * @param senderEmail - Sender's email address
   * @returns Tracking key string
   */
  buildTrackingKey(
    trackBy: 'ip' | 'sender' | 'ip_sender',
    inboxEmail: string,
    senderIp: string,
    senderEmail: string,
  ): string {
    // Always include inbox email in key to isolate per-inbox
    const normalizedInbox = inboxEmail.toLowerCase();
    const normalizedSender = senderEmail.toLowerCase();

    switch (trackBy) {
      case 'ip':
        return `greylist:${normalizedInbox}:ip:${senderIp}`;
      case 'sender':
        return `greylist:${normalizedInbox}:sender:${normalizedSender}`;
      case 'ip_sender':
      default:
        return `greylist:${normalizedInbox}:ip_sender:${senderIp}:${normalizedSender}`;
    }
  }

  /**
   * Get or create entry for a tracking key.
   *
   * @param key - Tracking key
   * @param inboxEmail - Inbox email for logging
   * @returns Current entry (creates new if doesn't exist)
   */
  getOrCreateEntry(key: string, inboxEmail: string): GreylistEntry {
    let entry = this.state.get(key);

    if (!entry) {
      entry = {
        firstSeenAt: new Date(),
        attempts: 0,
        inboxEmail,
      };
      this.state.set(key, entry);
      this.logger.debug(`New greylist entry created: ${key}`);
    }

    return entry;
  }

  /**
   * Increment attempt count for a tracking key.
   *
   * @param key - Tracking key
   * @returns New attempt count
   */
  incrementAttempts(key: string): number {
    const entry = this.state.get(key);
    if (entry) {
      entry.attempts++;
      this.logger.debug(`Greylist attempt incremented: ${key} -> ${entry.attempts}`);
      return entry.attempts;
    }
    return 0;
  }

  /**
   * Get current attempt count for a tracking key.
   *
   * @param key - Tracking key
   * @returns Current attempt count, or 0 if not found
   */
  getAttempts(key: string): number {
    return this.state.get(key)?.attempts || 0;
  }

  /**
   * Check if entry exists and is within the retry window.
   *
   * @param key - Tracking key
   * @param retryWindowMs - Retry window in milliseconds
   * @returns True if entry exists and is within window
   */
  isWithinWindow(key: string, retryWindowMs: number): boolean {
    const entry = this.state.get(key);
    if (!entry) return false;

    const elapsed = Date.now() - entry.firstSeenAt.getTime();
    return elapsed <= retryWindowMs;
  }

  /**
   * Remove entry for a tracking key.
   *
   * @param key - Tracking key
   */
  removeEntry(key: string): void {
    this.state.delete(key);
    this.logger.debug(`Greylist entry removed: ${key}`);
  }

  /**
   * Clean up entries that have expired beyond the retry window.
   * Called periodically to prevent memory leaks.
   *
   * @param maxAge - Maximum age in milliseconds (default: 10 minutes)
   */
  cleanupStaleEntries(maxAge: number = 10 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.state.entries()) {
      const elapsed = now - entry.firstSeenAt.getTime();
      if (elapsed > maxAge) {
        this.state.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned ${cleaned} stale greylist entries`);
    }

    return cleaned;
  }

  /**
   * Periodic cleanup of stale greylist entries.
   * Runs every minute to remove entries older than 10 minutes.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  private periodicCleanup(): void {
    this.cleanupStaleEntries();
  }

  /**
   * Get current state size (for metrics/debugging).
   */
  getStateSize(): number {
    return this.state.size;
  }

  /**
   * Clear all state (for testing).
   */
  clearAll(): void {
    this.state.clear();
  }
}
