import { registerAs } from '@nestjs/config';
import * as process from 'process';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { Logger } from '@nestjs/common';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import {
  DEFAULT_DATA_PATH,
  DEFAULT_MAX_CONNECTIONS,
  DEFAULT_CLOSE_TIMEOUT,
  DEFAULT_EARLY_TALKER_DELAY,
  DEFAULT_SMTP_BANNER,
  DEFAULT_DISABLED_COMMANDS,
  DEFAULT_LOCAL_INBOX_TTL,
  DEFAULT_LOCAL_INBOX_MAX_TTL,
  DEFAULT_LOCAL_INBOX_ALIAS_RANDOM_BYTES,
  DEFAULT_LOCAL_CLEANUP_INTERVAL,
  MIN_INBOX_ALIAS_RANDOM_BYTES,
  MAX_INBOX_ALIAS_RANDOM_BYTES,
  DEFAULT_HARD_MODE_REJECT_CODE,
  DEFAULT_BACKEND_REQUEST_TIMEOUT,
  DEFAULT_LEADERSHIP_TTL,
  DEFAULT_CERT_CHECK_INTERVAL,
  DEFAULT_CERT_RENEW_THRESHOLD_DAYS,
  DEFAULT_ACME_DIRECTORY_URL,
  DEFAULT_THROTTLE_TTL,
  DEFAULT_THROTTLE_LIMIT,
  DEFAULT_SMTP_RATE_LIMIT_MAX_EMAILS,
  DEFAULT_SMTP_RATE_LIMIT_DURATION,
  DEFAULT_SERVER_PORT,
  DEFAULT_HTTPS_PORT,
  DEFAULT_CLUSTER_NAME,
  DEFAULT_GATEWAY_MODE,
  ALLOWED_GATEWAY_MODES,
  DEFAULT_SMTP_MAX_MESSAGE_SIZE,
  DEFAULT_SMTP_MAX_HEADER_SIZE,
  DEFAULT_SMTP_SESSION_TIMEOUT,
  DEFAULT_SMTP_PORT,
  DEFAULT_SMTP_HOST,
} from './config/config.constants';
import {
  parseOptionalBoolean,
  parseNumberWithDefault,
  parseStringWithDefault,
  parseAllowedDomains,
  parseDisabledCommands,
} from './config/config.parsers';
import { isValidDomain, validateTlsConfig } from './config/config.validators';
import { buildTlsConfig, generateNodeId, generateSharedSecret } from './config/config.utils';

const logger = new Logger('ConfigValidation');

/**
 * Builds complete SMTP server configuration from environment variables.
 *
 * Configures a receive-only SMTP server with domain validation to prevent
 * relaying. All values must be explicitly provided - no defaults are used.
 * This ensures the server only runs with explicit, validated configuration.
 *
 * Required environment variables:
 * - VSB_SMTP_HOST: Server bind address
 * - VSB_SMTP_PORT: Server port number
 * - VSB_SMTP_SECURE: Whether to use TLS (true/false)
 * - VSB_SMTP_MAX_MESSAGE_SIZE: Maximum message size in bytes
 * - VSB_SMTP_SESSION_TIMEOUT: Session timeout in milliseconds
 * - VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS: Comma-separated list of domains to accept emails for
 *
 * Optional security environment variables:
 * - VSB_SMTP_MAX_CONNECTIONS: Maximum concurrent connections (default: 25)
 * - VSB_SMTP_CLOSE_TIMEOUT: Force-close timeout in ms (default: 30000)
 * - VSB_SMTP_DISABLED_COMMANDS: Comma-separated commands to disable (default: VRFY,EXPN,ETRN,TURN,AUTH)
 * - VSB_SMTP_DISABLE_PIPELINING: Hide PIPELINING capability (default: false)
 * - VSB_SMTP_EARLY_TALKER_DELAY: Banner delay in ms for early talker detection (default: 300)
 * - VSB_SMTP_BANNER: Custom server banner (default: "VaultSandbox Test SMTP Server (Receive-Only)")
 * - VSB_SMTP_MAX_HEADER_SIZE: Maximum header block size in bytes (default: 65536 = 64KB)
 *
 * @returns Complete SMTP configuration object
 * @throws {Error} If any required configuration value is missing or invalid
 */
