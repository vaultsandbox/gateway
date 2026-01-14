import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, Signal, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs/internal/firstValueFrom';
import { EncryptionService } from './encryption.service';
import { VaultSandboxApi } from './vault-sandbox-api';
import { VsToast } from '../../../shared/services/vs-toast';
import { EmailItemModel, InboxModel, ParsedEmailContent } from '../interfaces';
import { InboxService } from './inbox.service';

@Injectable({
  providedIn: 'root',
})
export class EmailService {
  private readonly api = inject(VaultSandboxApi);
  private readonly encryption = inject(EncryptionService);
  private readonly toast = inject(VsToast);
  private readonly inboxService = inject(InboxService);

  private readonly selectedEmailSignal = signal<EmailItemModel | null>(null);

  /**
   * Readonly signal for the currently selected email.
   */
  get selectedEmail(): Signal<EmailItemModel | null> {
    return this.selectedEmailSignal.asReadonly();
  }

  /**
   * Sets the selected email by inbox hash and email id.
   * @param inboxHash Hash of the inbox containing the email.
   * @param emailId Identifier of the email to select.
   */
  selectEmail(inboxHash: string, emailId: string): void {
    const inbox = this.inboxService.getInboxSnapshot(inboxHash);
    if (!inbox) {
      console.error('[EmailService] Cannot select email: inbox not found', inboxHash);
      this.toast.showError('Error', 'Cannot select email: inbox not found');
      return;
    }

    const email = inbox.emails.find((e) => e.id === emailId);
    if (!email) {
      console.error('[EmailService] Cannot select email: email not found', emailId);
      this.toast.showError('Error', 'Cannot select email: email not found');
      return;
    }

    this.selectedEmailSignal.set(email);
  }

  /**
   * Clears the current email selection.
   */
  deselectEmail(): void {
    this.selectedEmailSignal.set(null);
  }

