import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that redirects HTTP requests to HTTPS with selective exceptions.
 *
 * This middleware ensures secure access to public endpoints while allowing
 * specific paths to remain accessible via HTTP:
 * - ACME HTTP-01 challenges (required by Let's Encrypt on port 80)
 * - Internal cluster P2P endpoints (already HMAC-authenticated)
 * - Health checks (for load balancers)
 *
 */
@Injectable()
export class RedirectToHttpsMiddleware implements NestMiddleware {
  constructor(private readonly configService: ConfigService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // Skip redirect if HTTPS is not enabled
    const httpsEnabled = this.configService.get<boolean>('vsb.main.httpsEnabled');
    const httpsPort = this.configService.get<number>('vsb.main.httpsPort');
    if (!httpsEnabled || !Number.isFinite(httpsPort)) {
      return next();
    }

    // Skip if already on HTTPS
    if (req.secure || req.protocol === 'https') {
      return next();
    }

    // Allow ACME challenges (required for Let's Encrypt validation)
    // Use originalUrl instead of path because path may be stripped by routing
    // console.log(`[RedirectMiddleware] Checking path: ${req.path}, url: ${req.url}, originalUrl: ${req.originalUrl}`);
    if (req.originalUrl.startsWith('/.well-known/acme-challenge/')) {
      // console.log(`[RedirectMiddleware] ACME challenge detected - allowing through`);
      return next();
    }

    // Allow cluster endpoints (internal P2P communication, already HMAC-authenticated)
    if (req.originalUrl.startsWith('/cluster/')) {
      return next();
    }

    // Allow health checks on HTTP for load balancers
    if (req.originalUrl === '/health' || req.path === '/health') {
      return next();
    }

    const allowedHosts = this.getAllowedHosts();
    const requestedHost = req.hostname?.toLowerCase();
    const redirectHost = this.resolveRedirectHost(requestedHost, allowedHosts);
    if (!redirectHost) {
      res.status(400).send('Invalid host header');
      return;
    }

    // Redirect to HTTPS
    // Preserve explicitly configured ports (including 0) and only skip default 443
    const portSuffix = httpsPort !== 443 ? `:${httpsPort}` : '';
    const httpsUrl = `https://${redirectHost}${portSuffix}${req.url}`;

    return res.redirect(301, httpsUrl);
  }

  private getAllowedHosts(): string[] {
    const hosts = new Set<string>();

    const origin = this.configService.get<string>('vsb.main.origin');
    const originHost = this.parseHost(origin);
    if (originHost) {
      hosts.add(originHost);
    }

    const allowedRecipientDomains = this.configService.get<string[]>('vsb.smtp.allowedRecipientDomains') ?? [];
    allowedRecipientDomains.forEach((domain) => hosts.add(domain.toLowerCase()));

    const certificateDomain = this.configService.get<string>('vsb.certificate.domain');
    if (certificateDomain) {
      hosts.add(certificateDomain.toLowerCase());
    }

    const certificateSans = this.configService.get<string[]>('vsb.certificate.additionalDomains') ?? [];
    certificateSans.forEach((domain) => hosts.add(domain.toLowerCase()));

    return Array.from(hosts);
  }

  private parseHost(value?: string): string | null {
    if (!value || value === '*') {
      return null;
    }

    try {
      const hasProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value);
      const url = new URL(hasProtocol ? value : `https://${value}`);
      return url.hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  private resolveRedirectHost(requestHost: string | undefined, allowedHosts: string[]): string | null {
    if (!requestHost) {
      return null;
    }

    const normalizedAllowedHosts = allowedHosts.map((host) => host.toLowerCase());
    return normalizedAllowedHosts.includes(requestHost) ? requestHost : null;
  }
}
