import { Logger } from '@nestjs/common';
import { parseOptionalBoolean } from './config.parsers';

const logger = new Logger('ConfigValidation');

/**
 * Checks if an IP address is a private/local IPv4 address.
 *
 * Allows RFC 1918 private ranges and loopback:
 * - 127.x.x.x (loopback)
 * - 10.x.x.x (Class A private)
 * - 172.16.x.x - 172.31.x.x (Class B private)
 * - 192.168.x.x (Class C private)
 *
 * @param ip - IP address string to check
 * @returns True if the IP is a valid private/local IPv4 address
 */
export function isPrivateIP(ip: string): boolean {
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = ip.match(ipv4Regex);

  if (!match) {
    return false;
  }

  const [, a, b, c, d] = match.map(Number);

  // Validate each octet is 0-255
  if ([a, b, c, d].some((octet) => octet > 255)) {
    return false;
  }

  // 127.x.x.x - loopback
  if (a === 127) {
    return true;
  }

  // 10.x.x.x - Class A private
  if (a === 10) {
    return true;
  }

  // 172.16.x.x - 172.31.x.x - Class B private
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }

  // 192.168.x.x - Class C private
  if (a === 192 && b === 168) {
    return true;
  }

  return false;
}

/**
 * Validates domain format using basic domain regex.
 *
 * Checks if a domain follows basic DNS naming rules.
 * Allows subdomains and TLDs with 2+ characters.
 * Also allows localhost, vaultsandbox, and private IPv4 addresses.
 *
 * @param domain - Domain name to validate
 * @returns True if domain format is valid
 */
export function isValidDomain(domain: string): boolean {
  // Explicitly allow localhost and internal service names for local development
  if (domain === 'localhost' || domain === 'vaultsandbox') {
    return true;
  }

  // Allow private/local IPv4 addresses for development and LAN testing
  if (isPrivateIP(domain)) {
    return true;
  }

  // Standard regex for FQDN (requires at least one dot and a 2+ char TLD)
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
  const hasTlsPaths = process.env.VSB_TLS_CERT_PATH || process.env.VSB_TLS_KEY_PATH;

  if (certEnabled && hasTlsPaths) {
    logger.warn(
      'Both automatic certificate management (VSB_CERT_ENABLED=true) ' +
        'and manual TLS paths (VSB_TLS_CERT_PATH/VSB_TLS_KEY_PATH) are configured. ' +
        'Manual TLS paths will be used; ACME certificate renewal will be skipped.',
    );
  }
}
