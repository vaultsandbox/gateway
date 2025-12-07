import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InboxStorageService } from '../storage/inbox-storage.service';
import { InboxService } from '../inbox.service';
import { DEFAULT_LOCAL_CLEANUP_INTERVAL } from '../../config/config.constants';

@Injectable()
export class InboxCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InboxCleanupService.name);
  private cleanupInterval: NodeJS.Timeout;
  private readonly intervalMs: number;

  constructor(
    private readonly storageService: InboxStorageService,
    private readonly configService: ConfigService,
    private readonly inboxService: InboxService,
  ) {
    // Get cleanup interval from config (default: 5 minutes)
    const intervalSeconds = this.configService.get<number>('vsb.local.cleanupInterval', DEFAULT_LOCAL_CLEANUP_INTERVAL);
    this.intervalMs = intervalSeconds * 1000;
  }

  onModuleInit() {
    // Start cleanup job
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredInboxes();
    }, this.intervalMs);

    this.logger.log(`Cleanup job scheduled every ${this.intervalMs / 1000}s`);

    // Run cleanup immediately on startup
    this.cleanupExpiredInboxes();
  }

  onModuleDestroy() {
    // Stop cleanup job on shutdown
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.logger.log('Cleanup job stopped');
    }
  }

  /**
   * Clean up expired inboxes
   */
  private cleanupExpiredInboxes() {
    const now = new Date();
    const inboxes = this.storageService.getAllInboxes();

    for (const inbox of inboxes) {
      if (inbox.expiresAt < now) {
        this.inboxService.deleteInbox(inbox.emailAddress);
      }
    }
  }

  /**
   * Manually trigger cleanup (for testing)
   */
  triggerCleanup() {
    this.logger.log('Manual cleanup triggered');
    this.cleanupExpiredInboxes();
  }
}
