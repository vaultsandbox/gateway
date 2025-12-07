/**
 * Email Utility Functions
 *
 * Common utility functions for email address handling, domain extraction,
 * and IP normalization. These utilities are shared across SMTP services
 * for consistent email processing.
 *
 * @module email-utils
 */

/**
 * RFC 5321 email address length limits
 */
const EMAIL_LIMITS = {
  /** Maximum length of local part (before @) per RFC 5321 */
  MAX_LOCAL_PART: 64,
  /** Maximum length of domain part (after @) per RFC 5321 */
  MAX_DOMAIN: 255,
  /** Maximum total email address length per RFC 5321 */
  MAX_TOTAL: 320,
} as const;

/**
 * Regex pattern to detect control characters (0x00-0x1F and 0x7F)
 * These characters can cause log injection, terminal escape attacks, or parser confusion
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;

/**
 * Error class for email validation failures
 * Provides structured error information for validation rejections
 */
export class EmailValidationError extends Error {
  constructor(
    message: string,
    public readonly code: 'TOO_LONG' | 'INVALID_FORMAT' | 'CONTROL_CHARS' | 'EMPTY',
  ) {
    super(message);
    this.name = 'EmailValidationError';
  }
}

/**
 * Normalizes an IP address for consistent comparison and logging.
 *
 * Performs the following normalizations:
 * - Trims whitespace
 * - Removes IPv6 zone identifiers (e.g., %eth0)
 * - Strips IPv6-to-IPv4 mapping prefix (::ffff:)
 *
 * @param ip - IP address string to normalize
 * @returns Normalized IP address, or undefined if input is undefined
 *
 * @example
 * ```typescript
 * normalizeIp('::ffff:192.168.1.1') // returns '192.168.1.1'
 * normalizeIp('fe80::1%eth0') // returns 'fe80::1'
 * normalizeIp('  203.0.113.45  ') // returns '203.0.113.45'
 * ```
 */
export function normalizeIp(ip: string | undefined): string | undefined {
  if (!ip) {
    return undefined;
  }

  let normalized = ip.trim();

  // Remove IPv6 zone identifier (e.g., %eth0)
  const zoneIndex = normalized.indexOf('%');
  if (zoneIndex >= 0) {
    normalized = normalized.slice(0, zoneIndex);
  }

  // Strip IPv6-to-IPv4 mapping prefix
  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice(7);
  }

  return normalized;
}

/**
 * Extracts the domain portion from an email address.
 *
 * Returns the part after the @ symbol, lowercased for case-insensitive
 * domain comparison. Follows RFC 5321 section 2.3.11 (domains are
 * case-insensitive).
 *
 * @param email - The email address to extract domain from
 * @returns The domain portion in lowercase, or undefined if no @ found
 *
 * @example
 * ```typescript
 * extractDomain('user@Example.COM') // returns 'example.com'
 * extractDomain('admin@mail.example.org') // returns 'mail.example.org'
 * extractDomain('invalid-email') // returns undefined
 * ```
 */
export function extractDomain(email: string): string | undefined {
  const atIndex = email.indexOf('@');
  if (atIndex === -1) {
    return undefined;
  }
  return email.slice(atIndex + 1).toLowerCase();
}

/**
 * Validates an email address against RFC 5321 constraints.
 *
 * Performs the following security validations:
 * - Checks for empty/null sender (valid for bounce messages)
 * - Enforces RFC 5321 length limits (local: 64, domain: 255, total: 320)
 * - Rejects control characters (0x00-0x1F, 0x7F) to prevent injection attacks
 * - Validates basic email structure (local@domain)
 *
 * @param address - The email address to validate
 * @throws {EmailValidationError} If validation fails with specific error code
 *
 * @example
 * ```typescript
 * validateEmailAddress('user@example.com'); // OK
 * validateEmailAddress(''); // OK (null sender for bounces)
 * validateEmailAddress('a'.repeat(65) + '@example.com'); // throws TOO_LONG
 * validateEmailAddress('user\x00@example.com'); // throws CONTROL_CHARS
 * ```
 */
