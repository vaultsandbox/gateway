/**
 * Email Storage Service
 *
 * Centralized email storage with FIFO eviction policy and memory management.
 * Uses tombstone pattern for O(1) deletion while maintaining insertion order.
 *
 * ## Responsibilities
 * - Track all emails globally across all inboxes
 * - Monitor total memory usage
 * - Implement FIFO eviction when memory limits are reached
 * - Provide storage metrics and health information
 * - Coordinate with InboxStorageService for actual storage
 *
 * ## Eviction Strategy
 * - FIFO (First In, First Out): Oldest emails evicted first
 * - Tombstone pattern: Set encrypted payloads to null instead of array deletion
 * - O(1) deletion performance by avoiding array shifts
 * - Periodic compaction removes tombstone metadata (hourly)
 *
 * ## Memory Management
 * - Configurable memory limit (default: 500MB)
 * - Tracks encrypted payload sizes (metadata + parsed + raw)
 * - Automatic eviction when incoming email would exceed limit
 * - Optional time-based eviction (configurable, supplements inbox TTL)
 *
 * @module smtp-storage
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InboxStorageService } from '../../inbox/storage/inbox-storage.service';
import type { EncryptedPayload } from '../../crypto/interfaces';

interface EmailTrackingEntry {
  emailId: string;
  inboxEmail: string; // Inbox email address
  size: number; // Total size in bytes
  receivedAt: Date;
  isTombstone: boolean; // True if encrypted payloads have been nulled
}

interface EncryptedEmailPayloads {
  encryptedMetadata: EncryptedPayload;
  encryptedParsed: EncryptedPayload;
  encryptedRaw: EncryptedPayload;
}

@Injectable()
export class EmailStorageService {
  private readonly logger = new Logger(EmailStorageService.name);
  private readonly maxMemoryBytes: number;
  private readonly maxAgeMs: number;

  // Global tracking of all emails in insertion order (FIFO)
  private emails: EmailTrackingEntry[] = [];

  // Current memory usage across all emails
  private currentMemoryUsage = 0;

  // Eviction statistics
  private evictedCount = 0;

  /* c8 ignore next 4 */
  constructor(
    private readonly configService: ConfigService,
    private readonly inboxStorageService: InboxStorageService,
  ) {
    // Default 500MB, configurable via VSB_SMTP_MAX_MEMORY_MB
    const maxMemoryMB = this.configService.get<number>('vsb.smtp.maxMemoryMB', 500);
    this.maxMemoryBytes = maxMemoryMB * 1024 * 1024;

    // Default 0 = disabled, user can configure in seconds via VSB_SMTP_MAX_EMAIL_AGE_SECONDS
    const maxAgeSeconds = this.configService.get<number>('vsb.smtp.maxEmailAgeSeconds', 0);
    this.maxAgeMs = maxAgeSeconds * 1000;

    // Register with InboxStorageService for deletion notifications (avoids circular dependency)
    this.inboxStorageService.setEmailStorageService(this);

    this.logger.log(
      `EmailStorageService initialized: maxMemory=${(this.maxMemoryBytes / 1024 / 1024).toFixed(2)}MB, ` +
        `maxAge=${maxAgeSeconds > 0 ? `${maxAgeSeconds}s` : 'disabled'}`,
    );
  }

  /**
   * Store encrypted email payloads in inbox storage with memory management.
   * Automatically evicts oldest emails if memory limit would be exceeded.
   *
   * @param inboxEmail - Inbox email address
   * @param emailId - UUID for the email
   * @param payloads - Encrypted payloads (metadata, parsed, raw)
   * @returns Email ID
   */
  storeEmail(inboxEmail: string, emailId: string, payloads: EncryptedEmailPayloads): string {
    // Calculate total size of encrypted payloads
    const emailSize = this.calculatePayloadSize(payloads);

    // Hard cap: reject if the single email exceeds the configured limit
    if (emailSize > this.maxMemoryBytes) {
      throw new Error(
        `Incoming email size ${emailSize}B exceeds max memory limit ${this.maxMemoryBytes}B. Rejecting to prevent OOM.`,
      );
    }

    // Evict oldest emails if needed to make room
    this.evictIfNeeded(emailSize);

    // Safety net: if we still don't have room, reject
    /* c8 ignore next 3 -- defensive check: eviction should always free enough space */
    if (this.currentMemoryUsage + emailSize > this.maxMemoryBytes) {
      throw new Error('Unable to free enough space for incoming email. Rejecting to stay within memory limit.');
    }

    // Store the email in inbox storage (delegates to InboxStorageService)
    this.inboxStorageService.addEmail(inboxEmail, {
      id: emailId,
      encryptedMetadata: payloads.encryptedMetadata,
      encryptedParsed: payloads.encryptedParsed,
      encryptedRaw: payloads.encryptedRaw,
      isRead: false,
    });

    // Track the email globally for FIFO eviction
    this.emails.push({
      emailId,
      inboxEmail,
      size: emailSize,
      receivedAt: new Date(),
      isTombstone: false,
    });

    this.currentMemoryUsage += emailSize;

    this.logger.debug(
      `Stored email ${emailId} (${(emailSize / 1024).toFixed(2)}KB) - ` +
        `Memory: ${(this.currentMemoryUsage / 1024 / 1024).toFixed(2)}MB / ${(this.maxMemoryBytes / 1024 / 1024).toFixed(2)}MB ` +
        `(${((this.currentMemoryUsage / this.maxMemoryBytes) * 100).toFixed(1)}%)`,
    );

    return emailId;
  }

  /**
   * Evict oldest emails until we have space for incoming email.
   * Uses tombstone pattern for O(1) performance.
   *
   * @param incomingSize - Size of incoming email in bytes
   */
  private evictIfNeeded(incomingSize: number): void {
    // Check if we need to evict
    if (this.currentMemoryUsage + incomingSize <= this.maxMemoryBytes) {
      return;
    }

    let evictedThisRound = 0;
    let freedBytes = 0;

    // Evict oldest (first non-tombstone) emails until we have space
    while (this.currentMemoryUsage + incomingSize > this.maxMemoryBytes) {
      // Find first email that hasn't been tombstoned yet
      const oldest = this.emails.find((e) => !e.isTombstone);

      /* c8 ignore next 9 -- defensive check: should always have non-tombstoned emails if eviction is needed */
      if (!oldest) {
        this.logger.warn(
          'Cannot evict - no emails remaining. ' +
            `Incoming: ${(incomingSize / 1024).toFixed(2)}KB, ` +
            `Available: ${((this.maxMemoryBytes - this.currentMemoryUsage) / 1024).toFixed(2)}KB`,
        );
        break;
      }

      // Tombstone the email (nulls encrypted payloads in inbox storage)
      freedBytes += this.tombstoneEmail(oldest);

      evictedThisRound++;
    }

    if (evictedThisRound > 0) {
      this.logger.log(
        `Evicted ${evictedThisRound} email(s) to make room for incoming email ` +
          `(freed ${(freedBytes / 1024).toFixed(2)}KB, available ${((this.maxMemoryBytes - this.currentMemoryUsage) / 1024).toFixed(2)}KB)`,
      );
    }
  }

  /**
   * Tombstone an email by setting its encrypted payloads to null.
   * This releases ~99.9% of memory (the payloads) while keeping metadata for tracking.
   *
   * @param entry - Email tracking entry to tombstone
   */
  private tombstoneEmail(entry: EmailTrackingEntry): number {
    try {
      // Get the inbox
      const inbox = this.inboxStorageService.getInbox(entry.inboxEmail);
      if (!inbox) {
        this.logger.warn(
          `Inbox not found for eviction: ${entry.inboxEmail}, marking as tombstone anyway to prevent infinite loop`,
        );
        // Mark as tombstone even if inbox missing (prevents infinite loop)
        entry.isTombstone = true;
        this.currentMemoryUsage = Math.max(0, this.currentMemoryUsage - entry.size);
        this.evictedCount++;
        return entry.size;
      }

      // Get the email from inbox
      const email = inbox.emails.get(entry.emailId);
      if (!email) {
        this.logger.warn(
          `Email ${entry.emailId} not found in inbox ${entry.inboxEmail}, marking as tombstone anyway to prevent infinite loop`,
        );
        // Mark as tombstone even if email missing (prevents infinite loop)
        entry.isTombstone = true;
        this.currentMemoryUsage = Math.max(0, this.currentMemoryUsage - entry.size);
        this.evictedCount++;
        return entry.size;
      }

      // Remove from inbox storage so API consumers don't see evicted entries
      this.inboxStorageService.evictEmail(entry.inboxEmail, entry.emailId);

      // Mark as tombstone in tracking
      entry.isTombstone = true;
      this.currentMemoryUsage -= entry.size;
      this.evictedCount++;

      const ageMs = Date.now() - entry.receivedAt.getTime();
      this.logger.log(
        `Evicted email ${entry.emailId} from ${entry.inboxEmail} ` +
          `(${(entry.size / 1024).toFixed(2)}KB, age: ${(ageMs / 1000).toFixed(1)}s)`,
      );

      return entry.size;
    } catch (error) {
      this.logger.error(
        `Failed to tombstone email ${entry.emailId}: ${error}, marking as tombstone anyway to prevent infinite loop`,
      );
      // Mark as tombstone even on exception (prevents infinite loop)
      entry.isTombstone = true;
      this.currentMemoryUsage = Math.max(0, this.currentMemoryUsage - entry.size);
      this.evictedCount++;
      return entry.size;
    }
  }

  /**
   * Calculate the total size of encrypted payloads in bytes.
   * Estimates size based on base64url-encoded fields.
   *
   * @param payloads - Encrypted email payloads
   * @returns Estimated size in bytes
   */
  private calculatePayloadSize(payloads: EncryptedEmailPayloads): number {
    return (
      this.estimateEncryptedPayloadSize(payloads.encryptedMetadata) +
      this.estimateEncryptedPayloadSize(payloads.encryptedParsed) +
      this.estimateEncryptedPayloadSize(payloads.encryptedRaw)
    );
  }

  /**
   * Estimate the size of a single encrypted payload in bytes.
   * Uses Uint8Array.length for binary fields (no base64 encoding overhead).
   *
   * @param payload - Encrypted payload
   * @returns Estimated size in bytes
   */
  private estimateEncryptedPayloadSize(payload: EncryptedPayload): number {
    const totalBytes =
      payload.ct_kem.length +
      payload.nonce.length +
      payload.aad.length +
      payload.ciphertext.length +
      payload.sig.length +
      payload.server_sig_pk.length;

    // Add overhead for object structure (~100 bytes per payload, reduced from 200
    // because we no longer have base64 string overhead)
    return totalBytes + 100;
  }

  /**
   * Get storage metrics for monitoring and debugging.
   *
   * @returns Storage metrics including memory usage, email counts, and eviction stats
   */
  getMetrics() {
    const activeEmails = this.emails.filter((e) => !e.isTombstone);
    const tombstoneCount = this.emails.length - activeEmails.length;

    return {
      storage: {
        maxMemoryBytes: this.maxMemoryBytes,
        maxMemoryMB: (this.maxMemoryBytes / 1024 / 1024).toFixed(2),
        usedMemoryBytes: this.currentMemoryUsage,
        usedMemoryMB: (this.currentMemoryUsage / 1024 / 1024).toFixed(2),
        availableMemoryBytes: this.maxMemoryBytes - this.currentMemoryUsage,
        availableMemoryMB: ((this.maxMemoryBytes - this.currentMemoryUsage) / 1024 / 1024).toFixed(2),
        utilizationPercent: ((this.currentMemoryUsage / this.maxMemoryBytes) * 100).toFixed(2),
      },
      emails: {
        totalStored: activeEmails.length,
        totalEvicted: this.evictedCount,
        tombstones: tombstoneCount,
        oldestEmailAge: activeEmails.length > 0 ? Date.now() - activeEmails[0].receivedAt.getTime() : null,
        newestEmailAge:
          activeEmails.length > 0 ? Date.now() - activeEmails[activeEmails.length - 1].receivedAt.getTime() : null,
      },
      eviction: {
        maxAgeSeconds: this.maxAgeMs > 0 ? this.maxAgeMs / 1000 : null,
        maxAgeEnabled: this.maxAgeMs > 0,
      },
    };
  }

  /**
   * Periodic cleanup to remove tombstone metadata and reclaim tracking memory.
   * Runs every hour to compact the email tracking array.
   */
  @Cron(CronExpression.EVERY_HOUR)
  compactStorage() {
    const before = this.emails.length;

    // Remove tombstone entries (keep only active emails)
    this.emails = this.emails.filter((e) => !e.isTombstone);

    const removed = before - this.emails.length;
    if (removed > 0) {
      this.logger.log(
        `Compacted storage: removed ${removed} tombstone(s) (${before} -> ${this.emails.length} tracked emails)`,
      );
    }
  }

  /**
   * Periodic cleanup to evict stale emails based on age.
   * Runs every hour to check for emails that exceed max age.
   * Only active if VSB_SMTP_MAX_EMAIL_AGE_SECONDS is configured (> 0).
   */
  @Cron(CronExpression.EVERY_HOUR)
  evictStaleEmails() {
    // Skip if time-based eviction is disabled
    if (this.maxAgeMs === 0) {
      return;
    }

    const cutoff = Date.now() - this.maxAgeMs;
    let evictedCount = 0;

    // Find and tombstone all emails older than cutoff
    for (const email of this.emails) {
      if (!email.isTombstone && email.receivedAt.getTime() < cutoff) {
        this.tombstoneEmail(email);
        evictedCount++;
      }
    }

    if (evictedCount > 0) {
      const ageHours = (this.maxAgeMs / 1000 / 60 / 60).toFixed(1);
      this.logger.log(`Evicted ${evictedCount} email(s) older than ${ageHours}h (${this.maxAgeMs / 1000}s)`);
    }
  }

  /**
   * Remove an email from tracking when it's deleted by the user.
   * This is called when a user explicitly deletes an email via the API.
   *
   * @param inboxEmail - Inbox email address
   * @param emailId - Email ID to remove
   */
  onEmailDeleted(inboxEmail: string, emailId: string): void {
    const index = this.emails.findIndex((e) => e.emailId === emailId && e.inboxEmail === inboxEmail);

    if (index !== -1) {
      const entry = this.emails[index];

      // If not already tombstoned, free the memory
      if (!entry.isTombstone) {
        this.currentMemoryUsage -= entry.size;
      }

      // Remove from tracking completely (user-initiated deletion)
      this.emails.splice(index, 1);

      this.logger.debug(`Removed email ${emailId} from tracking (user deletion)`);
    }
  }

  /**
   * Remove all emails for an inbox from tracking when inbox is deleted.
   *
   * @param inboxEmail - Inbox email address
   */
  onInboxDeleted(inboxEmail: string): void {
    const before = this.emails.length;
    let freedMemory = 0;

    // Remove all emails for this inbox
    this.emails = this.emails.filter((e) => {
      if (e.inboxEmail === inboxEmail) {
        if (!e.isTombstone) {
          freedMemory += e.size;
        }
        return false; // Remove from tracking
      }
      return true; // Keep emails from other inboxes
    });

    this.currentMemoryUsage -= freedMemory;

    const removed = before - this.emails.length;
    if (removed > 0) {
      this.logger.log(
        `Removed ${removed} email(s) from tracking (inbox deletion: ${inboxEmail}, ` +
          `freed ${(freedMemory / 1024).toFixed(2)}KB)`,
      );
    }
  }
}
