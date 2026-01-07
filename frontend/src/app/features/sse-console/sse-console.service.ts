import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { EventSource } from 'eventsource';
import { environment } from '../../../environments/environment';

/**
 * Console message received from the SSE stream.
 */
export interface ConsoleMessage {
  type: 'info' | 'success' | 'warning' | 'error';
  text: string;
  timestamp: string;
}

/**
 * Type for EventSource constructor function.
 */
export type EventSourceConstructor = typeof EventSource;

/**
 * Injection token for the EventSource constructor.
 * Allows mocking EventSource in tests.
 */
/* istanbul ignore next 4 - factory only used at runtime, always mocked in tests */
export const EVENT_SOURCE_TOKEN = new InjectionToken<EventSourceConstructor>('EventSourceConstructor', {
  providedIn: 'root',
  factory: () => EventSource,
});

/**
 * Handles SSE connection to the console stream endpoint.
 * Manages connection lifecycle and message delivery.
 */
@Injectable({
  providedIn: 'root',
})
export class SseConsoleService {
  private readonly EventSourceClass = inject(EVENT_SOURCE_TOKEN);
  private readonly messagesSubject = new Subject<ConsoleMessage>();
  private readonly connectedSubject = signal<boolean>(false);
  private eventSource: InstanceType<EventSourceConstructor> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private apiKey: string | null = null;

  readonly messages$ = this.messagesSubject.asObservable();
  readonly connected = this.connectedSubject.asReadonly();

  /**
   * Opens the SSE connection to the console stream.
   *
   * @param apiKey Vault Sandbox API key for authentication.
   */
  connect(apiKey: string): void {
    this.apiKey = apiKey;
    this.closeEventSource();
    this.clearReconnectTimer();

    const url = `${environment.apiUrl}/sse-console/stream`;
    this.eventSource = new this.EventSourceClass(url, {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          headers: {
            ...init.headers,
            'x-api-key': apiKey,
          },
        }),
    });

    this.eventSource.onopen = () => {
      this.connectedSubject.set(true);
      this.reconnectAttempts = 0;
    };

    this.eventSource.onmessage = (event) => {
      try {
        const message: ConsoleMessage = JSON.parse(event.data);
        this.messagesSubject.next(message);
      } catch (error) {
        console.error('[SseConsole] Failed to parse message', error);
      }
    };

    this.eventSource.onerror = (error) => {
      console.error('[SseConsole] Connection error', error);
      this.connectedSubject.set(false);
      this.closeEventSource();

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    };
  }

  /**
   * Closes the SSE connection and clears reconnection timers.
   */
  disconnect(): void {
    this.clearReconnectTimer();
    this.closeEventSource();
    this.connectedSubject.set(false);
    this.apiKey = null;
    this.reconnectAttempts = 0;
  }

  /**
   * Closes the active SSE connection if present.
   */
  private closeEventSource(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  /**
   * Schedules a reconnection attempt if the SSE stream dropped.
   */
  private scheduleReconnect(): void {
    /* istanbul ignore if - defensive check for duplicate scheduling */
    if (this.reconnectTimer || !this.apiKey) {
      return;
    }

    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.apiKey) {
        this.connect(this.apiKey);
      }
    }, 2000);
  }

  /**
   * Clears any pending reconnection timer.
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
