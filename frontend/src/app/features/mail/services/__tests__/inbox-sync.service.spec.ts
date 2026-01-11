import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { InboxSyncService } from '../inbox-sync.service';
import { VaultSandboxApi } from '../vault-sandbox-api';
import { EncryptionService } from '../encryption.service';
import { VaultSandbox, NewEmailEvent } from '../../../../shared/services/vault-sandbox';
import { VsToast } from '../../../../shared/services/vs-toast';
import { InboxStateService } from '../inbox-state.service';
import {
  VaultSandboxStub,
  VaultSandboxApiStub,
  EncryptionServiceStub,
  VsToastStub,
  InboxStateServiceStub,
} from '../../../../../testing/mail-testing.mocks';
import { InboxModel, EmailListItemResponse } from '../../interfaces';
import { EncryptedPayload } from '../../../../shared/interfaces/encrypted-payload';

describe('InboxSyncService', () => {
  let service: InboxSyncService;
  let vaultSandboxApiStub: VaultSandboxApiStub;
  let encryptionServiceStub: EncryptionServiceStub;
  let vaultSandboxStub: VaultSandboxStub;
  let vsToastStub: VsToastStub;
  let inboxStateServiceStub: InboxStateServiceStub;

  const createEncryptedPayload = (): EncryptedPayload => ({
    v: 1,
    algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
    ct_kem: 'test-ct-kem',
    nonce: 'test-nonce',
    aad: 'test-aad',
    ciphertext: 'test-ciphertext',
    sig: 'test-sig',
    server_sig_pk: 'test-server-sig-pk',
  });

  const createInbox = (overrides: Partial<InboxModel> = {}): InboxModel => ({
    emailAddress: 'test@example.com',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    inboxHash: 'test-inbox-hash',
    serverSigPk: 'test-server-sig-pk',
    secretKey: new Uint8Array([1, 2, 3, 4]),
    emails: [],
    ...overrides,
  });

  const createEmailListItem = (overrides: Partial<EmailListItemResponse> = {}): EmailListItemResponse => ({
    id: 'email-1',
    encryptedMetadata: createEncryptedPayload(),
    isRead: false,
    ...overrides,
  });

  beforeEach(() => {
    vaultSandboxApiStub = new VaultSandboxApiStub();
    encryptionServiceStub = new EncryptionServiceStub();
    vaultSandboxStub = new VaultSandboxStub();
    vsToastStub = new VsToastStub();
    inboxStateServiceStub = new InboxStateServiceStub();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        InboxSyncService,
        { provide: VaultSandboxApi, useValue: vaultSandboxApiStub },
        { provide: EncryptionService, useValue: encryptionServiceStub },
        { provide: VaultSandbox, useValue: vaultSandboxStub },
        { provide: VsToast, useValue: vsToastStub },
        { provide: InboxStateService, useValue: inboxStateServiceStub },
      ],
    });
  });

  describe('construction', () => {
    it('should auto-subscribe to inboxes on construction if inboxes exist', () => {
      const inbox = createInbox();
      inboxStateServiceStub.setInboxes([inbox]);
      spyOn(vaultSandboxStub, 'connectToEvents');
      spyOn(vaultSandboxApiStub, 'getInboxSyncStatus').and.returnValue(of({ emailsHash: 'hash', emailCount: 0 }));
      spyOn(vaultSandboxApiStub, 'listEmails').and.returnValue(of([]));

      service = TestBed.inject(InboxSyncService);

      expect(vaultSandboxStub.connectToEvents).toHaveBeenCalledWith([inbox.inboxHash]);
    });

    it('should not auto-subscribe if no inboxes exist', () => {
      spyOn(vaultSandboxStub, 'connectToEvents');

      service = TestBed.inject(InboxSyncService);

      expect(vaultSandboxStub.connectToEvents).not.toHaveBeenCalled();
    });

    it('should subscribe to newEmail$ on construction', async () => {
      service = TestBed.inject(InboxSyncService);
      const inbox = createInbox();
      inboxStateServiceStub.setInboxes([inbox]);

      spyOn(encryptionServiceStub, 'decryptMetadata').and.resolveTo({
        from: 'sender@test.com',
        to: inbox.emailAddress,
        subject: 'Test Subject',
        receivedAt: new Date().toISOString(),
      });
      const updateSpy = spyOn(inboxStateServiceStub, 'updateInbox');
      const notifySpy = spyOn(inboxStateServiceStub, 'notifyNewEmail');

      const event: NewEmailEvent = {
        inboxId: inbox.inboxHash,
        emailId: 'new-email-id',
        encryptedMetadata: createEncryptedPayload(),
      };

      vaultSandboxStub.emit(event);

      // Allow async handling
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(updateSpy).toHaveBeenCalled();
      expect(notifySpy).toHaveBeenCalled();
    });
  });

  describe('subscribeToAllInboxes()', () => {
    beforeEach(() => {
      service = TestBed.inject(InboxSyncService);
    });

    it('should disconnect events when no inboxes exist', async () => {
      spyOn(vaultSandboxStub, 'disconnectEvents');

      await service.subscribeToAllInboxes();

      expect(vaultSandboxStub.disconnectEvents).toHaveBeenCalled();
    });

    it('should connect to events for all inboxes', async () => {
      const inbox1 = createInbox({ inboxHash: 'hash-1', emailAddress: 'test1@example.com' });
      const inbox2 = createInbox({ inboxHash: 'hash-2', emailAddress: 'test2@example.com' });
      inboxStateServiceStub.setInboxes([inbox1, inbox2]);
      spyOn(vaultSandboxStub, 'connectToEvents');
      spyOn(vaultSandboxApiStub, 'getInboxSyncStatus').and.returnValue(of({ emailsHash: 'hash', emailCount: 0 }));
      spyOn(vaultSandboxApiStub, 'listEmails').and.returnValue(of([]));

      await service.subscribeToAllInboxes();

      expect(vaultSandboxStub.connectToEvents).toHaveBeenCalledWith(['hash-1', 'hash-2']);
    });

    it('should load emails for all inboxes', async () => {
      const inbox1 = createInbox({ inboxHash: 'hash-1', emailAddress: 'test1@example.com' });
      const inbox2 = createInbox({ inboxHash: 'hash-2', emailAddress: 'test2@example.com' });
      inboxStateServiceStub.setInboxes([inbox1, inbox2]);
      spyOn(vaultSandboxStub, 'connectToEvents');
      const getSyncSpy = spyOn(vaultSandboxApiStub, 'getInboxSyncStatus').and.returnValue(
        of({ emailsHash: 'new-hash', emailCount: 0 }),
      );
      spyOn(vaultSandboxApiStub, 'listEmails').and.returnValue(of([]));

      await service.subscribeToAllInboxes();

      expect(getSyncSpy).toHaveBeenCalledTimes(2);
    });

    it('should continue loading other inboxes when one fails', async () => {
      const inbox1 = createInbox({ inboxHash: 'hash-1', emailAddress: 'test1@example.com' });
      const inbox2 = createInbox({ inboxHash: 'hash-2', emailAddress: 'test2@example.com' });
      inboxStateServiceStub.setInboxes([inbox1, inbox2]);
      spyOn(vaultSandboxStub, 'connectToEvents');
      spyOn(console, 'error');

      let callCount = 0;
      spyOn(vaultSandboxApiStub, 'getInboxSyncStatus').and.callFake(() => {
        callCount++;
        if (callCount === 1) {
          return throwError(() => new Error('Network error'));
        }
        return of({ emailsHash: 'hash', emailCount: 0 });
      });
      spyOn(vaultSandboxApiStub, 'listEmails').and.returnValue(of([]));

      await service.subscribeToAllInboxes();

      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('loadEmailsForInbox()', () => {
    beforeEach(() => {
      service = TestBed.inject(InboxSyncService);
    });

    it('should show error when inbox not found', async () => {
      spyOn(console, 'error');
      spyOn(vsToastStub, 'showError');

      await service.loadEmailsForInbox('nonexistent-hash');

      expect(console.error).toHaveBeenCalledWith(
        '[InboxSyncService] Cannot load emails: inbox not found',
        'nonexistent-hash',
      );
      expect(vsToastStub.showError).toHaveBeenCalledWith('Error', 'Cannot load emails: inbox not found');
    });

    it('should skip sync when computed local hash matches server hash', async () => {
      // Empty inbox has hash: 47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU (sha256 of "")
      const emptyHashBase64Url = '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU';
      const inbox = createInbox({ emails: [] });
      inboxStateServiceStub.setInboxes([inbox]);
      spyOn(vaultSandboxApiStub, 'getInboxSyncStatus').and.returnValue(
        of({ emailsHash: emptyHashBase64Url, emailCount: 0 }),
      );
      const listEmailsSpy = spyOn(vaultSandboxApiStub, 'listEmails');

      await service.loadEmailsForInbox(inbox.inboxHash);

      expect(listEmailsSpy).not.toHaveBeenCalled();
    });

    it('should fetch and decrypt new emails', async () => {
      const inbox = createInbox();
      inboxStateServiceStub.setInboxes([inbox]);

      const newEmail = createEmailListItem({ id: 'new-email-1' });
      spyOn(vaultSandboxApiStub, 'getInboxSyncStatus').and.returnValue(of({ emailsHash: 'new-hash', emailCount: 1 }));
      spyOn(vaultSandboxApiStub, 'listEmails').and.returnValue(of([newEmail]));
      spyOn(encryptionServiceStub, 'decryptMetadata').and.resolveTo({
        from: 'sender@test.com',
        to: inbox.emailAddress,
        subject: 'Test Subject',
        receivedAt: new Date().toISOString(),
      });
      spyOn(inboxStateServiceStub, 'updateInbox');

      await service.loadEmailsForInbox(inbox.inboxHash);

      expect(inboxStateServiceStub.updateInbox).toHaveBeenCalled();
      const updatedInbox = (inboxStateServiceStub.updateInbox as jasmine.Spy).calls.mostRecent().args[0] as InboxModel;
      expect(updatedInbox.emails.length).toBe(1);
      expect(updatedInbox.emails[0].id).toBe('new-email-1');
    });

    it('should not add duplicate emails', async () => {
      const existingEmail = {
        id: 'existing-email',
        encryptedMetadata: createEncryptedPayload(),
        isRead: true,
      };
      const inbox = createInbox({ emails: [existingEmail] });
      inboxStateServiceStub.setInboxes([inbox]);

      spyOn(vaultSandboxApiStub, 'getInboxSyncStatus').and.returnValue(of({ emailsHash: 'new-hash', emailCount: 1 }));
      spyOn(vaultSandboxApiStub, 'listEmails').and.returnValue(of([createEmailListItem({ id: 'existing-email' })]));
      spyOn(inboxStateServiceStub, 'updateInbox');

      await service.loadEmailsForInbox(inbox.inboxHash);

      const updatedInbox = (inboxStateServiceStub.updateInbox as jasmine.Spy).calls.mostRecent().args[0] as InboxModel;
      expect(updatedInbox.emails.length).toBe(1);
    });

    it('should remove emails deleted on server', async () => {
      const emailToKeep = {
        id: 'keep-email',
        encryptedMetadata: createEncryptedPayload(),
        isRead: false,
      };
      const emailToDelete = {
        id: 'delete-email',
        encryptedMetadata: createEncryptedPayload(),
        isRead: true,
      };
      const inbox = createInbox({ emails: [emailToKeep, emailToDelete] });
      inboxStateServiceStub.setInboxes([inbox]);

      // Server only returns one email (the other was deleted)
      spyOn(vaultSandboxApiStub, 'getInboxSyncStatus').and.returnValue(of({ emailsHash: 'new-hash', emailCount: 1 }));
      spyOn(vaultSandboxApiStub, 'listEmails').and.returnValue(of([createEmailListItem({ id: 'keep-email' })]));
      spyOn(inboxStateServiceStub, 'updateInbox');

      await service.loadEmailsForInbox(inbox.inboxHash);

      const updatedInbox = (inboxStateServiceStub.updateInbox as jasmine.Spy).calls.mostRecent().args[0] as InboxModel;
      expect(updatedInbox.emails.length).toBe(1);
      expect(updatedInbox.emails[0].id).toBe('keep-email');
    });

    it('should create fallback metadata on decryption failure', async () => {
      const inbox = createInbox();
      inboxStateServiceStub.setInboxes([inbox]);

      const newEmail = createEmailListItem({ id: 'new-email-1' });
      spyOn(vaultSandboxApiStub, 'getInboxSyncStatus').and.returnValue(of({ emailsHash: 'new-hash', emailCount: 1 }));
      spyOn(vaultSandboxApiStub, 'listEmails').and.returnValue(of([newEmail]));
      spyOn(encryptionServiceStub, 'decryptMetadata').and.rejectWith(new Error('Decryption failed'));
      spyOn(console, 'error');
      spyOn(inboxStateServiceStub, 'updateInbox');

      await service.loadEmailsForInbox(inbox.inboxHash);

      expect(console.error).toHaveBeenCalled();
      const updatedInbox = (inboxStateServiceStub.updateInbox as jasmine.Spy).calls.mostRecent().args[0] as InboxModel;
      expect(updatedInbox.emails.length).toBe(1);
      expect(updatedInbox.emails[0].decryptedMetadata).toBeUndefined();
    });

    it('should default isRead to false when undefined on successful decrypt', async () => {
      const inbox = createInbox();
      inboxStateServiceStub.setInboxes([inbox]);

      const newEmail = createEmailListItem({ id: 'new-email-1', isRead: undefined as unknown as boolean });
      spyOn(vaultSandboxApiStub, 'getInboxSyncStatus').and.returnValue(of({ emailsHash: 'new-hash', emailCount: 1 }));
      spyOn(vaultSandboxApiStub, 'listEmails').and.returnValue(of([newEmail]));
      spyOn(encryptionServiceStub, 'decryptMetadata').and.resolveTo({
        from: 'sender@test.com',
        to: inbox.emailAddress,
        subject: 'Test',
        receivedAt: new Date().toISOString(),
      });
      spyOn(inboxStateServiceStub, 'updateInbox');

      await service.loadEmailsForInbox(inbox.inboxHash);

      const updatedInbox = (inboxStateServiceStub.updateInbox as jasmine.Spy).calls.mostRecent().args[0] as InboxModel;
      expect(updatedInbox.emails[0].isRead).toBe(false);
    });

    it('should default isRead to false when undefined on decryption failure', async () => {
      const inbox = createInbox();
      inboxStateServiceStub.setInboxes([inbox]);

      const newEmail = createEmailListItem({ id: 'new-email-1', isRead: undefined as unknown as boolean });
      spyOn(vaultSandboxApiStub, 'getInboxSyncStatus').and.returnValue(of({ emailsHash: 'new-hash', emailCount: 1 }));
      spyOn(vaultSandboxApiStub, 'listEmails').and.returnValue(of([newEmail]));
      spyOn(encryptionServiceStub, 'decryptMetadata').and.rejectWith(new Error('Decryption failed'));
      spyOn(console, 'error');
      spyOn(inboxStateServiceStub, 'updateInbox');

      await service.loadEmailsForInbox(inbox.inboxHash);

      const updatedInbox = (inboxStateServiceStub.updateInbox as jasmine.Spy).calls.mostRecent().args[0] as InboxModel;
      expect(updatedInbox.emails[0].isRead).toBe(false);
    });

    it('should remove inbox on 404 error', async () => {
      const inbox = createInbox();
      inboxStateServiceStub.setInboxes([inbox]);

      const error404 = new HttpErrorResponse({ status: 404, statusText: 'Not Found' });
      spyOn(vaultSandboxApiStub, 'getInboxSyncStatus').and.returnValue(throwError(() => error404));
      spyOn(console, 'warn');
      spyOn(vsToastStub, 'showInboxDeleted');
      spyOn(inboxStateServiceStub, 'removeInbox').and.callThrough();
      spyOn(vaultSandboxStub, 'disconnectEvents');

      await service.loadEmailsForInbox(inbox.inboxHash);

      expect(console.warn).toHaveBeenCalledWith(
        '[InboxSyncService] Inbox not found on server (404), deleting local copy:',
        inbox.emailAddress,
      );
      expect(vsToastStub.showInboxDeleted).toHaveBeenCalledWith(inbox.emailAddress);
      expect(inboxStateServiceStub.removeInbox).toHaveBeenCalledWith(inbox.inboxHash);
    });

    it('should rethrow non-404 errors', async () => {
      const inbox = createInbox();
      inboxStateServiceStub.setInboxes([inbox]);

      const error500 = new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' });
      spyOn(vaultSandboxApiStub, 'getInboxSyncStatus').and.returnValue(throwError(() => error500));
      spyOn(console, 'error');

      await expectAsync(service.loadEmailsForInbox(inbox.inboxHash)).toBeRejectedWith(error500);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('disconnect()', () => {
    beforeEach(() => {
      service = TestBed.inject(InboxSyncService);
    });

    it('should disconnect SSE events', () => {
      spyOn(vaultSandboxStub, 'disconnectEvents');

      service.disconnect();

      expect(vaultSandboxStub.disconnectEvents).toHaveBeenCalled();
    });
  });

  describe('ngOnDestroy()', () => {
    beforeEach(() => {
      service = TestBed.inject(InboxSyncService);
    });

    it('should unsubscribe and disconnect events', () => {
      spyOn(vaultSandboxStub, 'disconnectEvents');

      service.ngOnDestroy();

      expect(vaultSandboxStub.disconnectEvents).toHaveBeenCalled();
    });
  });

  describe('syncAllInboxesAfterReconnect (via reconnected$ event)', () => {
    beforeEach(() => {
      service = TestBed.inject(InboxSyncService);
    });

    it('should sync all inboxes when reconnected$ emits', async () => {
      const inbox1 = createInbox({ inboxHash: 'hash-1', emailAddress: 'test1@example.com' });
      const inbox2 = createInbox({ inboxHash: 'hash-2', emailAddress: 'test2@example.com' });
      inboxStateServiceStub.setInboxes([inbox1, inbox2]);

      const getSyncSpy = spyOn(vaultSandboxApiStub, 'getInboxSyncStatus').and.returnValue(
        of({ emailsHash: 'new-hash', emailCount: 0 }),
      );
      spyOn(vaultSandboxApiStub, 'listEmails').and.returnValue(of([]));

      vaultSandboxStub.emitReconnected();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(getSyncSpy).toHaveBeenCalledTimes(2);
    });

    it('should not sync when no inboxes exist on reconnect', async () => {
      const getSyncSpy = spyOn(vaultSandboxApiStub, 'getInboxSyncStatus');

      vaultSandboxStub.emitReconnected();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(getSyncSpy).not.toHaveBeenCalled();
    });

    it('should handle sync errors gracefully on reconnect', async () => {
      const inbox = createInbox();
      inboxStateServiceStub.setInboxes([inbox]);

      spyOn(vaultSandboxApiStub, 'getInboxSyncStatus').and.returnValue(throwError(() => new Error('Network error')));
      spyOn(console, 'error');

      vaultSandboxStub.emitReconnected();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(console.error).toHaveBeenCalledWith(
        `[InboxSyncService] Error syncing inbox ${inbox.inboxHash} after reconnect:`,
        jasmine.any(Error),
      );
    });
  });

  describe('handleNewEmail (via SSE event)', () => {
    beforeEach(() => {
      service = TestBed.inject(InboxSyncService);
    });

    it('should ignore event when inbox not found', async () => {
      spyOn(inboxStateServiceStub, 'updateInbox');

      const event: NewEmailEvent = {
        inboxId: 'nonexistent-hash',
        emailId: 'new-email-id',
        encryptedMetadata: createEncryptedPayload(),
      };

      vaultSandboxStub.emit(event);

      // Allow async handling
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(inboxStateServiceStub.updateInbox).not.toHaveBeenCalled();
    });

    it('should ignore duplicate email events', async () => {
      const existingEmail = {
        id: 'existing-email-id',
        encryptedMetadata: createEncryptedPayload(),
        isRead: false,
      };
      const inbox = createInbox({ emails: [existingEmail] });
      inboxStateServiceStub.setInboxes([inbox]);
      spyOn(inboxStateServiceStub, 'updateInbox');

      const event: NewEmailEvent = {
        inboxId: inbox.inboxHash,
        emailId: 'existing-email-id',
        encryptedMetadata: createEncryptedPayload(),
      };

      vaultSandboxStub.emit(event);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(inboxStateServiceStub.updateInbox).not.toHaveBeenCalled();
    });

    it('should add new email on SSE event', async () => {
      const inbox = createInbox();
      inboxStateServiceStub.setInboxes([inbox]);

      spyOn(encryptionServiceStub, 'decryptMetadata').and.resolveTo({
        from: 'sender@test.com',
        to: inbox.emailAddress,
        subject: 'New Email Subject',
        receivedAt: new Date().toISOString(),
      });
      spyOn(inboxStateServiceStub, 'updateInbox');
      spyOn(inboxStateServiceStub, 'notifyNewEmail');

      const event: NewEmailEvent = {
        inboxId: inbox.inboxHash,
        emailId: 'new-email-id',
        encryptedMetadata: createEncryptedPayload(),
      };

      vaultSandboxStub.emit(event);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(inboxStateServiceStub.updateInbox).toHaveBeenCalled();
      expect(inboxStateServiceStub.notifyNewEmail).toHaveBeenCalled();

      const updatedInbox = (inboxStateServiceStub.updateInbox as jasmine.Spy).calls.mostRecent().args[0] as InboxModel;
      expect(updatedInbox.emails.length).toBe(1);
      expect(updatedInbox.emails[0].id).toBe('new-email-id');
      expect(updatedInbox.emails[0].isRead).toBeFalse();
    });

    it('should create fallback metadata on SSE decryption failure', async () => {
      const inbox = createInbox();
      inboxStateServiceStub.setInboxes([inbox]);

      spyOn(encryptionServiceStub, 'decryptMetadata').and.rejectWith(new Error('Decryption failed'));
      spyOn(console, 'error');
      spyOn(inboxStateServiceStub, 'updateInbox');
      spyOn(inboxStateServiceStub, 'notifyNewEmail');

      const event: NewEmailEvent = {
        inboxId: inbox.inboxHash,
        emailId: 'new-email-id',
        encryptedMetadata: createEncryptedPayload(),
      };

      vaultSandboxStub.emit(event);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(console.error).toHaveBeenCalledWith(
        '[InboxSyncService] Failed to decrypt SSE metadata:',
        jasmine.any(Error),
      );
      expect(inboxStateServiceStub.updateInbox).toHaveBeenCalled();

      const updatedInbox = (inboxStateServiceStub.updateInbox as jasmine.Spy).calls.mostRecent().args[0] as InboxModel;
      expect(updatedInbox.emails[0].decryptedMetadata?.from).toBe('unknown');
      expect(updatedInbox.emails[0].decryptedMetadata?.subject).toBe('(decryption failed)');
    });

    it('should prepend new email to existing emails', async () => {
      const existingEmail = {
        id: 'existing-email',
        encryptedMetadata: createEncryptedPayload(),
        decryptedMetadata: {
          from: 'old@test.com',
          to: 'test@example.com',
          subject: 'Old Email',
          receivedAt: new Date().toISOString(),
        },
        isRead: true,
      };
      const inbox = createInbox({ emails: [existingEmail] });
      inboxStateServiceStub.setInboxes([inbox]);

      spyOn(encryptionServiceStub, 'decryptMetadata').and.resolveTo({
        from: 'new@test.com',
        to: inbox.emailAddress,
        subject: 'New Email',
        receivedAt: new Date().toISOString(),
      });
      spyOn(inboxStateServiceStub, 'updateInbox');
      spyOn(inboxStateServiceStub, 'notifyNewEmail');

      const event: NewEmailEvent = {
        inboxId: inbox.inboxHash,
        emailId: 'new-email-id',
        encryptedMetadata: createEncryptedPayload(),
      };

      vaultSandboxStub.emit(event);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const updatedInbox = (inboxStateServiceStub.updateInbox as jasmine.Spy).calls.mostRecent().args[0] as InboxModel;
      expect(updatedInbox.emails.length).toBe(2);
      expect(updatedInbox.emails[0].id).toBe('new-email-id');
      expect(updatedInbox.emails[1].id).toBe('existing-email');
    });
  });
});