function buildSmtpConfig() {
  const smtpHost = parseStringWithDefault(process.env.VSB_SMTP_HOST, DEFAULT_SMTP_HOST);
  const smtpPort = parseNumberWithDefault(process.env.VSB_SMTP_PORT, DEFAULT_SMTP_PORT);
  const smtpSecure = parseOptionalBoolean(process.env.VSB_SMTP_SECURE, false);
  const tlsConfig = buildTlsConfig();
  const certEnabled = parseOptionalBoolean(process.env.VSB_CERT_ENABLED, false);

  // Validate TLS configuration for common misconfigurations
  validateTlsConfig(smtpPort, smtpSecure);

  if (smtpSecure && !tlsConfig && !certEnabled) {
    throw new Error(
      'VSB_SMTP_SECURE=true requires TLS credentials. Either:\n' +
        '  1. Enable certificate management: VSB_CERT_ENABLED=true\n' +
        '  2. Provide manual certificates: VSB_SMTP_TLS_CERT_PATH + VSB_SMTP_TLS_KEY_PATH',
    );
  }

  return {
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    maxMessageSize: parseNumberWithDefault(process.env.VSB_SMTP_MAX_MESSAGE_SIZE, DEFAULT_SMTP_MAX_MESSAGE_SIZE),
    maxHeaderSize: parseNumberWithDefault(process.env.VSB_SMTP_MAX_HEADER_SIZE, DEFAULT_SMTP_MAX_HEADER_SIZE),
    sessionTimeout: parseNumberWithDefault(process.env.VSB_SMTP_SESSION_TIMEOUT, DEFAULT_SMTP_SESSION_TIMEOUT),
    allowedRecipientDomains: parseAllowedDomains(),
    tls: tlsConfig,

    // Security controls
    maxConnections: parseNumberWithDefault(process.env.VSB_SMTP_MAX_CONNECTIONS, DEFAULT_MAX_CONNECTIONS),
    closeTimeout: parseNumberWithDefault(process.env.VSB_SMTP_CLOSE_TIMEOUT, DEFAULT_CLOSE_TIMEOUT),
    disabledCommands: parseDisabledCommands(DEFAULT_DISABLED_COMMANDS),
    disablePipelining: parseOptionalBoolean(process.env.VSB_SMTP_DISABLE_PIPELINING, false),
    earlyTalkerDelay: parseNumberWithDefault(process.env.VSB_SMTP_EARLY_TALKER_DELAY, DEFAULT_EARLY_TALKER_DELAY),
    banner: parseStringWithDefault(process.env.VSB_SMTP_BANNER, DEFAULT_SMTP_BANNER),

    // Memory management for email storage
    maxMemoryMB: parseNumberWithDefault(process.env.VSB_SMTP_MAX_MEMORY_MB, 500),
    maxEmailAgeSeconds: parseNumberWithDefault(process.env.VSB_SMTP_MAX_EMAIL_AGE_SECONDS, 0),
  };
}

