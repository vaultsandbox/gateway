import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MetricsDialog } from './metrics-dialog';
import { MetricsService } from './metrics.service';
import { of } from 'rxjs';
import { Metrics, StorageMetrics } from '../../shared/interfaces/metrics.interfaces';

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

  beforeEach(async () => {
    const metricsServiceSpy = jasmine.createSpyObj('MetricsService', [
      'getMetrics',
      'getStorageMetrics',
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
});
