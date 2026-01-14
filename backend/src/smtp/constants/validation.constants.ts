/**
 * Email Validation Constants
 *
 * Centralized constants for email validation, DNS lookups, file operations,
 * and authentication checks. These constants ensure consistent behavior across
 * all SMTP services.
 *
 * @module validation-constants
 */

/**
 * DNS Resolution Timeouts
 *
 * Timeout values for DNS lookups to prevent hanging on slow or unresponsive
 * DNS servers during email validation.
 */
export const DNS_TIMEOUTS = {
  /**
   * Timeout for reverse DNS (PTR record) lookups in milliseconds
   * @default 5000 (5 seconds)
   */
  REVERSE_DNS_TIMEOUT_MS: 5000,

  /**
   * Timeout for SPF record lookups in milliseconds
   * @default 5000 (5 seconds)
   */
  SPF_TIMEOUT_MS: 5000,

  /**
   * Timeout for DKIM public key lookups in milliseconds
   * @default 5000 (5 seconds)
   */
  DKIM_TIMEOUT_MS: 5000,

  /**
   * Timeout for DMARC policy lookups in milliseconds
   * @default 5000 (5 seconds)
   */
  DMARC_TIMEOUT_MS: 5000,
} as const;

/**
 * File System Permissions
 *
 * Unix file permission modes for secure certificate and email storage.
 * These follow the principle of least privilege.
 */
export const FILE_PERMISSIONS = {
  /**
   * Directory permissions (owner: rwx, group: ---, others: ---)
   * @default 0o700
   */
  DIRECTORY_MODE: 0o700,

  /**
   * Private key file permissions (owner: rw-, group: ---, others: ---)
   * @default 0o600
   */
  PRIVATE_KEY_MODE: 0o600,

  /**
   * Public certificate/data file permissions (owner: rw-, group: r--, others: r--)
   * @default 0o644
   */
  PUBLIC_FILE_MODE: 0o644,
} as const;

/**
 * Email Validation Patterns
 *
 * Regular expressions for basic email and domain validation.
 */
export const VALIDATION_PATTERNS = {
  /**
   * Simple email-like pattern (at least one char, @, at least one char)
   * Does not perform full RFC 5322 validation
   */
  EMAIL_LIKE: /.+@.+/,

  /**
   * Domain pattern for basic domain name validation
   * Matches standard domain names with alphanumeric characters, hyphens, and dots
   */
  DOMAIN: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i,

  /**
   * IPv4 address pattern
   */
  IPV4: /^(\d{1,3}\.){3}\d{1,3}$/,

  /**
   * IPv6 address pattern (simplified)
   */
  IPV6: /^([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i,
} as const;

/**
 * SPF Result Status Values
 *
 * Standard SPF verification result codes as defined in RFC 7208.
 */
export const SPF_STATUS = {
  /** SPF check passed - sender is authorized */
  PASS: 'pass',

  /** SPF check failed - sender is not authorized */
  FAIL: 'fail',

  /** SPF check is neutral - no definitive result */
  NEUTRAL: 'neutral',

  /** No SPF record found */
  NONE: 'none',

  /** SPF check soft-failed - sender probably not authorized */
  SOFTFAIL: 'softfail',

  /** Temporary error during SPF check (e.g., DNS timeout) */
  TEMPERROR: 'temperror',

  /** Permanent error during SPF check (e.g., malformed SPF record) */
  PERMERROR: 'permerror',

  /** SPF check was intentionally skipped (disabled globally or per-inbox) */
  SKIPPED: 'skipped',
} as const;

/**
 * DKIM Result Status Values
 *
 * Standard DKIM verification result codes as defined in RFC 6376.
 */
export const DKIM_STATUS = {
  /** DKIM signature is valid */
  PASS: 'pass',

  /** DKIM signature is invalid or verification failed */
  FAIL: 'fail',

  /** No DKIM signature found */
  NONE: 'none',

  /** DKIM signature validation is neutral */
  NEUTRAL: 'neutral',

  /** Temporary error during DKIM verification */
  TEMPERROR: 'temperror',

  /** Permanent error during DKIM verification */
  PERMERROR: 'permerror',

  /** DKIM check was intentionally skipped (disabled globally or per-inbox) */
  SKIPPED: 'skipped',
} as const;

/**
 * DMARC Result Status Values
 *
 * Standard DMARC verification result codes as defined in RFC 7489.
 */
export const DMARC_STATUS = {
  /** DMARC check passed */
  PASS: 'pass',

  /** DMARC check failed */
  FAIL: 'fail',

  /** No DMARC policy found */
  NONE: 'none',

  /** Temporary error during DMARC check */
  TEMPERROR: 'temperror',

  /** Permanent error during DMARC check */
  PERMERROR: 'permerror',

  /** DMARC check was intentionally skipped (disabled globally or per-inbox) */
  SKIPPED: 'skipped',
} as const;

/**
 * DMARC Policy Values
 *
 * DMARC policy recommendations as defined in RFC 7489.
 */
export const DMARC_POLICY = {
  /** Take no action, only monitor */
  NONE: 'none',

  /** Mark messages as spam/quarantine */
  QUARANTINE: 'quarantine',

  /** Reject messages that fail DMARC */
  REJECT: 'reject',
} as const;

/**
 * Character Encoding Constants
 *
 * Standard character encodings used in email processing.
 */
export const ENCODING = {
  /** UTF-8 character encoding */
  UTF8: 'utf8' as const,

  /** Base64 encoding for binary data */
  BASE64: 'base64' as const,

  /** ASCII character encoding */
  ASCII: 'ascii' as const,
} as const;

/**
 * Reverse DNS Result Status Values
 *
 * Status values for reverse DNS (PTR record) verification.
 */
export const REVERSE_DNS_STATUS = {
  /** Reverse DNS check passed - PTR record resolves to originating IP */
  PASS: 'pass',

  /** Reverse DNS check failed - PTR record does not resolve correctly */
  FAIL: 'fail',

  /** No PTR record found */
  NONE: 'none',

  /** Reverse DNS check was intentionally skipped (disabled globally or per-inbox) */
  SKIPPED: 'skipped',
} as const;

/**
 * Email File Storage Constants
 *
 * Constants related to email file storage and naming.
 */
export const EMAIL_STORAGE = {
  /**
   * Default raw email encoding for JSON storage
   */
  RAW_ENCODING: 'base64' as const,

  /**
   * File extension for stored email records
   */
  FILE_EXTENSION: '.json' as const,

  /**
   * Characters to remove from filenames for safety
   */
  // eslint-disable-next-line no-control-regex
  UNSAFE_FILENAME_CHARS: /[/\\:*?"<>|\x00-\x1f]/g,
} as const;
