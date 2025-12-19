import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that adds security headers to responses for the Angular frontend.
 *
 * These headers protect against common web vulnerabilities:
 * - XSS (Cross-Site Scripting)
 * - Clickjacking
 * - MIME-type sniffing
 * - Information disclosure
 *
 * Note: HSTS is handled separately in main.ts for all HTTPS connections.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    // Prevent clickjacking by disallowing iframe embedding
    res.setHeader('X-Frame-Options', 'DENY');

    // Prevent MIME-type sniffing (forces browser to respect Content-Type)
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Control referrer information sent with requests
    // 'strict-origin-when-cross-origin' sends origin only for cross-origin requests
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Restrict browser features/APIs the page can use
    // Disable sensitive features that this app doesn't need
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
    );

    // Content Security Policy - restricts resource loading
    // This is a baseline policy; adjust based on your Angular app's needs
    const csp = [
      "default-src 'self'",
      // Allow inline styles for Angular (required for component styles)
      "style-src 'self' 'unsafe-inline'",
      // Scripts from same origin + inline (required for Angular/PrimeNG dynamic code)
      "script-src 'self' 'unsafe-inline'",
      // Allow images from any HTTPS source (required for displaying email content)
      "img-src 'self' data: https:",
      // Allow fonts from self
      "font-src 'self'",
      // Allow connections to self (API calls) and WebSocket for SSE
      "connect-src 'self'",
      // Prevent embedding in frames
      "frame-ancestors 'none'",
      // Form submissions only to self
      "form-action 'self'",
      // Only load from HTTPS in production
      'upgrade-insecure-requests',
    ].join('; ');

    res.setHeader('Content-Security-Policy', csp);

    // Cross-Origin policies for additional isolation
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    next();
  }
}
