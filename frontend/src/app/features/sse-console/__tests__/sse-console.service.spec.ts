import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { SseConsoleService, ConsoleMessage, EVENT_SOURCE_TOKEN, EventSourceConstructor } from '../sse-console.service';

describe('SseConsoleService', () => {
  let service: SseConsoleService;
  let mockEventSourceInstance: MockEventSource;
  let eventSourceInstances: MockEventSource[];

  class MockEventSource {
    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    url: string;
    options: unknown;

    constructor(url: string, options?: unknown) {
      this.url = url;
      this.options = options;
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      mockEventSourceInstance = this;
      eventSourceInstances.push(this);
    }

    close = jasmine.createSpy('close');

    triggerOpen(): void {
      if (this.onopen) {
        this.onopen({} as Event);
      }
    }

    triggerMessage(data: string): void {
      if (this.onmessage) {
        this.onmessage({ data } as MessageEvent);
      }
    }

    triggerError(): void {
      if (this.onerror) {
        this.onerror({} as Event);
      }
    }
  }

  beforeEach(() => {
    eventSourceInstances = [];

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        SseConsoleService,
        { provide: EVENT_SOURCE_TOKEN, useValue: MockEventSource as unknown as EventSourceConstructor },
      ],
    });

    service = TestBed.inject(SseConsoleService);
  });

  afterEach(() => {
    service.disconnect();
  });

  describe('connect()', () => {
    it('should create EventSource with correct URL', () => {
      service.connect('test-api-key');

      expect(mockEventSourceInstance.url).toContain('/sse-console/stream');
    });

    it('should pass fetch function in options', () => {
      service.connect('test-api-key');

      expect(mockEventSourceInstance.options).toBeDefined();
      expect((mockEventSourceInstance.options as { fetch: unknown }).fetch).toBeDefined();
    });

    it('should set connected to true on open', () => {
      service.connect('test-api-key');

      expect(service.connected()).toBe(false);

      mockEventSourceInstance.triggerOpen();

      expect(service.connected()).toBe(true);
    });

    it('should close existing connection before creating new one', () => {
      service.connect('test-api-key');
      const firstEventSource = mockEventSourceInstance;

      service.connect('new-api-key');

      expect(firstEventSource.close).toHaveBeenCalled();
    });
  });

  describe('disconnect()', () => {
    it('should close EventSource connection', () => {
      service.connect('test-api-key');

      service.disconnect();

      expect(mockEventSourceInstance.close).toHaveBeenCalled();
    });

    it('should set connected to false', () => {
      service.connect('test-api-key');
      mockEventSourceInstance.triggerOpen();
      expect(service.connected()).toBe(true);

      service.disconnect();

      expect(service.connected()).toBe(false);
    });

    it('should reset reconnect attempts', () => {
      service.connect('test-api-key');
      // Simulate error
      mockEventSourceInstance.triggerError();

      service.disconnect();
      service.connect('test-api-key');

      // Should be able to start fresh (attempts reset)
      expect(eventSourceInstances.length).toBe(2);
    });

    it('should be safe to call when not connected', () => {
      expect(() => service.disconnect()).not.toThrow();
    });
  });

  describe('connected signal', () => {
    it('should be false initially', () => {
      expect(service.connected()).toBe(false);
    });

    it('should be true after successful connection', () => {
      service.connect('test-api-key');
      mockEventSourceInstance.triggerOpen();

      expect(service.connected()).toBe(true);
    });

    it('should be false after disconnect', () => {
      service.connect('test-api-key');
      mockEventSourceInstance.triggerOpen();

      service.disconnect();

      expect(service.connected()).toBe(false);
    });

    it('should be false after connection error', () => {
      service.connect('test-api-key');
      mockEventSourceInstance.triggerOpen();
      expect(service.connected()).toBe(true);

      mockEventSourceInstance.triggerError();

      expect(service.connected()).toBe(false);
    });

    it('should be readonly', () => {
      const connectedSignal = service.connected;

      // Signal should be readonly (no set method exposed)
      expect(typeof connectedSignal).toBe('function');
      expect((connectedSignal as unknown as { set?: unknown }).set).toBeUndefined();
    });
  });

  describe('messages$ observable', () => {
    it('should emit parsed messages', (done) => {
      const testMessage: ConsoleMessage = {
        type: 'info',
        text: 'Test message',
        timestamp: '2024-01-01T00:00:00Z',
      };

      service.connect('test-api-key');

      service.messages$.subscribe((message) => {
        expect(message).toEqual(testMessage);
        done();
      });

      mockEventSourceInstance.triggerMessage(JSON.stringify(testMessage));
    });

    it('should emit multiple messages in order', () => {
      const messages: ConsoleMessage[] = [];
      const testMessages: ConsoleMessage[] = [
        { type: 'info', text: 'First', timestamp: '2024-01-01T00:00:00Z' },
        { type: 'warning', text: 'Second', timestamp: '2024-01-01T00:00:01Z' },
        { type: 'error', text: 'Third', timestamp: '2024-01-01T00:00:02Z' },
      ];

      service.connect('test-api-key');
      service.messages$.subscribe((msg) => messages.push(msg));

      testMessages.forEach((msg) => {
        mockEventSourceInstance.triggerMessage(JSON.stringify(msg));
      });

      expect(messages).toEqual(testMessages);
    });

    it('should handle all message types', () => {
      const messageTypes: ConsoleMessage['type'][] = ['info', 'success', 'warning', 'error'];
      const receivedTypes: string[] = [];

      service.connect('test-api-key');
      service.messages$.subscribe((msg) => receivedTypes.push(msg.type));

      messageTypes.forEach((type) => {
        const msg: ConsoleMessage = { type, text: `${type} message`, timestamp: '2024-01-01T00:00:00Z' };
        mockEventSourceInstance.triggerMessage(JSON.stringify(msg));
      });

      expect(receivedTypes).toEqual(messageTypes);
    });
  });

  describe('message parsing errors', () => {
    it('should not emit on invalid JSON', () => {
      const messages: ConsoleMessage[] = [];
      spyOn(console, 'error');

      service.connect('test-api-key');
      service.messages$.subscribe((msg) => messages.push(msg));

      mockEventSourceInstance.triggerMessage('invalid json{');

      expect(messages.length).toBe(0);
      expect(console.error).toHaveBeenCalledWith('[SseConsole] Failed to parse message', jasmine.any(SyntaxError));
    });

    it('should continue processing after parse error', () => {
      const messages: ConsoleMessage[] = [];
      const validMessage: ConsoleMessage = {
        type: 'info',
        text: 'Valid message',
        timestamp: '2024-01-01T00:00:00Z',
      };
      spyOn(console, 'error');

      service.connect('test-api-key');
      service.messages$.subscribe((msg) => messages.push(msg));

      // Send invalid message
      mockEventSourceInstance.triggerMessage('invalid');

      // Send valid message after
      mockEventSourceInstance.triggerMessage(JSON.stringify(validMessage));

      expect(messages.length).toBe(1);
      expect(messages[0]).toEqual(validMessage);
    });
  });

  describe('reconnection behavior', () => {
    beforeEach(() => {
      jasmine.clock().install();
    });

    afterEach(() => {
      jasmine.clock().uninstall();
    });

    it('should schedule reconnect on connection error', () => {
      spyOn(console, 'error');
      service.connect('test-api-key');

      mockEventSourceInstance.triggerError();

      // Before delay
      expect(eventSourceInstances.length).toBe(1);

      // After delay
      jasmine.clock().tick(2000);

      // Should have created a new EventSource
      expect(eventSourceInstances.length).toBe(2);
    });

    it('should use 2 second delay between reconnect attempts', () => {
      spyOn(console, 'error');
      service.connect('test-api-key');

      mockEventSourceInstance.triggerError();

      // Before delay
      jasmine.clock().tick(1999);
      expect(eventSourceInstances.length).toBe(1);

      // After delay
      jasmine.clock().tick(1);
      expect(eventSourceInstances.length).toBe(2);
    });

    it('should stop reconnecting after max attempts (10)', () => {
      spyOn(console, 'error');
      service.connect('test-api-key');

      // Trigger 10 errors (max attempts)
      for (let i = 0; i < 10; i++) {
        const currentInstance = eventSourceInstances[eventSourceInstances.length - 1];
        currentInstance.triggerError();
        jasmine.clock().tick(2000);
      }

      const instancesAfterMaxAttempts = eventSourceInstances.length;

      // Trigger one more error
      const lastInstance = eventSourceInstances[eventSourceInstances.length - 1];
      lastInstance.triggerError();
      jasmine.clock().tick(2000);

      // Should not have created more instances
      expect(eventSourceInstances.length).toBe(instancesAfterMaxAttempts);
    });

    it('should close old connection before reconnecting', () => {
      spyOn(console, 'error');
      service.connect('test-api-key');
      const firstInstance = mockEventSourceInstance;

      mockEventSourceInstance.triggerError();
      jasmine.clock().tick(2000);

      expect(firstInstance.close).toHaveBeenCalled();
    });

    it('should not reconnect if manually disconnected', () => {
      spyOn(console, 'error');
      service.connect('test-api-key');

      service.disconnect();
      jasmine.clock().tick(5000);

      // Should only have the initial instance
      expect(eventSourceInstances.length).toBe(1);
    });

    it('should not schedule multiple reconnects for rapid errors', () => {
      spyOn(console, 'error');
      service.connect('test-api-key');

      // Trigger multiple errors quickly (eventSource is closed after first error)
      mockEventSourceInstance.triggerError();

      jasmine.clock().tick(2000);

      // Should only have 2 instances (original + 1 reconnect)
      expect(eventSourceInstances.length).toBe(2);
    });

    it('should reset reconnect attempts after successful connection', () => {
      spyOn(console, 'error');
      service.connect('test-api-key');

      // Trigger some errors
      for (let i = 0; i < 5; i++) {
        const currentInstance = eventSourceInstances[eventSourceInstances.length - 1];
        currentInstance.triggerError();
        jasmine.clock().tick(2000);
      }

      // Simulate successful connection
      const currentInstance = eventSourceInstances[eventSourceInstances.length - 1];
      currentInstance.triggerOpen();

      // Trigger error on current connection
      currentInstance.triggerError();
      jasmine.clock().tick(2000);

      // Should be able to reconnect again (10 more times possible)
      for (let i = 0; i < 9; i++) {
        const instance = eventSourceInstances[eventSourceInstances.length - 1];
        instance.triggerError();
        jasmine.clock().tick(2000);
      }

      // Should have reconnected 10 more times after reset (5 + 1 reset + 10 = 16)
      expect(eventSourceInstances.length).toBe(16);
    });

    it('should clear API key preventing reconnection after disconnect', () => {
      spyOn(console, 'error');
      service.connect('test-api-key');
      mockEventSourceInstance.triggerError();

      service.disconnect();

      // Advance timer past reconnect delay
      jasmine.clock().tick(3000);

      // Should not have created a new EventSource (API key cleared)
      expect(eventSourceInstances.length).toBe(1);
    });
  });

  describe('connection state transitions', () => {
    it('should transition from disconnected to connected on open', () => {
      expect(service.connected()).toBe(false);

      service.connect('test-api-key');
      expect(service.connected()).toBe(false);

      mockEventSourceInstance.triggerOpen();
      expect(service.connected()).toBe(true);
    });

    it('should transition from connected to disconnected on error', () => {
      spyOn(console, 'error');
      service.connect('test-api-key');
      mockEventSourceInstance.triggerOpen();
      expect(service.connected()).toBe(true);

      mockEventSourceInstance.triggerError();
      expect(service.connected()).toBe(false);
    });

    it('should transition from connected to disconnected on disconnect', () => {
      service.connect('test-api-key');
      mockEventSourceInstance.triggerOpen();
      expect(service.connected()).toBe(true);

      service.disconnect();
      expect(service.connected()).toBe(false);
    });
  });

  describe('API key header injection', () => {
    it('should inject x-api-key header in fetch requests', async () => {
      const apiKey = 'test-api-key-12345';
      let capturedHeaders: Record<string, string> = {};

      // Mock global fetch to capture headers
      const originalFetch = globalThis.fetch;
      globalThis.fetch = jasmine.createSpy('fetch').and.callFake((_input: unknown, init?: RequestInit) => {
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        return Promise.resolve(new Response());
      });

      service.connect(apiKey);

      // Get the fetch function passed to EventSource
      const fetchFn = (mockEventSourceInstance.options as { fetch: typeof fetch }).fetch;

      // Call it to verify header injection
      await fetchFn('http://test.com', { headers: { existing: 'header' } });

      expect(capturedHeaders['x-api-key']).toBe(apiKey);
      expect(capturedHeaders['existing']).toBe('header');

      globalThis.fetch = originalFetch;
    });
  });
});
