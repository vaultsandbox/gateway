/**
 * Console message types for styling/formatting
 */
export type ConsoleMessageType = 'info' | 'success' | 'warning' | 'error';

/**
 * Console message for SSE streaming
 */
export interface ConsoleMessage {
  /**
   * Message type (determines color/icon on client)
   */
  type: ConsoleMessageType;

  /**
   * Plain text message
   */
  text: string;

  /**
   * Timestamp in ISO 8601 format
   */
  timestamp: string;
}
