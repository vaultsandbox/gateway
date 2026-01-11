import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { firstValueFrom } from 'rxjs/internal/firstValueFrom';
import { HttpErrorResponse } from '@angular/common/http';
import { VaultSandboxApi } from './vault-sandbox-api';
import { EncryptionService } from './encryption.service';
import { VaultSandbox, NewEmailEvent } from '../../../shared/services/vault-sandbox';
import { VsToast } from '../../../shared/services/vs-toast';
import { EmailItemModel, InboxModel } from '../interfaces';
import { MetadataNormalizer } from './helpers/metadata-normalizer.helper';
import { computeEmailsHash } from './helpers/emails-hash.helper';
import { InboxStateService } from './inbox-state.service';

/**
 * Service responsible for SSE subscriptions and real-time email synchronization.
 * Handles connecting to events and processing new email arrivals.
 */
@Injectable({
  providedIn: 'root',
})
export class InboxSyncService implements OnDestroy {
  private readonly api = inject(VaultSandboxApi);
  private readonly encryption = inject(EncryptionService);
  private readonly vaultSandbox = inject(VaultSandbox);
  private readonly toast = inject(VsToast);
  private readonly state = inject(InboxStateService);

  private readonly newEmailSub: Subscription;
  private readonly reconnectedSub: Subscription;

  constructor() {
    this.newEmailSub = this.vaultSandbox.newEmail$.subscribe((event) => {
      /* istanbul ignore next - defensive catch, handleNewEmail has its own error handling */
      this.handleNewEmail(event).catch((error) => {
        console.error('[InboxSyncService] Error handling SSE email event:', error);
      });
    });

    this.reconnectedSub = this.vaultSandbox.reconnected$.subscribe(() => {
      void this.syncAllInboxesAfterReconnect();
    });

    // Auto-subscribe if there are existing inboxes
    if (this.state.inboxes.length > 0) {
      void this.subscribeToAllInboxes();
    }
  }

  /**
   * Connects SSE to all known inboxes and synchronizes their emails.
   */
  async subscribeToAllInboxes(): Promise<void> {
    const inboxHashes = this.state.getInboxHashes();

    if (inboxHashes.length === 0) {
      this.vaultSandbox.disconnectEvents();
      return;
    }

    this.vaultSandbox.connectToEvents(inboxHashes);

    await Promise.all(
      inboxHashes.map((hash) =>
        this.loadEmailsForInbox(hash).catch((error) => {
          console.error(`[InboxSyncService] Error syncing inbox ${hash}:`, error);
        }),
      ),
    );
  }

  /**
   * Synchronizes and decrypts emails for a given inbox.
   * Computes local hash and compares with server to detect changes.
   * Handles both new emails and deletions.
   */
  async loadEmailsForInbox(inboxHash: string): Promise<void> {
    const inbox = this.state.getInboxSnapshot(inboxHash);
    if (!inbox) {
      console.error('[InboxSyncService] Cannot load emails: inbox not found', inboxHash);
      this.toast.showError('Error', 'Cannot load emails: inbox not found');
      return;
    }

    try {
      // Compute local hash from current email IDs
      const localEmailIds = inbox.emails.map((e) => e.id);
      const localHash = await computeEmailsHash(localEmailIds);

      // Get server hash
      const syncStatus = await firstValueFrom(this.api.getInboxSyncStatus(inbox.emailAddress));

      // If hashes match, inbox is in sync
      if (localHash === syncStatus.emailsHash) {
        return;
      }

      // Fetch full email list from server
      const serverEmails = await firstValueFrom(this.api.listEmails(inbox.emailAddress));
      const serverEmailIds = new Set(serverEmails.map((e) => e.id));
      const localEmailIdSet = new Set(localEmailIds);

      // Find new emails (on server but not local)
      const newEmails = serverEmails.filter((email) => !localEmailIdSet.has(email.id));

      // Decrypt new email metadata
      const decryptedNewEmails = await Promise.all<EmailItemModel>(
        newEmails.map(async (email) => {
          try {
            const decryptedMetadata = await this.encryption.decryptMetadata(email.encryptedMetadata, inbox.secretKey);

            return {
              id: email.id,
              encryptedMetadata: email.encryptedMetadata,
              decryptedMetadata: MetadataNormalizer.normalize(decryptedMetadata, inbox.emailAddress),
              isRead: email.isRead ?? false,
            };
          } catch (error) {
            console.error('[InboxSyncService] Error decrypting metadata for email:', email.id, error);
            return {
              id: email.id,
              encryptedMetadata: email.encryptedMetadata,
              isRead: email.isRead ?? false,
            };
          }
        }),
      );

      // Remove deleted emails (local but not on server)
      const remainingEmails = inbox.emails.filter((e) => serverEmailIds.has(e.id));

      // Update local state: prepend new emails, keep remaining
      const updatedEmails = [...decryptedNewEmails, ...remainingEmails];
      const updatedInbox: InboxModel = {
        ...inbox,
        emails: updatedEmails,
      };

      this.state.updateInbox(updatedInbox);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        console.warn('[InboxSyncService] Inbox not found on server (404), deleting local copy:', inbox.emailAddress);
        this.toast.showInboxDeleted(inbox.emailAddress);
        this.state.removeInbox(inboxHash);
        void this.subscribeToAllInboxes();
        return;
      }

      console.error('[InboxSyncService] Error loading emails:', error);
      throw error;
    }
  }

  /**
   * Disconnects SSE events.
   */
  disconnect(): void {
    this.vaultSandbox.disconnectEvents();
  }

  /**
   * Cleans up subscriptions and disconnects SSE when service is destroyed.
   */
  ngOnDestroy(): void {
    this.newEmailSub.unsubscribe();
    this.reconnectedSub.unsubscribe();
    this.vaultSandbox.disconnectEvents();
  }

  /**
   * Syncs all inboxes after SSE reconnection to catch emails missed during disconnection.
   */
  private async syncAllInboxesAfterReconnect(): Promise<void> {
    const inboxHashes = this.state.getInboxHashes();
    if (inboxHashes.length === 0) {
      return;
    }

    await Promise.all(
      inboxHashes.map((hash) =>
        this.loadEmailsForInbox(hash).catch((error) => {
          console.error(`[InboxSyncService] Error syncing inbox ${hash} after reconnect:`, error);
        }),
      ),
    );
  }

  /**
   * Handles new email SSE events by decrypting metadata and updating state.
   */
  private async handleNewEmail(event: NewEmailEvent): Promise<void> {
    const inbox = this.state.getInboxSnapshot(event.inboxId);
    if (!inbox) {
      return;
    }

    if (inbox.emails.some((email) => email.id === event.emailId)) {
      return;
    }

    let decryptedMetadata: Record<string, unknown> | null = null;
    try {
      decryptedMetadata = await this.encryption.decryptMetadata(event.encryptedMetadata, inbox.secretKey);
    } catch (error) {
      console.error('[InboxSyncService] Failed to decrypt SSE metadata:', error);
      decryptedMetadata = {
        from: 'unknown',
        to: inbox.emailAddress,
        subject: '(decryption failed)',
        receivedAt: new Date().toISOString(),
      };
    }

    const newEmail: EmailItemModel = {
      id: event.emailId,
      encryptedMetadata: event.encryptedMetadata,
      decryptedMetadata: MetadataNormalizer.normalize(decryptedMetadata, inbox.emailAddress),
      isRead: false,
    };

    const updatedInbox: InboxModel = {
      ...inbox,
      emails: [newEmail, ...inbox.emails],
    };

    this.state.updateInbox(updatedInbox);
    this.state.notifyNewEmail(newEmail);
  }
}
