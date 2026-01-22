import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule, EventEmitter2 } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ChaosService } from '../chaos.service';
import { ChaosEnabledGuard } from '../chaos.guard';
import { ChaosModule } from '../chaos.module';
import { GreylistStateService } from '../state/greylist-state.service';
import { GreylistHandler } from '../handlers/greylist.handler';
import { MetricsModule } from '../../metrics/metrics.module';
import { SseConsoleModule } from '../../sse-console/sse-console.module';
import { silenceNestLogger } from '../../../test/helpers/silence-logger';
import type { InboxChaosConfig } from '../interfaces/chaos-config.interface';

/**
 * Chaos Module Integration Tests
 *
 * Tests for chaos engineering features including:
 * - ChaosService methods
 * - ChaosEnabledGuard behavior
 * - Handler-level chaos evaluation
 */
const restoreLogger = silenceNestLogger();

describe('Chaos Module Integration Tests', () => {
  let chaosService: ChaosService;
  let greylistStateService: GreylistStateService;
  let eventEmitter: EventEmitter2;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              vsb: {
                chaos: {
                  enabled: true,
                },
                sse: {
                  enabled: false,
                },
              },
            }),
          ],
        }),
        EventEmitterModule.forRoot(),
        ScheduleModule.forRoot(),
        MetricsModule,
        SseConsoleModule,
        ChaosModule,
      ],
    }).compile();

    chaosService = moduleFixture.get<ChaosService>(ChaosService);
    greylistStateService = moduleFixture.get<GreylistStateService>(GreylistStateService);
    eventEmitter = moduleFixture.get<EventEmitter2>(EventEmitter2);
  });

  afterAll(() => {
    restoreLogger();
  });

  beforeEach(() => {
    greylistStateService.clearAll();
  });

  describe('ChaosService', () => {
    describe('isEnabled', () => {
      it('should return true when chaos is enabled globally', () => {
        expect(chaosService.isEnabled()).toBe(true);
      });
    });

    describe('getDefaultConfig', () => {
      it('should return a config with enabled=false', () => {
        const config = chaosService.getDefaultConfig();
        expect(config).toEqual({ enabled: false });
      });
    });

    describe('evaluate', () => {
      it('should return continue when chaos config is undefined', () => {
        const result = chaosService.evaluate(undefined, 'session-1', 'test@example.com');
        expect(result.result.action).toBe('continue');
      });

      it('should return continue when chaos config is disabled', () => {
        const config: InboxChaosConfig = { enabled: false };
        const result = chaosService.evaluate(config, 'session-1', 'test@example.com');
        expect(result.result.action).toBe('continue');
      });

      it('should return continue when chaos config has expired', () => {
        const expiredDate = new Date(Date.now() - 10000).toISOString();
        const config: InboxChaosConfig = {
          enabled: true,
          expiresAt: expiredDate,
        };
        const result = chaosService.evaluate(config, 'session-1', 'test@example.com');
        expect(result.result.action).toBe('continue');
      });

      it('should not return continue when chaos config expires in the future', () => {
        const futureDate = new Date(Date.now() + 3600000).toISOString();
        const config: InboxChaosConfig = {
          enabled: true,
          expiresAt: futureDate,
          blackhole: { enabled: true, triggerWebhooks: false },
        };
        const result = chaosService.evaluate(config, 'session-1', 'test@example.com');
        expect(result.result.action).toBe('blackhole');
        expect(result.chaosType).toBe('blackhole');
      });

      describe('connection drop chaos', () => {
        it('should return drop action with 100% probability', () => {
          const config: InboxChaosConfig = {
            enabled: true,
            connectionDrop: {
              enabled: true,
              probability: 1.0,
              graceful: true,
            },
          };
          const result = chaosService.evaluate(config, 'session-1', 'test@example.com');
          expect(result.result.action).toBe('drop');
          expect(result.chaosType).toBe('connection_drop');
        });

        it('should continue with 0% probability', () => {
          const config: InboxChaosConfig = {
            enabled: true,
            connectionDrop: {
              enabled: true,
              probability: 0.0,
              graceful: true,
            },
          };
          const result = chaosService.evaluate(config, 'session-1', 'test@example.com');
          expect(result.result.action).toBe('continue');
        });
      });

      describe('greylist chaos', () => {
        it('should reject first attempt and accept on retry', () => {
          const config: InboxChaosConfig = {
            enabled: true,
            greylist: {
              enabled: true,
              maxAttempts: 2,
              retryWindowMs: 300000,
              trackBy: 'ip_sender',
            },
          };
          const greylistContext = {
            senderIp: '192.168.1.1',
            senderEmail: 'sender@external.com',
          };

          // First attempt - should be rejected
          const result1 = chaosService.evaluate(config, 'session-1', 'test@example.com', greylistContext);
          expect(result1.result.action).toBe('error');
          expect(result1.chaosType).toBe('greylist');

          // Second attempt - should pass
          const result2 = chaosService.evaluate(config, 'session-2', 'test@example.com', greylistContext);
          expect(result2.result.action).toBe('continue');
        });

        it('should skip greylist without context', () => {
          const config: InboxChaosConfig = {
            enabled: true,
            greylist: {
              enabled: true,
              maxAttempts: 2,
              retryWindowMs: 300000,
              trackBy: 'ip_sender',
            },
          };

          // Without greylist context, should continue
          const result = chaosService.evaluate(config, 'session-1', 'test@example.com');
          expect(result.result.action).toBe('continue');
        });
      });

      describe('random error chaos', () => {
        it('should return error with 100% error rate', () => {
          const config: InboxChaosConfig = {
            enabled: true,
            randomError: {
              enabled: true,
              errorRate: 1.0,
              errorTypes: ['temporary'],
            },
          };
          const result = chaosService.evaluate(config, 'session-1', 'test@example.com');
          expect(result.result.action).toBe('error');
          expect(result.chaosType).toBe('random_error');
        });

        it('should continue with 0% error rate', () => {
          const config: InboxChaosConfig = {
            enabled: true,
            randomError: {
              enabled: true,
              errorRate: 0.0,
              errorTypes: ['temporary'],
            },
          };
          const result = chaosService.evaluate(config, 'session-1', 'test@example.com');
          expect(result.result.action).toBe('continue');
        });
      });

      describe('blackhole chaos', () => {
        it('should return blackhole action when enabled', () => {
          const config: InboxChaosConfig = {
            enabled: true,
            blackhole: {
              enabled: true,
              triggerWebhooks: false,
            },
          };
          const result = chaosService.evaluate(config, 'session-1', 'test@example.com');
          expect(result.result.action).toBe('blackhole');
          expect(result.chaosType).toBe('blackhole');
          if (result.result.action === 'blackhole') {
            expect(result.result.triggerWebhooks).toBe(false);
          }
        });

        it('should return blackhole with triggerWebhooks=true', () => {
          const config: InboxChaosConfig = {
            enabled: true,
            blackhole: {
              enabled: true,
              triggerWebhooks: true,
            },
          };
          const result = chaosService.evaluate(config, 'session-1', 'test@example.com');
          expect(result.result.action).toBe('blackhole');
          if (result.result.action === 'blackhole') {
            expect(result.result.triggerWebhooks).toBe(true);
          }
        });
      });

      describe('latency chaos', () => {
        it('should return delay action with 100% probability', () => {
          const config: InboxChaosConfig = {
            enabled: true,
            latency: {
              enabled: true,
              minDelayMs: 100,
              maxDelayMs: 200,
              jitter: false,
              probability: 1.0,
            },
          };
          const result = chaosService.evaluate(config, 'session-1', 'test@example.com');
          expect(result.result.action).toBe('delay');
          expect(result.chaosType).toBe('latency');
          if (result.result.action === 'delay') {
            expect(result.result.delayMs).toBeGreaterThanOrEqual(100);
            expect(result.result.delayMs).toBeLessThanOrEqual(200);
          }
        });

        it('should continue with 0% probability', () => {
          const config: InboxChaosConfig = {
            enabled: true,
            latency: {
              enabled: true,
              minDelayMs: 100,
              maxDelayMs: 200,
              jitter: false,
              probability: 0.0,
            },
          };
          const result = chaosService.evaluate(config, 'session-1', 'test@example.com');
          expect(result.result.action).toBe('continue');
        });
      });

      describe('chaos priority order', () => {
        it('should prioritize connection drop over other chaos types', () => {
          const config: InboxChaosConfig = {
            enabled: true,
            connectionDrop: { enabled: true, probability: 1.0, graceful: true },
            blackhole: { enabled: true, triggerWebhooks: false },
            latency: { enabled: true, minDelayMs: 100, maxDelayMs: 200, jitter: false, probability: 1.0 },
          };
          const result = chaosService.evaluate(config, 'session-1', 'test@example.com');
          expect(result.chaosType).toBe('connection_drop');
        });

        it('should prioritize greylist over random error when context provided', () => {
          const config: InboxChaosConfig = {
            enabled: true,
            greylist: { enabled: true, maxAttempts: 3, retryWindowMs: 300000, trackBy: 'ip_sender' },
            randomError: { enabled: true, errorRate: 1.0, errorTypes: ['temporary'] },
          };
          const greylistContext = { senderIp: '10.0.0.1', senderEmail: 'test@sender.com' };
          const result = chaosService.evaluate(config, 'session-1', 'inbox@test.com', greylistContext);
          expect(result.chaosType).toBe('greylist');
        });

        it('should prioritize random error over blackhole', () => {
          const config: InboxChaosConfig = {
            enabled: true,
            randomError: { enabled: true, errorRate: 1.0, errorTypes: ['temporary'] },
            blackhole: { enabled: true, triggerWebhooks: false },
          };
          const result = chaosService.evaluate(config, 'session-1', 'test@example.com');
          expect(result.chaosType).toBe('random_error');
        });

        it('should prioritize blackhole over latency', () => {
          const config: InboxChaosConfig = {
            enabled: true,
            blackhole: { enabled: true, triggerWebhooks: false },
            latency: { enabled: true, minDelayMs: 100, maxDelayMs: 200, jitter: false, probability: 1.0 },
          };
          const result = chaosService.evaluate(config, 'session-1', 'test@example.com');
          expect(result.chaosType).toBe('blackhole');
        });
      });
    });

    describe('normalizeConfig', () => {
      it('should fill in defaults for latency config', () => {
        const raw = {
          enabled: true,
          latency: { enabled: true },
        };
        const normalized = chaosService.normalizeConfig(raw);
        expect(normalized.latency).toEqual({
          enabled: true,
          minDelayMs: 500,
          maxDelayMs: 10000,
          jitter: true,
          probability: 1.0,
        });
      });

      it('should fill in defaults for connectionDrop config', () => {
        const raw = {
          enabled: true,
          connectionDrop: { enabled: true },
        };
        const normalized = chaosService.normalizeConfig(raw);
        expect(normalized.connectionDrop).toEqual({
          enabled: true,
          probability: 1.0,
          graceful: true,
        });
      });

      it('should fill in defaults for randomError config', () => {
        const raw = {
          enabled: true,
          randomError: { enabled: true },
        };
        const normalized = chaosService.normalizeConfig(raw);
        expect(normalized.randomError).toEqual({
          enabled: true,
          errorRate: 0.1,
          errorTypes: ['temporary'],
        });
      });

      it('should fill in defaults for greylist config', () => {
        const raw = {
          enabled: true,
          greylist: { enabled: true },
        };
        const normalized = chaosService.normalizeConfig(raw);
        expect(normalized.greylist).toEqual({
          enabled: true,
          retryWindowMs: 300000,
          maxAttempts: 2,
          trackBy: 'ip_sender',
        });
      });

      it('should fill in defaults for blackhole config', () => {
        const raw = {
          enabled: true,
          blackhole: { enabled: true },
        };
        const normalized = chaosService.normalizeConfig(raw);
        expect(normalized.blackhole).toEqual({
          enabled: true,
          triggerWebhooks: false,
        });
      });

      it('should preserve expiresAt', () => {
        const expiresAt = new Date().toISOString();
        const raw = {
          enabled: true,
          expiresAt,
        };
        const normalized = chaosService.normalizeConfig(raw);
        expect(normalized.expiresAt).toBe(expiresAt);
      });
    });

    describe('logChaosEvent', () => {
      it('should emit chaos.applied event', (done) => {
        eventEmitter.once('chaos.applied', (event) => {
          expect(event.chaosType).toBe('test_type');
          expect(event.inboxEmail).toBe('test@example.com');
          expect(event.details).toBe('Test details');
          done();
        });

        chaosService.logChaosEvent({
          timestamp: new Date(),
          inboxEmail: 'test@example.com',
          chaosType: 'test_type',
          details: 'Test details',
          sessionId: 'session-123',
        });
      });

      it('should log event with messageId when provided', (done) => {
        eventEmitter.once('chaos.applied', (event) => {
          expect(event.messageId).toBe('msg-456');
          done();
        });

        chaosService.logChaosEvent({
          timestamp: new Date(),
          inboxEmail: 'test@example.com',
          chaosType: 'test_type',
          details: 'Test details',
          sessionId: 'session-123',
          messageId: 'msg-456',
        });
      });
    });
  });

  describe('GreylistHandler', () => {
    let greylistHandler: GreylistHandler;

    beforeEach(() => {
      greylistHandler = new GreylistHandler(greylistStateService);
      greylistStateService.clearAll();
    });

    it('should return continue when config is disabled', () => {
      const result = greylistHandler.evaluate(
        { enabled: false, maxAttempts: 2, retryWindowMs: 300000, trackBy: 'ip_sender' },
        { inboxEmail: 'test@example.com', senderIp: '1.2.3.4', senderEmail: 'sender@test.com' },
      );
      expect(result.action.action).toBe('continue');
    });

    it('should use default values when not provided', () => {
      const config = { enabled: true } as any;
      const context = { inboxEmail: 'test@example.com', senderIp: '1.2.3.4', senderEmail: 'sender@test.com' };

      // First attempt - rejected
      const result1 = greylistHandler.evaluate(config, context);
      expect(result1.action.action).toBe('error');

      // Second attempt - should pass (default maxAttempts is 2)
      const result2 = greylistHandler.evaluate(config, context);
      expect(result2.action.action).toBe('continue');
    });

    it('should reset entry when outside retry window', () => {
      const config = { enabled: true, maxAttempts: 2, retryWindowMs: 100, trackBy: 'ip_sender' as const };
      const context = { inboxEmail: 'test@example.com', senderIp: '1.2.3.4', senderEmail: 'sender@test.com' };

      // First attempt - rejected
      const result1 = greylistHandler.evaluate(config, context);
      expect(result1.action.action).toBe('error');

      // Wait for window to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // After window expires, should reset and reject again
          const result2 = greylistHandler.evaluate(config, context);
          expect(result2.action.action).toBe('error');
          resolve();
        }, 150);
      });
    });
  });

  describe('GreylistStateService', () => {
    describe('buildTrackingKey', () => {
      it('should build key with ip tracking', () => {
        const key = greylistStateService.buildTrackingKey('ip', 'test@example.com', '192.168.1.1', 'sender@test.com');
        expect(key).toBe('greylist:test@example.com:ip:192.168.1.1');
      });

      it('should build key with sender tracking', () => {
        const key = greylistStateService.buildTrackingKey(
          'sender',
          'test@example.com',
          '192.168.1.1',
          'sender@test.com',
        );
        expect(key).toBe('greylist:test@example.com:sender:sender@test.com');
      });

      it('should build key with ip_sender tracking', () => {
        const key = greylistStateService.buildTrackingKey(
          'ip_sender',
          'test@example.com',
          '192.168.1.1',
          'sender@test.com',
        );
        expect(key).toBe('greylist:test@example.com:ip_sender:192.168.1.1:sender@test.com');
      });

      it('should normalize email addresses to lowercase', () => {
        const key = greylistStateService.buildTrackingKey(
          'ip_sender',
          'TEST@EXAMPLE.COM',
          '192.168.1.1',
          'SENDER@TEST.COM',
        );
        expect(key).toBe('greylist:test@example.com:ip_sender:192.168.1.1:sender@test.com');
      });
    });

    describe('getOrCreateEntry', () => {
      it('should create new entry if not exists', () => {
        const entry = greylistStateService.getOrCreateEntry('test-key', 'test@example.com');
        expect(entry.attempts).toBe(0);
        expect(entry.inboxEmail).toBe('test@example.com');
        expect(entry.firstSeenAt).toBeInstanceOf(Date);
      });

      it('should return existing entry', () => {
        greylistStateService.getOrCreateEntry('test-key', 'test@example.com');
        greylistStateService.incrementAttempts('test-key');
        const entry = greylistStateService.getOrCreateEntry('test-key', 'test@example.com');
        expect(entry.attempts).toBe(1);
      });
    });

    describe('incrementAttempts', () => {
      it('should increment attempts', () => {
        greylistStateService.getOrCreateEntry('test-key', 'test@example.com');
        expect(greylistStateService.incrementAttempts('test-key')).toBe(1);
        expect(greylistStateService.incrementAttempts('test-key')).toBe(2);
      });

      it('should return 0 for non-existent key', () => {
        expect(greylistStateService.incrementAttempts('nonexistent')).toBe(0);
      });
    });

    describe('getAttempts', () => {
      it('should return attempts for existing key', () => {
        greylistStateService.getOrCreateEntry('test-key', 'test@example.com');
        greylistStateService.incrementAttempts('test-key');
        expect(greylistStateService.getAttempts('test-key')).toBe(1);
      });

      it('should return 0 for non-existent key', () => {
        expect(greylistStateService.getAttempts('nonexistent')).toBe(0);
      });
    });

    describe('isWithinWindow', () => {
      it('should return true for entry within window', () => {
        greylistStateService.getOrCreateEntry('test-key', 'test@example.com');
        expect(greylistStateService.isWithinWindow('test-key', 300000)).toBe(true);
      });

      it('should return false for non-existent key', () => {
        expect(greylistStateService.isWithinWindow('nonexistent', 300000)).toBe(false);
      });

      it('should return false for expired entry', async () => {
        greylistStateService.getOrCreateEntry('test-key', 'test@example.com');
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(greylistStateService.isWithinWindow('test-key', 10)).toBe(false);
      });
    });

    describe('removeEntry', () => {
      it('should remove entry', () => {
        greylistStateService.getOrCreateEntry('test-key', 'test@example.com');
        greylistStateService.removeEntry('test-key');
        expect(greylistStateService.getAttempts('test-key')).toBe(0);
      });
    });

    describe('cleanupStaleEntries', () => {
      it('should cleanup old entries', async () => {
        greylistStateService.getOrCreateEntry('test-key-1', 'test1@example.com');
        greylistStateService.getOrCreateEntry('test-key-2', 'test2@example.com');
        await new Promise((resolve) => setTimeout(resolve, 50));

        const cleaned = greylistStateService.cleanupStaleEntries(10);
        expect(cleaned).toBe(2);
        expect(greylistStateService.getStateSize()).toBe(0);
      });

      it('should not cleanup fresh entries', () => {
        greylistStateService.getOrCreateEntry('test-key', 'test@example.com');
        const cleaned = greylistStateService.cleanupStaleEntries(300000);
        expect(cleaned).toBe(0);
        expect(greylistStateService.getStateSize()).toBe(1);
      });
    });

    describe('getStateSize', () => {
      it('should return current state size', () => {
        expect(greylistStateService.getStateSize()).toBe(0);
        greylistStateService.getOrCreateEntry('key-1', 'test1@example.com');
        expect(greylistStateService.getStateSize()).toBe(1);
        greylistStateService.getOrCreateEntry('key-2', 'test2@example.com');
        expect(greylistStateService.getStateSize()).toBe(2);
      });
    });

    describe('clearAll', () => {
      it('should clear all state', () => {
        greylistStateService.getOrCreateEntry('key-1', 'test1@example.com');
        greylistStateService.getOrCreateEntry('key-2', 'test2@example.com');
        greylistStateService.clearAll();
        expect(greylistStateService.getStateSize()).toBe(0);
      });
    });
  });
});

