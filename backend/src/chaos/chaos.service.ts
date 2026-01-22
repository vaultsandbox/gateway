import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { InboxChaosConfig, ChaosEvaluationResult } from './interfaces/chaos-config.interface';
import type { ChaosEvent } from './interfaces/chaos-event.interface';
import { SseConsoleService } from '../sse-console/sse-console.service';
import { MetricsService } from '../metrics/metrics.service';
import { METRIC_PATHS } from '../metrics/metrics.constants';
import { LatencyHandler } from './handlers/latency.handler';
import { ConnectionDropHandler } from './handlers/connection-drop.handler';
import { RandomErrorHandler } from './handlers/random-error.handler';
import { GreylistHandler, GreylistContext } from './handlers/greylist.handler';
import { BlackholeHandler } from './handlers/blackhole.handler';
import { GreylistStateService } from './state/greylist-state.service';

/**
 * Core chaos orchestration service.
 *
 * Responsible for:
 * - Evaluating inbox chaos configuration during SMTP handling
 * - Coordinating chaos actions (delay, error, drop, blackhole)
 * - Logging chaos events to SSE console and metrics
 *
 * Supported chaos types:
 * - Latency injection
 * - Connection dropping
 * - Random error generation
 * - Greylisting simulation
 * - Blackhole mode
 */
@Injectable()
export class ChaosService {
  private readonly logger = new Logger(ChaosService.name);
  private readonly chaosEnabled: boolean;
  private readonly latencyHandler: LatencyHandler;
  private readonly connectionDropHandler: ConnectionDropHandler;
  private readonly randomErrorHandler: RandomErrorHandler;
  private readonly greylistHandler: GreylistHandler;
  private readonly blackholeHandler: BlackholeHandler;

  /* v8 ignore next 7 - false positive on constructor parameter properties */
  constructor(
    private readonly configService: ConfigService,
    private readonly sseConsoleService: SseConsoleService,
    private readonly metricsService: MetricsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly greylistStateService: GreylistStateService,
  ) {
    this.chaosEnabled = this.configService.get<boolean>('vsb.chaos.enabled', false);
    this.latencyHandler = new LatencyHandler();
    this.connectionDropHandler = new ConnectionDropHandler();
    this.randomErrorHandler = new RandomErrorHandler();
    this.greylistHandler = new GreylistHandler(this.greylistStateService);
    this.blackholeHandler = new BlackholeHandler();
    this.logger.log(`ChaosService initialized (enabled=${this.chaosEnabled})`);
  }

  /**
   * Check if chaos engineering is enabled globally.
   */
  isEnabled(): boolean {
    return this.chaosEnabled;
  }

  /**
   * Evaluate chaos configuration for an inbox and determine the action.
   *
   * Evaluates chaos types in priority order:
   * 1. Connection drop (most disruptive)
   * 2. Greylisting (requires greylistContext)
   * 3. Random error generation
   * 4. Blackhole mode
   * 5. Latency injection (least disruptive)
   *
   * The first non-continue action is returned.
   *
   * @param chaosConfig - Inbox chaos configuration
   * @param sessionId - SMTP session ID for logging
   * @param inboxEmail - Inbox email address for logging
   * @param greylistContext - Optional context for greylist evaluation (sender IP and email)
   * @returns Chaos evaluation result with action and details
   */
  evaluate(
    chaosConfig: InboxChaosConfig | undefined,
    sessionId: string,
    inboxEmail: string,
    greylistContext?: Omit<GreylistContext, 'inboxEmail'>,
  ): ChaosEvaluationResult {
    // If chaos is globally disabled, always continue
    if (!this.chaosEnabled) {
      return { result: { action: 'continue' } };
    }

    // If no chaos config or chaos disabled for inbox, continue
    if (!chaosConfig || !chaosConfig.enabled) {
      return { result: { action: 'continue' } };
    }

    // Check if chaos config has expired
    if (chaosConfig.expiresAt) {
      const expiresAt = new Date(chaosConfig.expiresAt);
      if (expiresAt < new Date()) {
        this.logger.debug(`Chaos config expired for ${inboxEmail}, skipping`);
        return { result: { action: 'continue' } };
      }
    }

    // Evaluate chaos types in priority order:
    // 1. Connection drop (most disruptive - drops connection entirely)
    // 2. Greylist (reject until retry threshold met)
    // 3. Random error (returns error code)
    // 4. Blackhole (accepts but discards email)
    // 5. Latency (least disruptive - just adds delay)

    // 1. Connection drop
    if (chaosConfig.connectionDrop?.enabled) {
      const dropResult = this.connectionDropHandler.evaluate(chaosConfig.connectionDrop);
      if (dropResult.action.action !== 'continue') {
        this.logChaosEvent({
          timestamp: new Date(),
          inboxEmail,
          chaosType: 'connection_drop',
          /* v8 ignore next - defensive fallback, handler always provides details */
          details: dropResult.details || 'Connection dropped',
          sessionId,
        });
        this.metricsService.increment(METRIC_PATHS.CHAOS_CONNECTIONS_DROPPED_TOTAL);
        return { result: dropResult.action, chaosType: 'connection_drop', details: dropResult.details };
      }
    }

    // 2. Greylist (requires context with sender info)
    if (chaosConfig.greylist?.enabled && greylistContext) {
      const greylistResult = this.greylistHandler.evaluate(chaosConfig.greylist, {
        inboxEmail,
        senderIp: greylistContext.senderIp,
        senderEmail: greylistContext.senderEmail,
      });
      if (greylistResult.action.action !== 'continue') {
        this.logChaosEvent({
          timestamp: new Date(),
          inboxEmail,
          chaosType: 'greylist',
          /* v8 ignore next - defensive fallback, handler always provides details */
          details: greylistResult.details || 'Greylisting rejection',
          sessionId,
        });
        this.metricsService.increment(METRIC_PATHS.CHAOS_GREYLIST_REJECTIONS_TOTAL);
        return { result: greylistResult.action, chaosType: 'greylist', details: greylistResult.details };
      }
    }

    // 3. Random error
    if (chaosConfig.randomError?.enabled) {
      const errorResult = this.randomErrorHandler.evaluate(chaosConfig.randomError);
      if (errorResult.action.action !== 'continue') {
        this.logChaosEvent({
          timestamp: new Date(),
          inboxEmail,
          chaosType: 'random_error',
          /* v8 ignore next - defensive fallback, handler always provides details */
          details: errorResult.details || 'Random error returned',
          sessionId,
        });
        this.metricsService.increment(METRIC_PATHS.CHAOS_ERRORS_RETURNED_TOTAL);
        return { result: errorResult.action, chaosType: 'random_error', details: errorResult.details };
      }
    }

    // 4. Blackhole (accepts email but doesn't store)
    if (chaosConfig.blackhole?.enabled) {
      const blackholeResult = this.blackholeHandler.evaluate(chaosConfig.blackhole);
      if (blackholeResult.action.action !== 'continue') {
        this.logChaosEvent({
          timestamp: new Date(),
          inboxEmail,
          chaosType: 'blackhole',
          /* v8 ignore next - defensive fallback, handler always provides details */
          details: blackholeResult.details || 'Email blackholed',
          sessionId,
        });
        this.metricsService.increment(METRIC_PATHS.CHAOS_BLACKHOLE_TOTAL);
        return { result: blackholeResult.action, chaosType: 'blackhole', details: blackholeResult.details };
      }
    }

    // 5. Latency injection (lowest priority - applies delay before response)
    if (chaosConfig.latency?.enabled) {
      const latencyResult = this.latencyHandler.evaluate(chaosConfig.latency);
      if (latencyResult.action.action !== 'continue') {
        /* v8 ignore next - defensive fallback, action is always 'delay' here */
        const delayMs = latencyResult.action.action === 'delay' ? latencyResult.action.delayMs : 0;
        this.logChaosEvent({
          timestamp: new Date(),
          inboxEmail,
          chaosType: 'latency',
          /* v8 ignore next - defensive fallback, handler always provides details */
          details: latencyResult.details || `${delayMs}ms delay`,
          sessionId,
        });
        this.metricsService.increment(METRIC_PATHS.CHAOS_LATENCY_INJECTED_MS, delayMs);
        return { result: latencyResult.action, chaosType: 'latency', details: latencyResult.details };
      }
    }

    return { result: { action: 'continue' } };
  }