  /**
   * Fetches an email body, decrypts it, parses content, and updates state.
   * @param inboxHash Hash of the inbox containing the email.
   * @param emailId Identifier of the email to fetch.
   */
  async fetchAndDecryptEmail(inboxHash: string, emailId: string): Promise<void> {
    const inbox = this.inboxService.getInboxSnapshot(inboxHash);
    if (!inbox) {
      console.error('[EmailService] Cannot fetch email: inbox not found', inboxHash);
      this.toast.showError('Error', 'Cannot load email: inbox not found');
      return;
    }

    const email = inbox.emails.find((e) => e.id === emailId);
    if (!email) {
      console.error('[EmailService] Cannot fetch email: email not found', emailId);
      this.toast.showError('Error', 'Cannot load email: email not found');
      return;
    }

    if (email.parsedContent) {
      return;
    }

    try {
      email.isLoadingBody = true;
      this.emitInboxUpdate(inbox, email);

      const result = await firstValueFrom(this.api.getEmail(inbox.emailAddress, emailId));

      let bodyJson: string;

      if (inbox.encrypted && inbox.secretKey) {
        // Encrypted inbox: decrypt content
        const encryptedContent = result.encryptedParsed || result.encryptedBody;
        if (!encryptedContent) {
          throw new Error('Neither encryptedParsed nor encryptedBody found in API response');
        }
        bodyJson = await this.encryption.decryptBody(encryptedContent, inbox.secretKey);
      } else {
        // Plain inbox: decode base64 content
        const plainContent = result.parsed;
        if (!plainContent) {
          throw new Error('Parsed content not found in API response for plain inbox');
        }
        bodyJson = atob(plainContent);
      }

      email.decryptedBody = bodyJson;

      try {
        const parsedContent = JSON.parse(bodyJson) as ParsedEmailContent;
        email.parsedContent = parsedContent;
      } catch (parseError) {
        console.error('[EmailService] Failed to parse email body JSON', parseError);
        email.parsedContent = undefined;
      }

      this.emitInboxUpdate(inbox, email);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        console.warn('[EmailService] Inbox not found on server (404), deleting local copy:', inbox.emailAddress);
        this.toast.showInboxDeleted(inbox.emailAddress);
        this.inboxService.deleteInbox(inboxHash);
        return;
      }

      console.error('[EmailService] Error fetching/decrypting email:', error);
      throw error;
    } finally {
      email.isLoadingBody = false;
      this.emitInboxUpdate(inbox, email);
    }
  }

  /**
   * Retrieves a raw email payload, decrypts it, and returns the raw content.
   * @param inboxHash Hash of the inbox containing the email.
   * @param emailId Identifier of the email to fetch.
   */
  async fetchAndDecryptRawEmail(inboxHash: string, emailId: string): Promise<string> {
    const inbox = this.inboxService.getInboxSnapshot(inboxHash);
    if (!inbox) {
      console.error('[EmailService] Cannot fetch raw email: inbox not found', inboxHash);
      this.toast.showError('Error', 'Cannot load raw email: inbox not found');
      throw new Error('Inbox not found');
    }

    try {
      const result = await firstValueFrom(this.api.getRawEmail(inbox.emailAddress, emailId));

      let rawContent: string;
      if (inbox.encrypted && inbox.secretKey && result.encryptedRaw) {
        // Encrypted inbox: decrypt raw content
        rawContent = await this.encryption.decryptBody(result.encryptedRaw, inbox.secretKey);
      } else if ('raw' in result && typeof result.raw === 'string') {
        // Plain inbox: decode base64 raw content
        rawContent = atob(result.raw as string);
      } else {
        throw new Error('No raw content found in API response');
      }

      return rawContent;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        console.warn('[EmailService] Inbox not found on server (404), deleting local copy:', inbox.emailAddress);
        this.toast.showInboxDeleted(inbox.emailAddress);
        this.inboxService.deleteInbox(inboxHash);
        throw error;
      }
      console.error('[EmailService] Error fetching/decrypting raw email:', error);
      throw error;
    }
  }

  /**
   * Marks an email as read both locally and on the server.
   * @param inboxHash Hash of the inbox containing the email.
   * @param emailId Identifier of the email to mark.
   */
  async markEmailAsRead(inboxHash: string, emailId: string): Promise<void> {
    const inbox = this.inboxService.getInboxSnapshot(inboxHash);
    if (!inbox) {
      console.error('[EmailService] Cannot mark email as read: inbox not found', inboxHash);
      this.toast.showError('Error', 'Cannot mark email as read: inbox not found');
      return;
    }

    const email = inbox.emails.find((e) => e.id === emailId);
    if (!email) {
      console.error('[EmailService] Cannot mark email as read: email not found', emailId);
      this.toast.showError('Error', 'Cannot mark email as read: email not found');
      return;
    }

    if (email.isRead) {
      return;
    }

    try {
      const updatedEmail: EmailItemModel = { ...email, isRead: true };
      const updatedInbox: InboxModel = {
        ...inbox,
        emails: inbox.emails.map((e) => (e.id === emailId ? updatedEmail : e)),
      };
      this.emitInboxUpdate(updatedInbox, updatedEmail);

      await firstValueFrom(this.api.markEmailAsRead(inbox.emailAddress, emailId));
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        console.warn('[EmailService] Inbox not found on server (404), deleting local copy:', inbox.emailAddress);
        this.toast.showInboxDeleted(inbox.emailAddress);
        this.inboxService.deleteInbox(inboxHash);
        return;
      }

      console.error('[EmailService] Error marking email as read:', error);
      const revertedInbox: InboxModel = {
        ...inbox,
        emails: inbox.emails.map((e) => (e.id === emailId ? email : e)),
      };
      this.emitInboxUpdate(revertedInbox, email);
    }
  }

  /**
   * Deletes an email from the inbox and clears selection if it was active.
   * @param inboxHash Hash of the inbox containing the email.
   * @param emailId Identifier of the email to delete.
   */
  deleteEmail(inboxHash: string, emailId: string): void {
    const inbox = this.inboxService.getInboxSnapshot(inboxHash);
    if (!inbox) {
      console.error('[EmailService] Cannot delete email: inbox not found', inboxHash);
      this.toast.showError('Error', 'Cannot delete email: inbox not found');
      return;
    }

    const emailIndex = inbox.emails.findIndex((e) => e.id === emailId);
    if (emailIndex === -1) {
      console.error('[EmailService] Cannot delete email: email not found', emailId);
      this.toast.showError('Error', 'Cannot delete email: email not found');
      return;
    }

    const updatedEmails = inbox.emails.filter((e) => e.id !== emailId);
    const updatedInbox: InboxModel = { ...inbox, emails: updatedEmails };
    this.emitInboxUpdate(updatedInbox, this.selectedEmailSignal());

    if (this.selectedEmailSignal()?.id === emailId) {
      this.deselectEmail();
    }
  }

  /**
   * Emits inbox updates and mirrors selected email state when necessary.
   * @param inbox Inbox to update.
   * @param email Optional email to refresh selection with.
   */
  private emitInboxUpdate(inbox: InboxModel, email?: EmailItemModel | null): void {
    this.inboxService.emitInboxUpdate(inbox);
    if (email && this.selectedEmailSignal()?.id === email.id) {
      this.selectedEmailSignal.set({ ...email });
    }
  }
}
