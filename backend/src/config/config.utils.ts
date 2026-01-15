import * as process from 'process';
import { randomBytes } from 'crypto';
import { Logger } from '@nestjs/common';
import type { SecureVersion } from 'tls';
import { parseStringWithDefault, parseOptionalBoolean, readTlsBuffer } from './config.parsers';
import type { VsbConfiguration } from './config.types';
import {
  DEFAULT_TLS_MIN_VERSION,
  DEFAULT_TLS_CIPHERS,
  DEFAULT_TLS_HONOR_CIPHER_ORDER,
  DEFAULT_TLS_ECDH_CURVE,
} from './config.constants';

/**
 * Builds TLS configuration from environment variables.
 *
 * Reads certificate and key files from paths specified in environment variables.
 * Both cert and key must be provided together - partial TLS config is not allowed.
 *
 * TLS security hardening:
 * - Enforces TLS 1.2+ by default (RFC 8996 compliance)
 * - Uses forward-secrecy ciphers (ECDHE)
 * - Configurable via environment variables for flexibility
 *
 * Optional environment variables:
 * - VSB_SMTP_TLS_MIN_VERSION: Minimum TLS version (default: TLSv1.2)
 * - VSB_SMTP_TLS_CIPHERS: Colon-separated cipher suites (default: ECDHE ciphers)
 * - VSB_SMTP_TLS_HONOR_CIPHER_ORDER: Prefer server cipher order (default: true)
 * - VSB_SMTP_TLS_ECDH_CURVE: ECDH curve configuration (default: auto)
 *
 * @returns TLS configuration with cert and key buffers, or undefined if TLS not configured
 * @throws {Error} If only one of cert/key is provided (both required for TLS)
 */
export function buildTlsConfig() {
  const certPath = process.env.VSB_TLS_CERT_PATH;
  const keyPath = process.env.VSB_TLS_KEY_PATH;
  const cert = readTlsBuffer(certPath);
  const key = readTlsBuffer(keyPath);

  if (!cert && !key) {
    return undefined;
  }

  if (!cert || !key) {
    throw new Error('Both VSB_TLS_CERT_PATH and VSB_TLS_KEY_PATH must be provided to enable TLS.');
  }

  // TLS security hardening (RFC 8996 - deprecates TLS 1.0 and 1.1)
  const minVersion = parseStringWithDefault(
    process.env.VSB_SMTP_TLS_MIN_VERSION,
    DEFAULT_TLS_MIN_VERSION,
  ) as SecureVersion;
  const ciphers = parseStringWithDefault(process.env.VSB_SMTP_TLS_CIPHERS, DEFAULT_TLS_CIPHERS);
  const honorCipherOrder = parseOptionalBoolean(
    process.env.VSB_SMTP_TLS_HONOR_CIPHER_ORDER,
    DEFAULT_TLS_HONOR_CIPHER_ORDER,
  );
  const ecdhCurve = parseStringWithDefault(process.env.VSB_SMTP_TLS_ECDH_CURVE, DEFAULT_TLS_ECDH_CURVE);

  return {
    cert,
    key,
    minVersion,
    ciphers,
    honorCipherOrder,
    ecdhCurve,
  };
}

/**
 * Generate Node ID
 *
 * Creates a unique node identifier using hostname and cryptographic random bytes.
 * Used for distributed coordination when VSB_NODE_ID is not explicitly configured.
 *
 * @returns Node ID in format: hostname-randomhex
 */
export function generateNodeId(): string {
  const hostname = parseStringWithDefault(process.env.HOSTNAME, 'unknown');
  const randomId = randomBytes(4).toString('hex'); // 8 hex characters (more secure than Math.random)
  return `${hostname}-${randomId}`;
}

/**
 * Generate Shared Secret
 */
export function generateSharedSecret(): string {
  return randomBytes(32).toString('hex');
}

/* c8 ignore start */
/**
 * Log Configuration Summary
 *
 * Logs a summary of the loaded configuration for debugging purposes.
 * Sensitive values (API keys, secrets) are redacted.
 *
 * @param config - The complete configuration object
 */
export function logConfigurationSummary(config: VsbConfiguration): void {
  const summaryLogger = new Logger('Configuration');

  summaryLogger.log(`Environment: ${config.environment}`);
  summaryLogger.log(`Gateway Mode: ${config.main.gatewayMode}`);
  summaryLogger.log(`HTTP Server: port ${config.main.port}`);
  summaryLogger.log(
    `HTTPS Server: ${config.main.httpsEnabled ? `enabled (port ${config.main.httpsPort})` : 'disabled'}`,
  );

  summaryLogger.log(`SMTP Server: ${config.smtp.host}:${config.smtp.port} (secure: ${config.smtp.secure})`);
  summaryLogger.log(`SMTP Allowed Domains: ${config.smtp.allowedRecipientDomains.join(', ')}`);
  summaryLogger.log(`SMTP Max Message Size: ${config.smtp.maxMessageSize} bytes`);
  summaryLogger.log(`SMTP Max Connections: ${config.smtp.maxConnections}`);

  if (config.certificate.enabled) {
    summaryLogger.log(`Certificate Management: enabled (domain: ${config.certificate.domain})`);
    if (config.certificate.additionalDomains.length > 0) {
      summaryLogger.log(`Certificate SANs: ${config.certificate.additionalDomains.join(', ')}`);
    }
    summaryLogger.log(`ACME Directory: ${config.certificate.staging ? 'STAGING' : 'PRODUCTION'}`);
  } else {
    summaryLogger.log('Certificate Management: disabled');
  }

  if (config.orchestration.enabled) {
    summaryLogger.log(
      `Orchestration: enabled (cluster: ${config.orchestration.clusterName}, node: ${config.orchestration.nodeId})`,
    );
    summaryLogger.log(
      `Cluster Peers: ${config.orchestration.peers.length > 0 ? config.orchestration.peers.join(', ') : 'none'}`,
    );
    summaryLogger.log(`Backend URL: ${config.orchestration.backend.url || 'not configured'}`);
  } else {
    summaryLogger.log('Orchestration: disabled');
  }

  if (config.smtpRateLimit.enabled) {
    summaryLogger.log(
      `SMTP Rate Limiting: enabled (${config.smtpRateLimit.points} emails per ${config.smtpRateLimit.duration}s)`,
    );
  } else {
    summaryLogger.log('SMTP Rate Limiting: disabled');
  }

  summaryLogger.log(`API Rate Limiting: ${config.throttle.limit} requests per ${config.throttle.ttl}ms`);

  // Crypto configuration
  const hasCryptoKeys = config.crypto.sigSkPath && config.crypto.sigPkPath;
  summaryLogger.log(
    `Quantum-Safe Signing: ${hasCryptoKeys ? 'persistent keys' : 'ephemeral keys (generated on startup)'}`,
  );

  summaryLogger.log('Configuration loaded successfully');
}
/* c8 ignore stop */