export function validateEmailAddress(address: string): void {
  // Handle null sender (empty MAIL FROM) - valid for bounce messages per RFC 5321 §4.5.5
  if (address === '' || address === '<>') {
    return;
  }

  // Check total length first (quick rejection)
  if (address.length > EMAIL_LIMITS.MAX_TOTAL) {
    throw new EmailValidationError(
      `Email address exceeds maximum length of ${EMAIL_LIMITS.MAX_TOTAL} characters`,
      'TOO_LONG',
    );
  }

  // Check for control characters (security: prevents log injection, terminal escapes)
  if (CONTROL_CHAR_PATTERN.test(address)) {
    throw new EmailValidationError('Email address contains invalid control characters', 'CONTROL_CHARS');
  }

  // Basic structure validation
  const atIndex = address.indexOf('@');
  if (atIndex === -1 || atIndex === 0 || atIndex === address.length - 1) {
    throw new EmailValidationError('Invalid email address format', 'INVALID_FORMAT');
  }

  const localPart = address.slice(0, atIndex);
  const domain = address.slice(atIndex + 1);

  // RFC 5321 local part limit
  if (localPart.length > EMAIL_LIMITS.MAX_LOCAL_PART) {
    throw new EmailValidationError(
      `Email local part exceeds maximum length of ${EMAIL_LIMITS.MAX_LOCAL_PART} characters`,
      'TOO_LONG',
    );
  }

  // RFC 5321 domain limit
  if (domain.length > EMAIL_LIMITS.MAX_DOMAIN) {
    throw new EmailValidationError(
      `Email domain exceeds maximum length of ${EMAIL_LIMITS.MAX_DOMAIN} characters`,
      'TOO_LONG',
    );
  }
}

/**
 * Checks if a string has basic email address structure.
 *
 * Performs a simple regex check to ensure the address contains an @ symbol
 * with text on both sides. Does not perform full RFC 5322 validation.
 *
 * @param value - The string to validate
 * @returns True if the string appears to be email-like
 *
 * @remarks
 * This is intentionally a simple check. Full RFC 5322 validation is complex
 * and often unnecessary for SMTP server validation. The regex `.+@.+` ensures:
 * - At least one character before @
 * - An @ symbol
 * - At least one character after @
 *
 * @example
 * ```typescript
 * isEmailLike('user@example.com') // returns true
 * isEmailLike('user') // returns false
 * isEmailLike('@example.com') // returns false
 * isEmailLike('user@') // returns false
 * ```
 */
export function isEmailLike(value: string): boolean {
  return /.+@.+/.test(value);
}

/**
 * Extracts a string from unknown value types (string or Buffer).
 *
 * Handles mailparser's string/Buffer polymorphism by converting Buffers
 * to UTF-8 strings. Returns undefined for other types.
 *
 * @param value - Value that may be a string, Buffer, or other type
 * @returns String representation, or undefined if not string/Buffer
 *
 * @example
 * ```typescript
 * extractString('hello');                    // Returns: "hello"
 * extractString(Buffer.from('world'));       // Returns: "world"
 * extractString(123);                        // Returns: undefined
 * extractString(null);                       // Returns: undefined
 * ```
 */
export function extractString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }

  return undefined;
}

/**
 * Extracts the base email address by removing any +tag suffix from the local part.
 *
 * This enables email aliasing where test1+shopping@domain.com resolves to test1@domain.com.
 * The +tag feature allows users to create multiple variations of their email address
 * without creating separate inboxes.
 *
 * @param email - The email address (potentially with +tag)
 * @returns The base email address without the +tag suffix
 *
 * @example
 * ```typescript
 * getBaseEmail('test1+shopping@example.com')  // returns 'test1@example.com'
 * getBaseEmail('user+newsletter@domain.org')  // returns 'user@domain.org'
 * getBaseEmail('simple@example.com')          // returns 'simple@example.com'
 * getBaseEmail('no-plus@example.com')         // returns 'no-plus@example.com'
 * ```
 */
export function getBaseEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex === -1) {
    return email;
  }

  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex); // Includes the @

  // Check if local part contains +
  const plusIndex = localPart.indexOf('+');
  if (plusIndex === -1) {
    return email; // No alias, return as-is
  }

  // Return base email: everything before + in local part + domain
  return localPart.slice(0, plusIndex) + domain;
}
