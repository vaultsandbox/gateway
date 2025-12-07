import { Logger } from '@nestjs/common';
import { parseOptionalBoolean } from './config.parsers';

const logger = new Logger('ConfigValidation');

/**
 * Validates domain format using basic domain regex.
 *
 * Checks if a domain follows basic DNS naming rules.
 * Allows subdomains and TLDs with 2+ characters.
 *
 * @param domain - Domain name to validate
 * @returns True if domain format is valid
 */
export function isValidDomain(domain: string): boolean {
  // Basic domain regex - allows subdomains, requires TLD with 2+ chars
  // Matches: example.com, mail.example.com, sub.domain.example.org
  return /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(domain);
}

/**
 * Validates TLS configuration for common misconfigurations.
 *
 * Logs warnings for:
 * - Port 25 with secure=true (should use secure=false for STARTTLS)
 * - Both certificate management and manual TLS paths configured
 */
export function validateTlsConfig(smtpPort: number, smtpSecure: boolean): void {
  // Warn if port 25 is used with secure=true (common misconfiguration)
  if (smtpPort === 25 && smtpSecure) {
    logger.warn(
      'Port 25 is configured with VSB_SMTP_SECURE=true. ' +
        'For server-to-server email delivery on port 25, VSB_SMTP_SECURE should be false to enable STARTTLS. ' +
        'See docs/plan-tls.md for details.',
    );
  }

  // Warn if both certificate management and manual TLS paths are configured
  const certEnabled = parseOptionalBoolean(process.env.VSB_CERT_ENABLED, false);
  const hasTlsPaths = process.env.VSB_SMTP_TLS_CERT_PATH || process.env.VSB_SMTP_TLS_KEY_PATH;

  if (certEnabled && hasTlsPaths) {
    logger.warn(
      'Both automatic certificate management (VSB_CERT_ENABLED=true) ' +
        'and manual TLS paths (VSB_SMTP_TLS_CERT_PATH/VSB_SMTP_TLS_KEY_PATH) are configured. ' +
        'Manual TLS paths will be IGNORED. Remove manual path configuration to avoid confusion.',
    );
  }
}
