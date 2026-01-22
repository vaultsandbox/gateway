/**
 * Custom error class for chaos-related SMTP errors.
 *
 * This error class allows chaos handlers to throw errors that will be
 * properly handled by the SMTP server, including custom response codes
 * and connection drop signaling.
 */

/**
 * Error thrown when chaos engineering triggers an SMTP error response.
 */
export class ChaosSmtpError extends Error {
  public readonly responseCode: number;
  public readonly enhanced: string;

  constructor(code: number, enhanced: string, message: string) {
    super(`${code} ${enhanced} ${message}`);
    this.name = 'ChaosSmtpError';
    this.responseCode = code;
    this.enhanced = enhanced;
  }
}

/**
 * Error thrown when chaos engineering triggers a connection drop.
 * The SMTP service should catch this and close the socket.
 */
export class ChaosDropError extends Error {
  public readonly graceful: boolean;

  constructor(graceful: boolean) {
    super('Chaos connection drop');
    this.name = 'ChaosDropError';
    this.graceful = graceful;
  }
}
