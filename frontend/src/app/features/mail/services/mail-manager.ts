import { Injectable, Signal, inject } from '@angular/core';
import { EmailItemModel, ExportedInboxData, InboxModel } from '../interfaces';
import { InboxService } from './inbox.service';
import { EmailService } from './email.service';

@Injectable({
  providedIn: 'root',
})
export class MailManager {
  private readonly inboxService = inject(InboxService);
  private readonly emailService = inject(EmailService);

  /**
   * Returns currently loaded inboxes from the inbox service.
   */
  get inboxes(): InboxModel[] {
    return this.inboxService.inboxes;
  }

  /**
   * Readonly computed map of inboxHash to unread counts.
   */
  get unreadCountByInbox() {
    return this.inboxService.unreadCountByInbox;
  }

  /**
   * Gets the unread count for a given inbox from the computed map.
   */
  getUnreadCount(inboxHash: string): number {
    return this.inboxService.getUnreadCount(inboxHash);
  }

  /**
   * Signal tracking the currently selected inbox.
   */
  get selectedInbox(): Signal<InboxModel | null> {
    return this.inboxService.selectedInbox;
  }

  /**
   * Signal tracking the currently selected email within an inbox.
   */
  get selectedEmail(): Signal<EmailItemModel | null> {
    return this.emailService.selectedEmail;
  }

  /**
   * Creates a new inbox with an optional email, TTL, and encryption preference.
   * @param emailAddress Optional desired email address.
   * @param ttlSeconds Optional time-to-live override for the inbox.
   * @param encryption Optional encryption preference: 'encrypted' | 'plain'. Omit to use server default.
   * @param emailAuth Optional email auth preference: true/false. Omit to use server default.
   * @param spamAnalysis Optional spam analysis preference: true/false. Omit to use server default.
   */
  createInbox(
    emailAddress?: string,
    ttlSeconds?: number,
    encryption?: 'encrypted' | 'plain',
    emailAuth?: boolean,
    spamAnalysis?: boolean,
  ): Promise<{ created: boolean; email: string }> {
    return this.inboxService.createInbox(emailAddress, ttlSeconds, encryption, emailAuth, spamAnalysis);
  }

  /**
   * Subscribes to server events for all known inbox hashes.
   */
  subscribeToAllInboxes(): Promise<void> {
    return this.inboxService.subscribeToAllInboxes();
  }

  /**
   * Selects an inbox and clears any email selection.
   */
  selectInbox(inboxHash: string): void {
    this.inboxService.selectInbox(inboxHash);
    this.emailService.deselectEmail();
  }

  /**
   * Deletes an inbox and clears any email selection.
   */
  deleteInbox(inboxHash: string): void {
    this.inboxService.deleteInbox(inboxHash);
    this.emailService.deselectEmail();
  }

  /**
   * Exports inbox metadata for backup if available.
   */
  exportInboxMetadata(inboxHash: string): ExportedInboxData | null {
    return this.inboxService.exportInboxMetadata(inboxHash);
  }

  /**
   * Clears all stored inbox data from local storage.
   */
  clearLocalStorage(): void {
    this.inboxService.clearLocalStorage();
  }

  /**
   * Imports a single inbox payload from exported data.
   */
  importInbox(importData: ExportedInboxData): { success: boolean; message: string; emailAddress?: string } {
    return this.inboxService.importInbox(importData);
  }

  /**
   * Imports multiple inbox export files and returns per-file results.
   */
  importMultipleInboxes(
    files: File[],
  ): Promise<{ filename: string; success: boolean; message: string; emailAddress?: string }[]> {
    return this.inboxService.importMultipleInboxes(files);
  }

  /**
   * Selects the inbox and specific email by id.
   */
  selectEmail(inboxHash: string, emailId: string): void {
    this.inboxService.selectInbox(inboxHash);
    this.emailService.selectEmail(inboxHash, emailId);
  }

  /**
   * Clears the current email selection.
   */
  deselectEmail(): void {
    this.emailService.deselectEmail();
  }

  /**
   * Loads and decrypts a specific email's metadata and content.
   */
  fetchAndDecryptEmail(inboxHash: string, emailId: string): Promise<void> {
    return this.emailService.fetchAndDecryptEmail(inboxHash, emailId);
  }

  /**
   * Loads and decrypts a raw email for download or export.
   */
  fetchAndDecryptRawEmail(inboxHash: string, emailId: string): Promise<string> {
    return this.emailService.fetchAndDecryptRawEmail(inboxHash, emailId);
  }

  /**
   * Marks a specific email as read in the backend and state.
   */
  markEmailAsRead(inboxHash: string, emailId: string): Promise<void> {
    return this.emailService.markEmailAsRead(inboxHash, emailId);
  }

  /**
   * Deletes an email from an inbox and clears selection if needed.
   */
  deleteEmail(inboxHash: string, emailId: string): void {
    this.emailService.deleteEmail(inboxHash, emailId);
  }

  /**
   * Loads emails for a given inbox hash and updates local state.
   */
  loadEmailsForInbox(inboxHash: string): Promise<void> {
    return this.inboxService.loadEmailsForInbox(inboxHash);
  }
}