/**
 * Build Local Mode Configuration
 *
 * Configures the gateway when running in local/standalone mode without a backend service.
 * Local mode stores emails in-memory with configurable TTL and cleanup intervals.
 *
 * API Key Loading Strategy (in order of precedence):
 * 1. VSB_LOCAL_API_KEY environment variable (explicit configuration)
 * 2. Persisted key from ${VSB_DATA_PATH}/.api-key file (auto-generated on first run)
 * 3. Auto-generate and persist new key (first-time setup)
 *
 * Optional environment variables:
 * - VSB_LOCAL_API_KEY: API key for authenticating local mode requests (minimum 32 characters)
 * - VSB_LOCAL_API_KEY_STRICT: Require explicit API key, disable auto-generation (default: false)
 * - VSB_LOCAL_INBOX_DEFAULT_TTL: Default inbox TTL in seconds (default: 3600 = 1 hour)
 * - VSB_LOCAL_INBOX_MAX_TTL: Maximum inbox TTL in seconds (default: 604800 = 7 days)
 * - VSB_LOCAL_CLEANUP_INTERVAL: Interval for cleaning up expired inboxes in seconds (default: 300 = 5 minutes)
 * - VSB_SMTP_HARD_MODE_REJECT_CODE: SMTP reject code for hard mode (default: 421)
 *
 * @returns Local mode configuration object
 * @throws {Error} If strict mode enabled and VSB_LOCAL_API_KEY is missing, or if API key is too short
 */
