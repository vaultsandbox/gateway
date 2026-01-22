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
  DEFAULT_SPAM_ANALYSIS_ENABLED,
  DEFAULT_RSPAMD_URL,
  DEFAULT_RSPAMD_TIMEOUT_MS,
  DEFAULT_CHAOS_ENABLED,
} from './config/config.constants';
import {
  parseOptionalBoolean,
  parseNumberWithDefault,
  parseStringWithDefault,
  parseAllowedDomains,
  parseDisabledCommands,
  parseEncryptionPolicy,
  isDevMode,
} from './config/config.parsers';
import { EncryptionPolicy } from './config/config.constants';
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
        '  2. Provide manual certificates: VSB_TLS_CERT_PATH + VSB_TLS_KEY_PATH',
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
 * - VSB_LOCAL_ALLOW_CLEAR_ALL_INBOXES: Allow DELETE /api/inboxes endpoint (default: true)
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
    } catch (err) /* v8 ignore start */ {
      // File doesn't exist or can't be read - will auto-generate
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.debug(`Could not read API key from file: ${errorMessage}`);
    } /* v8 ignore stop */

    // Precedence 3: Auto-generate and persist
    if (!apiKey) {
      apiKey = randomBytes(32).toString('base64');
      source = 'generated';

      // Attempt to persist for future restarts
      try {
        mkdirSync(dataPath, { recursive: true, mode: 0o700 });
        writeFileSync(apiKeyFilePath, apiKey, { mode: 0o600 });

        // Show API key in logs only in dev mode for easy local development
        /* v8 ignore start - dev/prod logging branches not tested */
        if (isDevMode()) {
          logger.warn(
            '\n' +
              '━'.repeat(80) +
              '\n' +
              '🔑 AUTO-GENERATED API KEY (Dev Mode)\n' +
              '━'.repeat(80) +
              '\n' +
              `${apiKey}\n` +
              '\n' +
              `Persisted to: ${apiKeyFilePath}\n` +
              '━'.repeat(80) +
              '\n',
          );
        } else {
          // Production: only show file location, not the key itself
          logger.warn(
            '\n' +
              '━'.repeat(80) +
              '\n' +
              '⚠️  AUTO-GENERATED API KEY\n' +
              '━'.repeat(80) +
              '\n' +
              `Saved to: ${apiKeyFilePath}\n` +
              `To view: docker compose exec gateway cat ${apiKeyFilePath}; echo\n` +
              '━'.repeat(80) +
              '\n',
          );
        }
        /* v8 ignore stop */
      } catch (err) {
        // Cannot persist - require manual configuration
        /* c8 ignore next */
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
      /* c8 ignore next */
      `VSB_LOCAL_API_KEY must be at least 32 characters (current: ${apiKey?.length || 0}). ` +
        'Generate with: openssl rand -base64 32',
    );
  }

  if (source) {
    // In dev mode, always show the API key for convenience (except when generated, which has its own banner)
    if (isDevMode() && source !== 'generated') {
      logger.log(`🔑 API Key (Dev Mode): ${apiKey}`);
    } else {
      logger.log(`✓ Local API key loaded from ${source}`);
    }
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
    allowClearAllInboxes: parseOptionalBoolean(process.env.VSB_LOCAL_ALLOW_CLEAR_ALL_INBOXES, true),
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
    // Email is optional - Let's Encrypt allows registration without email
    // If not provided, user won't receive certificate expiry notifications
    if (!email || !email.trim()) {
      logger.log('VSB_CERT_EMAIL not set - certificate expiry notifications will not be sent');
    }
    /* v8 ignore start - Defensive: unreachable because parseAllowedDomains() throws first if no domains */
    if (!domain || !domain.trim()) {
      throw new Error(
        'VSB_CERT_DOMAIN is required when VSB_CERT_ENABLED=true. ' +
          'Either set VSB_CERT_DOMAIN explicitly or ensure VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS contains at least one domain.',
      );
    }
    /* v8 ignore stop */
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
 * Configures quantum-safe signing keys for ML-DSA-65 and encryption policy.
 * If both key paths are provided, keys will be loaded from files.
 * Otherwise, ephemeral keys will be generated on startup.
 *
 * Encryption policy varies based on dev/production mode:
 * - Dev mode: defaults to 'never' (plain JSON responses for easy API testing)
 * - Production mode: defaults to 'always' (secure by default)
 *
 * Optional environment variables:
 * - VSB_SERVER_SIGNATURE_SECRET_KEY_PATH: Path to secret key file (raw binary, 4032 bytes)
 * - VSB_SERVER_SIGNATURE_PUBLIC_KEY_PATH: Path to public key file (raw binary, 1952 bytes)
 * - VSB_ENCRYPTION_ENABLED: Encryption policy ('enabled', 'disabled', 'always', 'never')
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

  // Dev mode: disable encryption by default but allow override; Production: always encrypt
  const devMode = isDevMode();
  const defaultEncryptionPolicy = devMode ? EncryptionPolicy.DISABLED : EncryptionPolicy.ALWAYS;
  const encryptionPolicy = parseEncryptionPolicy(process.env.VSB_ENCRYPTION_ENABLED, defaultEncryptionPolicy);

  // Log encryption configuration
  const policyLabels: Record<EncryptionPolicy, string> = {
    [EncryptionPolicy.ALWAYS]: 'always (all inboxes encrypted)',
    [EncryptionPolicy.ENABLED]: 'enabled (encrypted by default, can request plain)',
    [EncryptionPolicy.DISABLED]: 'disabled (plain by default, can request encrypted)',
    [EncryptionPolicy.NEVER]: 'never (all inboxes plain)',
  };
  const defaultInbox =
    encryptionPolicy === EncryptionPolicy.ALWAYS || encryptionPolicy === EncryptionPolicy.ENABLED
      ? 'encrypted'
      : 'plain';
  logger.log(`Encryption policy: ${policyLabels[encryptionPolicy]} - new inboxes: ${defaultInbox}`);

  /* v8 ignore next 4 - warning log for non-encrypted modes not tested */
  if (encryptionPolicy === EncryptionPolicy.DISABLED || encryptionPolicy === EncryptionPolicy.NEVER) {
    if (!devMode) {
      logger.warn(`⚠️  Encryption is not enforced. Emails may be stored in plaintext.`);
    }
  }

  return {
    sigSkPath: sigSkPath || undefined,
    sigPkPath: sigPkPath || undefined,
    encryptionPolicy,
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

  // Auto-derive CORS origin from SMTP allowed domains only if not explicitly set.
  // Intentionally uses only the first domain - the API and web UI are served from
  // a single origin, while SMTP may accept emails for multiple recipient domains.
  // Set VSB_SERVER_ORIGIN explicitly to override, or use "*" for wildcard CORS.
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
 * Build Webhook Configuration
 *
 * Configures the webhook system for real-time HTTP notifications on email events.
 * Supports both global webhooks (all events) and inbox-scoped webhooks.
 *
 * Optional environment variables:
 * - VSB_WEBHOOK_ENABLED: Enable webhook system (default: true)
 * - VSB_WEBHOOK_MAX_GLOBAL: Maximum global webhooks (default: 100)
 * - VSB_WEBHOOK_MAX_PER_INBOX: Maximum webhooks per inbox (default: 50)
 * - VSB_WEBHOOK_TIMEOUT: HTTP delivery timeout in ms (default: 10000)
 * - VSB_WEBHOOK_MAX_RETRIES: Maximum retry attempts (default: 5)
 * - VSB_WEBHOOK_MAX_RETRIES_PER_WEBHOOK: Maximum pending retries per webhook (default: 100)
 * - VSB_WEBHOOK_ALLOW_HTTP: Allow HTTP URLs (default: false, requires HTTPS)
 * - VSB_WEBHOOK_REQUIRE_AUTH_DEFAULT: Default requireAuth for filters (default: true in prod, false in dev)
 * - VSB_WEBHOOK_MAX_HEADERS: Maximum number of headers to include in payload (default: 50)
 * - VSB_WEBHOOK_MAX_HEADER_VALUE_LEN: Maximum length of header values in chars (default: 1000)
 */
function buildWebhookConfig() {
  const devMode = isDevMode();

  return {
    enabled: parseOptionalBoolean(process.env.VSB_WEBHOOK_ENABLED, true),
    maxGlobalWebhooks: parseNumberWithDefault(process.env.VSB_WEBHOOK_MAX_GLOBAL, 100),
    maxInboxWebhooks: parseNumberWithDefault(process.env.VSB_WEBHOOK_MAX_PER_INBOX, 50),
    deliveryTimeout: parseNumberWithDefault(process.env.VSB_WEBHOOK_TIMEOUT, 10000),
    maxRetries: parseNumberWithDefault(process.env.VSB_WEBHOOK_MAX_RETRIES, 5),
    maxRetriesPerWebhook: parseNumberWithDefault(process.env.VSB_WEBHOOK_MAX_RETRIES_PER_WEBHOOK, 100),
    allowHttp: parseOptionalBoolean(process.env.VSB_WEBHOOK_ALLOW_HTTP, false),
    // Default for requireAuth when not specified in webhook filter
    // In dev mode, defaults to false for easier local testing
    requireAuthDefault: parseOptionalBoolean(process.env.VSB_WEBHOOK_REQUIRE_AUTH_DEFAULT, !devMode),
    // Header limits for payload size control
    maxHeaders: parseNumberWithDefault(process.env.VSB_WEBHOOK_MAX_HEADERS, 50),
    maxHeaderValueLen: parseNumberWithDefault(process.env.VSB_WEBHOOK_MAX_HEADER_VALUE_LEN, 1000),
  };
}

/**
 * Build Email Auth Configuration
 *
 * Configures optional email authentication checks (SPF, DKIM, DMARC, Reverse DNS).
 * These checks can be disabled globally via environment variables or per-inbox.
 * When disabled, checks return status: 'skipped' instead of running.
 *
 * Security posture varies based on dev/production mode:
 * - Dev mode (no domain configured): email auth disabled by default for easy local testing
 * - Production mode (domain configured): email auth enabled by default for security
 *
 * Optional environment variables:
 * - VSB_EMAIL_AUTH_ENABLED: Master switch for all auth checks (default: true in prod, false in dev)
 * - VSB_EMAIL_AUTH_SPF_ENABLED: SPF verification (default: true)
 * - VSB_EMAIL_AUTH_DKIM_ENABLED: DKIM verification (default: true)
 * - VSB_EMAIL_AUTH_DMARC_ENABLED: DMARC verification (default: true)
 * - VSB_EMAIL_AUTH_REVERSE_DNS_ENABLED: Reverse DNS/PTR verification (default: true)
 * - VSB_EMAIL_AUTH_INBOX_DEFAULT: Default emailAuth for new inboxes (default: true)
 *
 * Precedence:
 * - If VSB_EMAIL_AUTH_ENABLED=false → ALL checks skipped
 * - Else → Individual VSB_EMAIL_AUTH_*_ENABLED variables control each check
 * - Per-inbox emailAuth=false skips all checks for that inbox
 */
function buildEmailAuthConfig() {
  const devMode = isDevMode();

  // Secure by default: enable auth checks unless in dev mode
  const defaultEnabled = !devMode;
  const defaultInboxEmailAuth = !devMode;

  if (devMode) {
    logger.log('Dev mode detected (no domain configured) - email auth disabled by default');
  }

  return {
    enabled: parseOptionalBoolean(process.env.VSB_EMAIL_AUTH_ENABLED, defaultEnabled),
    spf: parseOptionalBoolean(process.env.VSB_EMAIL_AUTH_SPF_ENABLED, true),
    dkim: parseOptionalBoolean(process.env.VSB_EMAIL_AUTH_DKIM_ENABLED, true),
    dmarc: parseOptionalBoolean(process.env.VSB_EMAIL_AUTH_DMARC_ENABLED, true),
    reverseDns: parseOptionalBoolean(process.env.VSB_EMAIL_AUTH_REVERSE_DNS_ENABLED, true),
    inboxDefault: parseOptionalBoolean(process.env.VSB_EMAIL_AUTH_INBOX_DEFAULT, defaultInboxEmailAuth),
  };
}

/**
 * Build Spam Analysis Configuration
 *
 * Configures optional Rspamd integration for spam analysis of incoming emails.
 * When enabled, emails are analyzed via HTTP POST to a Rspamd server before storage.
 * Analysis results include spam score, triggered rules, and recommended action.
 *
 * Security posture varies based on dev/production mode:
 * - Dev mode: spam analysis disabled by default (requires Rspamd container)
 * - Production mode: spam analysis disabled by default (opt-in feature)
 *
 * Optional environment variables:
 * - VSB_SPAM_ANALYSIS_ENABLED: Master switch for spam analysis (default: false)
 * - VSB_RSPAMD_URL: Rspamd worker API base URL (default: http://localhost:11333)
 * - VSB_RSPAMD_TIMEOUT_MS: HTTP request timeout in milliseconds (default: 5000)
 * - VSB_RSPAMD_PASSWORD: Rspamd controller password if auth enabled (default: undefined)
 * - VSB_SPAM_ANALYSIS_INBOX_DEFAULT: Default spamAnalysis for new inboxes (default: true)
 *
 * Precedence:
 * - If VSB_SPAM_ANALYSIS_ENABLED=false → spam analysis skipped for all emails
 * - Else → per-inbox spamAnalysis setting controls whether analysis runs
 */
function buildSpamAnalysisConfig() {
  const enabled = parseOptionalBoolean(process.env.VSB_SPAM_ANALYSIS_ENABLED, DEFAULT_SPAM_ANALYSIS_ENABLED);
  const rspamdUrl = parseStringWithDefault(process.env.VSB_RSPAMD_URL, DEFAULT_RSPAMD_URL);

  if (enabled) {
    logger.log(`Spam analysis enabled - Rspamd URL: ${rspamdUrl}`);
  }

  return {
    enabled,
    rspamd: {
      url: rspamdUrl,
      timeoutMs: parseNumberWithDefault(process.env.VSB_RSPAMD_TIMEOUT_MS, DEFAULT_RSPAMD_TIMEOUT_MS),
      password: process.env.VSB_RSPAMD_PASSWORD || undefined,
    },
    inboxDefault: parseOptionalBoolean(process.env.VSB_SPAM_ANALYSIS_INBOX_DEFAULT, true),
  };
}

/**
 * Build Chaos Configuration
 *
 * Configures chaos engineering features for testing email delivery failure scenarios.
 * When disabled globally, all chaos configuration is ignored and chaos API endpoints return 403.
 *
 * Optional environment variables:
 * - VSB_CHAOS_ENABLED: Master switch for chaos features (default: false)
 */
function buildChaosConfig() {
  const enabled = parseOptionalBoolean(process.env.VSB_CHAOS_ENABLED, DEFAULT_CHAOS_ENABLED);

  if (enabled) {
    logger.log('Chaos engineering features enabled');
  }

  return {
    enabled,
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
    emailAuth: buildEmailAuthConfig(),
    webhook: gatewayMode === 'local' ? buildWebhookConfig() : undefined,
    spamAnalysis: gatewayMode === 'local' ? buildSpamAnalysisConfig() : undefined,
    chaos: gatewayMode === 'local' ? buildChaosConfig() : undefined,
  };
});
