import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { EventSource } from 'eventsource';
import { environment } from '../../../environments/environment';
import { EncryptedPayload } from '../interfaces/encrypted-payload';

/**
 * Event payload delivered when a new encrypted email arrives via SSE.
 */
export interface NewEmailEvent {
  inboxId: string;
  emailId: string;
  encryptedMetadata: EncryptedPayload; // End-to-end encrypted metadata payload
}

/**
 * Handles persistence of the Vault Sandbox API key and manages the SSE connection.
 */
@Injectable({
  providedIn: 'root',
})
export class VaultSandbox {
  private readonly STORAGE_KEY = 'vaultsandbox_api_key';

  private readonly apiKeySignal = signal<string | null>(this.getStoredApiKey());
  private readonly newEmailSubject = new Subject<NewEmailEvent>();
  private readonly reconnectedSubject = new Subject<void>();
  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private trackedInboxIds: string[] = [];

  readonly apiKey = this.apiKeySignal.asReadonly();
  readonly newEmail$ = this.newEmailSubject.asObservable();
  readonly reconnected$ = this.reconnectedSubject.asObservable();

  /**
   * Reads the persisted API key from `localStorage`.
   *
   * @returns Stored API key or null when unavailable.
   */
  private getStoredApiKey(): string | null {
    /* istanbul ignore else - SSR guard, always true in browser */
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem(this.STORAGE_KEY);
    }
    /* istanbul ignore next - SSR fallback */
    return null;
  }

  /**
   * Persists the provided API key and reconnects to the SSE stream if needed.
   *
   * @param key Vault Sandbox API key.
   */
  setApiKey(key: string): void {
    /* istanbul ignore else - SSR guard, always true in browser */
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(this.STORAGE_KEY, key);
      this.apiKeySignal.set(key);
      if (this.trackedInboxIds.length > 0) {
        this.connectToEvents(this.trackedInboxIds);
      }
    }
  }

  /**
   * Checks whether an API key exists in memory.
   *
   * @returns True when an API key is available.
   */
  hasApiKey(): boolean {
    return !!this.apiKey();
  }

  /**
   * Removes the stored API key and tears down any open SSE connection.
   */
  clearApiKey(): void {
    /* istanbul ignore else - SSR guard, always true in browser */
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(this.STORAGE_KEY);
      this.apiKeySignal.set(null);
      this.disconnectEvents();
    }
  }

  /**
   * Opens the SSE connection for the provided inbox IDs.
   *
   * @param inboxIds List of inbox hashes to subscribe to.
   */
  connectToEvents(inboxIds: string[]): void {
    this.trackedInboxIds = Array.from(new Set(inboxIds));

    if (this.trackedInboxIds.length === 0) {
      this.disconnectEvents();
      return;
    }

    const apiKey = this.apiKey();
    if (!apiKey) {
      console.warn('Cannot connect to events without an API key');
      return;
    }

    const params = new URLSearchParams();
    params.set('inboxes', this.trackedInboxIds.join(','));

    this.closeEventSource();
    this.clearReconnectTimer();

    this.eventSource = new EventSource(`${environment.apiUrl}/events?${params.toString()}`, {
      /* istanbul ignore next 7 - internal EventSource fetch callback */
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          headers: {
            ...init.headers,
            'x-api-key': apiKey,
          },
        }),
    });

    /* istanbul ignore next 8 - internal SSE message handler */
    this.eventSource.onmessage = (event) => {
      try {
        const payload: NewEmailEvent = JSON.parse(event.data);
        this.newEmailSubject.next(payload);
      } catch (error) {
        console.error('Failed to parse SSE payload', error);
      }
    };

    /* istanbul ignore next 5 - internal SSE error handler */
    this.eventSource.onerror = (error) => {
      console.error('[VaultSandbox] SSE connection error', error);
      this.closeEventSource();
      this.scheduleReconnect();
    };
  }

  /**
   * Stops receiving events and clears all reconnection timers.
   */
  disconnectEvents(): void {
    this.trackedInboxIds = [];
    this.clearReconnectTimer();
    this.closeEventSource();
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
  /* istanbul ignore next 13 - reconnection timer logic, tested via integration */
  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.trackedInboxIds.length === 0) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.trackedInboxIds.length > 0) {
        this.connectToEvents(this.trackedInboxIds);
        this.reconnectedSubject.next();
      }
    }, 2000);
  }

  /**
   * Clears any pending reconnection timer.
   */
  private clearReconnectTimer(): void {
    /* istanbul ignore if - timer only set via SSE error handler */
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
