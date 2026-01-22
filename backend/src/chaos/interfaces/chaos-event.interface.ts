/**
 * Chaos Event Interface
 *
 * Defines the structure for chaos event logging and tracking.
 */

/**
 * Chaos event recorded when chaos is applied to an email
 */
export interface ChaosEvent {
  timestamp: Date;
  inboxEmail: string;
  chaosType: string;
  details: string;
  sessionId: string;
  messageId?: string;
}

/**
 * Chaos event for SSE console output
 */
export interface ChaosConsoleEvent {
  type: 'chaos';
  inbox: string;
  chaosType: string;
  details: string;
  sessionId: string;
}
