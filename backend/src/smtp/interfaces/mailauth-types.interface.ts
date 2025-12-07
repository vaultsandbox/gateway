/**
 * Type definitions for the mailauth library
 *
 * These interfaces describe the structure of responses from the mailauth library,
 * which provides SPF, DKIM, and DMARC email authentication verification.
 *
 * @module mailauth-types
 */

/**
 * Status object returned by mailauth validation functions
 *
 * Contains the result status and optional comment explaining the result.
 */
export interface MailauthStatusObject {
  /**
   * The validation result status
   * Common values: 'pass', 'fail', 'neutral', 'none', 'softfail', 'temperror', 'permerror'
   */
  result?: string;

  /**
   * Additional comment or explanation about the validation result
   */
  comment?: string;
}

/**
 * Result from SPF (Sender Policy Framework) verification
 *
 * SPF validates whether the sending server's IP address is authorized
 * to send email for the sender's domain.
 */
export interface MailauthSpfResult {
  /**
   * Validation status - can be a string or status object
   */
  status?: MailauthStatusObject | string;

  /**
   * Additional information about the SPF check
   */
  info?: string;
}

/**
 * DKIM signature information from email verification
 *
 * Each DKIM-Signature header in an email produces one signature result.
 * Multiple signatures are possible when an email is signed by multiple domains.
 */
export interface MailauthDkimSignature {
  /**
   * Validation status of this DKIM signature
   */
  status?: MailauthStatusObject | string;

  /**
   * The domain that signed the email (alternative field name)
   */
  signingDomain?: string;

  /**
   * The domain that signed the email
   */
  domain?: string;

  /**
   * The DKIM selector used (identifies the public key in DNS)
   */
  selector?: string;

  /**
   * Additional information about the DKIM verification
   */
  info?: string;
}

/**
 * Result from DKIM (DomainKeys Identified Mail) verification
 *
 * Contains results for all DKIM signatures found in the email.
 */
export interface MailauthDkimResult {
  /**
   * Array of DKIM signature verification results
   */
  results?: MailauthDkimSignature[];
}

/**
 * DMARC alignment information
 *
 * DMARC checks whether SPF and DKIM results align with the From header domain.
 */
export interface MailauthDmarcAlignment {
  /**
   * SPF alignment result
   */
  spf?: { result?: string };

  /**
   * DKIM alignment result
   */
  dkim?: { result?: string };
}

/**
 * Result from DMARC (Domain-based Message Authentication, Reporting, and Conformance) verification
 *
 * DMARC builds on SPF and DKIM to provide sender domain authentication.
 */
export interface MailauthDmarcResult {
  /**
   * Overall DMARC validation status
   */
  status?: MailauthStatusObject | string;

  /**
   * DMARC policy (alternative field name)
   * Values: 'none', 'quarantine', 'reject'
   */
  policy?: string;

  /**
   * DMARC policy (short form)
   * Values: 'none', 'quarantine', 'reject'
   */
  p?: string;

  /**
   * Alignment information for SPF and DKIM
   */
  alignment?: MailauthDmarcAlignment;

  /**
   * Additional information about the DMARC check
   */
  info?: string;

  /**
   * The domain being validated
   */
  domain?: string;
}