function buildLocalModeConfig() {
  const apiKeyFromEnv = process.env.VSB_LOCAL_API_KEY;
  const strictMode = parseOptionalBoolean(process.env.VSB_LOCAL_API_KEY_STRICT, false);
  const dataPath = parseStringWithDefault(process.env.VSB_DATA_PATH, DEFAULT_DATA_PATH);
  const apiKeyFilePath = join(dataPath, '.api-key');

  let apiKey: string | undefined;
  let source: 'env' | 'file' | 'generated' | undefined;

  // Precedence 1: Environment variable (explicit configuration)
  if (apiKeyFromEnv && apiKeyFromEnv.trim()) {
    apiKey = apiKeyFromEnv.trim();
    source = 'env';
  } else if (strictMode) {
    // Strict mode: Require explicit API key (advanced users, CI/CD)
    throw new Error(
      '\n' +
        '═'.repeat(80) +
        '\n' +
        '❌ CONFIGURATION ERROR: VSB_LOCAL_API_KEY is required (strict mode)\n' +
        '═'.repeat(80) +
        '\n\n' +
        'VSB_LOCAL_API_KEY_STRICT=true requires explicit API key configuration.\n' +
        'Generate a secure API key using one of these methods:\n\n' +
        '  openssl rand -base64 32\n' +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"\n\n" +
        'Then set it in your environment:\n' +
        '  export VSB_LOCAL_API_KEY="<generated-key>"\n\n' +
        'Or add to your .env file:\n' +
        '  VSB_LOCAL_API_KEY=<generated-key>\n\n' +
        '═'.repeat(80) +
        '\n',
    );
  } else {
    // Precedence 2: Try to load from persisted file
    try {
      if (existsSync(apiKeyFilePath)) {
        const fileContent = readFileSync(apiKeyFilePath, 'utf-8').trim();
        if (fileContent && fileContent.length >= 32) {
          apiKey = fileContent;
          source = 'file';
        }
      }
    } catch (err) {
      // File doesn't exist or can't be read - will auto-generate
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.debug(`Could not read API key from file: ${errorMessage}`);
    }

    // Precedence 3: Auto-generate and persist
    if (!apiKey) {
      apiKey = randomBytes(32).toString('base64');
      source = 'generated';

      // Attempt to persist for future restarts
      try {
        mkdirSync(dataPath, { recursive: true, mode: 0o700 });
        writeFileSync(apiKeyFilePath, apiKey, { mode: 0o600 });

        logger.warn(
          '\n' +
            '━'.repeat(80) +
            '\n' +
            '⚠️  AUTO-GENERATED API KEY (First-Time Setup)\n' +
            '━'.repeat(80) +
            '\n' +
            `Saved to: ${apiKeyFilePath}\n` +
            `This key will be reused on container restarts.\n\n` +
            'To view the key:\n' +
            `  cat ${apiKeyFilePath}\n\n` +
            'For production deployments:\n' +
            '  • Set VSB_LOCAL_API_KEY in environment or .env file\n' +
            '  • Use VSB_LOCAL_API_KEY_STRICT=true to enforce explicit configuration\n' +
            '━'.repeat(80) +
            '\n',
        );
      } catch (err) {
        // Cannot persist - require manual configuration
        const errorMessage = err instanceof Error ? err.message : String(err);

        throw new Error(
          '\n' +
            '═'.repeat(80) +
            '\n' +
            '❌ CONFIGURATION ERROR: Cannot persist auto-generated API key\n' +
            '═'.repeat(80) +
            '\n\n' +
            `Failed to write to ${apiKeyFilePath}: ${errorMessage}\n\n` +
            'Please configure VSB_LOCAL_API_KEY manually.\n' +
            'Generate a secure API key using one of these methods:\n\n' +
            '  openssl rand -base64 32\n' +
            "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"\n\n" +
            'Then set it in your environment:\n' +
            '  export VSB_LOCAL_API_KEY="<generated-key>"\n\n' +
            'Or add to your .env file:\n' +
            '  VSB_LOCAL_API_KEY=<generated-key>\n\n' +
            '═'.repeat(80) +
            '\n',
        );
      }
    }
  }

  // Validate minimum length
  if (!apiKey || apiKey.length < 32) {
    throw new Error(
      `VSB_LOCAL_API_KEY must be at least 32 characters (current: ${apiKey?.length || 0}). ` +
        'Generate with: openssl rand -base64 32',
    );
  }

  if (source) {
    logger.log(`✓ Local API key loaded from ${source}`);
  }

  const inboxAliasRandomBytes = parseNumberWithDefault(
    process.env.VSB_INBOX_ALIAS_RANDOM_BYTES,
    DEFAULT_LOCAL_INBOX_ALIAS_RANDOM_BYTES,
  );

  if (inboxAliasRandomBytes < MIN_INBOX_ALIAS_RANDOM_BYTES || inboxAliasRandomBytes > MAX_INBOX_ALIAS_RANDOM_BYTES) {
    throw new Error(
      `VSB_INBOX_ALIAS_RANDOM_BYTES must be between ${MIN_INBOX_ALIAS_RANDOM_BYTES} and ${MAX_INBOX_ALIAS_RANDOM_BYTES} (received: ${inboxAliasRandomBytes}).`,
    );
  }

  return {
    apiKey,
    inboxDefaultTtl: parseNumberWithDefault(process.env.VSB_LOCAL_INBOX_DEFAULT_TTL, DEFAULT_LOCAL_INBOX_TTL),
    inboxMaxTtl: parseNumberWithDefault(process.env.VSB_LOCAL_INBOX_MAX_TTL, DEFAULT_LOCAL_INBOX_MAX_TTL),
    cleanupInterval: parseNumberWithDefault(process.env.VSB_LOCAL_CLEANUP_INTERVAL, DEFAULT_LOCAL_CLEANUP_INTERVAL),
    inboxAliasRandomBytes,
    hardModeRejectCode: parseNumberWithDefault(
      process.env.VSB_SMTP_HARD_MODE_REJECT_CODE,
      DEFAULT_HARD_MODE_REJECT_CODE,
    ),
  };
}

/**
 * Build Orchestration Configuration
 *
 * Configures distributed leadership coordination for multi-node deployments.
 * Uses backend Redis API for distributed locking to prevent split-brain during
 * certificate renewal. Optional for single-node deployments.
 *
 * Optional environment variables:
 * - VSB_ORCHESTRATION_ENABLED: Enable distributed coordination (default: false)
 * - VSB_CLUSTER_NAME: Cluster identifier for multi-tenant support (default: 'default')
 * - VSB_NODE_ID: Unique node identifier (default: auto-generated from hostname)
 * - VSB_CLUSTER_PEERS: Comma-separated peer URLs for P2P sync (default: [])
 * - VSB_LEADERSHIP_TTL: Distributed lock TTL in seconds (default: 300)
 *
 * @returns Orchestration configuration object
 */
