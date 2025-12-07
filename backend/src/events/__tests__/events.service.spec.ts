import { EventsService } from '../events.service';
import { NewEmailEvent } from '../interfaces';
import { firstValueFrom, take, toArray } from 'rxjs';

describe('EventsService', () => {
  let service: EventsService;

  beforeEach(() => {
    service = new EventsService();
  });

  describe('streamForInboxes', () => {
    it('returns empty stream when no inbox IDs provided', (done) => {
      const stream$ = service.streamForInboxes([]);

      // Emit an event that should NOT be received
      service.emitNewEmailEvent(createMockEvent('inbox-1'));

      // Give some time for potential events, then complete
      setTimeout(() => {
        const subscription = stream$.pipe(take(1)).subscribe({
          next: () => {
            done.fail('Should not receive any events');
          },
        });

        // No events should come through
        setTimeout(() => {
          subscription.unsubscribe();
          done();
        }, 50);
      }, 10);
    });

    it('filters events to only subscribed inboxes', (done) => {
      const stream$ = service.streamForInboxes(['inbox-1', 'inbox-3']);
      const received: NewEmailEvent[] = [];

      const subscription = stream$.subscribe((event) => {
        received.push(event);
      });

      // Emit events for different inboxes
      service.emitNewEmailEvent(createMockEvent('inbox-1', 'email-1'));
      service.emitNewEmailEvent(createMockEvent('inbox-2', 'email-2')); // Should be filtered out
      service.emitNewEmailEvent(createMockEvent('inbox-3', 'email-3'));
      service.emitNewEmailEvent(createMockEvent('inbox-4', 'email-4')); // Should be filtered out

      setTimeout(() => {
        subscription.unsubscribe();
        expect(received).toHaveLength(2);
        expect(received[0].inboxId).toBe('inbox-1');
        expect(received[0].emailId).toBe('email-1');
        expect(received[1].inboxId).toBe('inbox-3');
        expect(received[1].emailId).toBe('email-3');
        done();
      }, 50);
    });

    it('handles single inbox subscription', (done) => {
      const stream$ = service.streamForInboxes(['inbox-only']);
      const received: NewEmailEvent[] = [];

      const subscription = stream$.subscribe((event) => {
        received.push(event);
      });

      service.emitNewEmailEvent(createMockEvent('inbox-only', 'email-1'));
      service.emitNewEmailEvent(createMockEvent('other-inbox', 'email-2'));
      service.emitNewEmailEvent(createMockEvent('inbox-only', 'email-3'));

      setTimeout(() => {
        subscription.unsubscribe();
        expect(received).toHaveLength(2);
        expect(received.every((e) => e.inboxId === 'inbox-only')).toBe(true);
        done();
      }, 50);
    });

    it('allows multiple subscribers to same inbox', (done) => {
      const stream1$ = service.streamForInboxes(['shared-inbox']);
      const stream2$ = service.streamForInboxes(['shared-inbox']);
      const received1: NewEmailEvent[] = [];
      const received2: NewEmailEvent[] = [];

      const sub1 = stream1$.subscribe((event) => received1.push(event));
      const sub2 = stream2$.subscribe((event) => received2.push(event));

      service.emitNewEmailEvent(createMockEvent('shared-inbox', 'email-1'));

      setTimeout(() => {
        sub1.unsubscribe();
        sub2.unsubscribe();
        expect(received1).toHaveLength(1);
        expect(received2).toHaveLength(1);
        expect(received1[0].emailId).toBe('email-1');
        expect(received2[0].emailId).toBe('email-1');
        done();
      }, 50);
    });
  });

  describe('toMessageEvents', () => {
    it('transforms NewEmailEvent to MessageEvent format', async () => {
      const event = createMockEvent('inbox-1', 'email-1');
      const stream$ = service.streamForInboxes(['inbox-1']);
      const message$ = service.toMessageEvents(stream$);

      const resultPromise = firstValueFrom(message$.pipe(take(1)));
      service.emitNewEmailEvent(event);

      const result = await resultPromise;
      expect(result).toEqual({ data: event });
    });

    it('preserves all event properties in data field', async () => {
      const event = createMockEvent('test-inbox', 'test-email');
      const stream$ = service.streamForInboxes(['test-inbox']);
      const message$ = service.toMessageEvents(stream$);

      const resultPromise = firstValueFrom(message$.pipe(take(1)));
      service.emitNewEmailEvent(event);

      const result = await resultPromise;
      expect(result.data).toHaveProperty('inboxId', 'test-inbox');
      expect(result.data).toHaveProperty('emailId', 'test-email');
      expect(result.data).toHaveProperty('encryptedMetadata');
    });

    it('transforms multiple events sequentially', async () => {
      const stream$ = service.streamForInboxes(['inbox-1']);
      const message$ = service.toMessageEvents(stream$);

      const resultsPromise = firstValueFrom(message$.pipe(take(3), toArray()));

      service.emitNewEmailEvent(createMockEvent('inbox-1', 'email-1'));
      service.emitNewEmailEvent(createMockEvent('inbox-1', 'email-2'));
      service.emitNewEmailEvent(createMockEvent('inbox-1', 'email-3'));

      const results = await resultsPromise;
      expect(results).toHaveLength(3);
      expect(results[0].data.emailId).toBe('email-1');
      expect(results[1].data.emailId).toBe('email-2');
      expect(results[2].data.emailId).toBe('email-3');
    });
  });

  describe('emitNewEmailEvent', () => {
    it('emits events to the stream', (done) => {
      const stream$ = service.streamForInboxes(['inbox-1']);
      const event = createMockEvent('inbox-1', 'test-email');

      stream$.pipe(take(1)).subscribe({
        next: (received) => {
          expect(received).toEqual(event);
          done();
        },
      });

      service.emitNewEmailEvent(event);
    });
  });
});

function createMockEvent(inboxId: string, emailId: string = 'default-email-id'): NewEmailEvent {
  return {
    inboxId,
    emailId,
    encryptedMetadata: {
      v: 1,
      algs: {
        kem: 'ML-KEM-768',
        sig: 'ML-DSA-65',
        aead: 'AES-256-GCM',
        kdf: 'HKDF-SHA-512',
      },
      ct_kem: 'mock-ct-kem',
      nonce: 'mock-nonce',
      aad: 'mock-aad',
      ciphertext: 'mock-ciphertext',
      sig: 'mock-sig',
      server_sig_pk: 'mock-server-sig-pk',
    },
  };
}
