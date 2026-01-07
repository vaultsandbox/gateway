import { Injectable, OnDestroy, Signal, computed, effect, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { Title } from '@angular/platform-browser';
import { EmailItemModel, InboxModel } from '../interfaces';
import { InboxStorageService } from './inbox-storage.service';

/**
 * Service responsible for managing inbox collection state.
 * Handles inbox selection, unread counts, and document title updates.
 */
@Injectable({
  providedIn: 'root',
})
export class InboxStateService implements OnDestroy {
  private readonly storage = inject(InboxStorageService);
  private readonly title = inject(Title);

  private readonly inboxesSignal = signal<InboxModel[]>([]);
  private readonly selectedInboxSignal = signal<InboxModel | null>(null);
  private readonly unreadCountMapSignal = computed<Record<string, number>>(() => {
    return this.inboxesSignal().reduce<Record<string, number>>((acc, inbox) => {
      acc[inbox.inboxHash] = inbox.emails.reduce((count, email) => (email.isRead ? count : count + 1), 0);
      return acc;
    }, {});
  });

  readonly totalUnreadCount = computed<number>(() =>
    Object.values(this.unreadCountMapSignal()).reduce((sum, count) => sum + count, 0),
  );

  private readonly inboxCreatedSubject = new Subject<InboxModel>();
  private readonly inboxDeletedSubject = new Subject<string>();
  private readonly inboxUpdatedSubject = new Subject<InboxModel>();
  private readonly newEmailArrivedSubject = new Subject<EmailItemModel>();

  /* istanbul ignore next - compile-time constant, fallback only used if title is empty */
  private readonly baseTitle = this.title.getTitle() || 'VaultSandbox';
  private readonly documentTitleEffect = effect(() => {
    const totalUnread = this.totalUnreadCount();
    this.title.setTitle(totalUnread > 0 ? `${this.baseTitle} (${totalUnread})` : this.baseTitle);
  });

  constructor() {
    const savedInboxes = this.storage.loadInboxes();
    if (savedInboxes.length > 0) {
      this.inboxesSignal.set(savedInboxes);
    }
  }

  /**
   * Returns the in-memory list of inbox models.
   */
  get inboxes(): InboxModel[] {
    return this.inboxesSignal();
  }

  /**
   * Readonly map of inboxHash to unread count, recomputed when inboxes change.
   */
  get unreadCountByInbox(): Signal<Record<string, number>> {
    return this.unreadCountMapSignal;
  }

  /**
   * Returns the unread count for a specific inbox from the computed map.
   */
  getUnreadCount(inboxHash: string): number {
    return this.unreadCountMapSignal()[inboxHash] ?? 0;
  }

  /**
   * Readonly signal for the currently selected inbox.
   */
  get selectedInbox(): Signal<InboxModel | null> {
    return this.selectedInboxSignal.asReadonly();
  }

  /**
   * Observable that emits when an inbox is created.
   */
  get inboxCreated$() {
    return this.inboxCreatedSubject.asObservable();
  }

  /**
   * Observable that emits when an inbox is deleted.
   */
  get inboxDeleted$() {
    return this.inboxDeletedSubject.asObservable();
  }

  /**
   * Observable that emits whenever an inbox is updated.
   */
  get inboxUpdated$() {
    return this.inboxUpdatedSubject.asObservable();
  }

  /**
   * Observable that emits when a new email is received via SSE.
   */
  get newEmailArrived$() {
    return this.newEmailArrivedSubject.asObservable();
  }

  /**
   * Sets the active inbox by hash if it exists.
   */
  selectInbox(inboxHash: string): void {
    const inbox = this.inboxesSignal().find((i) => i.inboxHash === inboxHash);
    if (inbox) {
      this.selectedInboxSignal.set(inbox);
    }
  }

  /**
   * Returns a copy of the inbox by hash without mutating state.
   */
  getInboxSnapshot(inboxHash: string): InboxModel | undefined {
    return this.inboxesSignal().find((inbox) => inbox.inboxHash === inboxHash);
  }

  /**
   * Returns all inbox hashes.
   */
  getInboxHashes(): string[] {
    return this.inboxesSignal().map((inbox) => inbox.inboxHash);
  }

  /**
   * Adds a new inbox to state and emits created event.
   */
  addInbox(inbox: InboxModel, options?: { persist?: boolean }): void {
    this.setInboxes([...this.inboxesSignal(), inbox], { persist: options?.persist ?? true });
    this.inboxCreatedSubject.next(inbox);
  }

  /**
   * Removes an inbox from state and emits deleted event.
   * Returns the remaining inboxes.
   */
  removeInbox(inboxHash: string): InboxModel[] {
    const inbox = this.inboxesSignal().find((i) => i.inboxHash === inboxHash);
    if (!inbox) {
      console.error('[InboxStateService] Cannot delete inbox: inbox not found', inboxHash);
      return this.inboxesSignal();
    }

    const updatedInboxes = this.inboxesSignal().filter((i) => i.inboxHash !== inboxHash);
    this.setInboxes(updatedInboxes, { persist: true });
    this.inboxDeletedSubject.next(inboxHash);

    /* istanbul ignore next - defensive, already handled by setInboxes */
    if (this.selectedInboxSignal()?.inboxHash === inboxHash) {
      this.selectedInboxSignal.set(updatedInboxes[0] ?? null);
    }

    return updatedInboxes;
  }

  /**
   * Updates an inbox in local state, persists if requested, and emits updates.
   */
  updateInbox(inbox: InboxModel, options?: { persist?: boolean }): void {
    const inboxes = this.inboxesSignal();
    const updated = inboxes.map((existing) => (existing.inboxHash === inbox.inboxHash ? inbox : existing));
    this.setInboxes(updated, { persist: options?.persist ?? false });
    this.inboxUpdatedSubject.next(inbox);
  }

  /**
   * Emits a new email arrived event.
   */
  notifyNewEmail(email: EmailItemModel): void {
    this.newEmailArrivedSubject.next(email);
  }

  /**
   * Clears all inbox and settings data from storage.
   */
  clearLocalStorage(): void {
    this.storage.clearStorage();
  }

  /**
   * Cleans up the document title effect when service is destroyed.
   */
  ngOnDestroy(): void {
    this.documentTitleEffect.destroy();
  }

  /**
   * Centralized setter for inbox state, maintaining selection and persistence.
   */
  private setInboxes(inboxes: InboxModel[], options?: { persist?: boolean }): void {
    this.inboxesSignal.set(inboxes);

    const selectedHash = this.selectedInboxSignal()?.inboxHash;
    if (selectedHash) {
      const selected = inboxes.find((inbox) => inbox.inboxHash === selectedHash) ?? null;
      this.selectedInboxSignal.set(selected ? { ...selected } : null);
    }

    if (options?.persist) {
      this.storage.saveInboxes(inboxes);
    }
  }
}