function buildOrchestrationConfig() {
  const peersEnv = process.env.VSB_CLUSTER_PEERS;

  return {
    enabled: parseOptionalBoolean(process.env.VSB_ORCHESTRATION_ENABLED, false),
    clusterName: parseStringWithDefault(process.env.VSB_CLUSTER_NAME, DEFAULT_CLUSTER_NAME),
    nodeId: parseStringWithDefault(process.env.VSB_NODE_ID, generateNodeId()),
    peers: peersEnv
      ? peersEnv
          .split(',')
          .map((peer) => peer.trim())
          .filter(Boolean)
      : [],
    backend: {
      url: parseStringWithDefault(process.env.VSB_BACKEND_URL, ''),
      apiKey: parseStringWithDefault(process.env.VSB_BACKEND_API_KEY, ''),
      timeout: parseNumberWithDefault(process.env.VSB_BACKEND_REQUEST_TIMEOUT, DEFAULT_BACKEND_REQUEST_TIMEOUT),
    },
    leadership: {
      ttl: parseNumberWithDefault(process.env.VSB_LEADERSHIP_TTL, DEFAULT_LEADERSHIP_TTL),
    },
  };
}

/**
 * Build Certificate Configuration
 *
 * Configures automatic TLS certificate management via Let's Encrypt ACME protocol.
 * Supports distributed coordination for multi-node deployments with P2P certificate
 * synchronization and HMAC-based peer authentication.
 *
 * Certificate storage path is derived from VSB_DATA_PATH/certificates.
 *
 * Required environment variables (when VSB_CERT_ENABLED=true):
 * - VSB_CERT_EMAIL: Let's Encrypt account email address
 *
 * Optional environment variables:
 * - VSB_CERT_ENABLED: Enable automatic certificate management (default: false)
 * - VSB_CERT_DOMAIN: Primary certificate domain name (default: first domain from VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS)
 * - VSB_DATA_PATH: Unified data directory root (default: '/app/data')
 * - VSB_CERT_ADDITIONAL_DOMAINS: Comma-separated Subject Alternative Names (default: [])
 * - VSB_CERT_CHECK_INTERVAL: Certificate check interval in ms (default: 86400000 = 24 hours)
 * - VSB_CERT_RENEW_THRESHOLD_DAYS: Renewal threshold in days before expiry (default: 30)
 * - VSB_CERT_ACME_DIRECTORY: ACME directory URL (default: Let's Encrypt production)
 * - VSB_CERT_STAGING: Use Let's Encrypt staging environment (default: false)
 * - VSB_CERT_PEER_SHARED_SECRET: HMAC secret for P2P auth (default: auto-generated)
 *
 * @returns Certificate configuration object
 * @throws {Error} If VSB_CERT_ENABLED=true but required fields are missing
 */
