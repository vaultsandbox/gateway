/**
 * Predefined SMTP Error Codes for Chaos Engineering
 *
 * These error codes are used by the random error generator and specific error
 * injection features to simulate various SMTP failure scenarios.
 */

export interface SmtpError {
  code: number;
  enhanced: string;
  message: string;
}

/**
 * Temporary errors (4xx) - Client should retry
 */
export const TEMPORARY_ERRORS: SmtpError[] = [
  { code: 421, enhanced: '4.7.0', message: 'Service temporarily unavailable' },
  { code: 450, enhanced: '4.2.1', message: 'Mailbox busy, try again later' },
  { code: 451, enhanced: '4.3.0', message: 'Temporary processing error' },
  { code: 452, enhanced: '4.3.1', message: 'Insufficient storage' },
];

/**
 * Permanent errors (5xx) - Client should not retry
 */
export const PERMANENT_ERRORS: SmtpError[] = [
  { code: 550, enhanced: '5.1.1', message: 'Mailbox not found' },
  { code: 551, enhanced: '5.1.6', message: 'User not local' },
  { code: 552, enhanced: '5.3.4', message: 'Message size exceeds limit' },
  { code: 553, enhanced: '5.1.3', message: 'Mailbox name invalid' },
  { code: 554, enhanced: '5.0.0', message: 'Transaction failed' },
];

/**
 * Greylist-specific error
 */
export const GREYLIST_ERROR: SmtpError = {
  code: 451,
  enhanced: '4.7.1',
  message: 'Greylisting in operation, try again later',
};

/**
 * Rate limit error
 */
export const RATE_LIMIT_ERROR: SmtpError = {
  code: 421,
  enhanced: '4.7.0',
  message: 'Too many messages, slow down',
};

/**
 * Size exceeded error
 */
export const SIZE_EXCEEDED_ERROR: SmtpError = {
  code: 552,
  enhanced: '5.3.4',
  message: 'Message size exceeds limit',
};

/**
 * Get all errors of specified types
 */
export function getErrorsByTypes(types: ('temporary' | 'permanent')[]): SmtpError[] {
  const errors: SmtpError[] = [];
  if (types.includes('temporary')) {
    errors.push(...TEMPORARY_ERRORS);
  }
  if (types.includes('permanent')) {
    errors.push(...PERMANENT_ERRORS);
  }
  return errors;
}

/**
 * Get a random error from the specified types
 */
export function getRandomError(types: ('temporary' | 'permanent')[]): SmtpError {
  const errors = getErrorsByTypes(types);
  /* v8 ignore next 3 - defensive fallback for empty types array */
  if (errors.length === 0) {
    return TEMPORARY_ERRORS[0];
  }
  return errors[Math.floor(Math.random() * errors.length)];
}
