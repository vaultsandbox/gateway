/**
 * SMTP Rate Limiter Service
 *
 * Provides per-IP rate limiting for SMTP connections to prevent abuse
 * in the QA email testing environment. Uses in-memory storage via
 * rate-limiter-flexible.
 *
 * ## Features
 * - Per-IP address rate limiting
 * - In-memory storage (no Redis required)
 * - Configurable via environment variables
 * - Returns proper SMTP error codes when limits exceeded
 * - Emits metrics for rate limit violations
 *
 * @module smtp-rate-limiter
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { MetricsService } from '../metrics/metrics.service';
import { METRIC_PATHS } from '../metrics/metrics.constants';

/**
 * Configuration interface for SMTP rate limiting
 */
export interface SmtpRateLimitConfig {
  enabled: boolean;
  points: number; // Max emails per duration
  duration: number; // Duration in seconds
}

/**
 * Custom error for rate limit exceeded
 */
export class RateLimitExceededError extends Error {
  public readonly responseCode: number = 421;
  public readonly retryAfter?: number;

  constructor(retryAfter?: number) {
    const message = retryAfter
      ? `4.7.0 Too many connections from your IP address. Please try again in ${Math.ceil(retryAfter / 1000)} seconds.`
      : '4.7.0 Too many connections from your IP address. Please try again later.';

    super(message);
    this.name = 'RateLimitExceededError';
    this.retryAfter = retryAfter;

    // Maintain proper stack trace (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RateLimitExceededError);
    }
  }
}

@Injectable()
export class SmtpRateLimiterService {
  private readonly logger = new Logger(SmtpRateLimiterService.name);
  private readonly config: SmtpRateLimitConfig;
  private readonly rateLimiter?: RateLimiterMemory;

  constructor(
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
  ) {
    this.config = this.configService.get<SmtpRateLimitConfig>('vsb.smtpRateLimit')!;

    if (!this.config.enabled) {
      this.logger.log('SMTP rate limiting disabled');
      return;
    }

    // Initialize rate limiter with configured settings
    this.rateLimiter = new RateLimiterMemory({
      points: this.config.points, // Number of points
      duration: this.config.duration, // Per duration in seconds
      blockDuration: 0, // Do not block, just count
    });

    this.logger.log(
      `SMTP rate limiter initialized: ${this.config.points} requests per ${this.config.duration} seconds per IP`,
    );
  }

  /**
   * Consumes a point for the given IP address
   *
   * @param ip - IP address to check and consume
   * @throws {RateLimitExceededError} If rate limit is exceeded
   */
  async consumeIp(ip: string): Promise<void> {
    // If rate limiting is disabled, allow all requests
    if (!this.config.enabled || !this.rateLimiter) {
      return;
    }

    try {
      await this.rateLimiter.consume(ip, 1);
      // Successfully consumed a point
    } catch (error) {
      // Rate limit exceeded
      if (error instanceof RateLimiterRes) {
        const retryAfterMs = error.msBeforeNext;

        this.logger.warn(
          `Rate limit exceeded for IP ${ip}. ` +
            `Consumed: ${error.consumedPoints}/${this.config.points}. ` +
            `Retry after: ${Math.ceil(retryAfterMs / 1000)}s`,
        );

        // Emit metric for rate limit violation
        this.metricsService.increment(METRIC_PATHS.REJECTIONS_RATE_LIMIT);

        // Throw custom error with retry-after information
        throw new RateLimitExceededError(retryAfterMs);
      }

      // Re-throw unexpected errors
      throw error;
    }
  }

  /**
   * Gets the current rate limit status for an IP address
   *
   * Useful for debugging and monitoring. Does not consume points.
   *
   * @param ip - IP address to check
   * @returns Current consumption status or undefined if rate limiting disabled
   */
  async getStatus(ip: string): Promise<RateLimiterRes | null> {
    if (!this.config.enabled || !this.rateLimiter) {
      return null;
    }

    try {
      return await this.rateLimiter.get(ip);
    } catch {
      return null;
    }
  }

  /**
   * Resets the rate limit for a specific IP address
   *
   * Useful for testing or manual intervention. Should be used sparingly
   * in production environments.
   *
   * @param ip - IP address to reset
   */
  async resetIp(ip: string): Promise<void> {
    if (!this.config.enabled || !this.rateLimiter) {
      return;
    }

    await this.rateLimiter.delete(ip);
    this.logger.log(`Rate limit reset for IP ${ip}`);
  }
}
