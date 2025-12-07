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

  constructor() {
    this.newEmailSub = this.vaultSandbox.newEmail$.subscribe((event) => {
      this.handleNewEmail(event).catch((error) => {
        console.error('[InboxSyncService] Error handling SSE email event:', error);
      });
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
   */
  async loadEmailsForInbox(inboxHash: string): Promise<void> {
    const inbox = this.state.getInboxSnapshot(inboxHash);
    if (!inbox) {
      console.error('[InboxSyncService] Cannot load emails: inbox not found', inboxHash);
      this.toast.showError('Error', 'Cannot load emails: inbox not found');
      return;
    }

    try {
      const syncStatus = await firstValueFrom(this.api.getInboxSyncStatus(inbox.emailAddress));

      if (inbox.emailsHash && inbox.emailsHash === syncStatus.emailsHash) {
        return;
      }

      const result = await firstValueFrom(this.api.listEmails(inbox.emailAddress));
      const existingEmailIds = new Set(inbox.emails.map((e) => e.id));
      const newEmails = result.filter((email) => !existingEmailIds.has(email.id));

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

      const updatedEmails = decryptedNewEmails.length > 0 ? [...decryptedNewEmails, ...inbox.emails] : inbox.emails;
      const updatedInbox: InboxModel = {
        ...inbox,
        emails: updatedEmails,
        emailsHash: syncStatus.emailsHash,
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
    this.vaultSandbox.disconnectEvents();
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
