import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SmtpRateLimiterService, RateLimitExceededError } from '../smtp-rate-limiter.service';
import { MetricsService } from '../../metrics/metrics.service';
import { METRIC_PATHS } from '../../metrics/metrics.constants';

describe('SmtpRateLimiterService', () => {
  let service: SmtpRateLimiterService;
  let metricsService: MetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmtpRateLimiterService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'vsb.smtpRateLimit') {
                return {
                  enabled: true,
                  points: 5,
                  duration: 60, // 60 seconds
                };
              }
              return undefined;
            }),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            increment: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SmtpRateLimiterService>(SmtpRateLimiterService);
    metricsService = module.get<MetricsService>(MetricsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('consumeIp', () => {
    it('should allow requests within the limit', async () => {
      const testIp = '192.168.1.1';

      // Should allow 5 requests
      for (let i = 0; i < 5; i++) {
        await expect(service.consumeIp(testIp)).resolves.not.toThrow();
      }
    });

    it('should reject requests exceeding the limit', async () => {
      const testIp = '192.168.1.2';

      // Consume all 5 points
      for (let i = 0; i < 5; i++) {
        await service.consumeIp(testIp);
      }

      // 6th request should be rejected
      await expect(service.consumeIp(testIp)).rejects.toThrow(RateLimitExceededError);
    });

    it('should emit metrics when rate limit exceeded', async () => {
      const testIp = '192.168.1.3';

      // Consume all 5 points
      for (let i = 0; i < 5; i++) {
        await service.consumeIp(testIp);
      }

      // Try to exceed limit
      try {
        await service.consumeIp(testIp);
      } catch {
        // Expected to throw
      }

      // Check that metrics were incremented
      expect(metricsService.increment).toHaveBeenCalledWith(METRIC_PATHS.REJECTIONS_RATE_LIMIT);
    });

    it('should track different IPs separately', async () => {
      const ip1 = '192.168.1.4';
      const ip2 = '192.168.1.5';

      // Consume 5 points for ip1
      for (let i = 0; i < 5; i++) {
        await service.consumeIp(ip1);
      }

      // ip2 should still be able to make requests
      await expect(service.consumeIp(ip2)).resolves.not.toThrow();
    });

    it('should include retry-after in error', async () => {
      const testIp = '192.168.1.6';

      // Consume all points
      for (let i = 0; i < 5; i++) {
        await service.consumeIp(testIp);
      }

      // Exceed limit and check error
      try {
        await service.consumeIp(testIp);
        fail('Should have thrown RateLimitExceededError');
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitExceededError);
        if (error instanceof RateLimitExceededError) {
          expect(error.retryAfter).toBeDefined();
          expect(error.retryAfter).toBeGreaterThan(0);
          expect(error.responseCode).toBe(421);
          expect(error.message).toContain('4.7.0');
        }
      }
    });
  });

  describe('getStatus', () => {
    it('should return status for an IP', async () => {
      const testIp = '192.168.1.7';

      // Make some requests
      await service.consumeIp(testIp);
      await service.consumeIp(testIp);

      const status = await service.getStatus(testIp);
      expect(status).not.toBeNull();
      if (status) {
        expect(status.consumedPoints).toBe(2);
      }
    });

    it('should return null for unknown IP', async () => {
      const status = await service.getStatus('192.168.1.99');
      expect(status).toBeNull();
    });
  });

  describe('resetIp', () => {
    it('should reset rate limit for an IP', async () => {
      const testIp = '192.168.1.8';

      // Consume all points
      for (let i = 0; i < 5; i++) {
        await service.consumeIp(testIp);
      }

      // Should be rate limited
      await expect(service.consumeIp(testIp)).rejects.toThrow(RateLimitExceededError);

      // Reset the IP
      await service.resetIp(testIp);

      // Should be able to make requests again
      await expect(service.consumeIp(testIp)).resolves.not.toThrow();
    });
  });

  describe('disabled rate limiting', () => {
    it('should allow all requests when disabled', async () => {
      // Create a new service with rate limiting disabled
      const disabledModule = await Test.createTestingModule({
        providers: [
          SmtpRateLimiterService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'vsb.smtpRateLimit') {
                  return {
                    enabled: false,
                    points: 5,
                    duration: 60,
                  };
                }
                return undefined;
              }),
            },
          },
          {
            provide: MetricsService,
            useValue: {
              increment: jest.fn(),
            },
          },
        ],
      }).compile();

      const disabledService = disabledModule.get<SmtpRateLimiterService>(SmtpRateLimiterService);
      const testIp = '192.168.1.9';

      // Should allow unlimited requests
      for (let i = 0; i < 100; i++) {
        await expect(disabledService.consumeIp(testIp)).resolves.not.toThrow();
      }
    });

    it('should return null from getStatus when disabled', async () => {
      const disabledModule = await Test.createTestingModule({
        providers: [
          SmtpRateLimiterService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'vsb.smtpRateLimit') {
                  return { enabled: false, points: 5, duration: 60 };
                }
                return undefined;
              }),
            },
          },
          {
            provide: MetricsService,
            useValue: { increment: jest.fn() },
          },
        ],
      }).compile();

      const disabledService = disabledModule.get<SmtpRateLimiterService>(SmtpRateLimiterService);
      const status = await disabledService.getStatus('192.168.1.10');
      expect(status).toBeNull();
    });

    it('should do nothing when resetIp is called with rate limiting disabled', async () => {
      const disabledModule = await Test.createTestingModule({
        providers: [
          SmtpRateLimiterService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'vsb.smtpRateLimit') {
                  return { enabled: false, points: 5, duration: 60 };
                }
                return undefined;
              }),
            },
          },
          {
            provide: MetricsService,
            useValue: { increment: jest.fn() },
          },
        ],
      }).compile();

      const disabledService = disabledModule.get<SmtpRateLimiterService>(SmtpRateLimiterService);
      // Should not throw
      await expect(disabledService.resetIp('192.168.1.11')).resolves.not.toThrow();
    });
  });
});

describe('RateLimitExceededError', () => {
  it('should create error with retryAfter', () => {
    const error = new RateLimitExceededError(5000);
    expect(error.name).toBe('RateLimitExceededError');
    expect(error.responseCode).toBe(421);
    expect(error.retryAfter).toBe(5000);
    expect(error.message).toContain('5 seconds');
    expect(error.message).toContain('4.7.0');
  });

  it('should create error without retryAfter', () => {
    const error = new RateLimitExceededError();
    expect(error.name).toBe('RateLimitExceededError');
    expect(error.responseCode).toBe(421);
    expect(error.retryAfter).toBeUndefined();
    expect(error.message).toContain('try again later');
    expect(error.message).toContain('4.7.0');
  });

  it('should have proper stack trace', () => {
    const error = new RateLimitExceededError(1000);
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('RateLimitExceededError');
  });
});
