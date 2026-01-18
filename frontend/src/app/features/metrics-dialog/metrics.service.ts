import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AuthPassRate,
  CertificateStatus,
  Metrics,
  StorageMetrics,
  WebhookMetrics,
} from '../../shared/interfaces/metrics.interfaces';

/**
 * Provides helpers for fetching and transforming SMTP gateway metrics.
 */
@Injectable({
  providedIn: 'root',
})
export class MetricsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  /**
   * Retrieves the aggregated SMTP gateway metrics from the backend.
   *
   * @returns Observable that emits Metric snapshots from `/metrics`.
   */
  getMetrics(): Observable<Metrics> {
    return this.http.get<Metrics>(`${this.baseUrl}/metrics`);
  }

  /**
   * Retrieves email storage metrics from the backend.
   * Only available when gateway is running in local mode.
   *
   * @returns Observable that emits StorageMetrics from `/metrics/storage`.
   */
  getStorageMetrics(): Observable<StorageMetrics> {
    return this.http.get<StorageMetrics>(`${this.baseUrl}/metrics/storage`);
  }

  /**
   * Retrieves aggregated webhook metrics from the backend.
   *
   * @returns Observable that emits WebhookMetrics from `/webhooks/metrics`.
   */
  getWebhookMetrics(): Observable<WebhookMetrics> {
    return this.http.get<WebhookMetrics>(`${this.baseUrl}/webhooks/metrics`);
  }

  /**
   * Derives the SPF, DKIM and DMARC pass rates based on the provided metrics.
   *
   * @param metrics All current gateway metrics.
   * @returns Percentage-based auth pass rate summary.
   */
  calculateAuthPassRates(metrics: Metrics): AuthPassRate {
    return {
      spf: this.calculatePassRate(metrics.auth.spf_pass, metrics.auth.spf_fail),
      dkim: this.calculatePassRate(metrics.auth.dkim_pass, metrics.auth.dkim_fail),
      dmarc: this.calculatePassRate(metrics.auth.dmarc_pass, metrics.auth.dmarc_fail),
    };
  }

  /**
   * Calculates the percentage of rejected connections.
   *
   * @param metrics All current gateway metrics.
   * @returns Rejection percentage (0-100).
   */
  calculateRejectionRate(metrics: Metrics): number {
    const total = metrics.connections.total;
    const rejected = metrics.connections.rejected;
    return total > 0 ? (rejected / total) * 100 : 0;
  }

  /**
   * Adds up the individual rejection counters.
   *
   * @param metrics All current gateway metrics.
   * @returns Total number of rejected items.
   */
  getTotalRejections(metrics: Metrics): number {
    return (
      metrics.rejections.sender_rejected_total +
      metrics.rejections.recipient_rejected_total +
      metrics.rejections.data_rejected_size_total +
      metrics.rejections.invalid_commands +
      metrics.rejections.hard_mode_total +
      metrics.rejections.rate_limit_total
    );
  }

  /**
   * Determines the average number of recipients per email.
   *
   * @param metrics All current gateway metrics.
   * @returns Average recipient count.
   */
  getAvgRecipientsPerEmail(metrics: Metrics): number {
    const received = metrics.email.received_total;
    return received > 0 ? metrics.email.recipients_total / received : 0;
  }

  /**
   * Maps days until certificate expiry to a status bucket.
   *
   * @param daysUntilExpiry Days remaining until expiration.
   * @returns Certificate status descriptor.
   */
  getCertificateStatus(daysUntilExpiry: number): CertificateStatus {
    if (daysUntilExpiry === 0) return 'disabled';
    if (daysUntilExpiry < 0) return 'expired';
    if (daysUntilExpiry < 7) return 'critical';
    if (daysUntilExpiry < 15) return 'critical';
    if (daysUntilExpiry < 30) return 'warning';
    return 'healthy';
  }

  /**
   * Categorises email processing latency.
   *
   * @param ms Processing time in milliseconds.
   * @returns Speed bucket label.
   */
  getProcessingTimeStatus(ms: number): 'fast' | 'acceptable' | 'slow' {
    if (ms < 500) return 'fast';
    if (ms < 2000) return 'acceptable';
    return 'slow';
  }

  /**
   * Calculates the success rate of certificate renewals.
   *
   * @param metrics All current gateway metrics.
   * @returns Success percentage (0-100).
   */
  getCertRenewalSuccessRate(metrics: Metrics): number {
    const attempts = metrics.certificate.renewal_attempts;
    const success = metrics.certificate.renewal_success;
    return attempts > 0 ? (success / attempts) * 100 : 0;
  }

  /**
   * Helper that computes a percentage from pass/fail counters.
   *
   * @param pass Number of successful checks.
   * @param fail Number of failed checks.
   * @returns Percentage of passes (0-100).
   */
  private calculatePassRate(pass: number, fail: number): number {
    const total = pass + fail;
    return total > 0 ? (pass / total) * 100 : 0;
  }
}