  /**
   * Log a chaos event to SSE console and metrics.
   *
   * @param event - Chaos event to log
   */
  logChaosEvent(event: ChaosEvent): void {
    // Log to standard logger
    this.logger.log(
      `[CHAOS] inbox=${event.inboxEmail} type=${event.chaosType} ` +
        `details="${event.details}" session=${event.sessionId}` +
        (event.messageId ? ` messageId=${event.messageId}` : ''),
    );

    // Log to SSE console
    this.sseConsoleService.log(
      'warning',
      `🎲 [CHAOS] ${event.chaosType}: ${event.details} (inbox=${event.inboxEmail})`,
    );

    // Increment metrics
    this.metricsService.increment(METRIC_PATHS.CHAOS_EVENTS_TOTAL);

    // Emit event for potential webhook handling
    this.eventEmitter.emit('chaos.applied', event);
  }

  /**
   * Get default chaos configuration with all features disabled.
   */
  getDefaultConfig(): InboxChaosConfig {
    return {
      enabled: false,
    };
  }

  /**
   * Validate and normalize chaos configuration.
   * Fills in defaults for missing values.
   *
   * @param config - Raw chaos configuration from API (may have optional fields)
   * @returns Normalized chaos configuration with all required fields filled in
   */
  /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

  normalizeConfig(config: Record<string, any>): InboxChaosConfig {
    const normalized: InboxChaosConfig = {
      enabled: Boolean(config.enabled),
      expiresAt: config.expiresAt as string | undefined,
    };

    // Normalize latency config
    if (config.latency) {
      normalized.latency = {
        enabled: Boolean(config.latency.enabled),
        minDelayMs: config.latency.minDelayMs ?? 500,
        maxDelayMs: config.latency.maxDelayMs ?? 10000,
        jitter: config.latency.jitter ?? true,
        probability: config.latency.probability ?? 1.0,
      };
    }

    // Normalize connectionDrop config
    if (config.connectionDrop) {
      normalized.connectionDrop = {
        enabled: Boolean(config.connectionDrop.enabled),
        probability: config.connectionDrop.probability ?? 1.0,
        graceful: config.connectionDrop.graceful ?? true,
      };
    }

    // Normalize randomError config
    if (config.randomError) {
      normalized.randomError = {
        enabled: Boolean(config.randomError.enabled),
        errorRate: config.randomError.errorRate ?? 0.1,
        errorTypes: config.randomError.errorTypes ?? ['temporary'],
      };
    }

    // Normalize greylist config
    if (config.greylist) {
      normalized.greylist = {
        enabled: Boolean(config.greylist.enabled),
        retryWindowMs: config.greylist.retryWindowMs ?? 300000,
        maxAttempts: config.greylist.maxAttempts ?? 2,
        trackBy: config.greylist.trackBy ?? 'ip_sender',
      };
    }

    // Normalize blackhole config
    if (config.blackhole) {
      normalized.blackhole = {
        enabled: Boolean(config.blackhole.enabled),
        triggerWebhooks: config.blackhole.triggerWebhooks ?? false,
      };
    }

    return normalized;
  }
  /* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
}
