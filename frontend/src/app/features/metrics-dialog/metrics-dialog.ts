import { Component, Output, EventEmitter, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { BadgeModule } from 'primeng/badge';
import { MetricsService } from './metrics.service';
import { firstValueFrom } from 'rxjs';
import { TooltipModule } from 'primeng/tooltip';
import { Tabs, TabList, Tab, TabPanels, TabPanel } from 'primeng/tabs';
import {
  Metrics,
  CertificateStatus,
  StorageMetrics,
  StorageHealthStatus,
} from '../../shared/interfaces/metrics.interfaces';
import { AUTO_REFRESH_INTERVAL_MS } from '../../shared/constants/app.constants';
import { formatUptime, formatDuration, formatDurationMs } from '../../shared/utils/time.utils';
import { BaseDialog } from '../../shared/components/base-dialog';

@Component({
  selector: 'app-metrics-dialog',
  imports: [
    CommonModule,
    DialogModule,
    ButtonModule,
    ProgressBarModule,
    BadgeModule,
    TooltipModule,
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
  ],
  templateUrl: './metrics-dialog.html',
  styleUrl: './metrics-dialog.scss',
  standalone: true,
})
/**
 * Dialog component that surfaces mail delivery metrics with auto-refreshing status.
 * Handles loading state, error reporting, and emits when the dialog is closed.
 */
export class MetricsDialog extends BaseDialog implements OnInit, OnDestroy {
  private readonly metricsService = inject(MetricsService);
  private readonly cdr = inject(ChangeDetectorRef);

  @Output() override closed = new EventEmitter<void>();

  metrics: Metrics | null = null;
  storageMetrics: StorageMetrics | null = null;
  loading = false;
  error: string | null = null;
  autoRefreshInterval: ReturnType<typeof setInterval> | null = null;

  activeTab = 'general';
  private readonly TAB_GENERAL = 'general';
  private readonly TAB_STORAGE = 'storage';

  /**
   * Initializes metrics retrieval and starts the auto-refresh cycle on mount.
   */
  ngOnInit(): void {
    this.loadMetrics();
    this.startAutoRefresh();
  }

  /**
   * Stops the auto-refresh timer when the component is destroyed.
   */
  ngOnDestroy(): void {
    this.stopAutoRefresh();
  }

  /**
   * Loads metrics from the service based on active tab, surfacing loading and error states.
   */
  async loadMetrics(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.cdr.detectChanges();

    try {
      if (this.activeTab === this.TAB_GENERAL) {
        this.metrics = await firstValueFrom(this.metricsService.getMetrics());
      } else if (this.activeTab === this.TAB_STORAGE) {
        this.storageMetrics = await firstValueFrom(this.metricsService.getStorageMetrics());
      }
      this.cdr.detectChanges();
    } catch (err: unknown) {
      console.error('Failed to load metrics:', err);
      this.error = err instanceof Error ? err.message : 'Failed to load metrics';
      this.cdr.detectChanges();
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  /**
   * Handles tab switching and triggers immediate metrics refresh for the newly active tab.
   */
  onTabChange(newTab: string | number | undefined): void {
    if (newTab === undefined) return;
    this.activeTab = String(newTab);
    this.loadMetrics();
  }

  /**
   * Triggered by the dialog close button.
   */
  onClose(): void {
    this.closeDialog();
  }

  /**
   * Manual refresh invoked from the Refresh button.
   */
  onRefresh(): void {
    this.loadMetrics();
  }

  /**
   * Starts a 5 second interval that refreshes metrics while the dialog is visible.
   */
  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    // Refresh every 5 seconds
    /* istanbul ignore next 3 - interval callback tested via lifecycle hooks */
    this.autoRefreshInterval = setInterval(() => {
      if (this.dialogVisible) {
        this.loadMetrics();
      }
    }, AUTO_REFRESH_INTERVAL_MS);
  }

  /**
   * Clears any active auto-refresh interval and resets tracking state.
   */
  private stopAutoRefresh(): void {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
      this.autoRefreshInterval = null;
    }
  }

  // Helper methods for template
  /**
   * Aggregated SPF/DKIM/DMARC pass rates.
   */
  get authPassRates() {
    return this.metrics ? this.metricsService.calculateAuthPassRates(this.metrics) : { spf: 0, dkim: 0, dmarc: 0 };
  }

  /**
   * Overall rejection rate for processed messages.
   */
  get rejectionRate() {
    return this.metrics ? this.metricsService.calculateRejectionRate(this.metrics) : 0;
  }

  /**
   * Total number of rejected messages.
   */
  get totalRejections() {
    return this.metrics ? this.metricsService.getTotalRejections(this.metrics) : 0;
  }

  /**
   * Average recipients per email.
   */
  get avgRecipientsPerEmail() {
    return this.metrics ? this.metricsService.getAvgRecipientsPerEmail(this.metrics) : 0;
  }

  /**
   * Certificate health category derived from days until expiry.
   */
  get certificateStatus(): CertificateStatus {
    return this.metrics
      ? this.metricsService.getCertificateStatus(this.metrics.certificate.days_until_expiry)
      : 'disabled';
  }

  /**
   * Processing speed category for the current metrics snapshot.
   */
  get processingTimeStatus() {
    return this.metrics ? this.metricsService.getProcessingTimeStatus(this.metrics.email.processing_time_ms) : 'fast';
  }

  /**
   * Percentage of successful certificate renewals.
   */
  get certRenewalSuccessRate() {
    return this.metrics ? this.metricsService.getCertRenewalSuccessRate(this.metrics) : 0;
  }

  /**
   * Maps authentication pass rate to PrimeNG severity tokens.
   */
  getAuthStatusSeverity(passRate: number): 'success' | 'warn' | 'danger' {
    if (passRate >= 80) return 'success';
    if (passRate >= 50) return 'warn';
    return 'danger';
  }

  /**
   * Maps authentication pass rates to PrimeNG icon names used in the summary tiles.
   */
  getAuthStatusIcon(passRate: number): string {
    if (passRate >= 80) return 'pi-check';
    if (passRate >= 50) return 'pi-exclamation-triangle';
    return 'pi-times';
  }

  /**
   * Maps certificate status into PrimeNG severity tokens.
   */
  getCertStatusSeverity(status: CertificateStatus): 'success' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case 'healthy':
        return 'success';
      case 'warning':
        return 'warn';
      case 'critical':
      case 'expired':
        return 'danger';
      case 'disabled':
        return 'secondary';
    }
  }

  /**
   * Maps certificate status to PrimeNG icon names for display.
   */
  getCertStatusIcon(status: CertificateStatus): string {
    switch (status) {
      case 'healthy':
        return 'pi-check-circle';
      case 'warning':
        return 'pi-exclamation-triangle';
      case 'critical':
      case 'expired':
        return 'pi-times-circle';
      case 'disabled':
        return 'pi-minus-circle';
    }
  }

  /**
   * Returns user-facing certificate text based on status and expiry window.
   */
  getCertStatusText(status: CertificateStatus, days: number): string {
    switch (status) {
      case 'healthy':
        return `Valid - Expires in ${days} days`;
      case 'warning':
        return `Expires in ${days} days`;
      case 'critical':
        return `Expires in ${days} days (urgent)`;
      case 'expired':
        return 'Expired';
      case 'disabled':
        return 'Certificate management disabled';
    }
  }

  /**
   * Normalizes processing time status into PrimeNG severity tokens.
   */
  getProcessingTimeSeverity(status: 'fast' | 'acceptable' | 'slow'): 'success' | 'warn' | 'danger' {
    switch (status) {
      case 'fast':
        return 'success';
      case 'acceptable':
        return 'warn';
      case 'slow':
        return 'danger';
    }
  }

  /**
   * Formats processing time with ms or s units for use in the UI.
   */
  formatProcessingTime(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(2)}s`;
  }

  /**
   * Formats uptime in a compact `Xd Yh Zm Ss` string, omitting zero-value parts.
   */
  formatUptime(seconds: number): string {
    return formatUptime(seconds);
  }

  // Storage metrics helpers

  /**
   * Determines storage health based on utilization percentage.
   */
  get storageHealthStatus(): StorageHealthStatus {
    if (!this.storageMetrics) return 'healthy';
    const utilization = parseFloat(this.storageMetrics.storage.utilizationPercent) || 0;
    if (utilization < 70) return 'healthy';
    if (utilization < 90) return 'warning';
    return 'critical';
  }

  /**
   * Formats bytes into human-readable format (KB, MB, GB).
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Formats seconds into human-readable duration (hours, days).
   */
  formatDuration(seconds: number): string {
    return formatDuration(seconds);
  }

  /**
   * Formats milliseconds into human-readable duration.
   */
  formatDurationMs(ms: number): string {
    return formatDurationMs(ms);
  }
}