function buildCertificateConfig() {
  const enabled = parseOptionalBoolean(process.env.VSB_CERT_ENABLED, false);
  const email = parseStringWithDefault(process.env.VSB_CERT_EMAIL, '');
  let domain = parseStringWithDefault(process.env.VSB_CERT_DOMAIN, '');
  const additionalDomainsEnv = process.env.VSB_CERT_ADDITIONAL_DOMAINS;
  const additionalDomains = additionalDomainsEnv
    ? additionalDomainsEnv
        .split(',')
        .map((domain) => domain.trim())
        .filter(Boolean)
    : [];

  // Auto-derive certificate domain from SMTP allowed domains if not explicitly set
  if (enabled && (!domain || !domain.trim())) {
    const allowedDomains = parseAllowedDomains();
    if (allowedDomains.length > 0) {
      domain = allowedDomains[0];
      logger.log(`VSB_CERT_DOMAIN not set - auto-derived from VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS: ${domain}`);
    }
  }

  // Fail fast: if certificate management is enabled, require critical fields
  if (enabled) {
    if (!email || !email.trim()) {
      throw new Error('VSB_CERT_EMAIL is required when VSB_CERT_ENABLED=true');
    }
    if (!domain || !domain.trim()) {
      throw new Error(
        'VSB_CERT_DOMAIN is required when VSB_CERT_ENABLED=true. ' +
          'Either set VSB_CERT_DOMAIN explicitly or ensure VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS contains at least one domain.',
      );
    }
  }

  // Validate SAN entries to fail fast before ACME order
  if (additionalDomains.length > 0) {
    const invalidAdditionalDomains = additionalDomains.filter((san) => !isValidDomain(san));
    if (invalidAdditionalDomains.length > 0) {
      throw new Error(`Invalid domain format in VSB_CERT_ADDITIONAL_DOMAINS: ${invalidAdditionalDomains.join(', ')}`);
    }
  }

  // Warn if peerSharedSecret is auto-generated in multi-node clusters
  const orchestrationEnabled = parseOptionalBoolean(process.env.VSB_ORCHESTRATION_ENABLED, false);
  let peerSharedSecret: string;
  if (!process.env.VSB_CERT_PEER_SHARED_SECRET) {
    peerSharedSecret = generateSharedSecret();
    if (enabled && orchestrationEnabled) {
      logger.warn(
        'VSB_CERT_PEER_SHARED_SECRET not configured - using auto-generated secret. ' +
          'For multi-node clusters, all nodes MUST use the same shared secret. ' +
          'Set VSB_CERT_PEER_SHARED_SECRET in environment to ensure consistency across nodes.',
      );
    }
  } else {
    peerSharedSecret = process.env.VSB_CERT_PEER_SHARED_SECRET;
  }

  // Derive certificate storage path from unified data path
  const dataPath = parseStringWithDefault(process.env.VSB_DATA_PATH, DEFAULT_DATA_PATH);
  const storagePath = join(dataPath, 'certificates');

  const config = {
    enabled,
    email,
    domain,
    additionalDomains,
    storagePath,
    checkInterval: parseNumberWithDefault(process.env.VSB_CERT_CHECK_INTERVAL, DEFAULT_CERT_CHECK_INTERVAL),
    renewDaysBeforeExpiry: parseNumberWithDefault(
      process.env.VSB_CERT_RENEW_THRESHOLD_DAYS,
      DEFAULT_CERT_RENEW_THRESHOLD_DAYS,
    ),
    acmeDirectoryUrl: parseStringWithDefault(process.env.VSB_CERT_ACME_DIRECTORY, DEFAULT_ACME_DIRECTORY_URL),
    staging: parseOptionalBoolean(process.env.VSB_CERT_STAGING, false),
    peerSharedSecret,
  };

  return config;
}

/**
 * Build Crypto Configuration
 *
 * Configures quantum-safe signing keys for ML-DSA-65.
 * If both key paths are provided, keys will be loaded from files.
 * Otherwise, ephemeral keys will be generated on startup.
 *
 * Optional environment variables:
 * - VSB_SERVER_SIGNATURE_SECRET_KEY_PATH: Path to secret key file (raw binary, 4032 bytes)
 * - VSB_SERVER_SIGNATURE_PUBLIC_KEY_PATH: Path to public key file (raw binary, 1952 bytes)
 */
function buildCryptoConfig() {
  const sigSkPath = process.env.VSB_SERVER_SIGNATURE_SECRET_KEY_PATH;
  const sigPkPath = process.env.VSB_SERVER_SIGNATURE_PUBLIC_KEY_PATH;

  // Validate: either both paths or neither
  if ((sigSkPath && !sigPkPath) || (!sigSkPath && sigPkPath)) {
    throw new Error(
      'Both VSB_SERVER_SIGNATURE_SECRET_KEY_PATH and VSB_SERVER_SIGNATURE_PUBLIC_KEY_PATH must be provided together, or neither for ephemeral keys',
    );
  }

  return {
    sigSkPath: sigSkPath || undefined,
    sigPkPath: sigPkPath || undefined,
  };
}

