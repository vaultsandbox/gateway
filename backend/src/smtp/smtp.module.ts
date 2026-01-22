import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CertificateModule } from '../certificate/certificate.module';
import { CryptoModule } from '../crypto/crypto.module';
import { InboxModule } from '../inbox/inbox.module';
import { EventsModule } from '../events/events.module';
import { MetricsModule } from '../metrics/metrics.module';
import { SseConsoleModule } from '../sse-console/sse-console.module';
import { ChaosModule } from '../chaos/chaos.module';
import { SmtpHandlerService } from './smtp-handler.service';
import { SmtpService } from './smtp.service';
import { EmailValidationService } from './email-validation.service';
import { EmailProcessingService } from './email-processing.service';
import { EmailStorageService } from './storage/email-storage.service';
import { SmtpRateLimiterService } from './smtp-rate-limiter.service';
import { SpamAnalysisService } from './spam-analysis.service';
import { DEFAULT_GATEWAY_MODE, DEFAULT_CHAOS_ENABLED } from '../config/config.constants';
import { parseOptionalBoolean } from '../config/config.parsers';

// Conditional imports based on gateway mode
const gatewayMode = process.env.VSB_GATEWAY_MODE || DEFAULT_GATEWAY_MODE;
const chaosEnabled = parseOptionalBoolean(process.env.VSB_CHAOS_ENABLED, DEFAULT_CHAOS_ENABLED);

// Dynamic imports array
const dynamicImports = [CertificateModule, MetricsModule, SseConsoleModule];

if (gatewayMode === 'local') {
  // Local mode Imports
  dynamicImports.push(CryptoModule);
  dynamicImports.push(InboxModule);
  dynamicImports.push(EventsModule);
  dynamicImports.push(HttpModule); // For spam analysis (Rspamd HTTP calls)
  if (chaosEnabled) {
    dynamicImports.push(ChaosModule); // For chaos engineering features
  }
} else if (gatewayMode === 'backend') {
  // Backend mode Imports
  dynamicImports.push(CryptoModule);
  dynamicImports.push(HttpModule);
}

// Dynamic providers array (EmailStorageService only in local mode)

const dynamicProviders: any[] = [
  EmailValidationService,
  EmailProcessingService,
  SmtpHandlerService,
  SmtpService,
  SmtpRateLimiterService,
];

if (gatewayMode === 'local') {
  // Add EmailStorageService only in local mode (provides memory management for in-memory email storage)
  dynamicProviders.push(EmailStorageService);
  // Add SpamAnalysisService for Rspamd integration in local mode
  dynamicProviders.push(SpamAnalysisService);
}

// Dynamic exports array

const dynamicExports: any[] = [SmtpService];

if (gatewayMode === 'local') {
  // Export EmailStorageService in local mode for MetricsController access
  dynamicExports.push(EmailStorageService);
}

@Module({
  imports: dynamicImports,
  providers: dynamicProviders,
  exports: dynamicExports,
})
export class SmtpModule {}
