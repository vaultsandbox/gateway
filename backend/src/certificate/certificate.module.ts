import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { CertificateController } from './certificate.controller';
import { CertificateService } from './certificate.service';
import { AcmeClientService } from './acme/acme-client.service';
import { CertificateStorageService } from './storage/certificate-storage.service';
import { CertificateWatcherService } from './watcher/certificate-watcher.service';
import { CertificateHealthIndicator } from './certificate.health';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { PeerAuthGuard } from './guards/peer-auth.guard';
import type { CertificateConfig } from './interfaces';
import { CERTIFICATE_CONFIG } from './certificate.tokens';
import { TerminusModule } from '@nestjs/terminus';

/**
 * Factory provider for CertificateConfig.
 * Centralizes the logic for loading certificate configuration from ConfigService.
 */
const certificateConfigProvider = {
  provide: CERTIFICATE_CONFIG,
  useFactory: (configService: ConfigService): CertificateConfig => {
    const config = configService.get<CertificateConfig>('vsb.certificate');
    return (
      config ??
      ({
        enabled: false,
        email: '',
        domain: '',
        storagePath: '/tmp/certificates',
        checkInterval: 86_400_000,
        renewDaysBeforeExpiry: 30,
        acmeDirectoryUrl: '',
        staging: false,
        peerSharedSecret: '',
      } satisfies CertificateConfig)
    );
  },
  inject: [ConfigService],
};

/**
 * The NestJS module for all certificate management functionalities.
 * It encapsulates controllers, services, and providers related to ACME certificate
 * issuance, renewal, storage, and cluster synchronization.
 */
@Module({
  imports: [HttpModule, OrchestrationModule, TerminusModule],
  controllers: [CertificateController],
  providers: [
    certificateConfigProvider,
    CertificateService,
    AcmeClientService,
    CertificateStorageService,
    CertificateWatcherService,
    CertificateHealthIndicator,
    PeerAuthGuard,
  ],
  exports: [CertificateService, CertificateHealthIndicator],
})
export class CertificateModule {}
