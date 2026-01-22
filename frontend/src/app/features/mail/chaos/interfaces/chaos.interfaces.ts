/**
 * Chaos Engineering Configuration Interfaces
 *
 * These interfaces define the structure for chaos engineering configuration
 * which allows simulating various failure modes for testing purposes.
 */

// ==================== Latency Configuration ====================

/**
 * Latency injection configuration.
 * Injects artificial delays into email processing.
 */
export interface LatencyConfig {
  /** Enable latency injection */
  enabled: boolean;
  /** Minimum delay in milliseconds (default: 500) */
  minDelayMs?: number;
  /** Maximum delay in milliseconds (default: 10000) */
  maxDelayMs?: number;
  /** Randomize delay within range; false = fixed at maxDelayMs (default: true) */
  jitter?: boolean;
  /** Probability of applying delay 0.0-1.0 (default: 1.0) */
  probability?: number;
}

// ==================== Connection Drop Configuration ====================

/**
 * Connection drop configuration.
 * Simulates connection failures by dropping the SMTP connection.
 * Connection is dropped after receiving email but before sending 250 OK.
 */
export interface ConnectionDropConfig {
  /** Enable connection dropping */
  enabled: boolean;
  /** Probability of dropping 0.0-1.0 (default: 1.0) */
  probability?: number;
  /** Use graceful close (FIN) vs abrupt (RST) (default: true) */
  graceful?: boolean;
}

// ==================== Random Error Configuration ====================

/** Types of SMTP errors that can be returned */
export type SmtpErrorType = 'temporary' | 'permanent';

/**
 * Random error configuration.
 * Returns random SMTP error codes.
 */
export interface RandomErrorConfig {
  /** Enable random error generation */
  enabled: boolean;
  /** Probability of returning an error 0.0-1.0 (default: 0.1) */
  errorRate?: number;
  /** Types of errors to return (default: ['temporary']) */
  errorTypes?: SmtpErrorType[];
}

// ==================== Greylist Configuration ====================

/** How to identify unique senders for greylisting */
export type GreylistTrackBy = 'ip' | 'sender' | 'ip_sender';

/**
 * Greylist configuration.
 * Simulates greylisting behavior (reject first attempt, accept on retry).
 */
export interface GreylistConfig {
  /** Enable greylisting simulation */
  enabled: boolean;
  /** Window for tracking retry attempts in ms (default: 300000 = 5 min) */
  retryWindowMs?: number;
  /** Number of attempts before accepting (default: 2) */
  maxAttempts?: number;
  /** How to identify unique senders (default: 'ip_sender') */
  trackBy?: GreylistTrackBy;
}

// ==================== Blackhole Configuration ====================

/**
 * Blackhole configuration.
 * Accepts emails but silently discards them (does not store).
 */
export interface BlackholeConfig {
  /** Enable blackhole mode */
  enabled: boolean;
  /** Whether to still trigger webhooks (default: false) */
  triggerWebhooks?: boolean;
}

// ==================== Main Configuration ====================

/**
 * Main chaos configuration request/response.
 * Contains all chaos type configurations for an inbox.
 */
export interface ChaosConfigRequest {
  /** Master switch for chaos on this inbox */
  enabled: boolean;
  /** ISO 8601 timestamp - auto-disable chaos after this time */
  expiresAt?: string;
  /** Latency injection settings */
  latency?: LatencyConfig;
  /** Connection drop settings */
  connectionDrop?: ConnectionDropConfig;
  /** Random error settings */
  randomError?: RandomErrorConfig;
  /** Greylisting settings */
  greylist?: GreylistConfig;
  /** Blackhole mode settings */
  blackhole?: BlackholeConfig;
}

/** Response type is the same as request */
export type ChaosConfigResponse = ChaosConfigRequest;
