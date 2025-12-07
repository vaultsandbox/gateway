import { Injectable, OnDestroy, Signal, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs/internal/firstValueFrom';
import { VaultSandboxApi } from './vault-sandbox-api';
import { SettingsManager } from './settings-manager';
import { EncryptionService } from './encryption.service';
import { VsToast } from '../../../shared/services/vs-toast';
import { ExportedInboxData, InboxModel } from '../interfaces';
import { InboxStateService } from './inbox-state.service';
import { InboxSyncService } from './inbox-sync.service';
import { InboxImportExportService } from './inbox-import-export.service';

/**
 * Facade service for inbox operations.
 * Delegates to specialized services for state management, sync, and import/export.
 */
@Injectable({
  providedIn: 'root',
})
export class InboxService implements OnDestroy {
  private readonly api = inject(VaultSandboxApi);
  private readonly settingsManager = inject(SettingsManager);
  private readonly encryption = inject(EncryptionService);
  private readonly toast = inject(VsToast);
  private readonly state = inject(InboxStateService);
  private readonly sync = inject(InboxSyncService);
  private readonly importExport = inject(InboxImportExportService);

  readonly totalUnreadCount = this.state.totalUnreadCount;

  /**
   * Returns the in-memory list of inbox models.
   */
  get inboxes(): InboxModel[] {
    return this.state.inboxes;
  }

  /**
   * Readonly map of inboxHash to unread count, recomputed when inboxes change.
   */
  get unreadCountByInbox(): Signal<Record<string, number>> {
    return this.state.unreadCountByInbox;
  }

  /**
   * Returns the unread count for a specific inbox from the computed map.
   */
  getUnreadCount(inboxHash: string): number {
    return this.state.getUnreadCount(inboxHash);
  }

  /**
   * Readonly signal for the currently selected inbox.
   */
  get selectedInbox(): Signal<InboxModel | null> {
    return this.state.selectedInbox;
  }

  /**
   * Observable that emits when an inbox is created.
   */
  get inboxCreated$() {
    return this.state.inboxCreated$;
  }

  /**
   * Observable that emits when an inbox is deleted.
   */
  get inboxDeleted$() {
    return this.state.inboxDeleted$;
  }

  /**
   * Observable that emits whenever an inbox is updated.
   */
  get inboxUpdated$() {
    return this.state.inboxUpdated$;
  }

  /**
   * Observable that emits when a new email is received via SSE.
   */
  get newEmailArrived$() {
    return this.state.newEmailArrived$;
  }

  /**
   * Creates a new inbox using generated keys and subscribes to events for it.
   * @param emailAddress Optional desired email address.
   * @param ttlSeconds Optional time-to-live override for the inbox.
   */
  async createInbox(emailAddress?: string, ttlSeconds?: number): Promise<{ created: boolean; email: string }> {
    try {
      const keypair = this.encryption.generateKeypair();
      const ttl = ttlSeconds ?? (await this.settingsManager.getTtlSetting()).ttlSeconds;

      const result = await firstValueFrom(this.api.createInbox(keypair.publicKeyB64, ttl, emailAddress));

      const inbox: InboxModel = {
        emailAddress: result.emailAddress,
        expiresAt: result.expiresAt,
        inboxHash: result.inboxHash,
        serverSigPk: result.serverSigPk,
        secretKey: keypair.secretKey,
        emails: [],
      };

      this.state.addInbox(inbox, { persist: true });

      await this.sync.subscribeToAllInboxes();
      this.state.selectInbox(inbox.inboxHash);

      return { created: true, email: inbox.emailAddress };
    } catch (error) {
      console.error('[InboxService] Error creating inbox:', error);
      this.toast.showError('Inbox Creation Failed', 'Unable to create inbox. Please try again.');
      return { created: false, email: '' };
    }
  }

  /**
   * Connects SSE to all known inboxes and synchronizes their emails.
   */
  async subscribeToAllInboxes(): Promise<void> {
    return this.sync.subscribeToAllInboxes();
  }

  /**
   * Sets the active inbox by hash if it exists.
   * @param inboxHash Hash of the inbox to select.
   */
  selectInbox(inboxHash: string): void {
    this.state.selectInbox(inboxHash);
  }

  /**
   * Deletes an inbox, updates storage, and adjusts selection.
   * @param inboxHash Hash of the inbox to delete.
   */
  deleteInbox(inboxHash: string): void {
    this.state.removeInbox(inboxHash);
    void this.sync.subscribeToAllInboxes();
  }

  /**
   * Exports metadata for the specified inbox for backup purposes.
   * @param inboxHash Hash of the inbox to export.
   */
  exportInboxMetadata(inboxHash: string): ExportedInboxData | null {
    return this.importExport.exportInboxMetadata(inboxHash);
  }

  /**
   * Imports a single inbox record and persists it when valid.
   * @param importData Serialized inbox payload to import.
   */
  importInbox(importData: ExportedInboxData): { success: boolean; message: string; emailAddress?: string } {
    return this.importExport.importInbox(importData);
  }

  /**
   * Imports multiple inbox files and returns per-file outcomes.
   * @param files Files selected by the user, each containing inbox data.
   */
  async importMultipleInboxes(
    files: File[],
  ): Promise<{ filename: string; success: boolean; message: string; emailAddress?: string }[]> {
    return this.importExport.importMultipleInboxes(files);
  }

  /**
   * Clears all inbox and settings data from storage.
   */
  clearLocalStorage(): void {
    this.state.clearLocalStorage();
  }

  /**
   * Synchronizes and decrypts emails for a given inbox.
   * @param inboxHash Hash of the inbox to sync.
   */
  async loadEmailsForInbox(inboxHash: string): Promise<void> {
    return this.sync.loadEmailsForInbox(inboxHash);
  }

  /**
   * Returns a copy of the inbox by hash without mutating state.
   * @param inboxHash Hash of the inbox to retrieve.
   */
  getInboxSnapshot(inboxHash: string): InboxModel | undefined {
    return this.state.getInboxSnapshot(inboxHash);
  }

  /**
   * Updates an inbox in local state, persists if requested, and emits updates.
   * @param inbox Modified inbox model to set.
   * @param options Optional persistence options.
   */
  emitInboxUpdate(inbox: InboxModel, options?: { persist?: boolean }): void {
    this.state.updateInbox(inbox, options);
  }

  /**
   * Cleans up subscriptions and disconnects SSE when service is destroyed.
   */
  ngOnDestroy(): void {
    this.sync.disconnect();
  }
}