describe('ChaosEnabledGuard', () => {
  describe('when chaos is disabled', () => {
    let guard: ChaosEnabledGuard;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        providers: [
          ChaosEnabledGuard,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(false),
            },
          },
        ],
      }).compile();

      guard = moduleFixture.get<ChaosEnabledGuard>(ChaosEnabledGuard);
    });

    it('should throw ForbiddenException when chaos is disabled', () => {
      expect(() => guard.canActivate()).toThrow(ForbiddenException);
      expect(() => guard.canActivate()).toThrow('Chaos engineering features are disabled');
    });
  });

  describe('when chaos is enabled', () => {
    let guard: ChaosEnabledGuard;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        providers: [
          ChaosEnabledGuard,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(true),
            },
          },
        ],
      }).compile();

      guard = moduleFixture.get<ChaosEnabledGuard>(ChaosEnabledGuard);
    });

    it('should return true when chaos is enabled', () => {
      expect(guard.canActivate()).toBe(true);
    });
  });
});

describe('ChaosService with chaos disabled globally', () => {
  let chaosService: ChaosService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              vsb: {
                chaos: {
                  enabled: false,
                },
                sse: {
                  enabled: false,
                },
              },
            }),
          ],
        }),
        EventEmitterModule.forRoot(),
        ScheduleModule.forRoot(),
        SseConsoleModule,
        MetricsModule,
        ChaosModule,
      ],
    }).compile();

    chaosService = moduleFixture.get<ChaosService>(ChaosService);
  });

  it('should return false for isEnabled', () => {
    expect(chaosService.isEnabled()).toBe(false);
  });

  it('should return continue for evaluate even with enabled config', () => {
    const config: InboxChaosConfig = {
      enabled: true,
      blackhole: { enabled: true, triggerWebhooks: false },
    };
    const result = chaosService.evaluate(config, 'session-1', 'test@example.com');
    expect(result.result.action).toBe('continue');
  });
});
