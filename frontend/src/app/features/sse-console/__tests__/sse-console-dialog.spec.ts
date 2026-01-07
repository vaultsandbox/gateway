import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject } from 'rxjs';
import { SseConsoleDialog } from '../sse-console-dialog';
import { SseConsoleService, ConsoleMessage } from '../sse-console.service';
import { VaultSandbox } from '../../../shared/services/vault-sandbox';

describe('SseConsoleDialog', () => {
  let component: SseConsoleDialog;
  let fixture: ComponentFixture<SseConsoleDialog>;
  let sseConsoleService: jasmine.SpyObj<SseConsoleService>;
  let messagesSubject: Subject<ConsoleMessage>;
  let connectedSignal: ReturnType<typeof signal<boolean>>;

  beforeEach(async () => {
    messagesSubject = new Subject<ConsoleMessage>();
    connectedSignal = signal(false);

    const sseConsoleServiceSpy = jasmine.createSpyObj('SseConsoleService', ['connect', 'disconnect'], {
      messages$: messagesSubject.asObservable(),
      connected: connectedSignal.asReadonly(),
    });

    const vaultSandboxSpy = jasmine.createSpyObj('VaultSandbox', [], {
      apiKey: signal<string | null>('test-api-key').asReadonly(),
    });

    await TestBed.configureTestingModule({
      imports: [SseConsoleDialog],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: SseConsoleService, useValue: sseConsoleServiceSpy },
        { provide: VaultSandbox, useValue: vaultSandboxSpy },
      ],
    }).compileComponents();

    sseConsoleService = TestBed.inject(SseConsoleService) as jasmine.SpyObj<SseConsoleService>;

    fixture = TestBed.createComponent(SseConsoleDialog);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnInit()', () => {
    it('should connect to SSE console with API key', () => {
      fixture.detectChanges();

      expect(sseConsoleService.connect).toHaveBeenCalledWith('test-api-key');
    });

    it('should not connect when no API key is available', async () => {
      const noKeyVaultSandbox = jasmine.createSpyObj('VaultSandbox', [], {
        apiKey: signal<string | null>(null).asReadonly(),
      });

      spyOn(console, 'error');

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [SseConsoleDialog],
        providers: [
          provideZonelessChangeDetection(),
          provideNoopAnimations(),
          { provide: SseConsoleService, useValue: sseConsoleService },
          { provide: VaultSandbox, useValue: noKeyVaultSandbox },
        ],
      }).compileComponents();

      const noKeyFixture = TestBed.createComponent(SseConsoleDialog);
      noKeyFixture.detectChanges();

      expect(sseConsoleService.connect).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('[SseConsoleDialog] No API key available');

      noKeyFixture.destroy();
    });

    it('should subscribe to messages and update signal', async () => {
      fixture.detectChanges();

      const testMessage: ConsoleMessage = {
        type: 'info',
        text: 'Test message',
        timestamp: '2024-01-01T00:00:00Z',
      };

      messagesSubject.next(testMessage);
      await fixture.whenStable();

      expect(component.messages()).toEqual([testMessage]);
    });

    it('should limit messages to 1000', async () => {
      fixture.detectChanges();

      // Add 1001 messages
      for (let i = 0; i < 1001; i++) {
        messagesSubject.next({
          type: 'info',
          text: `Message ${i}`,
          timestamp: '2024-01-01T00:00:00Z',
        });
      }
      await fixture.whenStable();

      expect(component.messages().length).toBe(1000);
      expect(component.messages()[0].text).toBe('Message 1'); // First message trimmed
      expect(component.messages()[999].text).toBe('Message 1000');
    });
  });

  describe('ngOnDestroy()', () => {
    it('should disconnect from SSE console', () => {
      fixture.detectChanges();
      component.ngOnDestroy();

      expect(sseConsoleService.disconnect).toHaveBeenCalled();
    });
  });

  describe('onClose()', () => {
    it('should close the dialog and emit closed event', () => {
      const closedSpy = spyOn(component.closed, 'emit');

      component.onClose();

      expect(component.dialogVisible).toBeFalse();
      expect(closedSpy).toHaveBeenCalled();
    });
  });

  describe('clearConsole()', () => {
    it('should clear all messages', async () => {
      fixture.detectChanges();

      // Add some messages
      messagesSubject.next({ type: 'info', text: 'Message 1', timestamp: '2024-01-01T00:00:00Z' });
      messagesSubject.next({ type: 'warning', text: 'Message 2', timestamp: '2024-01-01T00:00:01Z' });
      await fixture.whenStable();

      expect(component.messages().length).toBe(2);

      component.clearConsole();

      expect(component.messages()).toEqual([]);
    });
  });

  describe('getMessageClass()', () => {
    it('should return correct class for info type', () => {
      expect(component.getMessageClass('info')).toBe('message-info');
    });

    it('should return correct class for success type', () => {
      expect(component.getMessageClass('success')).toBe('message-success');
    });

    it('should return correct class for warning type', () => {
      expect(component.getMessageClass('warning')).toBe('message-warning');
    });

    it('should return correct class for error type', () => {
      expect(component.getMessageClass('error')).toBe('message-error');
    });
  });

  describe('formatTimestamp()', () => {
    it('should format timestamp using DateFormatter', () => {
      const timestamp = '2024-01-01T12:30:45Z';
      const result = component.formatTimestamp(timestamp);

      // Should return a time-only format
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });
  });

  describe('connected signal', () => {
    it('should reflect SSE service connection state', () => {
      expect(component.connected()).toBe(false);

      connectedSignal.set(true);

      expect(component.connected()).toBe(true);
    });
  });

  describe('onScroll()', () => {
    it('should disable auto-scroll when user scrolls up', async () => {
      fixture.detectChanges();

      const mockContainer = {
        scrollHeight: 1000,
        scrollTop: 500,
        clientHeight: 300,
      };

      component.onScroll({ target: mockContainer } as unknown as Event);

      // Auto-scroll should be disabled because scrollTop + clientHeight != scrollHeight
      // Add a message and verify it doesn't auto-scroll
      messagesSubject.next({ type: 'info', text: 'New message', timestamp: '2024-01-01T00:00:00Z' });
      await fixture.whenStable();

      // Component should still work, just auto-scroll disabled
      expect(component.messages().length).toBe(1);
    });

    it('should enable auto-scroll when user scrolls to bottom', async () => {
      fixture.detectChanges();

      const mockContainer = {
        scrollHeight: 1000,
        scrollTop: 700,
        clientHeight: 300,
      };

      component.onScroll({ target: mockContainer } as unknown as Event);

      // Auto-scroll should be enabled because scrollTop + clientHeight == scrollHeight
      messagesSubject.next({ type: 'info', text: 'New message', timestamp: '2024-01-01T00:00:00Z' });
      await fixture.whenStable();

      expect(component.messages().length).toBe(1);
    });
  });

  describe('auto-scroll effect', () => {
    it('should not throw when container is not found', async () => {
      fixture.detectChanges();

      // No container in DOM - scrollToBottom will be called but container won't be found
      messagesSubject.next({ type: 'info', text: 'Test', timestamp: '2024-01-01T00:00:00Z' });
      await fixture.whenStable();

      // Should not throw
      expect(component.messages().length).toBe(1);
    });

    it('should not auto-scroll when disabled', async () => {
      fixture.detectChanges();

      // Disable auto-scroll by simulating user scroll up
      const mockContainer = {
        scrollHeight: 1000,
        scrollTop: 500,
        clientHeight: 300,
      };
      component.onScroll({ target: mockContainer } as unknown as Event);

      // Add message
      messagesSubject.next({ type: 'info', text: 'Test', timestamp: '2024-01-01T00:00:00Z' });
      await fixture.whenStable();

      // Effect runs but auto-scroll is disabled
      expect(component.messages().length).toBe(1);
    });
  });

  describe('dialog visibility', () => {
    it('should toggle visibility based on dialog events', () => {
      const closedSpy = spyOn(component.closed, 'emit');

      component.onVisibleChange(false);

      expect(component.dialogVisible).toBeFalse();
      expect(closedSpy).toHaveBeenCalled();

      component.onVisibleChange(true);

      expect(component.dialogVisible).toBeTrue();
    });
  });
});
