import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MetricsDialog } from './metrics-dialog';
import { MetricsService } from './metrics.service';
import { of, throwError } from 'rxjs';
import { Metrics, StorageMetrics, WebhookMetrics } from '../../shared/interfaces/metrics.interfaces';

describe('MetricsDialog', () => {
  let component: MetricsDialog;
  let fixture: ComponentFixture<MetricsDialog>;
  let metricsService: jasmine.SpyObj<MetricsService>;

  const mockMetrics: Metrics = {
    connections: { total: 100, active: 5, rejected: 2 },
    inbox: { created_total: 20, deleted_total: 5, active_total: 15 },
    email: { received_total: 50, recipients_total: 75, processing_time_ms: 250 },
    rejections: {
      invalid_commands: 1,
      sender_rejected_total: 3,
      recipient_rejected_total: 8,
      data_rejected_size_total: 2,
      hard_mode_total: 4,
      rate_limit_total: 5,
    },
    auth: {
      spf_pass: 40,
      spf_fail: 10,
      dkim_pass: 35,
      dkim_fail: 15,
      dmarc_pass: 38,
      dmarc_fail: 12,
    },
    certificate: {
      days_until_expiry: 45,
      renewal_attempts: 2,
      renewal_success: 2,
      renewal_failures: 0,
    },
    server: {
      uptime_seconds: 3600,
    },
  };

  const mockStorageMetrics: StorageMetrics = {
    storage: {
      maxMemoryBytes: 104857600,
      maxMemoryMB: '100.00',
      usedMemoryBytes: 52428800,
      usedMemoryMB: '50.00',
      availableMemoryBytes: 52428800,
      availableMemoryMB: '50.00',
      utilizationPercent: '50.00',
    },
    emails: {
      totalStored: 150,
      totalEvicted: 25,
      tombstones: 8,
      oldestEmailAge: 3600000,
      newestEmailAge: 60000,
    },
    eviction: {
      maxAgeSeconds: 3600,
      maxAgeEnabled: true,
    },
  };

  const mockWebhookMetrics: WebhookMetrics = {
    webhooks: {
      global: 5,
      inbox: 5,
      enabled: 8,
      total: 10,
    },
    deliveries: {
      total: 100,
      successful: 95,
      failed: 5,
    },
  };

  beforeEach(async () => {
    const metricsServiceSpy = jasmine.createSpyObj('MetricsService', [
      'getMetrics',
      'getStorageMetrics',
      'getWebhookMetrics',
      'calculateAuthPassRates',
      'calculateRejectionRate',
      'getTotalRejections',
      'getAvgRecipientsPerEmail',
      'getCertificateStatus',
      'getProcessingTimeStatus',
      'getCertRenewalSuccessRate',
    ]);

    await TestBed.configureTestingModule({
      imports: [MetricsDialog],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MetricsService, useValue: metricsServiceSpy },
      ],
    }).compileComponents();

    metricsService = TestBed.inject(MetricsService) as jasmine.SpyObj<MetricsService>;
    metricsService.getMetrics.and.returnValue(of(mockMetrics));
    metricsService.getStorageMetrics.and.returnValue(of(mockStorageMetrics));
    metricsService.getWebhookMetrics.and.returnValue(of(mockWebhookMetrics));
    metricsService.calculateAuthPassRates.and.returnValue({ spf: 100, dkim: 100, dmarc: 100 });
    metricsService.calculateRejectionRate.and.returnValue(5);
    metricsService.getTotalRejections.and.callFake(
      (metrics: Metrics) =>
        metrics.rejections.sender_rejected_total +
        metrics.rejections.recipient_rejected_total +
        metrics.rejections.data_rejected_size_total +
        metrics.rejections.invalid_commands +
        metrics.rejections.hard_mode_total +
        metrics.rejections.rate_limit_total,
    );
    metricsService.getAvgRecipientsPerEmail.and.returnValue(1.5);
    metricsService.getCertificateStatus.and.returnValue('healthy');
    metricsService.getProcessingTimeStatus.and.returnValue('fast');
    metricsService.getCertRenewalSuccessRate.and.returnValue(100);

    fixture = TestBed.createComponent(MetricsDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load metrics when requested', async () => {
    await component.loadMetrics();

    expect(metricsService.getMetrics).toHaveBeenCalled();
    expect(component.metrics).toEqual(mockMetrics);
    expect(component.error).toBeNull();
  });

  it('should handle error when loading metrics fails', async () => {
    spyOn(console, 'error');
    metricsService.getMetrics.and.returnValue(throwError(() => new Error('Network error')));

    await component.loadMetrics();

    expect(component.error).toBe('Network error');
    expect(component.loading).toBeFalse();
  });

  it('should handle non-Error exceptions when loading metrics', async () => {
    spyOn(console, 'error');
    metricsService.getMetrics.and.returnValue(throwError(() => 'String error'));

    await component.loadMetrics();

    expect(component.error).toBe('Failed to load metrics');
  });

  it('should emit closed output when dialog closes', () => {
    const closedSpy = spyOn(component.closed, 'emit');

    component.onClose();

    expect(component.dialogVisible).toBeFalse();
    expect(closedSpy).toHaveBeenCalled();
  });

  it('should toggle visibility based on dialog events', () => {
    const closedSpy = spyOn(component.closed, 'emit');

    component.onVisibleChange(false);

    expect(component.dialogVisible).toBeFalse();
    expect(closedSpy).toHaveBeenCalled();

    component.onVisibleChange(true);

    expect(component.dialogVisible).toBeTrue();
  });

  it('should manage auto refresh lifecycle hooks', () => {
    component.ngOnInit();
    expect(component.autoRefreshInterval).not.toBeNull();

    component.ngOnDestroy();
    expect(component.autoRefreshInterval).toBeNull();
  });

  it('should render rate limit rejection metric', () => {
    component.metrics = mockMetrics;
    fixture.detectChanges();

    const card = document.body.querySelector<HTMLElement>('[data-testid="rate-limit-rejections"]');
    expect(card).withContext('Rate limit card should exist').not.toBeNull();
    expect(card?.textContent).toContain('Rate Limit Rejections');
    expect(card?.textContent).toContain(mockMetrics.rejections.rate_limit_total.toString());
    expect(card?.textContent).toContain('Connections or MAIL FROM blocked by the SMTP rate limiter.');
  });

  it('should load storage metrics when switching to storage tab', async () => {
    component.onTabChange('storage');
    await fixture.whenStable();

    expect(metricsService.getStorageMetrics).toHaveBeenCalled();
    expect(component.storageMetrics).toEqual(mockStorageMetrics);
    expect(component.activeTab).toBe('storage');
  });

  it('should load general metrics when switching to general tab', async () => {
    component.activeTab = 'storage';
    metricsService.getMetrics.calls.reset();

    component.onTabChange('general');
    await fixture.whenStable();

    expect(metricsService.getMetrics).toHaveBeenCalled();
    expect(component.activeTab).toBe('general');
  });

  it('should load webhook metrics when switching to webhooks tab', async () => {
    component.onTabChange('webhooks');
    await fixture.whenStable();

    expect(metricsService.getWebhookMetrics).toHaveBeenCalled();
    expect(component.webhookMetrics).toEqual(mockWebhookMetrics);
    expect(component.activeTab).toBe('webhooks');
  });

  it('should handle undefined tab change', () => {
    const currentTab = component.activeTab;
    component.onTabChange(undefined);
    expect(component.activeTab).toBe(currentTab);
  });

  it('should handle numeric tab change', () => {
    component.onTabChange(0);
    expect(component.activeTab).toBe('0');
  });

  it('should determine healthy storage status when utilization is low', () => {
    component.storageMetrics = {
      ...mockStorageMetrics,
      storage: { ...mockStorageMetrics.storage, utilizationPercent: '50.00' },
    };
    expect(component.storageHealthStatus).toBe('healthy');
  });

  it('should determine warning storage status when utilization is between 70-90%', () => {
    component.storageMetrics = {
      ...mockStorageMetrics,
      storage: { ...mockStorageMetrics.storage, utilizationPercent: '80.00' },
    };
    expect(component.storageHealthStatus).toBe('warning');
  });

  it('should determine critical storage status when utilization is above 90%', () => {
    component.storageMetrics = {
      ...mockStorageMetrics,
      storage: { ...mockStorageMetrics.storage, utilizationPercent: '95.00' },
    };
    expect(component.storageHealthStatus).toBe('critical');
  });

  it('should return healthy when storage metrics is null', () => {
    component.storageMetrics = null;
    expect(component.storageHealthStatus).toBe('healthy');
  });

  it('should return healthy when utilization is NaN', () => {
    component.storageMetrics = {
      ...mockStorageMetrics,
      storage: { ...mockStorageMetrics.storage, utilizationPercent: 'invalid' },
    };
    expect(component.storageHealthStatus).toBe('healthy');
  });

  it('should format bytes correctly', () => {
    expect(component.formatBytes(0)).toBe('0 Bytes');
    expect(component.formatBytes(1024)).toBe('1 KB');
    expect(component.formatBytes(1048576)).toBe('1 MB');
    expect(component.formatBytes(1073741824)).toBe('1 GB');
    expect(component.formatBytes(1536)).toBe('1.5 KB');
  });

  it('should format duration correctly', () => {
    expect(component.formatDuration(30)).toBe('30s');
    expect(component.formatDuration(120)).toBe('2m');
    expect(component.formatDuration(3600)).toBe('1h');
    expect(component.formatDuration(86400)).toBe('1d');
    expect(component.formatDuration(172800)).toBe('2d');
  });

  it('should format duration in ms correctly', () => {
    expect(component.formatDurationMs(1000)).toBe('1s');
    expect(component.formatDurationMs(60000)).toBe('1m');
  });

  it('should refresh metrics when onRefresh is called', async () => {
    metricsService.getMetrics.calls.reset();

    component.onRefresh();
    await fixture.whenStable();

    expect(metricsService.getMetrics).toHaveBeenCalled();
  });

  describe('helper getters', () => {
    it('should return default values when metrics is null', () => {
      component.metrics = null;

      expect(component.authPassRates).toEqual({ spf: 0, dkim: 0, dmarc: 0 });
      expect(component.rejectionRate).toBe(0);
      expect(component.totalRejections).toBe(0);
      expect(component.avgRecipientsPerEmail).toBe(0);
      expect(component.certificateStatus).toBe('disabled');
      expect(component.processingTimeStatus).toBe('fast');
      expect(component.certRenewalSuccessRate).toBe(0);
    });

    it('should delegate to service when metrics is set', () => {
      component.metrics = mockMetrics;

      // Access getters to trigger service calls
      void component.authPassRates;
      void component.rejectionRate;
      void component.totalRejections;
      void component.avgRecipientsPerEmail;
      void component.certificateStatus;
      void component.processingTimeStatus;
      void component.certRenewalSuccessRate;

      expect(metricsService.calculateAuthPassRates).toHaveBeenCalledWith(mockMetrics);
      expect(metricsService.calculateRejectionRate).toHaveBeenCalledWith(mockMetrics);
      expect(metricsService.getTotalRejections).toHaveBeenCalledWith(mockMetrics);
      expect(metricsService.getAvgRecipientsPerEmail).toHaveBeenCalledWith(mockMetrics);
      expect(metricsService.getCertificateStatus).toHaveBeenCalledWith(mockMetrics.certificate.days_until_expiry);
      expect(metricsService.getProcessingTimeStatus).toHaveBeenCalledWith(mockMetrics.email.processing_time_ms);
      expect(metricsService.getCertRenewalSuccessRate).toHaveBeenCalledWith(mockMetrics);
    });
  });

  describe('getAuthStatusSeverity', () => {
    it('returns success for pass rate >= 80', () => {
      expect(component.getAuthStatusSeverity(80)).toBe('success');
      expect(component.getAuthStatusSeverity(100)).toBe('success');
    });

    it('returns warn for pass rate >= 50 and < 80', () => {
      expect(component.getAuthStatusSeverity(50)).toBe('warn');
      expect(component.getAuthStatusSeverity(79)).toBe('warn');
    });

    it('returns danger for pass rate < 50', () => {
      expect(component.getAuthStatusSeverity(49)).toBe('danger');
      expect(component.getAuthStatusSeverity(0)).toBe('danger');
    });
  });

  describe('getAuthStatusIcon', () => {
    it('returns pi-check for pass rate >= 80', () => {
      expect(component.getAuthStatusIcon(80)).toBe('pi-check');
      expect(component.getAuthStatusIcon(100)).toBe('pi-check');
    });

    it('returns pi-exclamation-triangle for pass rate >= 50 and < 80', () => {
      expect(component.getAuthStatusIcon(50)).toBe('pi-exclamation-triangle');
      expect(component.getAuthStatusIcon(79)).toBe('pi-exclamation-triangle');
    });

    it('returns pi-times for pass rate < 50', () => {
      expect(component.getAuthStatusIcon(49)).toBe('pi-times');
      expect(component.getAuthStatusIcon(0)).toBe('pi-times');
    });
  });

  describe('getCertStatusSeverity', () => {
    it('returns correct severity for all certificate statuses', () => {
      expect(component.getCertStatusSeverity('healthy')).toBe('success');
      expect(component.getCertStatusSeverity('warning')).toBe('warn');
      expect(component.getCertStatusSeverity('critical')).toBe('danger');
      expect(component.getCertStatusSeverity('expired')).toBe('danger');
      expect(component.getCertStatusSeverity('disabled')).toBe('secondary');
    });
  });

  describe('getCertStatusIcon', () => {
    it('returns correct icon for all certificate statuses', () => {
      expect(component.getCertStatusIcon('healthy')).toBe('pi-check-circle');
      expect(component.getCertStatusIcon('warning')).toBe('pi-exclamation-triangle');
      expect(component.getCertStatusIcon('critical')).toBe('pi-times-circle');
      expect(component.getCertStatusIcon('expired')).toBe('pi-times-circle');
      expect(component.getCertStatusIcon('disabled')).toBe('pi-minus-circle');
    });
  });

  describe('getCertStatusText', () => {
    it('returns correct text for all certificate statuses', () => {
      expect(component.getCertStatusText('healthy', 45)).toBe('Valid - Expires in 45 days');
      expect(component.getCertStatusText('warning', 25)).toBe('Expires in 25 days');
      expect(component.getCertStatusText('critical', 5)).toBe('Expires in 5 days (urgent)');
      expect(component.getCertStatusText('expired', 0)).toBe('Expired');
      expect(component.getCertStatusText('disabled', 0)).toBe('Certificate management disabled');
    });
  });

  describe('getProcessingTimeSeverity', () => {
    it('returns correct severity for all processing time statuses', () => {
      expect(component.getProcessingTimeSeverity('fast')).toBe('success');
      expect(component.getProcessingTimeSeverity('acceptable')).toBe('warn');
      expect(component.getProcessingTimeSeverity('slow')).toBe('danger');
    });
  });

  describe('formatProcessingTime', () => {
    it('formats milliseconds correctly', () => {
      expect(component.formatProcessingTime(500)).toBe('500ms');
      expect(component.formatProcessingTime(999)).toBe('999ms');
    });

    it('formats seconds correctly', () => {
      expect(component.formatProcessingTime(1000)).toBe('1.00s');
      expect(component.formatProcessingTime(1500)).toBe('1.50s');
      expect(component.formatProcessingTime(2500)).toBe('2.50s');
    });
  });

  describe('formatUptime', () => {
    it('formats uptime correctly', () => {
      expect(component.formatUptime(3600)).toBe('1h');
      expect(component.formatUptime(86400)).toBe('1d');
    });
  });

  describe('webhookDeliverySuccessRate', () => {
    it('returns 0 when webhookMetrics is null', () => {
      component.webhookMetrics = null;
      expect(component.webhookDeliverySuccessRate).toBe(0);
    });

    it('returns 0 when total deliveries is 0', () => {
      component.webhookMetrics = {
        ...mockWebhookMetrics,
        deliveries: { total: 0, successful: 0, failed: 0 },
      };
      expect(component.webhookDeliverySuccessRate).toBe(0);
    });

    it('calculates correct success rate', () => {
      component.webhookMetrics = mockWebhookMetrics;
      // 95 successful out of 100 total = 95%
      expect(component.webhookDeliverySuccessRate).toBe(95);
    });

    it('calculates 100% when all deliveries are successful', () => {
      component.webhookMetrics = {
        ...mockWebhookMetrics,
        deliveries: { total: 50, successful: 50, failed: 0 },
      };
      expect(component.webhookDeliverySuccessRate).toBe(100);
    });
  });
});
