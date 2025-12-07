import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { HealthController } from './health.controller';
import { SmtpHealthIndicator } from './smtp.health';
import { SmtpModule } from '../smtp/smtp.module';
import { CertificateModule } from '../certificate/certificate.module';
import { CertificateHealthIndicator } from '../certificate/certificate.health';

/**
 * The HealthModule provides health check endpoints for the application.
 */
@Module({
  imports: [TerminusModule, HttpModule, SmtpModule, CertificateModule],
  controllers: [HealthController],
  providers: [SmtpHealthIndicator, CertificateHealthIndicator],
})
export class HealthModule {}
