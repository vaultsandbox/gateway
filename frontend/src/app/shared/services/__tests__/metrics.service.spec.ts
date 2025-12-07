import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MetricsService } from '../../../features/metrics-dialog/metrics.service';
import { environment } from '../../../../environments/environment';
import { Metrics } from '../../interfaces/metrics.interfaces';

describe('MetricsService', () => {
  let service: MetricsService;
  let httpMock: HttpTestingController;

  const mockMetrics: Metrics = {
    connections: { total: 100, active: 5, rejected: 2 },
    inbox: { created_total: 20, deleted_total: 5, active_total: 15 },
    email: { received_total: 50, recipients_total: 75, processing_time_ms: 250 },
    rejections: {
      invalid_commands: 0,
      sender_rejected_total: 3,
      recipient_rejected_total: 8,
      data_rejected_size_total: 1,
      hard_mode_total: 2,
      rate_limit_total: 4,
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

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MetricsService, provideHttpClient(), provideHttpClientTesting(), provideZonelessChangeDetection()],
    });
    service = TestBed.inject(MetricsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should fetch metrics', () => {
    service.getMetrics().subscribe((metrics) => {
      expect(metrics).toEqual(mockMetrics);
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/metrics`);
    expect(req.request.method).toBe('GET');
    req.flush(mockMetrics);
  });

  it('should calculate auth pass rates correctly', () => {
    const rates = service.calculateAuthPassRates(mockMetrics);

    expect(rates.spf).toBeCloseTo(80, 1);
    expect(rates.dkim).toBeCloseTo(70, 1);
    expect(rates.dmarc).toBeCloseTo(76, 1);
  });

  it('should calculate rejection rate correctly', () => {
    const rate = service.calculateRejectionRate(mockMetrics);
    expect(rate).toBeCloseTo(2, 1);
  });

  it('should calculate total rejections correctly', () => {
    const total = service.getTotalRejections(mockMetrics);
    expect(total).toBe(18);
  });

  it('should include rate limit rejections in total rejections', () => {
    const metricsCopy: Metrics = {
      ...mockMetrics,
      rejections: {
        ...mockMetrics.rejections,
        sender_rejected_total: 0,
        recipient_rejected_total: 0,
        data_rejected_size_total: 0,
        invalid_commands: 0,
        hard_mode_total: 0,
        rate_limit_total: 5,
      },
    };

    expect(service.getTotalRejections(metricsCopy)).toBe(5);
  });

  it('should calculate average recipients per email', () => {
    const avg = service.getAvgRecipientsPerEmail(mockMetrics);
    expect(avg).toBe(1.5);
  });

  it('should return correct certificate status', () => {
    expect(service.getCertificateStatus(45)).toBe('healthy');
    expect(service.getCertificateStatus(25)).toBe('warning');
    expect(service.getCertificateStatus(10)).toBe('critical');
    expect(service.getCertificateStatus(0)).toBe('disabled');
    expect(service.getCertificateStatus(-1)).toBe('expired');
  });

  it('should return correct processing time status', () => {
    expect(service.getProcessingTimeStatus(250)).toBe('fast');
    expect(service.getProcessingTimeStatus(1000)).toBe('acceptable');
    expect(service.getProcessingTimeStatus(3000)).toBe('slow');
  });

  it('should calculate cert renewal success rate', () => {
    const rate = service.getCertRenewalSuccessRate(mockMetrics);
    expect(rate).toBe(100);
  });
});
