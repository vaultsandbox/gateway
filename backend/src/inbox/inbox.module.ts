import { Module } from '@nestjs/common';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { InboxStorageService } from './storage/inbox-storage.service';
import { InboxCleanupService } from './cleanup/inbox-cleanup.service';
import { CryptoModule } from '../crypto/crypto.module';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [CryptoModule, MetricsModule],
  controllers: [InboxController],
  providers: [InboxService, InboxStorageService, InboxCleanupService],
  exports: [InboxService, InboxStorageService],
})
export class InboxModule {}
