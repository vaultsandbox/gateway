/**
 * Chaos Engineering Configuration Interfaces
 *
 * Defines all configuration types for chaos engineering features.
 * Each chaos type has its own configuration interface with enable/disable
 * and type-specific settings.
 */

/**
 * Latency injection configuration
 */
export interface LatencyConfig {
  enabled: boolean;
  minDelayMs: number; // Default: 500
  maxDelayMs: number; // Default: 10000
  jitter: boolean; // Randomize within range
  probability: number; // 0.0-1.0, chance of applying delay
}

/**
 * Connection drop configuration
 */
export interface ConnectionDropConfig {
  enabled: boolean;
  probability: number; // 0.0-1.0
  graceful: boolean; // true = FIN, false = RST
}

/**
 * Random error generator configuration
 */
export interface RandomErrorConfig {
  enabled: boolean;
  errorRate: number; // 0.0-1.0 (e.g., 0.1 = 10% fail)
  errorTypes: ('temporary' | 'permanent')[];
}

/**
 * Greylisting simulator configuration
 */
export interface GreylistConfig {
  enabled: boolean;
  retryWindowMs: number; // Default: 300000 (5 minutes)
  maxAttempts: number; // Accept after N attempts, default: 2
  trackBy: 'ip' | 'sender' | 'ip_sender';
}

/**
 * Blackhole mode configuration
 */
export interface BlackholeConfig {
  enabled: boolean;
  triggerWebhooks: boolean; // false = also suppress webhooks
}

/**
 * Complete inbox chaos configuration
 */
export interface InboxChaosConfig {
  enabled: boolean; // Master switch for this inbox
  expiresAt?: string; // ISO timestamp for auto-disable (optional)

  latency?: LatencyConfig;
  connectionDrop?: ConnectionDropConfig;
  randomError?: RandomErrorConfig;
  greylist?: GreylistConfig;
  blackhole?: BlackholeConfig;
}

/**
 * Result of chaos evaluation
 */
export type ChaosAction =
  | { action: 'continue' }
  | { action: 'delay'; delayMs: number }
  | { action: 'error'; code: number; enhanced: string; message: string }
  | { action: 'drop'; graceful: boolean }
  | { action: 'blackhole'; triggerWebhooks: boolean };

/**
 * Chaos evaluation result with details for logging
 */
export interface ChaosEvaluationResult {
  result: ChaosAction;
  chaosType?: string;
  details?: string;
}
