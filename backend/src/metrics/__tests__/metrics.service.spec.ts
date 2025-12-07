import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { MetricsService } from '../metrics.service';
import { METRIC_PATHS } from '../metrics.constants';

describe('MetricsService', () => {
  let service: MetricsService;
  let loggerSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsService],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
    loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Initialization', () => {
    it('should initialize with all metrics set to zero', () => {
      const metrics = service.getMetrics();

      expect(metrics.connections.total).toBe(0);
      expect(metrics.connections.active).toBe(0);
      expect(metrics.connections.rejected).toBe(0);

      expect(metrics.inbox.created_total).toBe(0);
      expect(metrics.inbox.deleted_total).toBe(0);
      expect(metrics.inbox.active_total).toBe(0);

      expect(metrics.email.received_total).toBe(0);
      expect(metrics.email.recipients_total).toBe(0);
      expect(metrics.email.processing_time_ms).toBe(0);

      expect(metrics.rejections.invalid_commands).toBe(0);
      expect(metrics.rejections.sender_rejected_total).toBe(0);
      expect(metrics.rejections.recipient_rejected_total).toBe(0);
      expect(metrics.rejections.data_rejected_size_total).toBe(0);
      expect(metrics.rejections.hard_mode_total).toBe(0);
      expect(metrics.rejections.rate_limit_total).toBe(0);

      expect(metrics.auth.spf_pass).toBe(0);
      expect(metrics.auth.spf_fail).toBe(0);
      expect(metrics.auth.dkim_pass).toBe(0);
      expect(metrics.auth.dkim_fail).toBe(0);
      expect(metrics.auth.dmarc_pass).toBe(0);
      expect(metrics.auth.dmarc_fail).toBe(0);

      expect(metrics.certificate.days_until_expiry).toBe(0);
      expect(metrics.certificate.renewal_attempts).toBe(0);
      expect(metrics.certificate.renewal_success).toBe(0);
      expect(metrics.certificate.renewal_failures).toBe(0);

      expect(metrics.server.uptime_seconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getMetrics', () => {
    it('should return a readonly copy of metrics', () => {
      const metrics1 = service.getMetrics();
      const metrics2 = service.getMetrics();

      expect(metrics1).not.toBe(metrics2); // Should be different objects
      expect(metrics1).toEqual(metrics2); // But have same values
    });

    it('should calculate uptime correctly', (done) => {
      const initialMetrics = service.getMetrics();
      const initialUptime = initialMetrics.server.uptime_seconds;

      // Wait a bit and check if uptime increased
      setTimeout(() => {
        const laterMetrics = service.getMetrics();
        expect(laterMetrics.server.uptime_seconds).toBeGreaterThan(initialUptime);
        done();
      }, 1100); // Wait more than 1 second
    });
  });

  describe('increment', () => {
    it('should increment metric by default value of 1', () => {
      service.increment(METRIC_PATHS.CONNECTIONS_TOTAL);
      const metrics = service.getMetrics();
      expect(metrics.connections.total).toBe(1);
    });

    it('should increment metric by specified value', () => {
      service.increment(METRIC_PATHS.EMAIL_RECIPIENTS_TOTAL, 5);
      const metrics = service.getMetrics();
      expect(metrics.email.recipients_total).toBe(5);
    });

    it('should increment multiple times', () => {
      service.increment(METRIC_PATHS.INBOX_CREATED_TOTAL, 2);
      service.increment(METRIC_PATHS.INBOX_CREATED_TOTAL, 3);
      const metrics = service.getMetrics();
      expect(metrics.inbox.created_total).toBe(5);
    });

    it('should handle negative increment values', () => {
      service.increment(METRIC_PATHS.CONNECTIONS_ACTIVE, 5);
      service.increment(METRIC_PATHS.CONNECTIONS_ACTIVE, -2);
      const metrics = service.getMetrics();
      expect(metrics.connections.active).toBe(3);
    });

    it('should log error for invalid path', () => {
      const invalidPath = 'invalid.path' as any;
      service.increment(invalidPath);
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to increment metric invalid.path'));
    });

    it('should log error for non-existent path', () => {
      const nonExistentPath = 'nonexistent.metric' as any;
      service.increment(nonExistentPath);
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to increment metric nonexistent.metric'));
    });
  });

  describe('decrement', () => {
    it('should decrement metric by default value of 1', () => {
      // First increment to have a positive value
      service.increment(METRIC_PATHS.CONNECTIONS_ACTIVE, 10);
      service.decrement(METRIC_PATHS.CONNECTIONS_ACTIVE);
      const metrics = service.getMetrics();
      expect(metrics.connections.active).toBe(9);
    });

    it('should decrement metric by specified value', () => {
      service.increment(METRIC_PATHS.EMAIL_RECIPIENTS_TOTAL, 10);
      service.decrement(METRIC_PATHS.EMAIL_RECIPIENTS_TOTAL, 3);
      const metrics = service.getMetrics();
      expect(metrics.email.recipients_total).toBe(7);
    });

    it('should allow negative values', () => {
      service.decrement(METRIC_PATHS.CONNECTIONS_REJECTED, 5);
      const metrics = service.getMetrics();
      expect(metrics.connections.rejected).toBe(-5);
    });

    it('should log error for invalid path', () => {
      const invalidPath = 'invalid.path' as any;
      service.decrement(invalidPath);
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to decrement metric invalid.path'));
    });
  });

  describe('set', () => {
    it('should set metric to specified value', () => {
      service.set(METRIC_PATHS.CERT_DAYS_UNTIL_EXPIRY, 30);
      const metrics = service.getMetrics();
      expect(metrics.certificate.days_until_expiry).toBe(30);
    });

    it('should overwrite existing value', () => {
      service.set(METRIC_PATHS.CERT_DAYS_UNTIL_EXPIRY, 30);
      service.set(METRIC_PATHS.CERT_DAYS_UNTIL_EXPIRY, 15);
      const metrics = service.getMetrics();
      expect(metrics.certificate.days_until_expiry).toBe(15);
    });

    it('should set to zero', () => {
      service.increment(METRIC_PATHS.AUTH_SPF_PASS, 10);
      service.set(METRIC_PATHS.AUTH_SPF_PASS, 0);
      const metrics = service.getMetrics();
      expect(metrics.auth.spf_pass).toBe(0);
    });

    it('should set to negative value', () => {
      service.set(METRIC_PATHS.AUTH_DKIM_FAIL, -5);
      const metrics = service.getMetrics();
      expect(metrics.auth.dkim_fail).toBe(-5);
    });

    it('should log error for invalid path', () => {
      const invalidPath = 'invalid.path' as any;
      service.set(invalidPath, 10);
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to set metric invalid.path'));
    });
  });

  describe('recordProcessingTime', () => {
    it('should record initial processing time', () => {
      service.recordProcessingTime(100);
      const metrics = service.getMetrics();
      expect(metrics.email.processing_time_ms).toBe(100);
    });

    it('should calculate average processing time', () => {
      service.recordProcessingTime(100);
      service.recordProcessingTime(200);
      service.recordProcessingTime(300);
      const metrics = service.getMetrics();
      expect(metrics.email.processing_time_ms).toBe(200); // (100 + 200 + 300) / 3 = 200
    });

    it('should handle decimal averaging correctly', () => {
      service.recordProcessingTime(100);
      service.recordProcessingTime(101);
      const metrics = service.getMetrics();
      expect(metrics.email.processing_time_ms).toBe(101); // (100 + 101) / 2 = 100.5, rounded to 101
    });

    it('should handle zero processing time', () => {
      service.recordProcessingTime(0);
      const metrics = service.getMetrics();
      expect(metrics.email.processing_time_ms).toBe(0);
    });

    it('should handle many records', () => {
      for (let i = 1; i <= 1000; i++) {
        service.recordProcessingTime(i);
      }
      const metrics = service.getMetrics();
      expect(metrics.email.processing_time_ms).toBe(501); // Average of 1 to 1000
    });
  });

  describe('Integration tests', () => {
    it('should handle mixed operations correctly', () => {
      // Increment some metrics
      service.increment(METRIC_PATHS.CONNECTIONS_TOTAL, 10);
      service.increment(METRIC_PATHS.EMAIL_RECEIVED_TOTAL, 5);

      // Decrement some metrics
      service.decrement(METRIC_PATHS.CONNECTIONS_ACTIVE, 2);

      // Set some metrics
      service.set(METRIC_PATHS.CERT_DAYS_UNTIL_EXPIRY, 30);

      // Record processing times
      service.recordProcessingTime(100);
      service.recordProcessingTime(200);

      const metrics = service.getMetrics();

      expect(metrics.connections.total).toBe(10);
      expect(metrics.connections.active).toBe(-2);
      expect(metrics.email.received_total).toBe(5);
      expect(metrics.certificate.days_until_expiry).toBe(30);
      expect(metrics.email.processing_time_ms).toBe(150);
    });

    it('should maintain independence between different metric categories', () => {
      service.increment(METRIC_PATHS.CONNECTIONS_TOTAL, 5);
      service.increment(METRIC_PATHS.EMAIL_RECEIVED_TOTAL, 3);
      service.set(METRIC_PATHS.CERT_DAYS_UNTIL_EXPIRY, 15);

      const metrics = service.getMetrics();

      expect(metrics.connections.total).toBe(5);
      expect(metrics.connections.active).toBe(0);
      expect(metrics.connections.rejected).toBe(0);

      expect(metrics.email.received_total).toBe(3);
      expect(metrics.email.recipients_total).toBe(0);
      expect(metrics.email.processing_time_ms).toBe(0);

      expect(metrics.certificate.days_until_expiry).toBe(15);
      expect(metrics.certificate.renewal_attempts).toBe(0);
    });
  });

  describe('Error handling', () => {
    it('should handle malformed paths gracefully', () => {
      const malformedPaths = [
        '',
        'justonelevel',
        'too.many.levels.here',
        'nonexistent.metric.path',
        'connections.nonexistent_field',
      ];

      malformedPaths.forEach((path) => {
        expect(() => {
          service.increment(path as any);
        }).not.toThrow();

        expect(() => {
          service.decrement(path as any);
        }).not.toThrow();

        expect(() => {
          service.set(path as any, 10);
        }).not.toThrow();
      });

      expect(loggerSpy).toHaveBeenCalledTimes(malformedPaths.length * 3);
    });
  });
});
