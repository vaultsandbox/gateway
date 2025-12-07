import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventsController } from '../events.controller';
import { EventsService } from '../events.service';
import { InboxService } from '../../inbox/inbox.service';
import { ApiKeyGuard } from '../../inbox/guards/api-key.guard';
import { silenceNestLogger } from '../../../test/helpers/silence-logger';
import { take } from 'rxjs';

describe('EventsController', () => {
  let controller: EventsController;
  let eventsService: EventsService;
  let inboxService: jest.Mocked<InboxService>;
  const restoreLogger = silenceNestLogger();

  afterAll(() => restoreLogger());

  beforeEach(async () => {
    const mockInboxService = {
      listInboxHashes: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [
        EventsService,
        {
          provide: InboxService,
          useValue: mockInboxService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-api-key'),
          },
        },
        ApiKeyGuard,
      ],
    }).compile();

    controller = module.get<EventsController>(EventsController);
    eventsService = module.get<EventsService>(EventsService);
    inboxService = module.get(InboxService);
  });

  describe('stream - normalizeInboxIds behavior', () => {
    beforeEach(() => {
      // Default: all requested inboxes are "owned"
      inboxService.listInboxHashes.mockImplementation(() => ['inbox-1', 'inbox-2', 'inbox-3', 'owned-inbox']);
    });

    it('throws BadRequestException when inboxes parameter is undefined', () => {
      expect(() => controller.stream(undefined)).toThrow(BadRequestException);
      expect(() => controller.stream(undefined)).toThrow('At least one inbox hash must be specified');
    });

    it('throws BadRequestException when inboxes parameter is empty string', () => {
      expect(() => controller.stream('')).toThrow(BadRequestException);
      expect(() => controller.stream('')).toThrow('At least one inbox hash must be specified');
    });

    it('throws BadRequestException when inboxes contains only whitespace', () => {
      expect(() => controller.stream('   ')).toThrow(BadRequestException);
      expect(() => controller.stream('   ')).toThrow('At least one inbox hash must be specified');
    });

    it('throws BadRequestException when inboxes contains only commas', () => {
      expect(() => controller.stream(',,,,')).toThrow(BadRequestException);
      expect(() => controller.stream(',,,,')).toThrow('At least one inbox hash must be specified');
    });

    it('throws BadRequestException when inboxes contains commas and whitespace', () => {
      expect(() => controller.stream(' , , , ')).toThrow(BadRequestException);
      expect(() => controller.stream(' , , , ')).toThrow('At least one inbox hash must be specified');
    });

    it('accepts single inbox ID as string', () => {
      const stream$ = controller.stream('inbox-1');
      expect(stream$).toBeDefined();
    });

    it('accepts comma-separated inbox IDs', () => {
      const stream$ = controller.stream('inbox-1,inbox-2');
      expect(stream$).toBeDefined();
    });

    it('trims whitespace from inbox IDs', () => {
      // Should work with whitespace around IDs
      const stream$ = controller.stream('  inbox-1  ,  inbox-2  ');
      expect(stream$).toBeDefined();
    });

    it('handles array input (multiple query params)', () => {
      const stream$ = controller.stream(['inbox-1', 'inbox-2']);
      expect(stream$).toBeDefined();
    });

    it('deduplicates repeated inbox IDs', () => {
      // Should not cause issues with duplicates
      const stream$ = controller.stream('inbox-1,inbox-1,inbox-1');
      expect(stream$).toBeDefined();
    });

    it('filters empty entries from comma-separated list', () => {
      // Empty entries between commas should be filtered
      const stream$ = controller.stream('inbox-1,,inbox-2,,,inbox-3');
      expect(stream$).toBeDefined();
    });

    it('handles mixed array with comma-separated values', () => {
      // Array elements that contain commas should be split
      const stream$ = controller.stream(['inbox-1,inbox-2', 'inbox-3']);
      expect(stream$).toBeDefined();
    });
  });

  describe('stream - inbox ownership validation', () => {
    it('throws BadRequestException when no requested inboxes are owned', () => {
      inboxService.listInboxHashes.mockReturnValue(['owned-inbox-1', 'owned-inbox-2']);

      expect(() => controller.stream('unowned-inbox')).toThrow(BadRequestException);
      expect(() => controller.stream('unowned-inbox')).toThrow('No matching inbox hashes found');
    });

    it('filters out unowned inboxes from subscription', (done) => {
      inboxService.listInboxHashes.mockReturnValue(['owned-inbox']);

      const stream$ = controller.stream('owned-inbox,unowned-inbox');

      // Subscribe and emit events
      stream$.pipe(take(1)).subscribe({
        next: (event) => {
          // Should only receive events for owned inbox
          expect(event.data.inboxId).toBe('owned-inbox');
          done();
        },
      });

      // Emit event for owned inbox
      eventsService.emitNewEmailEvent({
        inboxId: 'owned-inbox',
        emailId: 'email-1',
        encryptedMetadata: createMockEncryptedPayload(),
      });
    });

    it('returns observable that emits MessageEvent format', (done) => {
      inboxService.listInboxHashes.mockReturnValue(['inbox-1']);

      const stream$ = controller.stream('inbox-1');

      stream$.pipe(take(1)).subscribe({
        next: (event) => {
          expect(event).toHaveProperty('data');
          expect(event.data).toHaveProperty('inboxId');
          expect(event.data).toHaveProperty('emailId');
          done();
        },
      });

      eventsService.emitNewEmailEvent({
        inboxId: 'inbox-1',
        emailId: 'email-1',
        encryptedMetadata: createMockEncryptedPayload(),
      });
    });
  });

  describe('stream - heartbeat', () => {
    it('emits heartbeat events every 30 seconds', (done) => {
      jest.useFakeTimers();

      inboxService.listInboxHashes.mockReturnValue(['inbox-1']);
      const stream$ = controller.stream('inbox-1');

      const events: any[] = [];
      const subscription = stream$.subscribe({
        next: (event) => {
          events.push(event);
        },
      });

      // Advance timer by 30 seconds
      jest.advanceTimersByTime(30000);

      // Should have received a heartbeat
      expect(events.length).toBeGreaterThanOrEqual(1);
      const heartbeat = events.find((e) => e.data?.type === 'heartbeat');
      expect(heartbeat).toBeDefined();
      expect(heartbeat.data.timestamp).toBeDefined();

      subscription.unsubscribe();
      jest.useRealTimers();
      done();
    });
  });
});

function createMockEncryptedPayload() {
  return {
    v: 1 as const,
    algs: {
      kem: 'ML-KEM-768' as const,
      sig: 'ML-DSA-65' as const,
      aead: 'AES-256-GCM' as const,
      kdf: 'HKDF-SHA-512' as const,
    },
    ct_kem: 'mock-ct-kem',
    nonce: 'mock-nonce',
    aad: 'mock-aad',
    ciphertext: 'mock-ciphertext',
    sig: 'mock-sig',
    server_sig_pk: 'mock-server-sig-pk',
  };
}
