import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ConfirmationService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { MailboxSidebar } from './mailbox-sidebar';
import { MailManager } from '../services/mail-manager';
import { VaultSandboxApi } from '../services/vault-sandbox-api';
import { ServerInfoService } from '../services/server-info.service';
import { SettingsManager } from '../services/settings-manager';
import { VsToast } from '../../../shared/services/vs-toast';
import { MailManagerStub, ServerInfoServiceStub, SettingsManagerStub } from '../../../../testing/mail-testing.mocks';
import { InboxModel, EmailItemModel } from '../interfaces';
import { TOAST_DURATION_MS } from '../../../shared/constants/app.constants';
import { SanitizationLevel } from '../services/settings-manager';

describe('MailboxSidebar', () => {
  let component: MailboxSidebar;
  let fixture: ComponentFixture<MailboxSidebar>;
  let mailManager: MailManagerStub;
  let apiSpy: jasmine.SpyObj<VaultSandboxApi>;
  let toastSpy: jasmine.SpyObj<VsToast>;
  let confirmationService: ConfirmationService;
  let serverInfoService: ServerInfoServiceStub;
  let settingsManager: SettingsManagerStub;

  const createMockEmail = (id: string): EmailItemModel => ({
    id,
    encryptedMetadata: null,
    isRead: false,
  });

  const createMockInbox = (overrides: Partial<InboxModel> = {}): InboxModel => ({
    emailAddress: 'test@example.com',
    expiresAt: new Date().toISOString(),
    inboxHash: 'test-inbox-hash',
    encrypted: true,
    serverSigPk: 'stub-server-sig',
    secretKey: new Uint8Array(),
    emails: [],
    ...overrides,
  });

  beforeEach(async () => {
    apiSpy = jasmine.createSpyObj('VaultSandboxApi', ['deleteEmail', 'deleteInbox']);
    apiSpy.deleteEmail.and.returnValue(of(void 0));
    apiSpy.deleteInbox.and.returnValue(of(void 0));

    toastSpy = jasmine.createSpyObj('VsToast', ['showSuccess', 'showError', 'showWarning', 'showInfo']);

    await TestBed.configureTestingModule({
      imports: [MailboxSidebar],
      providers: [
        provideZonelessChangeDetection(),
        ConfirmationService,
        { provide: MailManager, useClass: MailManagerStub },
        { provide: VaultSandboxApi, useValue: apiSpy },
        { provide: ServerInfoService, useClass: ServerInfoServiceStub },
        { provide: SettingsManager, useClass: SettingsManagerStub },
        { provide: VsToast, useValue: toastSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MailboxSidebar);
    component = fixture.componentInstance;
    mailManager = TestBed.inject(MailManager) as unknown as MailManagerStub;
    confirmationService = TestBed.inject(ConfirmationService);
    serverInfoService = TestBed.inject(ServerInfoService) as unknown as ServerInfoServiceStub;
    settingsManager = TestBed.inject(SettingsManager) as unknown as SettingsManagerStub;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('getUnreadCount', () => {
    it('returns unread count for existing inbox', () => {
      const inbox = createMockInbox({ emails: [createMockEmail('1'), createMockEmail('2')] });
      mailManager.setInboxes([inbox]);

      expect(component.getUnreadCount('test-inbox-hash')).toBe(2);
    });

    it('returns 0 for non-existent inbox', () => {
      expect(component.getUnreadCount('non-existent')).toBe(0);
    });
  });

  describe('getEmailLocalPart', () => {
    it('extracts local part before @', () => {
      expect(component.getEmailLocalPart('user@example.com')).toBe('user');
    });

    it('returns full string when no @ present', () => {
      expect(component.getEmailLocalPart('no-at-sign')).toBe('no-at-sign');
    });

    it('handles email with multiple @ signs', () => {
      expect(component.getEmailLocalPart('user@sub@example.com')).toBe('user');
    });
  });

  describe('createMailbox', () => {
    it('shows success toast when mailbox is created', async () => {
      spyOn(mailManager, 'createInbox').and.returnValue(Promise.resolve({ created: true, email: 'new@example.com' }));

      await component.createMailbox();

      expect(toastSpy.showSuccess).toHaveBeenCalledWith('Created', 'new@example.com', TOAST_DURATION_MS);
    });

    it('shows error toast when mailbox creation fails', async () => {
      spyOn(mailManager, 'createInbox').and.returnValue(Promise.resolve({ created: false, email: '' }));

      await component.createMailbox();

      expect(toastSpy.showError).toHaveBeenCalledWith('Error', 'Error Creating Mailbox', TOAST_DURATION_MS);
    });

    it('uses stored domain if it exists in allowed domains', async () => {
      let capturedDomain: string | undefined;
      spyOn(mailManager, 'createInbox').and.callFake((domain?: string) => {
        capturedDomain = domain;
        return Promise.resolve({ created: true, email: 'test@custom.com' });
      });

      // Set up server info with allowed domains using spyOnProperty
      spyOnProperty(serverInfoService, 'serverInfo').and.returnValue(
        signal({
          serverSigPk: 'stub',
          algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
          context: 'stub',
          maxTtl: 86400,
          defaultTtl: 3600,
          sseConsole: false,
          allowClearAllInboxes: true,
          allowedDomains: ['custom.com', 'other.com'],
          encryptionPolicy: 'always' as const,
          webhookEnabled: false,
          webhookRequireAuthDefault: true,
        }).asReadonly(),
      );

      // Set stored domain preference
      settingsManager.saveSettings({
        ttlSeconds: 3600,
        ttlUnit: 'hours',
        lastUsedDomain: 'custom.com',
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.DomPurify,
        timeFormat: '24h',
      });

      await component.createMailbox();

      expect(capturedDomain).toBe('custom.com');
    });

    it('uses undefined domain if stored domain is not in allowed domains', async () => {
      let capturedDomain: string | undefined = 'not-called';
      spyOn(mailManager, 'createInbox').and.callFake((domain?: string) => {
        capturedDomain = domain;
        return Promise.resolve({ created: true, email: 'test@default.com' });
      });

      settingsManager.saveSettings({
        ttlSeconds: 3600,
        ttlUnit: 'hours',
        lastUsedDomain: 'invalid.com',
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.DomPurify,
        timeFormat: '24h',
      });

      await component.createMailbox();

      expect(capturedDomain).toBeUndefined();
    });

    it('uses undefined domain when serverInfo is null', async () => {
      let capturedDomain: string | undefined = 'not-called';
      spyOn(mailManager, 'createInbox').and.callFake((domain?: string) => {
        capturedDomain = domain;
        return Promise.resolve({ created: true, email: 'test@default.com' });
      });

      // Mock serverInfo to return null
      spyOnProperty(serverInfoService, 'serverInfo').and.returnValue(signal(null).asReadonly());

      settingsManager.saveSettings({
        ttlSeconds: 3600,
        ttlUnit: 'hours',
        lastUsedDomain: 'custom.com',
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.DomPurify,
        timeFormat: '24h',
      });

      await component.createMailbox();

      // When serverInfo is null, allowedDomains defaults to [], so stored domain won't be used
      expect(capturedDomain).toBeUndefined();
    });
  });

  describe('onInboxClick', () => {
    it('calls mailManager.selectInbox with inbox hash', () => {
      const selectSpy = spyOn(mailManager, 'selectInbox');

      component.onInboxClick('test-hash');

      expect(selectSpy).toHaveBeenCalledWith('test-hash');
    });
  });

  describe('onInboxRightClick', () => {
    let contextMenuSpy: jasmine.SpyObj<{ show: jasmine.Spy }>;

    beforeEach(() => {
      contextMenuSpy = jasmine.createSpyObj('ContextMenu', ['show']);
      (component as unknown as { contextMenu: typeof contextMenuSpy }).contextMenu = contextMenuSpy;
    });

    it('prevents default event behavior', () => {
      const event = jasmine.createSpyObj('MouseEvent', ['preventDefault']);
      const inbox = createMockInbox();

      component.onInboxRightClick(event, inbox);

      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('sets selectedInboxForMenu', () => {
      const event = jasmine.createSpyObj('MouseEvent', ['preventDefault']);
      const inbox = createMockInbox();

      component.onInboxRightClick(event, inbox);

      expect((component as unknown as { selectedInboxForMenu: InboxModel }).selectedInboxForMenu).toBe(inbox);
    });

    it('builds menu items with correct labels', () => {
      const event = jasmine.createSpyObj('MouseEvent', ['preventDefault']);
      const inbox = createMockInbox();

      component.onInboxRightClick(event, inbox);

      const menuItems = (component as unknown as { menuItems: { label?: string; separator?: boolean }[] }).menuItems;
      expect(menuItems[0].label).toBe('Export Inbox');
      expect(menuItems[1].label).toBe('Webhooks');
      expect(menuItems[2].label).toBe('Forget Inbox');
      expect(menuItems[3].separator).toBe(true);
      expect(menuItems[4].label).toBe('Delete All Emails');
      expect(menuItems[5].label).toBe('Delete Inbox');
    });

    it('shows context menu at event position', () => {
      const event = jasmine.createSpyObj('MouseEvent', ['preventDefault']);
      const inbox = createMockInbox();

      component.onInboxRightClick(event, inbox);

      expect(contextMenuSpy.show).toHaveBeenCalledWith(event);
    });

    it('executes exportInbox command when Export Inbox menu item is clicked', () => {
      const event = jasmine.createSpyObj('MouseEvent', ['preventDefault']);
      const inbox = createMockInbox();
      const exportSpy = spyOn(component, 'exportInbox');

      spyOn(URL, 'createObjectURL').and.returnValue('blob:mock');
      spyOn(URL, 'revokeObjectURL');
      spyOn(document, 'createElement').and.returnValue(document.createElement('a'));

      component.onInboxRightClick(event, inbox);

      const menuItems = (component as unknown as { menuItems: { command?: () => void }[] }).menuItems;
      menuItems[0].command?.(); // Export Inbox

      expect(exportSpy).toHaveBeenCalledWith(inbox);
    });

    it('emits openInboxWebhooks when Webhooks menu item is clicked', () => {
      const event = jasmine.createSpyObj('MouseEvent', ['preventDefault']);
      const inbox = createMockInbox();
      const webhooksSpy = spyOn(component.openInboxWebhooks, 'emit');

      component.onInboxRightClick(event, inbox);

      const menuItems = (component as unknown as { menuItems: { command?: () => void }[] }).menuItems;
      menuItems[1].command?.(); // Webhooks

      expect(webhooksSpy).toHaveBeenCalledWith(inbox);
    });

    it('executes forgetInbox command when Forget Inbox menu item is clicked', () => {
      const event = jasmine.createSpyObj('MouseEvent', ['preventDefault']);
      const inbox = createMockInbox();
      const forgetSpy = spyOn(component, 'forgetInbox');

      component.onInboxRightClick(event, inbox);

      const menuItems = (component as unknown as { menuItems: { command?: () => void }[] }).menuItems;
      menuItems[2].command?.(); // Forget Inbox (index 2, after Webhooks at 1)

      expect(forgetSpy).toHaveBeenCalledWith(inbox);
    });

    it('executes deleteAllEmails command when Delete All Emails menu item is clicked', () => {
      const event = jasmine.createSpyObj('MouseEvent', ['preventDefault']);
      const inbox = createMockInbox();
      const deleteAllSpy = spyOn(component, 'deleteAllEmails');

      component.onInboxRightClick(event, inbox);

      const menuItems = (component as unknown as { menuItems: { command?: () => void }[] }).menuItems;
      menuItems[4].command?.(); // Delete All Emails (index 4, after separator at 3)

      expect(deleteAllSpy).toHaveBeenCalledWith(inbox);
    });

    it('executes deleteInbox command when Delete Inbox menu item is clicked', () => {
      const event = jasmine.createSpyObj('MouseEvent', ['preventDefault']);
      const inbox = createMockInbox();
      const deleteSpy = spyOn(component, 'deleteInbox');

      component.onInboxRightClick(event, inbox);

      const menuItems = (component as unknown as { menuItems: { command?: () => void }[] }).menuItems;
      menuItems[5].command?.(); // Delete Inbox (index 5)

      expect(deleteSpy).toHaveBeenCalledWith(inbox);
    });
  });

  describe('deleteAllEmails', () => {
    let confirmSpy: jasmine.Spy;

    beforeEach(() => {
      confirmSpy = spyOn(confirmationService, 'confirm');
    });

    it('shows info toast when inbox has no emails', () => {
      const inbox = createMockInbox({ emails: [] });

      component.deleteAllEmails(inbox);

      expect(toastSpy.showInfo).toHaveBeenCalledWith(
        'No Emails',
        'This inbox has no emails to delete',
        TOAST_DURATION_MS,
      );
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('shows confirmation with singular email text for 1 email', () => {
      const inbox = createMockInbox({ emails: [createMockEmail('1')] });

      component.deleteAllEmails(inbox);

      expect(confirmSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          message: 'Are you sure you want to delete all 1 email from test@example.com? This action cannot be undone.',
        }),
      );
    });

    it('shows confirmation with plural email text for multiple emails', () => {
      const inbox = createMockInbox({ emails: [createMockEmail('1'), createMockEmail('2')] });

      component.deleteAllEmails(inbox);

      expect(confirmSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          message: 'Are you sure you want to delete all 2 emails from test@example.com? This action cannot be undone.',
        }),
      );
    });

    it('deletes all emails successfully', async () => {
      const inbox = createMockInbox({ emails: [createMockEmail('1'), createMockEmail('2')] });
      const deleteEmailSpy = spyOn(mailManager, 'deleteEmail');

      confirmSpy.and.callFake((options: { accept: () => Promise<void> }) => {
        options.accept();
      });

      component.deleteAllEmails(inbox);
      await fixture.whenStable();

      expect(apiSpy.deleteEmail).toHaveBeenCalledTimes(2);
      expect(deleteEmailSpy).toHaveBeenCalledTimes(2);
      expect(toastSpy.showSuccess).toHaveBeenCalledWith(
        'Deleted',
        'All 2 emails deleted successfully',
        TOAST_DURATION_MS,
      );
    });

    it('shows warning toast on partial deletion failure', async () => {
      const inbox = createMockInbox({ emails: [createMockEmail('1'), createMockEmail('2')] });
      spyOn(mailManager, 'deleteEmail');
      spyOn(console, 'error');

      let callCount = 0;
      apiSpy.deleteEmail.and.callFake(() => {
        callCount++;
        if (callCount === 2) {
          return throwError(() => new Error('API Error'));
        }
        return of(void 0);
      });

      confirmSpy.and.callFake((options: { accept: () => Promise<void> }) => {
        options.accept();
      });

      component.deleteAllEmails(inbox);
      await fixture.whenStable();

      expect(toastSpy.showWarning).toHaveBeenCalledWith(
        'Partially Deleted',
        '1 emails deleted, 1 failed',
        TOAST_DURATION_MS,
      );
    });

    it('shows error toast when all deletions fail', async () => {
      const inbox = createMockInbox({ emails: [createMockEmail('1'), createMockEmail('2')] });
      spyOn(console, 'error');
      apiSpy.deleteEmail.and.returnValue(throwError(() => new Error('API Error')));

      confirmSpy.and.callFake((options: { accept: () => Promise<void> }) => {
        options.accept();
      });

      component.deleteAllEmails(inbox);
      await fixture.whenStable();

      expect(toastSpy.showError).toHaveBeenCalledWith('Error', 'Failed to delete emails', TOAST_DURATION_MS);
    });
  });

  describe('deleteInbox', () => {
    let confirmSpy: jasmine.Spy;

    beforeEach(() => {
      confirmSpy = spyOn(confirmationService, 'confirm');
    });

    it('shows confirmation dialog with inbox email', () => {
      const inbox = createMockInbox();

      component.deleteInbox(inbox);

      expect(confirmSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          header: 'Delete Inbox',
          message: 'Are you sure you want to delete test@example.com? This action cannot be undone.',
        }),
      );
    });

    it('deletes inbox successfully on accept', async () => {
      const inbox = createMockInbox();
      const deleteInboxSpy = spyOn(mailManager, 'deleteInbox');
      const subscribeSpy = spyOn(mailManager, 'subscribeToAllInboxes').and.returnValue(Promise.resolve());

      confirmSpy.and.callFake((options: { accept: () => Promise<void> }) => {
        options.accept();
      });

      component.deleteInbox(inbox);
      await fixture.whenStable();

      expect(apiSpy.deleteInbox).toHaveBeenCalledWith('test@example.com');
      expect(deleteInboxSpy).toHaveBeenCalledWith('test-inbox-hash');
      expect(subscribeSpy).toHaveBeenCalled();
      expect(toastSpy.showSuccess).toHaveBeenCalledWith(
        'Deleted',
        'Inbox deleted: test@example.com',
        TOAST_DURATION_MS,
      );
    });

    it('shows error toast when API fails', async () => {
      const inbox = createMockInbox();
      spyOn(console, 'error');
      apiSpy.deleteInbox.and.returnValue(throwError(() => new Error('API Error')));

      confirmSpy.and.callFake((options: { accept: () => Promise<void> }) => {
        options.accept();
      });

      component.deleteInbox(inbox);
      await fixture.whenStable();

      expect(toastSpy.showError).toHaveBeenCalledWith('Error', 'Failed to delete inbox', TOAST_DURATION_MS);
    });
  });

  describe('forgetInbox', () => {
    it('forgets inbox successfully', async () => {
      const inbox = createMockInbox();
      const deleteInboxSpy = spyOn(mailManager, 'deleteInbox');
      const subscribeSpy = spyOn(mailManager, 'subscribeToAllInboxes').and.returnValue(Promise.resolve());

      await component.forgetInbox(inbox);

      expect(deleteInboxSpy).toHaveBeenCalledWith('test-inbox-hash');
      expect(subscribeSpy).toHaveBeenCalled();
      expect(toastSpy.showSuccess).toHaveBeenCalledWith(
        'Forgotten',
        'Inbox removed from list: test@example.com',
        TOAST_DURATION_MS,
      );
    });

    it('shows error toast on failure', async () => {
      const inbox = createMockInbox();
      spyOn(console, 'error');
      spyOn(mailManager, 'deleteInbox').and.throwError('Error');

      await component.forgetInbox(inbox);

      expect(toastSpy.showError).toHaveBeenCalledWith('Error', 'Failed to forget inbox', TOAST_DURATION_MS);
    });
  });

  describe('exportInbox', () => {
    let createObjectURLSpy: jasmine.Spy;
    let revokeObjectURLSpy: jasmine.Spy;
    let mockLink: HTMLAnchorElement;

    beforeEach(() => {
      createObjectURLSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:mock-url');
      revokeObjectURLSpy = spyOn(URL, 'revokeObjectURL');

      mockLink = document.createElement('a');
      spyOn(mockLink, 'click');
      spyOn(document, 'createElement').and.returnValue(mockLink);
    });

    it('exports inbox successfully', () => {
      const inbox = createMockInbox();

      component.exportInbox(inbox);

      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(mockLink.download).toBe('inbox-test_at_example.com.json');
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
      expect(toastSpy.showSuccess).toHaveBeenCalledWith(
        'Exported',
        'Inbox exported: inbox-test_at_example.com.json',
        TOAST_DURATION_MS,
      );
    });

    it('shows error toast when exportInboxMetadata returns null', () => {
      const inbox = createMockInbox();
      spyOn(mailManager, 'exportInboxMetadata').and.returnValue(null as never);

      component.exportInbox(inbox);

      expect(toastSpy.showError).toHaveBeenCalledWith('Error', 'Failed to export inbox', TOAST_DURATION_MS);
    });

    it('shows error toast on exception', () => {
      const inbox = createMockInbox();
      spyOn(console, 'error');
      spyOn(mailManager, 'exportInboxMetadata').and.throwError('Export error');

      component.exportInbox(inbox);

      expect(toastSpy.showError).toHaveBeenCalledWith('Error', 'Failed to export inbox', TOAST_DURATION_MS);
    });

    it('sanitizes special characters in filename', () => {
      const inbox = createMockInbox({ emailAddress: 'user+tag@sub.example.com' });

      component.exportInbox(inbox);

      expect(mockLink.download).toBe('inbox-user_tag_at_sub.example.com.json');
    });
  });

  describe('openCustomInboxDialog', () => {
    it('sets showCustomInboxDialog to true', () => {
      component.openCustomInboxDialog();

      expect((component as unknown as { showCustomInboxDialog: () => boolean }).showCustomInboxDialog()).toBe(true);
    });
  });

  describe('createInboxMenuItems', () => {
    it('disables Custom option when no allowed domains', () => {
      spyOnProperty(serverInfoService, 'serverInfo').and.returnValue(
        signal({
          serverSigPk: 'stub',
          algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
          context: 'stub',
          maxTtl: 86400,
          defaultTtl: 3600,
          sseConsole: false,
          allowClearAllInboxes: true,
          allowedDomains: [],
          encryptionPolicy: 'always' as const,
          webhookEnabled: false,
          webhookRequireAuthDefault: true,
        }).asReadonly(),
      );

      const menuItems = (
        component as unknown as { createInboxMenuItems: () => { disabled: boolean }[] }
      ).createInboxMenuItems();
      expect(menuItems[0].disabled).toBe(true);
    });

    it('enables Custom option when allowed domains exist', () => {
      spyOnProperty(serverInfoService, 'serverInfo').and.returnValue(
        signal({
          serverSigPk: 'stub',
          algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
          context: 'stub',
          maxTtl: 86400,
          defaultTtl: 3600,
          sseConsole: false,
          allowClearAllInboxes: true,
          allowedDomains: ['example.com'],
          encryptionPolicy: 'always' as const,
          webhookEnabled: false,
          webhookRequireAuthDefault: true,
        }).asReadonly(),
      );

      const menuItems = (
        component as unknown as { createInboxMenuItems: () => { disabled: boolean }[] }
      ).createInboxMenuItems();
      expect(menuItems[0].disabled).toBe(false);
    });

    it('calls openCustomInboxDialog when Custom command is executed', () => {
      const openDialogSpy = spyOn(component, 'openCustomInboxDialog');

      const menuItems = (
        component as unknown as { createInboxMenuItems: () => { command?: () => void }[] }
      ).createInboxMenuItems();
      menuItems[0].command?.();

      expect(openDialogSpy).toHaveBeenCalled();
    });

    it('handles null serverInfo gracefully', () => {
      spyOnProperty(serverInfoService, 'serverInfo').and.returnValue(signal(null).asReadonly());

      const menuItems = (
        component as unknown as { createInboxMenuItems: () => { disabled: boolean }[] }
      ).createInboxMenuItems();
      expect(menuItems[0].disabled).toBe(true);
    });
  });
});