/**
 * Build Throttle Configuration
 *
 * Configures global rate limiting for API endpoints.
 * Since API key authentication is required for most endpoints,
 * these limits can be fairly generous for development/testing.
 *
 * Optional environment variables:
 * - VSB_THROTTLE_TTL: Time window in milliseconds (default: 60000 = 60 seconds)
 * - VSB_THROTTLE_LIMIT: Maximum requests per TTL window (default: 100)
 */
function buildThrottleConfig() {
  return {
    ttl: parseNumberWithDefault(process.env.VSB_THROTTLE_TTL, DEFAULT_THROTTLE_TTL),
    limit: parseNumberWithDefault(process.env.VSB_THROTTLE_LIMIT, DEFAULT_THROTTLE_LIMIT),
  };
}

/**
 * Build SMTP Rate Limit Configuration
 *
 * Configures per-IP rate limiting for SMTP connections to prevent abuse
 * in the QA email testing environment. This is separate from the API
 * throttling and focuses solely on SMTP traffic.
 *
 * Optional environment variables:
 * - VSB_SMTP_RATE_LIMIT_ENABLED: Enable rate limiting (default: true)
 * - VSB_SMTP_RATE_LIMIT_MAX_EMAILS: Max emails per duration (default: 100)
 * - VSB_SMTP_RATE_LIMIT_DURATION: Duration in seconds (default: 900 = 15 minutes)
 */
function buildSmtpRateLimitConfig() {
  return {
    enabled: parseOptionalBoolean(process.env.VSB_SMTP_RATE_LIMIT_ENABLED, true),
    points: parseNumberWithDefault(process.env.VSB_SMTP_RATE_LIMIT_MAX_EMAILS, DEFAULT_SMTP_RATE_LIMIT_MAX_EMAILS),
    duration: parseNumberWithDefault(process.env.VSB_SMTP_RATE_LIMIT_DURATION, DEFAULT_SMTP_RATE_LIMIT_DURATION),
  };
}

/**
 * Build Main Server Configuration
 *
 * Configures the main HTTP/HTTPS server settings and gateway operation mode.
 * The gateway can operate in local mode (standalone) or connected to a backend service.
 *
 * Optional environment variables:
 * - NODE_ENV: Application environment (default: 'development')
 * - VSB_SERVER_PORT: Main HTTP server port (default: 80)
 * - VSB_SERVER_HTTPS_ENABLED: Enable HTTPS server (default: true)
 * - VSB_SERVER_HTTPS_PORT: HTTPS server port (default: 443)
 * - VSB_SERVER_ORIGIN: Server origin URL for CORS (default: auto-derived from first VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS with appropriate protocol)
 * - VSB_BACKEND_URL: Backend service URL (default: undefined)
 * - VSB_BACKEND_API_KEY: Backend API key (default: undefined)
 * - VSB_BACKEND_REQUEST_TIMEOUT: Backend API request timeout in ms (default: 10000)
 * - VSB_GATEWAY_MODE: Gateway operation mode - 'local' or 'backend' (default: 'local')
 *
 * @returns Main server configuration object
 * @throws {Error} If VSB_GATEWAY_MODE is not 'local' or 'backend'
 */
