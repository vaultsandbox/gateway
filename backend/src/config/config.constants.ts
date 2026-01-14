export const BOOLEAN_TRUE_VALUES = ['true', '1', 'yes', 'on'];

/**
 * Server-level encryption policy.
 * Parsed once at config load; used throughout the codebase.
 */
export enum EncryptionPolicy {
  /** Encryption enabled by default; per-inbox override allowed */
  ENABLED = 'enabled',
  /** Encryption disabled by default; per-inbox override allowed */
  DISABLED = 'disabled',
  /** Encryption always on; per-inbox override NOT allowed */
  ALWAYS = 'always',
  /** Encryption always off; per-inbox override NOT allowed */
  NEVER = 'never',
}

export const DEFAULT_ENCRYPTION_POLICY = EncryptionPolicy.ALWAYS;

// Configuration defaults
export const DEFAULT_DATA_PATH = '/app/data';
export const DEFAULT_MAX_CONNECTIONS = 25;
export const DEFAULT_CLOSE_TIMEOUT = 30000;
export const DEFAULT_EARLY_TALKER_DELAY = 300;
export const DEFAULT_SMTP_BANNER = 'VaultSandbox Test SMTP Server (Receive-Only)';
export const DEFAULT_DISABLED_COMMANDS = ['VRFY', 'EXPN', 'ETRN', 'TURN', 'AUTH'];
export const DEFAULT_LOCAL_INBOX_TTL = 3600; // 1 hour
export const DEFAULT_LOCAL_INBOX_MAX_TTL = 604800; // 7 days - suitable for QA/testing scenarios
export const DEFAULT_LOCAL_INBOX_ALIAS_RANDOM_BYTES = 4; // 8 hex chars
export const MIN_INBOX_ALIAS_RANDOM_BYTES = 4; // Avoid tiny entropy
export const MAX_INBOX_ALIAS_RANDOM_BYTES = 32; // Cap to keep local-part reasonable
export const DEFAULT_LOCAL_CLEANUP_INTERVAL = 300; // 5 minutes
export const DEFAULT_HARD_MODE_REJECT_CODE = 421;
export const DEFAULT_BACKEND_REQUEST_TIMEOUT = 10000;
export const DEFAULT_LEADERSHIP_TTL = 300;
export const DEFAULT_CERT_CHECK_INTERVAL = 86_400_000;
export const DEFAULT_CERT_RENEW_THRESHOLD_DAYS = 30;
export const DEFAULT_ACME_DIRECTORY_URL = 'https://acme-v02.api.letsencrypt.org/directory';
export const DEFAULT_THROTTLE_TTL = 60000;
export const DEFAULT_THROTTLE_LIMIT = 500;
export const DEFAULT_SMTP_RATE_LIMIT_MAX_EMAILS = 500;
export const DEFAULT_SMTP_RATE_LIMIT_DURATION = 900;
export const DEFAULT_SERVER_PORT = 80;
export const DEFAULT_HTTPS_PORT = 443;
export const DEFAULT_CLUSTER_NAME = 'default';
export const DEFAULT_GATEWAY_MODE = 'local';
export const ALLOWED_GATEWAY_MODES = ['local', 'backend'] as const;
export const DEFAULT_SMTP_HOST = '0.0.0.0';
export const DEFAULT_SMTP_PORT = 25;
export const DEFAULT_SMTP_MAX_MESSAGE_SIZE = 10485760; // 10MB
export const DEFAULT_SMTP_MAX_HEADER_SIZE = 65536; // 64KB
export const DEFAULT_SMTP_SESSION_TIMEOUT = 300000; // 5 minutes

// TLS Security defaults (RFC 8996 compliance)
export const DEFAULT_TLS_MIN_VERSION = 'TLSv1.2';
export const DEFAULT_TLS_CIPHERS = [
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
].join(':');
export const DEFAULT_TLS_HONOR_CIPHER_ORDER = true;
export const DEFAULT_TLS_ECDH_CURVE = 'auto';
