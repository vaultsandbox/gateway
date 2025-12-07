import { Module } from '@nestjs/common';
import { HttpServerService } from './http-server.service';
import { RedirectToHttpsMiddleware } from './redirect-to-https.middleware';
import { CertificateModule } from '../certificate/certificate.module';

/**
 * Server module for managing HTTP/HTTPS dual server architecture.
 *
 * Provides:
 * - HttpServerService: Manages both HTTP and HTTPS servers
 * - RedirectToHttpsMiddleware: Redirects HTTP to HTTPS with exceptions
 *
 * Dependencies:
 * - CertificateModule: For TLS certificate management and hot-reload
 */
@Module({
  imports: [CertificateModule],
  providers: [HttpServerService, RedirectToHttpsMiddleware],
  exports: [HttpServerService, RedirectToHttpsMiddleware],
})
export class ServerModule {}