function buildMainConfig() {
  const gatewayMode = parseStringWithDefault(process.env.VSB_GATEWAY_MODE, DEFAULT_GATEWAY_MODE);
  const certEnabled = parseOptionalBoolean(process.env.VSB_CERT_ENABLED, false);
  const httpsEnabled = parseOptionalBoolean(process.env.VSB_SERVER_HTTPS_ENABLED, certEnabled);

  // Validate gatewayMode is one of the allowed values
  if (!(ALLOWED_GATEWAY_MODES as readonly string[]).includes(gatewayMode)) {
    throw new Error(`Invalid VSB_GATEWAY_MODE: "${gatewayMode}". Must be one of: ${ALLOWED_GATEWAY_MODES.join(', ')}`);
  }

  let origin: string;

  // Auto-derive CORS origin from SMTP allowed domains only if not explicitly set
  // If explicitly set to "*", respect it for wildcard CORS
  if (!process.env.VSB_SERVER_ORIGIN) {
    const allowedDomains = parseAllowedDomains();
    const protocol = httpsEnabled ? 'https' : 'http';
    origin = `${protocol}://${allowedDomains[0]}`;
    logger.log(`VSB_SERVER_ORIGIN not set - auto-derived from VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS: ${origin}`);
  } else {
    origin = process.env.VSB_SERVER_ORIGIN.trim();
  }

  const backendUrl = process.env.VSB_BACKEND_URL?.trim();
  const backendApiKey = process.env.VSB_BACKEND_API_KEY?.trim();
  const orchestrationEnabled = parseOptionalBoolean(process.env.VSB_ORCHESTRATION_ENABLED, false);

  if (gatewayMode === 'backend') {
    if (!backendUrl || !backendApiKey) {
      throw new Error(
        'VSB_GATEWAY_MODE=backend requires backend configuration:\n' +
          '  - VSB_BACKEND_URL: Backend service URL (required)\n' +
          '  - VSB_BACKEND_API_KEY: Backend API authentication key (required)',
      );
    }
  }

  if (orchestrationEnabled) {
    if (!backendUrl || !backendApiKey) {
      throw new Error(
        'VSB_ORCHESTRATION_ENABLED=true requires backend configuration for distributed locking:\n' +
          '  - VSB_BACKEND_URL: Backend Redis API URL (required)\n' +
          '  - VSB_BACKEND_API_KEY: Backend API key (required)',
      );
    }
  }

  if (httpsEnabled && !certEnabled) {
    logger.warn(
      'HTTPS is enabled but certificate management is disabled; keep HTTP-only until certificates are configured',
    );
  }

  return {
    port: parseNumberWithDefault(process.env.VSB_SERVER_PORT, DEFAULT_SERVER_PORT),
    httpsEnabled,
    httpsPort: parseNumberWithDefault(process.env.VSB_SERVER_HTTPS_PORT, DEFAULT_HTTPS_PORT),
    origin,
    backend: {
      url: backendUrl,
      apiKey: backendApiKey,
      timeout: parseNumberWithDefault(process.env.VSB_BACKEND_REQUEST_TIMEOUT, DEFAULT_BACKEND_REQUEST_TIMEOUT),
    },
    gatewayMode,
  };
}

/**
 * Build SSE Console Configuration
 *
 * Configures server-wide console-style SSE logging for debugging and monitoring.
 * When enabled, broadcasts simple log messages about email receipts and validation
 * results to all authenticated clients.
 *
 * Optional environment variables:
 * - VSB_SSE_CONSOLE_ENABLED: Enable SSE console logging (default: true)
 */
function buildSseConsoleConfig() {
  return {
    enabled: parseOptionalBoolean(process.env.VSB_SSE_CONSOLE_ENABLED, true),
  };
}

/**
 * Register Config VSB
 */
export default registerAs('vsb', () => {
  const gatewayMode = parseStringWithDefault(process.env.VSB_GATEWAY_MODE, DEFAULT_GATEWAY_MODE);

  return {
    environment: parseStringWithDefault(process.env.NODE_ENV, 'production'),
    main: buildMainConfig(),
    smtp: buildSmtpConfig(),
    orchestration: buildOrchestrationConfig(),
    certificate: buildCertificateConfig(),
    local: gatewayMode === 'local' ? buildLocalModeConfig() : undefined,
    crypto: buildCryptoConfig(),
    throttle: buildThrottleConfig(),
    smtpRateLimit: buildSmtpRateLimitConfig(),
    sseConsole: buildSseConsoleConfig(),
  };
});
