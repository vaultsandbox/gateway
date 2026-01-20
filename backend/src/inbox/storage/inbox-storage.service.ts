import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Inbox, StoredEmail } from '../interfaces';
import type { IWebhookStorageService } from '../../webhook/interfaces/webhook.interface';

// Interface for EmailStorageService to avoid circular dependency
interface IEmailStorageService {
  onInboxDeleted(inboxEmail: string): void;
  onEmailDeleted(inboxEmail: string, emailId: string): void;
}

@Injectable()
export class InboxStorageService {
  private readonly logger = new Logger(InboxStorageService.name);
  private inboxes: Map<string, Inbox> = new Map(); // Map<emailAddress, Inbox>
  private inboxHashToEmail = new Map<string, string>(); // Map<inboxHash, emailAddress>
  private emailStorageService?: IEmailStorageService; // Will be set by EmailStorageService to avoid circular dependency
  private webhookStorageService?: IWebhookStorageService; // Will be set by WebhookStorageService to avoid circular dependency

  /**
   * Update the emailsHash for an inbox based on its current email IDs
   */
  private _updateEmailsHash(inbox: Inbox): void {
    const emailIds = Array.from(inbox.emails.keys()).sort();
    const hash = createHash('sha256').update(emailIds.join(',')).digest('base64url');
    inbox.emailsHash = hash;
  }

  /**
   * Create a new inbox
   */
  createInbox(
    emailAddress: string,
    clientKemPk: string | undefined,
    expiresAt: Date,
    inboxHash: string,
    encrypted: boolean,
    emailAuth: boolean,
    spamAnalysis?: boolean,
  ): Inbox {
    // Normalize email to lowercase for case-insensitive lookups
    const normalizedEmail = emailAddress.toLowerCase();

    // Check for duplicate inboxHash (prevents KEM key reuse for encrypted, email reuse for plain)
    if (this.inboxHashToEmail.has(inboxHash)) {
      const existingEmail = this.inboxHashToEmail.get(inboxHash);
      this.logger.warn(
        `Duplicate inboxHash detected: ${inboxHash} (existing inbox: ${existingEmail}, attempted: ${normalizedEmail})`,
      );
      throw new ConflictException(
        encrypted
          ? 'An inbox with the same client KEM public key already exists. Use a unique key pair.'
          : 'An inbox with this email address already exists.',
      );
    }

    const inbox: Inbox = {
      emailAddress: normalizedEmail,
      clientKemPk,
      inboxHash,
      encrypted,
      emailAuth,
      spamAnalysis,
      createdAt: new Date(),
      expiresAt,
      emails: new Map(),
      emailsHash: '', // Will be calculated by _updateEmailsHash
    };

    this.inboxes.set(normalizedEmail, inbox);
    this.inboxHashToEmail.set(inboxHash, normalizedEmail);
    this._updateEmailsHash(inbox); // Initialize emailsHash for empty inbox
    this.logger.log(
      `Inbox created: ${normalizedEmail} (encrypted=${encrypted}, emailAuth=${emailAuth}), expires at ${expiresAt.toISOString()}`,
    );
    return inbox;
  }

  /**
   * Get inbox by email address
   */
  getInbox(emailAddress: string): Inbox | undefined {
    // Normalize email to lowercase for case-insensitive lookups
    return this.inboxes.get(emailAddress.toLowerCase());
  }

  /**
   * Get all inboxes (for cleanup job)
   */
  getAllInboxes(): Inbox[] {
    return Array.from(this.inboxes.values());
  }

  /**
   * Set the EmailStorageService reference for deletion notifications.
   * Called by EmailStorageService to register itself (avoids circular dependency).
   *
   * @param service - EmailStorageService instance
   */
  setEmailStorageService(service: IEmailStorageService): void {
    this.emailStorageService = service;
  }

  /**
   * Set the WebhookStorageService reference for deletion notifications.
   * Called by WebhookStorageService to register itself (avoids circular dependency).
   *
   * @param service - WebhookStorageService instance
   */
  setWebhookStorageService(service: IWebhookStorageService): void {
    this.webhookStorageService = service;
  }

  /**
   * Delete inbox and all associated emails
   */
  deleteInbox(emailAddress: string): boolean {
    // Normalize email to lowercase for case-insensitive lookups
    const normalizedEmail = emailAddress.toLowerCase();
    const inbox = this.inboxes.get(normalizedEmail);
    if (!inbox) {
      return true; // Already Deleted
    }
    const deleted = this.inboxes.delete(normalizedEmail);
    if (deleted) {
      this.inboxHashToEmail.delete(inbox.inboxHash);
      this.logger.log(`Inbox deleted: ${normalizedEmail}`);

      // Notify EmailStorageService if available (for memory tracking)
      if (this.emailStorageService) {
        this.emailStorageService.onInboxDeleted(normalizedEmail);
      }

      // Notify WebhookStorageService if available (for cascading webhook deletion)
      if (this.webhookStorageService) {
        this.webhookStorageService.onInboxDeleted(inbox.inboxHash);
      }
    }
    return deleted;
  }

