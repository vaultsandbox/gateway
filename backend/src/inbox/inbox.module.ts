import { Module, forwardRef } from '@nestjs/common';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { InboxStorageService } from './storage/inbox-storage.service';
import { InboxCleanupService } from './cleanup/inbox-cleanup.service';
import { CryptoModule } from '../crypto/crypto.module';
import { MetricsModule } from '../metrics/metrics.module';
import { ChaosModule } from '../chaos/chaos.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { DEFAULT_CHAOS_ENABLED } from '../config/config.constants';
import { parseOptionalBoolean } from '../config/config.parsers';

// Dynamic imports array - ChaosModule only when chaos is enabled
const chaosEnabled = parseOptionalBoolean(process.env.VSB_CHAOS_ENABLED, DEFAULT_CHAOS_ENABLED);
const dynamicImports: any[] = [CryptoModule, MetricsModule, forwardRef(() => PersistenceModule)];
if (chaosEnabled) {
  dynamicImports.push(ChaosModule);
}

@Module({
  imports: dynamicImports,
  controllers: [InboxController],
  providers: [InboxService, InboxStorageService, InboxCleanupService],
  exports: [InboxService, InboxStorageService],
})
export class InboxModule {}
