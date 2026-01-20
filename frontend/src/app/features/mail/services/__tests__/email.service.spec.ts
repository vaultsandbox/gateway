import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { EmailService } from '../email.service';
import { VaultSandboxApi } from '../vault-sandbox-api';
import { EncryptionService } from '../encryption.service';
import { VsToast } from '../../../../shared/services/vs-toast';
import { InboxService } from '../inbox.service';
import { EmailItemModel, InboxModel, ParsedEmailContent } from '../../interfaces';
import { EncryptionServiceStub, VaultSandboxApiStub, VsToastStub } from '../../../../../testing/mail-testing.mocks';
import { EncryptedPayload } from '../../../../shared/interfaces/encrypted-payload';

describe('EmailService', () => {
  let service: EmailService;
  let inboxServiceStub: TestInboxServiceStub;
  let apiStub: VaultSandboxApiStub;
  let encryptionStub: EncryptionServiceStub;
  let toastStub: VsToastStub;

  const createEncryptedPayload = (): EncryptedPayload => ({
    v: 1,
    algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
    ct_kem: '',
    nonce: '',
    aad: '',
    ciphertext: '',
    sig: '',
    server_sig_pk: 'stub',
  });

  const createEmail = (overrides: Partial<EmailItemModel> = {}): EmailItemModel => ({
    id: 'email-1',
    encryptedMetadata: createEncryptedPayload(),
    isRead: false,
    ...overrides,
  });

  const createInbox = (overrides: Partial<InboxModel> = {}): InboxModel => ({
    emailAddress: 'test@example.com',
    expiresAt: new Date().toISOString(),
    inboxHash: 'inbox-hash-1',
    encrypted: true,
    emailAuth: false,
    serverSigPk: 'stub-server-sig',
    secretKey: new Uint8Array(32),
    emails: [createEmail()],
    ...overrides,
  });

  class TestInboxServiceStub {
    private inboxes: InboxModel[] = [];
    private deletedInboxes: string[] = [];
    private updatedInboxes: InboxModel[] = [];

    setInboxes(inboxes: InboxModel[]): void {
      this.inboxes = inboxes;
    }

    getInboxSnapshot(inboxHash: string): InboxModel | undefined {
      return this.inboxes.find((i) => i.inboxHash === inboxHash);
    }

    emitInboxUpdate(inbox: InboxModel): void {
      this.updatedInboxes.push(inbox);
      const index = this.inboxes.findIndex((i) => i.inboxHash === inbox.inboxHash);
      if (index !== -1) {
        this.inboxes[index] = inbox;
      }
    }

    deleteInbox(inboxHash: string): void {
      this.deletedInboxes.push(inboxHash);
      this.inboxes = this.inboxes.filter((i) => i.inboxHash !== inboxHash);
    }

    getDeletedInboxes(): string[] {
      return this.deletedInboxes;
    }

    getUpdatedInboxes(): InboxModel[] {
      return this.updatedInboxes;
    }

    clearHistory(): void {
      this.deletedInboxes = [];
      this.updatedInboxes = [];
    }
  }

  beforeEach(() => {
    inboxServiceStub = new TestInboxServiceStub();
    apiStub = new VaultSandboxApiStub();
    encryptionStub = new EncryptionServiceStub();
    toastStub = new VsToastStub();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        EmailService,
        { provide: VaultSandboxApi, useValue: apiStub },
        { provide: EncryptionService, useValue: encryptionStub },
        { provide: VsToast, useValue: toastStub },
        { provide: InboxService, useValue: inboxServiceStub },
      ],
    });

    service = TestBed.inject(EmailService);
  });

  describe('selectEmail', () => {
    it('sets the selected email when inbox and email exist', () => {
      const email = createEmail({ id: 'email-123' });
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      service.selectEmail(inbox.inboxHash, 'email-123');

      expect(service.selectedEmail()).toEqual(email);
    });

    it('shows error toast when inbox not found', () => {
      const showErrorSpy = spyOn(toastStub, 'showError');

      service.selectEmail('non-existent-hash', 'email-123');

      expect(service.selectedEmail()).toBeNull();
      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Cannot select email: inbox not found');
    });

    it('shows error toast when email not found in inbox', () => {
      const inbox = createInbox({ emails: [] });
      inboxServiceStub.setInboxes([inbox]);
      const showErrorSpy = spyOn(toastStub, 'showError');

      service.selectEmail(inbox.inboxHash, 'non-existent-email');

      expect(service.selectedEmail()).toBeNull();
      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Cannot select email: email not found');
    });
  });

  describe('deselectEmail', () => {
    it('clears the selected email', () => {
      const email = createEmail();
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      service.selectEmail(inbox.inboxHash, email.id);
      expect(service.selectedEmail()).not.toBeNull();

      service.deselectEmail();
      expect(service.selectedEmail()).toBeNull();
    });
  });

  describe('fetchAndDecryptEmail', () => {
    describe('plain inbox support', () => {
      const createPlainInbox = (overrides: Partial<InboxModel> = {}): InboxModel => ({
        emailAddress: 'plain@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'plain-inbox-hash',
        encrypted: false,
        emailAuth: false,
        emails: [createEmail()],
        ...overrides,
      });

      it('decodes base64 parsed content for plain inbox', async () => {
        const email = createEmail();
        const inbox = createPlainInbox({ emails: [email] });
        inboxServiceStub.setInboxes([inbox]);

        const parsedContent: ParsedEmailContent = {
          html: '<p>Plain Test</p>',
          text: 'Plain Test',
          textAsHtml: '<p>Plain Test</p>',
          headers: {},
          subject: 'Plain Subject',
          from: 'sender@example.com',
          to: 'plain@example.com',
          attachments: [],
        };

        spyOn(apiStub, 'getEmail').and.returnValue(of({ parsed: btoa(JSON.stringify(parsedContent)) }));

        await service.fetchAndDecryptEmail(inbox.inboxHash, email.id);

        const updatedInboxes = inboxServiceStub.getUpdatedInboxes();
        expect(updatedInboxes.length).toBeGreaterThan(0);

        const lastUpdate = updatedInboxes[updatedInboxes.length - 1];
        const updatedEmail = lastUpdate.emails.find((e) => e.id === email.id);
        expect(updatedEmail?.parsedContent).toEqual(parsedContent);
      });

      it('throws error when plain inbox API response has no parsed content', async () => {
        const email = createEmail();
        const inbox = createPlainInbox({ emails: [email] });
        inboxServiceStub.setInboxes([inbox]);

        spyOn(apiStub, 'getEmail').and.returnValue(of({ isRead: false }));

        await expectAsync(service.fetchAndDecryptEmail(inbox.inboxHash, email.id)).toBeRejectedWithError(
          'Parsed content not found in API response for plain inbox',
        );
      });
    });

    it('fetches and decrypts email body', async () => {
      const email = createEmail();
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      const parsedContent: ParsedEmailContent = {
        html: '<p>Test</p>',
        text: 'Test',
        textAsHtml: '<p>Test</p>',
        headers: {},
        subject: 'Test Subject',
        from: 'sender@example.com',
        to: 'test@example.com',
        attachments: [],
      };

      spyOn(apiStub, 'getEmail').and.returnValue(of({ encryptedParsed: createEncryptedPayload() }));
      spyOn(encryptionStub, 'decryptBody').and.returnValue(Promise.resolve(JSON.stringify(parsedContent)));

      await service.fetchAndDecryptEmail(inbox.inboxHash, email.id);

      const updatedInboxes = inboxServiceStub.getUpdatedInboxes();
      expect(updatedInboxes.length).toBeGreaterThan(0);

      const lastUpdate = updatedInboxes[updatedInboxes.length - 1];
      const updatedEmail = lastUpdate.emails.find((e) => e.id === email.id);
      expect(updatedEmail?.parsedContent).toEqual(parsedContent);
    });

    it('returns early if email already has parsed content', async () => {
      const parsedContent: ParsedEmailContent = {
        html: '<p>Cached</p>',
        text: 'Cached',
        textAsHtml: '<p>Cached</p>',
        headers: {},
        subject: 'Cached Subject',
        from: 'sender@example.com',
        to: 'test@example.com',
        attachments: [],
      };

      const email = createEmail({ parsedContent });
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      const getEmailSpy = spyOn(apiStub, 'getEmail');

      await service.fetchAndDecryptEmail(inbox.inboxHash, email.id);

      expect(getEmailSpy).not.toHaveBeenCalled();
    });

    it('shows error toast when inbox not found', async () => {
      const showErrorSpy = spyOn(toastStub, 'showError');

      await service.fetchAndDecryptEmail('non-existent-hash', 'email-123');

      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Cannot load email: inbox not found');
    });

    it('shows error toast when email not found in inbox', async () => {
      const inbox = createInbox({ emails: [] });
      inboxServiceStub.setInboxes([inbox]);
      const showErrorSpy = spyOn(toastStub, 'showError');

      await service.fetchAndDecryptEmail(inbox.inboxHash, 'non-existent-email');

      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Cannot load email: email not found');
    });

    it('deletes inbox on 404 response', async () => {
      const email = createEmail();
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      const showInboxDeletedSpy = spyOn(toastStub, 'showInboxDeleted');
      spyOn(apiStub, 'getEmail').and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

      await service.fetchAndDecryptEmail(inbox.inboxHash, email.id);

      expect(inboxServiceStub.getDeletedInboxes()).toContain(inbox.inboxHash);
      expect(showInboxDeletedSpy).toHaveBeenCalledWith(inbox.emailAddress);
    });

    it('throws error for non-404 API errors', async () => {
      const email = createEmail();
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      spyOn(apiStub, 'getEmail').and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      await expectAsync(service.fetchAndDecryptEmail(inbox.inboxHash, email.id)).toBeRejected();
    });

    it('handles JSON parse failure gracefully', async () => {
      const email = createEmail();
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      spyOn(apiStub, 'getEmail').and.returnValue(of({ encryptedParsed: createEncryptedPayload() }));
      spyOn(encryptionStub, 'decryptBody').and.returnValue(Promise.resolve('invalid json'));

      await service.fetchAndDecryptEmail(inbox.inboxHash, email.id);

      const updatedInboxes = inboxServiceStub.getUpdatedInboxes();
      const lastUpdate = updatedInboxes[updatedInboxes.length - 1];
      const updatedEmail = lastUpdate.emails.find((e) => e.id === email.id);
      expect(updatedEmail?.decryptedBody).toBe('invalid json');
      expect(updatedEmail?.parsedContent).toBeUndefined();
    });

    it('throws error when API response has neither encryptedParsed nor encryptedBody', async () => {
      const email = createEmail();
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      spyOn(apiStub, 'getEmail').and.returnValue(of({ isRead: false }));

      await expectAsync(service.fetchAndDecryptEmail(inbox.inboxHash, email.id)).toBeRejectedWithError(
        'Neither encryptedParsed nor encryptedBody found in API response',
      );
    });

    it('sets isLoadingBody to true during fetch and false after', async () => {
      const email = createEmail();
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      const loadingStates: boolean[] = [];
      const originalEmitInboxUpdate = inboxServiceStub.emitInboxUpdate.bind(inboxServiceStub);
      spyOn(inboxServiceStub, 'emitInboxUpdate').and.callFake((updatedInbox: InboxModel) => {
        const updatedEmail = updatedInbox.emails.find((e) => e.id === email.id);
        if (updatedEmail) {
          loadingStates.push(updatedEmail.isLoadingBody ?? false);
        }
        originalEmitInboxUpdate(updatedInbox);
      });

      spyOn(apiStub, 'getEmail').and.returnValue(of({ encryptedParsed: createEncryptedPayload() }));
      spyOn(encryptionStub, 'decryptBody').and.returnValue(Promise.resolve('{}'));

      await service.fetchAndDecryptEmail(inbox.inboxHash, email.id);

      expect(loadingStates[0]).toBeTrue();
      expect(loadingStates[loadingStates.length - 1]).toBeFalse();
    });
  });

  describe('fetchAndDecryptRawEmail', () => {
    describe('plain inbox support', () => {
      const createPlainInbox = (overrides: Partial<InboxModel> = {}): InboxModel => ({
        emailAddress: 'plain@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'plain-inbox-hash',
        encrypted: false,
        emailAuth: false,
        emails: [createEmail()],
        ...overrides,
      });

      it('decodes base64 raw content for plain inbox', async () => {
        const email = createEmail();
        const inbox = createPlainInbox({ emails: [email] });
        inboxServiceStub.setInboxes([inbox]);

        const rawContent = 'From: sender@example.com\r\nTo: plain@example.com\r\n\r\nPlain Body';
        spyOn(apiStub, 'getRawEmail').and.returnValue(of({ raw: btoa(rawContent) }));

        const result = await service.fetchAndDecryptRawEmail(inbox.inboxHash, email.id);

        expect(result).toBe(rawContent);
      });

      it('throws error when plain inbox API response has no raw content', async () => {
        const email = createEmail();
        const inbox = createPlainInbox({ emails: [email] });
        inboxServiceStub.setInboxes([inbox]);

        spyOn(apiStub, 'getRawEmail').and.returnValue(of({}));

        await expectAsync(service.fetchAndDecryptRawEmail(inbox.inboxHash, email.id)).toBeRejectedWithError(
          'No raw content found in API response',
        );
      });
    });

    it('fetches and decrypts raw email content', async () => {
      const email = createEmail();
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      const rawContent = 'From: sender@example.com\r\nTo: test@example.com\r\n\r\nBody';
      spyOn(apiStub, 'getRawEmail').and.returnValue(of({ encryptedRaw: createEncryptedPayload() }));
      spyOn(encryptionStub, 'decryptBody').and.returnValue(Promise.resolve(rawContent));

      const result = await service.fetchAndDecryptRawEmail(inbox.inboxHash, email.id);

      expect(result).toBe(rawContent);
    });

    it('throws error when inbox not found', async () => {
      const showErrorSpy = spyOn(toastStub, 'showError');

      await expectAsync(service.fetchAndDecryptRawEmail('non-existent-hash', 'email-123')).toBeRejectedWithError(
        'Inbox not found',
      );

      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Cannot load raw email: inbox not found');
    });

    it('deletes inbox on 404 response', async () => {
      const email = createEmail();
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      const showInboxDeletedSpy = spyOn(toastStub, 'showInboxDeleted');
      spyOn(apiStub, 'getRawEmail').and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

      await expectAsync(service.fetchAndDecryptRawEmail(inbox.inboxHash, email.id)).toBeRejected();

      expect(inboxServiceStub.getDeletedInboxes()).toContain(inbox.inboxHash);
      expect(showInboxDeletedSpy).toHaveBeenCalledWith(inbox.emailAddress);
    });

    it('throws error for non-404 API errors', async () => {
      const email = createEmail();
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      spyOn(apiStub, 'getRawEmail').and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      await expectAsync(service.fetchAndDecryptRawEmail(inbox.inboxHash, email.id)).toBeRejected();
    });
  });

  describe('markEmailAsRead', () => {
    it('marks email as read with optimistic update', async () => {
      const email = createEmail({ isRead: false });
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      spyOn(apiStub, 'markEmailAsRead').and.returnValue(of(undefined));

      await service.markEmailAsRead(inbox.inboxHash, email.id);

      const updatedInboxes = inboxServiceStub.getUpdatedInboxes();
      expect(updatedInboxes.length).toBeGreaterThan(0);

      const optimisticUpdate = updatedInboxes[0];
      const updatedEmail = optimisticUpdate.emails.find((e) => e.id === email.id);
      expect(updatedEmail?.isRead).toBeTrue();
    });

    it('returns early if email is already read', async () => {
      const email = createEmail({ isRead: true });
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      const markAsReadSpy = spyOn(apiStub, 'markEmailAsRead');

      await service.markEmailAsRead(inbox.inboxHash, email.id);

      expect(markAsReadSpy).not.toHaveBeenCalled();
    });

    it('shows error toast when inbox not found', async () => {
      const showErrorSpy = spyOn(toastStub, 'showError');

      await service.markEmailAsRead('non-existent-hash', 'email-123');

      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Cannot mark email as read: inbox not found');
    });

    it('shows error toast when email not found in inbox', async () => {
      const inbox = createInbox({ emails: [] });
      inboxServiceStub.setInboxes([inbox]);
      const showErrorSpy = spyOn(toastStub, 'showError');

      await service.markEmailAsRead(inbox.inboxHash, 'non-existent-email');

      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Cannot mark email as read: email not found');
    });

    it('deletes inbox on 404 response', async () => {
      const email = createEmail({ isRead: false });
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      const showInboxDeletedSpy = spyOn(toastStub, 'showInboxDeleted');
      spyOn(apiStub, 'markEmailAsRead').and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

      await service.markEmailAsRead(inbox.inboxHash, email.id);

      expect(inboxServiceStub.getDeletedInboxes()).toContain(inbox.inboxHash);
      expect(showInboxDeletedSpy).toHaveBeenCalledWith(inbox.emailAddress);
    });

    it('rolls back optimistic update on non-404 API error', async () => {
      const email = createEmail({ isRead: false });
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      spyOn(apiStub, 'markEmailAsRead').and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      await service.markEmailAsRead(inbox.inboxHash, email.id);

      const updatedInboxes = inboxServiceStub.getUpdatedInboxes();
      expect(updatedInboxes.length).toBe(2);

      const rollbackUpdate = updatedInboxes[1];
      const rolledBackEmail = rollbackUpdate.emails.find((e) => e.id === email.id);
      expect(rolledBackEmail?.isRead).toBeFalse();
    });

    it('preserves other emails during optimistic update with multiple emails', async () => {
      const email1 = createEmail({ id: 'email-1', isRead: false });
      const email2 = createEmail({ id: 'email-2', isRead: false });
      const inbox = createInbox({ emails: [email1, email2] });
      inboxServiceStub.setInboxes([inbox]);

      spyOn(apiStub, 'markEmailAsRead').and.returnValue(of(undefined));

      await service.markEmailAsRead(inbox.inboxHash, email1.id);

      const updatedInboxes = inboxServiceStub.getUpdatedInboxes();
      const optimisticUpdate = updatedInboxes[0];
      const updatedEmail1 = optimisticUpdate.emails.find((e) => e.id === 'email-1');
      const unchangedEmail2 = optimisticUpdate.emails.find((e) => e.id === 'email-2');

      expect(updatedEmail1?.isRead).toBeTrue();
      expect(unchangedEmail2?.isRead).toBeFalse();
    });

    it('preserves other emails during rollback with multiple emails', async () => {
      const email1 = createEmail({ id: 'email-1', isRead: false });
      const email2 = createEmail({ id: 'email-2', isRead: false });
      const inbox = createInbox({ emails: [email1, email2] });
      inboxServiceStub.setInboxes([inbox]);

      spyOn(apiStub, 'markEmailAsRead').and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      await service.markEmailAsRead(inbox.inboxHash, email1.id);

      const updatedInboxes = inboxServiceStub.getUpdatedInboxes();
      expect(updatedInboxes.length).toBe(2);

      const rollbackUpdate = updatedInboxes[1];
      const rolledBackEmail1 = rollbackUpdate.emails.find((e) => e.id === 'email-1');
      const unchangedEmail2 = rollbackUpdate.emails.find((e) => e.id === 'email-2');

      expect(rolledBackEmail1?.isRead).toBeFalse();
      expect(unchangedEmail2?.isRead).toBeFalse();
    });
  });

  describe('deleteEmail', () => {
    it('removes email from inbox', () => {
      const email = createEmail();
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      service.deleteEmail(inbox.inboxHash, email.id);

      const updatedInboxes = inboxServiceStub.getUpdatedInboxes();
      expect(updatedInboxes.length).toBe(1);

      const updatedInbox = updatedInboxes[0];
      expect(updatedInbox.emails.find((e) => e.id === email.id)).toBeUndefined();
    });

    it('clears selection if deleted email was selected', () => {
      const email = createEmail();
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      service.selectEmail(inbox.inboxHash, email.id);
      expect(service.selectedEmail()).not.toBeNull();

      service.deleteEmail(inbox.inboxHash, email.id);

      expect(service.selectedEmail()).toBeNull();
    });

    it('does not clear selection if different email was selected', () => {
      const email1 = createEmail({ id: 'email-1' });
      const email2 = createEmail({ id: 'email-2' });
      const inbox = createInbox({ emails: [email1, email2] });
      inboxServiceStub.setInboxes([inbox]);

      service.selectEmail(inbox.inboxHash, email1.id);
      expect(service.selectedEmail()?.id).toBe('email-1');

      service.deleteEmail(inbox.inboxHash, email2.id);

      expect(service.selectedEmail()?.id).toBe('email-1');
    });

    it('shows error toast when inbox not found', () => {
      const showErrorSpy = spyOn(toastStub, 'showError');

      service.deleteEmail('non-existent-hash', 'email-123');

      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Cannot delete email: inbox not found');
    });

    it('shows error toast when email not found in inbox', () => {
      const inbox = createInbox({ emails: [] });
      inboxServiceStub.setInboxes([inbox]);
      const showErrorSpy = spyOn(toastStub, 'showError');

      service.deleteEmail(inbox.inboxHash, 'non-existent-email');

      expect(showErrorSpy).toHaveBeenCalledWith('Error', 'Cannot delete email: email not found');
    });
  });

  describe('selectedEmail signal', () => {
    it('returns readonly signal', () => {
      expect(service.selectedEmail()).toBeNull();
    });

    it('updates when email is selected and mirrors emitInboxUpdate changes', () => {
      const email = createEmail({ id: 'email-1' });
      const inbox = createInbox({ emails: [email] });
      inboxServiceStub.setInboxes([inbox]);

      service.selectEmail(inbox.inboxHash, email.id);
      expect(service.selectedEmail()?.id).toBe('email-1');
    });
  });
});
