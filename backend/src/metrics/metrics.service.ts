import { Injectable, Logger } from '@nestjs/common';
import type { MetricPath } from './metrics.constants';
import { Metrics } from './interfaces';

/**
 * @class MetricsService
 * @description Service responsible for collecting, tracking, and managing system metrics.
 * Provides methods to increment, decrement, and set metric values, as well as retrieve
 * the current state of all tracked metrics. This service is essential for monitoring
 * system performance, usage patterns, and health status.
 */
@Injectable()
export class MetricsService {
  /** Logger instance for the MetricsService */
  private readonly logger = new Logger(MetricsService.name);
  /** Timestamp when the service was initialized, used for uptime calculation */
  private readonly startTime: number = Date.now();

  /** Internal storage for all metrics values */
  private metrics: Metrics = {
    connections: {
      total: 0,
      active: 0,
      rejected: 0,
    },
    inbox: {
      created_total: 0,
      deleted_total: 0,
      active_total: 0,
    },
    email: {
      received_total: 0,
      recipients_total: 0,
      processing_time_ms: 0,
    },
    rejections: {
      invalid_commands: 0,
      sender_rejected_total: 0,
      recipient_rejected_total: 0,
      data_rejected_size_total: 0,
      hard_mode_total: 0,
      rate_limit_total: 0,
    },
    auth: {
      spf_pass: 0,
      spf_fail: 0,
      dkim_pass: 0,
      dkim_fail: 0,
      dmarc_pass: 0,
      dmarc_fail: 0,
    },
    certificate: {
      days_until_expiry: 0,
      renewal_attempts: 0,
      renewal_success: 0,
      renewal_failures: 0,
    },
    server: {
      uptime_seconds: 0,
    },
    spam: {
      analyzed_total: 0,
      skipped_total: 0,
      errors_total: 0,
      spam_detected_total: 0,
      processing_time_ms: 0,
    },
  };

  /** Counter for tracking the number of email processing events */
  private emailProcessingCount = 0;
  /** Accumulator for the total processing time of all emails */
  private emailProcessingSum = 0;

  /**
   * Retrieves the current state of all metrics.
   * @returns {Readonly<Metrics>} A readonly copy of all metrics with dynamically calculated uptime.
   * @description Returns a snapshot of all current metrics. The server uptime is calculated
   * dynamically based on the service start time to ensure accuracy.
   */
  getMetrics(): Readonly<Metrics> {
    // Calculate uptime dynamically
    const uptimeMs = Date.now() - this.startTime;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);

    return {
      ...this.metrics,
      server: {
        uptime_seconds: uptimeSeconds,
      },
    };
  }

  /**
   * Increments a specific metric by the given value.
   * @param {MetricPath} path - The dot-separated path to the metric to increment.
   * @param {number} value - The value to increment by (default: 1).
   * @description Safely increments a numeric metric at the specified path. If the path is invalid
   * or doesn't point to a number, an error is logged but the operation fails gracefully.
   */
  increment(path: MetricPath, value: number = 1): void {
    try {
      const keys = path.split('.');

      let current: any = this.metrics;

      for (let i = 0; i < keys.length - 1; i++) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (!current[keys[i]]) {
          throw new Error(`Invalid metric path: ${path} (key "${keys[i]}" not found)`);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        current = current[keys[i]];
      }

      const finalKey = keys[keys.length - 1];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (typeof current[finalKey] !== 'number') {
        throw new Error(`Invalid metric path: ${path} (not a number)`);
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      current[finalKey] += value;
    } catch (error) {
      this.logger.error(`Failed to increment metric ${path}: ${(error as Error).message}`);
    }
  }

  /**
   * Decrements a specific metric by the given value.
   * @param {MetricPath} path - The dot-separated path to the metric to decrement.
   * @param {number} value - The value to decrement by (default: 1).
   * @description Safely decrements a numeric metric at the specified path. If the path is invalid
   * or doesn't point to a number, an error is logged but the operation fails gracefully.
   */
  decrement(path: MetricPath, value: number = 1): void {
    try {
      const keys = path.split('.');

      let current: any = this.metrics;

      for (let i = 0; i < keys.length - 1; i++) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (!current[keys[i]]) {
          throw new Error(`Invalid metric path: ${path} (key "${keys[i]}" not found)`);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        current = current[keys[i]];
      }

      const finalKey = keys[keys.length - 1];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (typeof current[finalKey] !== 'number') {
        throw new Error(`Invalid metric path: ${path} (not a number)`);
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      current[finalKey] -= value;
    } catch (error) {
      this.logger.error(`Failed to decrement metric ${path}: ${(error as Error).message}`);
    }
  }

  /**
   * Sets a specific metric to the given value.
   * @param {MetricPath} path - The dot-separated path to the metric to set.
   * @param {number} value - The value to set the metric to.
   * @description Safely sets a numeric metric at the specified path to the given value. If the path is invalid
   * or doesn't point to a number, an error is logged but the operation fails gracefully.
   */
  set(path: MetricPath, value: number): void {
    try {
      const keys = path.split('.');

      let current: any = this.metrics;

      for (let i = 0; i < keys.length - 1; i++) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (!current[keys[i]]) {
          throw new Error(`Invalid metric path: ${path} (key "${keys[i]}" not found)`);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        current = current[keys[i]];
      }

      const finalKey = keys[keys.length - 1];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (typeof current[finalKey] !== 'number') {
        throw new Error(`Invalid metric path: ${path} (not a number)`);
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      current[finalKey] = value;
    } catch (error) {
      this.logger.error(`Failed to set metric ${path}: ${(error as Error).message}`);
    }
  }

  /**
   * Records the processing time for an email and updates the average.
   * @param {number} ms - The processing time in milliseconds.
   * @description Special method for tracking average email processing time. Maintains a running
   * average by storing the total count and sum of processing times, then updating the
   * email.processing_time_ms metric with the calculated average.
   */
  recordProcessingTime(ms: number): void {
    this.emailProcessingCount++;
    this.emailProcessingSum += ms;
    this.metrics.email.processing_time_ms = Math.round(this.emailProcessingSum / this.emailProcessingCount);
  }
}
