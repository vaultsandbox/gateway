import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { MailManager } from '../mail-manager';
import { InboxService } from '../inbox.service';
import { EmailService } from '../email.service';
import { VaultSandboxApi } from '../vault-sandbox-api';
import { EncryptionService } from '../encryption.service';
import { VaultSandbox } from '../../../../shared/services/vault-sandbox';
import { VsToast } from '../../../../shared/services/vs-toast';
import { SettingsManager } from '../settings-manager';
import { ExportedInboxData, InboxModel, EmailItemModel } from '../../interfaces';
import {
  EncryptionServiceStub,
  SettingsManagerStub,
  VaultSandboxApiStub,
  VaultSandboxStub,
  VsToastStub,
} from '../../../../../testing/mail-testing.mocks';

describe('MailManager', () => {
  let service: MailManager;
  let inboxService: InboxService;
  let emailService: EmailService;

  const mockInbox: InboxModel = {
    emailAddress: 'test@example.com',
    expiresAt: new Date().toISOString(),
    inboxHash: 'test-hash',
    serverSigPk: 'test-server-sig',
    secretKey: new Uint8Array(),
    emails: [],
  };

  const mockEmail: EmailItemModel = {
    id: 'email-id',
    encryptedMetadata: null,
    decryptedMetadata: {
      from: 'sender@example.com',
      to: 'test@example.com',
      subject: 'Test Subject',
      receivedAt: new Date().toISOString(),
    },
    isRead: false,
    isLoadingBody: false,
  };

  const mockExportedData: ExportedInboxData = {
    version: 1,
    emailAddress: 'test@example.com',
    expiresAt: new Date().toISOString(),
    inboxHash: 'test-hash',
    serverSigPk: 'test-server-sig',
    secretKey: '',
    exportedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: VaultSandboxApi, useClass: VaultSandboxApiStub },
        { provide: EncryptionService, useClass: EncryptionServiceStub },
        { provide: VaultSandbox, useClass: VaultSandboxStub },
        { provide: VsToast, useClass: VsToastStub },
        { provide: SettingsManager, useClass: SettingsManagerStub },
      ],
    });
    service = TestBed.inject(MailManager);
    inboxService = TestBed.inject(InboxService);
    emailService = TestBed.inject(EmailService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('inboxes getter', () => {
    it('should delegate to inboxService.inboxes', () => {
      const spy = spyOnProperty(inboxService, 'inboxes', 'get').and.returnValue([mockInbox]);

      const result = service.inboxes;

      expect(spy).toHaveBeenCalled();
      expect(result).toEqual([mockInbox]);
    });
  });

  describe('unreadCountByInbox getter', () => {
    it('should delegate to inboxService.unreadCountByInbox', () => {
      const mockSignal = signal<Record<string, number>>({ 'test-hash': 5 });
      const spy = spyOnProperty(inboxService, 'unreadCountByInbox', 'get').and.returnValue(mockSignal);

      const result = service.unreadCountByInbox;

      expect(spy).toHaveBeenCalled();
      expect(result()).toEqual({ 'test-hash': 5 });
    });
  });

  describe('getUnreadCount', () => {
    it('should delegate to inboxService.getUnreadCount', () => {
      const spy = spyOn(inboxService, 'getUnreadCount').and.returnValue(3);

      const result = service.getUnreadCount('test-hash');

      expect(spy).toHaveBeenCalledWith('test-hash');
      expect(result).toBe(3);
    });
  });

  describe('selectedInbox getter', () => {
    it('should delegate to inboxService.selectedInbox', () => {
      const mockSignal = signal<InboxModel | null>(mockInbox);
      const spy = spyOnProperty(inboxService, 'selectedInbox', 'get').and.returnValue(mockSignal);

      const result = service.selectedInbox;

      expect(spy).toHaveBeenCalled();
      expect(result()).toEqual(mockInbox);
    });
  });

  describe('selectedEmail getter', () => {
    it('should delegate to emailService.selectedEmail', () => {
      const mockSignal = signal<EmailItemModel | null>(mockEmail);
      const spy = spyOnProperty(emailService, 'selectedEmail', 'get').and.returnValue(mockSignal);

      const result = service.selectedEmail;

      expect(spy).toHaveBeenCalled();
      expect(result()).toEqual(mockEmail);
    });
  });

  describe('createInbox', () => {
    it('should delegate to inboxService.createInbox', async () => {
      const spy = spyOn(inboxService, 'createInbox').and.resolveTo({ created: true, email: 'new@example.com' });

      const result = await service.createInbox('new@example.com', 3600);

      expect(spy).toHaveBeenCalledWith('new@example.com', 3600);
      expect(result).toEqual({ created: true, email: 'new@example.com' });
    });

    it('should call without arguments when none provided', async () => {
      const spy = spyOn(inboxService, 'createInbox').and.resolveTo({ created: true, email: 'auto@example.com' });

      const result = await service.createInbox();

      expect(spy).toHaveBeenCalledWith(undefined, undefined);
      expect(result).toEqual({ created: true, email: 'auto@example.com' });
    });
  });

  describe('subscribeToAllInboxes', () => {
    it('should delegate to inboxService.subscribeToAllInboxes', async () => {
      const spy = spyOn(inboxService, 'subscribeToAllInboxes').and.resolveTo();

      await service.subscribeToAllInboxes();

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('selectInbox', () => {
    it('should call inboxService.selectInbox and emailService.deselectEmail', () => {
      const selectSpy = spyOn(inboxService, 'selectInbox');
      const deselectSpy = spyOn(emailService, 'deselectEmail');

      service.selectInbox('test-hash');

      expect(selectSpy).toHaveBeenCalledWith('test-hash');
      expect(deselectSpy).toHaveBeenCalled();
    });
  });

  describe('deleteInbox', () => {
    it('should call inboxService.deleteInbox and emailService.deselectEmail', () => {
      const deleteSpy = spyOn(inboxService, 'deleteInbox');
      const deselectSpy = spyOn(emailService, 'deselectEmail');

      service.deleteInbox('test-hash');

      expect(deleteSpy).toHaveBeenCalledWith('test-hash');
      expect(deselectSpy).toHaveBeenCalled();
    });
  });

  describe('exportInboxMetadata', () => {
    it('should delegate to inboxService.exportInboxMetadata', () => {
      const spy = spyOn(inboxService, 'exportInboxMetadata').and.returnValue(mockExportedData);

      const result = service.exportInboxMetadata('test-hash');

      expect(spy).toHaveBeenCalledWith('test-hash');
      expect(result).toEqual(mockExportedData);
    });

    it('should return null when inbox not found', () => {
      const spy = spyOn(inboxService, 'exportInboxMetadata').and.returnValue(null);

      const result = service.exportInboxMetadata('nonexistent-hash');

      expect(spy).toHaveBeenCalledWith('nonexistent-hash');
      expect(result).toBeNull();
    });
  });

  describe('clearLocalStorage', () => {
    it('should delegate to inboxService.clearLocalStorage', () => {
      const spy = spyOn(inboxService, 'clearLocalStorage');

      service.clearLocalStorage();

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('importInbox', () => {
    it('should delegate to inboxService.importInbox', () => {
      const spy = spyOn(inboxService, 'importInbox').and.returnValue({
        success: true,
        message: 'Imported successfully',
        emailAddress: 'test@example.com',
      });

      const result = service.importInbox(mockExportedData);

      expect(spy).toHaveBeenCalledWith(mockExportedData);
      expect(result).toEqual({
        success: true,
        message: 'Imported successfully',
        emailAddress: 'test@example.com',
      });
    });
  });

  describe('importMultipleInboxes', () => {
    it('should delegate to inboxService.importMultipleInboxes', async () => {
      const mockFiles = [new File(['{}'], 'inbox1.json'), new File(['{}'], 'inbox2.json')];
      const spy = spyOn(inboxService, 'importMultipleInboxes').and.resolveTo([
        { filename: 'inbox1.json', success: true, message: 'Imported' },
        { filename: 'inbox2.json', success: true, message: 'Imported' },
      ]);

      const result = await service.importMultipleInboxes(mockFiles);

      expect(spy).toHaveBeenCalledWith(mockFiles);
      expect(result).toEqual([
        { filename: 'inbox1.json', success: true, message: 'Imported' },
        { filename: 'inbox2.json', success: true, message: 'Imported' },
      ]);
    });
  });

  describe('selectEmail', () => {
    it('should call inboxService.selectInbox and emailService.selectEmail', () => {
      const selectInboxSpy = spyOn(inboxService, 'selectInbox');
      const selectEmailSpy = spyOn(emailService, 'selectEmail');

      service.selectEmail('test-hash', 'email-id');

      expect(selectInboxSpy).toHaveBeenCalledWith('test-hash');
      expect(selectEmailSpy).toHaveBeenCalledWith('test-hash', 'email-id');
    });
  });

  describe('deselectEmail', () => {
    it('should delegate to emailService.deselectEmail', () => {
      const spy = spyOn(emailService, 'deselectEmail');

      service.deselectEmail();

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('fetchAndDecryptEmail', () => {
    it('should delegate to emailService.fetchAndDecryptEmail', async () => {
      const spy = spyOn(emailService, 'fetchAndDecryptEmail').and.resolveTo();

      await service.fetchAndDecryptEmail('test-hash', 'email-id');

      expect(spy).toHaveBeenCalledWith('test-hash', 'email-id');
    });
  });

  describe('fetchAndDecryptRawEmail', () => {
    it('should delegate to emailService.fetchAndDecryptRawEmail', async () => {
      const spy = spyOn(emailService, 'fetchAndDecryptRawEmail').and.resolveTo('raw-email-content');

      const result = await service.fetchAndDecryptRawEmail('test-hash', 'email-id');

      expect(spy).toHaveBeenCalledWith('test-hash', 'email-id');
      expect(result).toBe('raw-email-content');
    });
  });

  describe('markEmailAsRead', () => {
    it('should delegate to emailService.markEmailAsRead', async () => {
      const spy = spyOn(emailService, 'markEmailAsRead').and.resolveTo();

      await service.markEmailAsRead('test-hash', 'email-id');

      expect(spy).toHaveBeenCalledWith('test-hash', 'email-id');
    });
  });

  describe('deleteEmail', () => {
    it('should delegate to emailService.deleteEmail', () => {
      const spy = spyOn(emailService, 'deleteEmail');

      service.deleteEmail('test-hash', 'email-id');

      expect(spy).toHaveBeenCalledWith('test-hash', 'email-id');
    });
  });

  describe('loadEmailsForInbox', () => {
    it('should delegate to inboxService.loadEmailsForInbox', async () => {
      const spy = spyOn(inboxService, 'loadEmailsForInbox').and.resolveTo();

      await service.loadEmailsForInbox('test-hash');

      expect(spy).toHaveBeenCalledWith('test-hash');
    });
  });
});