  /**
   * Delete a single email from an inbox
   */
  deleteEmail(emailAddress: string, emailId: string): boolean {
    const normalizedEmail = emailAddress.toLowerCase();
    const inbox = this.inboxes.get(normalizedEmail);
    if (!inbox) {
      throw new NotFoundException(`Inbox not found: ${normalizedEmail}`);
    }

    const deleted = inbox.emails.delete(emailId);
    if (!deleted) {
      throw new NotFoundException(`Email not found: ${emailId}`);
    }

    this._updateEmailsHash(inbox); // Update hash after deleting email
    this.logger.log(`Email ${emailId} deleted from inbox ${normalizedEmail}`);

    // Notify EmailStorageService if available (for memory tracking)
    if (this.emailStorageService) {
      this.emailStorageService.onEmailDeleted(normalizedEmail, emailId);
    }

    return deleted;
  }

  /**
   * Remove an email due to eviction (tombstone) without surfacing it to clients.
   * Does not throw if the inbox/email is already gone.
   */
  evictEmail(emailAddress: string, emailId: string): void {
    const normalizedEmail = emailAddress.toLowerCase();
    const inbox = this.inboxes.get(normalizedEmail);
    if (!inbox) {
      this.logger.warn(`Inbox not found during eviction: ${normalizedEmail}`);
      return;
    }

    const removed = inbox.emails.delete(emailId);
    if (removed) {
      this._updateEmailsHash(inbox);
      this.logger.log(`Email ${emailId} evicted from inbox ${normalizedEmail}`);
    } else {
      this.logger.warn(`Email ${emailId} not found during eviction in inbox ${normalizedEmail}`);
    }
  }

  /**
   * Add email to inbox (supports both encrypted and plain emails)
   */
  addEmail(emailAddress: string, email: StoredEmail): void {
    // Normalize email to lowercase for case-insensitive lookups
    const normalizedEmail = emailAddress.toLowerCase();
    const inbox = this.inboxes.get(normalizedEmail);
    if (!inbox) {
      throw new NotFoundException(`Inbox not found: ${normalizedEmail}`);
    }

    inbox.emails.set(email.id, email);
    this._updateEmailsHash(inbox); // Update hash after adding email
    this.logger.log(`Email ${email.id} added to inbox ${normalizedEmail}`);
  }

  /**
   * Get all emails for an inbox (newest first)
   */
  getEmails(emailAddress: string): StoredEmail[] {
    // Normalize email to lowercase for case-insensitive lookups
    const normalizedEmail = emailAddress.toLowerCase();
    const inbox = this.inboxes.get(normalizedEmail);
    if (!inbox) {
      throw new NotFoundException(`Inbox not found: ${normalizedEmail}`);
    }

    // Return emails in reverse order (newest first, since Map maintains insertion order)
    return Array.from(inbox.emails.values()).reverse();
  }

  /**
   * Get a specific email
   */
  getEmail(emailAddress: string, emailId: string): StoredEmail {
    // Normalize email to lowercase for case-insensitive lookups
    const normalizedEmail = emailAddress.toLowerCase();
    const inbox = this.inboxes.get(normalizedEmail);
    if (!inbox) {
      throw new NotFoundException(`Inbox not found: ${normalizedEmail}`);
    }

    const email = inbox.emails.get(emailId);
    if (!email) {
      throw new NotFoundException(`Email not found: ${emailId}`);
    }

    return email;
  }

  /**
   * Mark an email as read
   */
  markEmailAsRead(emailAddress: string, emailId: string): void {
    const normalizedEmail = emailAddress.toLowerCase();
    const inbox = this.inboxes.get(normalizedEmail);
    if (!inbox) {
      throw new NotFoundException(`Inbox not found: ${normalizedEmail}`);
    }

    const email = inbox.emails.get(emailId);
    if (!email) {
      throw new NotFoundException(`Email not found: ${emailId}`);
    }

    email.isRead = true;
    this.logger.log(`Email ${emailId} marked as read in inbox ${normalizedEmail}`);
  }

  /**
   * Check if inbox exists
   */
  inboxExists(emailAddress: string): boolean {
    // Normalize email to lowercase for case-insensitive lookups
    return this.inboxes.has(emailAddress.toLowerCase());
  }

  /**
   * Get inbox by its derived hash
   */
  getInboxByHash(inboxHash: string): Inbox | undefined {
    const emailAddress = this.inboxHashToEmail.get(inboxHash);
    if (!emailAddress) {
      return undefined;
    }

    return this.inboxes.get(emailAddress);
  }

  /**
   * List all inbox hashes
   */
  listInboxHashes(): string[] {
    return Array.from(this.inboxHashToEmail.keys());
  }

  /**
   * Get total number of inboxes
   */
  getInboxCount(): number {
    return this.inboxes.size;
  }

  /**
   * Get total number of emails across all inboxes
   */
  getTotalEmailCount(): number {
    let total = 0;
    for (const inbox of this.inboxes.values()) {
      total += inbox.emails.size;
    }
    return total;
  }

  /**
   * Remove every inbox (primarily for testing/maintenance endpoints)
   */
  clearAllInboxes(): number {
    const count = this.inboxes.size;

    // Notify dependent services before clearing
    for (const [emailAddress, inbox] of this.inboxes.entries()) {
      // Notify EmailStorageService for memory tracking
      if (this.emailStorageService) {
        this.emailStorageService.onInboxDeleted(emailAddress);
      }
      // Notify WebhookStorageService for cascading webhook deletion
      if (this.webhookStorageService) {
        this.webhookStorageService.onInboxDeleted(inbox.inboxHash);
      }
    }

    this.inboxes.clear();
    this.inboxHashToEmail.clear();
    this.logger.warn(`All inboxes cleared, removed ${count}`);
    return count;
  }
}
