import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal, Signal } from '@angular/core';
import { Mail } from './mail';
import { MailManager } from './services/mail-manager';
import { VaultSandbox } from '../../shared/services/vault-sandbox';
import { VsThemeManagerService } from '../../shared/services/vs-theme-manager-service';
import { VsToast } from '../../shared/services/vs-toast';
import { ConfirmationService } from 'primeng/api';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { SettingsManager, SanitizationLevel } from './services/settings-manager';
import { ServerInfoService } from './services/server-info.service';
import { ChaosService } from './chaos/services/chaos.service';
import { ChaosConfigResponse } from './chaos/interfaces/chaos.interfaces';
import { of, throwError } from 'rxjs';
import {
  MailManagerStub,
  VaultSandboxStub,
  VsThemeManagerServiceStub,
  VsToastStub,
  SettingsManagerStub,
} from '../../../testing/mail-testing.mocks';
import { InboxModel, ServerInfo } from './interfaces';

// Stub for ChaosService
class ChaosServiceStub implements Partial<ChaosService> {
  private response: ChaosConfigResponse = { enabled: false };
  private error: Error | null = null;

  setResponse(response: ChaosConfigResponse): void {
    this.response = response;
    this.error = null;
  }

  setError(error: Error): void {
    this.error = error;
  }

  get(emailAddress: string) {
    void emailAddress;
    if (this.error) {
      return throwError(() => this.error);
    }
    return of(this.response);
  }

  set(emailAddress: string, config: ChaosConfigResponse) {
    void emailAddress;
    return of(config);
  }

  disable(emailAddress: string) {
    void emailAddress;
    return of(void 0);
  }
}

// Testable stub that allows modifying serverInfo
class TestableServerInfoServiceStub implements Partial<ServerInfoService> {
  private readonly serverInfoSignal = signal<ServerInfo | null>({
    serverSigPk: 'stub',
    algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
    context: 'stub',
    maxTtl: 86400,
    defaultTtl: 3600,
    sseConsole: false,
    allowClearAllInboxes: true,
    allowedDomains: [],
    encryptionPolicy: 'always',
    webhookEnabled: false,
    webhookRequireAuthDefault: true,
    spamAnalysisEnabled: false,
    chaosEnabled: false,
  });

  get serverInfo(): Signal<ServerInfo | null> {
    return this.serverInfoSignal.asReadonly();
  }

  setServerInfo(info: ServerInfo | null): void {
    this.serverInfoSignal.set(info);
  }

  async getServerInfo(): Promise<ServerInfo | null> {
    return this.serverInfoSignal();
  }
}

describe('Mail', () => {
  let component: Mail;
  let fixture: ComponentFixture<Mail>;
  let mailManagerStub: MailManagerStub;
  let vaultSandboxStub: VaultSandboxStub;
  let vsThemeManagerServiceStub: VsThemeManagerServiceStub;
  let vsToastStub: VsToastStub;
  let settingsManagerStub: SettingsManagerStub;
  let serverInfoServiceStub: TestableServerInfoServiceStub;
  let chaosServiceStub: ChaosServiceStub;

  beforeEach(async () => {
    mailManagerStub = new MailManagerStub();
    vaultSandboxStub = new VaultSandboxStub();
    vsThemeManagerServiceStub = new VsThemeManagerServiceStub();
    vsToastStub = new VsToastStub();
    settingsManagerStub = new SettingsManagerStub();
    serverInfoServiceStub = new TestableServerInfoServiceStub();
    chaosServiceStub = new ChaosServiceStub();

    await TestBed.configureTestingModule({
      imports: [Mail, HttpClientTestingModule],
      providers: [
        provideZonelessChangeDetection(),
        ConfirmationService,
        { provide: MailManager, useValue: mailManagerStub },
        { provide: VaultSandbox, useValue: vaultSandboxStub },
        { provide: VsThemeManagerService, useValue: vsThemeManagerServiceStub },
        { provide: VsToast, useValue: vsToastStub },
        { provide: SettingsManager, useValue: settingsManagerStub },
        { provide: ServerInfoService, useValue: serverInfoServiceStub },
        { provide: ChaosService, useValue: chaosServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Mail);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('dateFormat', () => {
    it('should return 24-hour format when timeFormat is 24h', () => {
      settingsManagerStub.saveSettings({
        ttlSeconds: 3600,
        ttlUnit: 'hours',
        lastUsedDomain: '',
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.DomPurify,
        timeFormat: '24h',
      });

      expect(component.dateFormat()).toBe('M/d/yy, HH:mm');
    });

    it('should return 12-hour format when timeFormat is 12h', () => {
      settingsManagerStub.saveSettings({
        ttlSeconds: 3600,
        ttlUnit: 'hours',
        lastUsedDomain: '',
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.DomPurify,
        timeFormat: '12h',
      });

      expect(component.dateFormat()).toBe('M/d/yy, h:mm a');
    });
  });

  describe('topLeftMenuitems', () => {
    it('should include Console menu item when sseConsole is enabled', () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: true,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: false,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: false,
      });

      const menuItems = component.topLeftMenuitems();
      const consoleItem = menuItems.find((item) => item.label === 'Console');
      expect(consoleItem).toBeTruthy();
    });

    it('should not include Console menu item when sseConsole is disabled', () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: false,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: false,
      });

      const menuItems = component.topLeftMenuitems();
      const consoleItem = menuItems.find((item) => item.label === 'Console');
      expect(consoleItem).toBeUndefined();
    });

    it('should handle null serverInfo gracefully', () => {
      serverInfoServiceStub.setServerInfo(null);

      const menuItems = component.topLeftMenuitems();
      const consoleItem = menuItems.find((item) => item.label === 'Console');
      expect(consoleItem).toBeUndefined();
    });

    it('should include Webhooks menu item when webhookEnabled is true', () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: true,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: false,
      });

      const menuItems = component.topLeftMenuitems();
      const webhooksItem = menuItems.find((item) => item.label === 'Webhooks');
      expect(webhooksItem).toBeTruthy();
    });

    it('should not include Webhooks menu item when webhookEnabled is false', () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: false,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: false,
      });

      const menuItems = component.topLeftMenuitems();
      const webhooksItem = menuItems.find((item) => item.label === 'Webhooks');
      expect(webhooksItem).toBeUndefined();
    });

    it('should execute Webhooks menu command', () => {
      spyOn(component, 'openWebhooksDialog');

      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: true,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: false,
      });

      const menuItems = component.topLeftMenuitems();
      const webhooksItem = menuItems.find((item) => item.label === 'Webhooks');
      webhooksItem?.command?.({} as never);

      expect(component.openWebhooksDialog).toHaveBeenCalled();
    });

    it('should show Light Mode when in dark mode', () => {
      vsThemeManagerServiceStub.switchHtmlDarkLight(); // Set to dark mode

      // Re-trigger computed by calling switchTheme
      component.switchTheme();
      component.switchTheme(); // Back to dark

      const menuItems = component.topLeftMenuitems();
      const themeItem = menuItems.find((item) => item.label === 'Light Mode' || item.label === 'Dark Mode');
      expect(themeItem?.label).toBe('Light Mode');
      expect(themeItem?.icon).toBe('pi pi-fw pi-sun');
    });

    it('should show Dark Mode when in light mode', () => {
      const menuItems = component.topLeftMenuitems();
      const themeItem = menuItems.find((item) => item.label === 'Light Mode' || item.label === 'Dark Mode');
      expect(themeItem?.label).toBe('Dark Mode');
      expect(themeItem?.icon).toBe('pi pi-fw pi-moon');
    });

    it('should execute menu commands', () => {
      spyOn(component, 'openImportDialog');
      spyOn(component, 'openMetricsDialog');
      spyOn(component, 'openSettingsDialog');
      spyOn(component, 'switchTheme');
      spyOn(component, 'doLogout');
      spyOn(component, 'openConsoleDialog');

      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: true,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: false,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: false,
      });

      const menuItems = component.topLeftMenuitems();

      const importItem = menuItems.find((item) => item.label === 'Import Inbox');
      const metricsItem = menuItems.find((item) => item.label === 'Metrics');
      const consoleItem = menuItems.find((item) => item.label === 'Console');
      const settingsItem = menuItems.find((item) => item.label === 'Settings');
      const themeItem = menuItems.find((item) => item.label === 'Light Mode' || item.label === 'Dark Mode');
      const logoutItem = menuItems.find((item) => item.label === 'Logout');

      importItem?.command?.({} as never);
      metricsItem?.command?.({} as never);
      consoleItem?.command?.({} as never);
      settingsItem?.command?.({} as never);
      themeItem?.command?.({} as never);
      logoutItem?.command?.({} as never);

      expect(component.openImportDialog).toHaveBeenCalled();
      expect(component.openMetricsDialog).toHaveBeenCalled();
      expect(component.openConsoleDialog).toHaveBeenCalled();
      expect(component.openSettingsDialog).toHaveBeenCalled();
      expect(component.switchTheme).toHaveBeenCalled();
      expect(component.doLogout).toHaveBeenCalled();
    });
  });

  describe('doLogout', () => {
    it('should clear mail manager storage and vault sandbox API key', () => {
      spyOn(mailManagerStub, 'clearLocalStorage');
      spyOn(vaultSandboxStub, 'clearApiKey');

      component.doLogout();

      expect(mailManagerStub.clearLocalStorage).toHaveBeenCalled();
      expect(vaultSandboxStub.clearApiKey).toHaveBeenCalled();
    });
  });

  describe('switchTheme', () => {
    it('should toggle theme mode', () => {
      spyOn(vsThemeManagerServiceStub, 'switchHtmlDarkLight').and.callThrough();

      expect(vsThemeManagerServiceStub.isDarkMode()).toBe(false);

      component.switchTheme();

      expect(vsThemeManagerServiceStub.switchHtmlDarkLight).toHaveBeenCalled();
      expect(vsThemeManagerServiceStub.isDarkMode()).toBe(true);
    });
  });

  describe('copyToClipboard', () => {
    it('should copy text to clipboard', async () => {
      const mockClipboard = {
        writeText: jasmine.createSpy('writeText').and.returnValue(Promise.resolve()),
      };
      Object.defineProperty(navigator, 'clipboard', {
        value: mockClipboard,
        writable: true,
        configurable: true,
      });

      await component.copyToClipboard('test text');

      expect(mockClipboard.writeText).toHaveBeenCalledWith('test text');
    });

    it('should handle clipboard error gracefully', async () => {
      const mockClipboard = {
        writeText: jasmine.createSpy('writeText').and.returnValue(Promise.reject(new Error('Clipboard error'))),
      };
      Object.defineProperty(navigator, 'clipboard', {
        value: mockClipboard,
        writable: true,
        configurable: true,
      });

      spyOn(console, 'error');

      await component.copyToClipboard('test text');

      expect(console.error).toHaveBeenCalledWith('Failed to copy to clipboard:', jasmine.any(Error));
    });
  });

  describe('handleEmailSelected', () => {
    it('should do nothing when no inbox is selected', async () => {
      spyOn(mailManagerStub, 'selectEmail');

      await component.handleEmailSelected('email-123');

      expect(mailManagerStub.selectEmail).not.toHaveBeenCalled();
    });

    it('should select email, switch to detail view, mark as read, and fetch email', async () => {
      const mockInbox: InboxModel = {
        emailAddress: 'test@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'inbox-hash-123',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'sig-pk',
        secretKey: new Uint8Array(),
        emails: [],
      };
      mailManagerStub.setInboxes([mockInbox]);

      spyOn(mailManagerStub, 'selectEmail').and.callThrough();
      spyOn(mailManagerStub, 'markEmailAsRead').and.callThrough();
      spyOn(mailManagerStub, 'fetchAndDecryptEmail').and.callThrough();

      await component.handleEmailSelected('email-123');

      expect(mailManagerStub.selectEmail).toHaveBeenCalledWith('inbox-hash-123', 'email-123');
      expect(component.viewMode()).toBe('detail');
      expect(mailManagerStub.markEmailAsRead).toHaveBeenCalledWith('inbox-hash-123', 'email-123');
      expect(mailManagerStub.fetchAndDecryptEmail).toHaveBeenCalledWith('inbox-hash-123', 'email-123');
    });
  });

  describe('handleBackToList', () => {
    it('should deselect email and switch to list view', () => {
      spyOn(mailManagerStub, 'deselectEmail');
      component.viewMode.set('detail');

      component.handleBackToList();

      expect(mailManagerStub.deselectEmail).toHaveBeenCalled();
      expect(component.viewMode()).toBe('list');
    });
  });

  describe('handleRefresh', () => {
    it('should do nothing when no inbox is selected', async () => {
      spyOn(mailManagerStub, 'loadEmailsForInbox');

      await component.handleRefresh();

      expect(mailManagerStub.loadEmailsForInbox).not.toHaveBeenCalled();
    });

    it('should load emails for selected inbox', async () => {
      const mockInbox: InboxModel = {
        emailAddress: 'test@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'inbox-hash-123',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'sig-pk',
        secretKey: new Uint8Array(),
        emails: [],
      };
      mailManagerStub.setInboxes([mockInbox]);

      spyOn(mailManagerStub, 'loadEmailsForInbox').and.callThrough();

      await component.handleRefresh();

      expect(mailManagerStub.loadEmailsForInbox).toHaveBeenCalledWith('inbox-hash-123');
    });

    it('should handle errors gracefully', async () => {
      const mockInbox: InboxModel = {
        emailAddress: 'test@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'inbox-hash-123',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'sig-pk',
        secretKey: new Uint8Array(),
        emails: [],
      };
      mailManagerStub.setInboxes([mockInbox]);

      spyOn(mailManagerStub, 'loadEmailsForInbox').and.returnValue(Promise.reject(new Error('Network error')));
      spyOn(console, 'error');

      await component.handleRefresh();

      expect(console.error).toHaveBeenCalledWith('[Mail] Error refreshing emails:', jasmine.any(Error));
    });
  });

  describe('openImportDialog', () => {
    it('should create file input and trigger click', () => {
      const mockInput = document.createElement('input');
      spyOn(document, 'createElement').and.returnValue(mockInput);
      spyOn(mockInput, 'click');

      component.openImportDialog();

      expect(document.createElement).toHaveBeenCalledWith('input');
      expect(mockInput.type).toBe('file');
      expect(mockInput.accept).toBe('.json');
      expect(mockInput.multiple).toBe(true);
      expect(mockInput.click).toHaveBeenCalled();
    });

    it('should handle file selection', async () => {
      const mockInput = document.createElement('input');
      spyOn(document, 'createElement').and.returnValue(mockInput);
      spyOn(mockInput, 'click');
      spyOn(component, 'handleImportFiles').and.returnValue(Promise.resolve());

      component.openImportDialog();

      const mockFile = new File(['{}'], 'test.json', { type: 'application/json' });
      const mockFileList = {
        0: mockFile,
        length: 1,
        item: (index: number) => (index === 0 ? mockFile : null),
        [Symbol.iterator]: function* () {
          yield mockFile;
        },
      } as unknown as FileList;

      Object.defineProperty(mockInput, 'files', { value: mockFileList });

      const event = new Event('change');
      Object.defineProperty(event, 'target', { value: mockInput });
      await mockInput.onchange?.(event);

      expect(component.handleImportFiles).toHaveBeenCalledWith(mockFileList);
    });

    it('should not call handleImportFiles when no files selected', () => {
      const mockInput = document.createElement('input');
      spyOn(document, 'createElement').and.returnValue(mockInput);
      spyOn(mockInput, 'click');
      spyOn(component, 'handleImportFiles');

      component.openImportDialog();

      Object.defineProperty(mockInput, 'files', { value: null });

      const event = new Event('change');
      Object.defineProperty(event, 'target', { value: mockInput });
      mockInput.onchange?.(event);

      expect(component.handleImportFiles).not.toHaveBeenCalled();
    });

    it('should not call handleImportFiles when files list is empty', () => {
      const mockInput = document.createElement('input');
      spyOn(document, 'createElement').and.returnValue(mockInput);
      spyOn(mockInput, 'click');
      spyOn(component, 'handleImportFiles');

      component.openImportDialog();

      const emptyFileList = {
        length: 0,
        item: () => null,
        [Symbol.iterator]: function* () {
          // empty
        },
      } as unknown as FileList;
      Object.defineProperty(mockInput, 'files', { value: emptyFileList });

      const event = new Event('change');
      Object.defineProperty(event, 'target', { value: mockInput });
      mockInput.onchange?.(event);

      expect(component.handleImportFiles).not.toHaveBeenCalled();
    });
  });

  describe('openSettingsDialog', () => {
    it('should set showSettingsDialog to true', () => {
      expect(component.showSettingsDialog()).toBe(false);

      component.openSettingsDialog();

      expect(component.showSettingsDialog()).toBe(true);
    });
  });

  describe('openMetricsDialog', () => {
    it('should set showMetricsDialog to true', () => {
      expect(component.showMetricsDialog()).toBe(false);

      component.openMetricsDialog();

      expect(component.showMetricsDialog()).toBe(true);
    });
  });

  describe('openConsoleDialog', () => {
    it('should add a new console dialog ID', () => {
      expect(component.openConsoleDialogs()).toEqual([]);

      component.openConsoleDialog();

      expect(component.openConsoleDialogs()).toEqual([0]);
    });

    it('should increment console IDs for multiple dialogs', () => {
      component.openConsoleDialog();
      component.openConsoleDialog();
      component.openConsoleDialog();

      expect(component.openConsoleDialogs()).toEqual([0, 1, 2]);
    });
  });

  describe('openWebhooksDialog', () => {
    it('should set webhookScope to global and show dialog', () => {
      expect(component.showWebhooksDialog()).toBe(false);

      component.openWebhooksDialog();

      expect(component.webhookScope()).toEqual({ type: 'global' });
      expect(component.showWebhooksDialog()).toBe(true);
    });
  });

  describe('openInboxWebhooksDialog', () => {
    it('should set webhookScope to inbox-specific and show dialog', () => {
      const mockInbox: InboxModel = {
        emailAddress: 'test@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'inbox-hash-123',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'sig-pk',
        secretKey: new Uint8Array(),
        emails: [],
      };

      expect(component.showWebhooksDialog()).toBe(false);

      component.openInboxWebhooksDialog(mockInbox);

      expect(component.webhookScope()).toEqual({ type: 'inbox', email: 'test@example.com' });
      expect(component.showWebhooksDialog()).toBe(true);
    });
  });

  describe('closeConsoleDialog', () => {
    it('should remove the console dialog with the given ID', () => {
      component.openConsoleDialog();
      component.openConsoleDialog();
      component.openConsoleDialog();

      expect(component.openConsoleDialogs()).toEqual([0, 1, 2]);

      component.closeConsoleDialog(1);

      expect(component.openConsoleDialogs()).toEqual([0, 2]);
    });

    it('should handle closing non-existent dialog gracefully', () => {
      component.openConsoleDialog();

      component.closeConsoleDialog(999);

      expect(component.openConsoleDialogs()).toEqual([0]);
    });
  });

  describe('handleImportFiles', () => {
    it('should show success toast for each successful import', async () => {
      spyOn(vsToastStub, 'showSuccess');
      spyOn(mailManagerStub, 'subscribeToAllInboxes').and.callThrough();

      const mockFile = new File(['{}'], 'test.json', { type: 'application/json' });
      const mockFileList = {
        0: mockFile,
        length: 1,
        item: (index: number) => (index === 0 ? mockFile : null),
        [Symbol.iterator]: function* () {
          yield mockFile;
        },
      } as FileList;

      await component.handleImportFiles(mockFileList);

      expect(vsToastStub.showSuccess).toHaveBeenCalledWith('Imported', 'Imported test.json', 3000);
      expect(mailManagerStub.subscribeToAllInboxes).toHaveBeenCalled();
    });

    it('should show error toast for failed imports', async () => {
      spyOn(vsToastStub, 'showError');
      spyOn(mailManagerStub, 'importMultipleInboxes').and.returnValue(
        Promise.resolve([{ filename: 'bad.json', success: false, message: 'Invalid format' }]),
      );

      const mockFile = new File(['invalid'], 'bad.json', { type: 'application/json' });
      const mockFileList = {
        0: mockFile,
        length: 1,
        item: (index: number) => (index === 0 ? mockFile : null),
        [Symbol.iterator]: function* () {
          yield mockFile;
        },
      } as FileList;

      await component.handleImportFiles(mockFileList);

      expect(vsToastStub.showError).toHaveBeenCalledWith('Import Failed', 'Invalid format', 5000);
    });

    it('should show summary toast for multiple files', async () => {
      spyOn(vsToastStub, 'showSuccess');
      spyOn(vsToastStub, 'showInfo');
      spyOn(mailManagerStub, 'importMultipleInboxes').and.returnValue(
        Promise.resolve([
          { filename: 'file1.json', success: true, message: 'Imported file1.json' },
          { filename: 'file2.json', success: true, message: 'Imported file2.json' },
        ]),
      );

      const mockFile1 = new File(['{}'], 'file1.json', { type: 'application/json' });
      const mockFile2 = new File(['{}'], 'file2.json', { type: 'application/json' });
      const mockFileList = {
        0: mockFile1,
        1: mockFile2,
        length: 2,
        item: (index: number) => (index === 0 ? mockFile1 : index === 1 ? mockFile2 : null),
        [Symbol.iterator]: function* () {
          yield mockFile1;
          yield mockFile2;
        },
      } as FileList;

      await component.handleImportFiles(mockFileList);

      expect(vsToastStub.showSuccess).toHaveBeenCalledTimes(2);
      expect(vsToastStub.showInfo).toHaveBeenCalledWith(
        'Import Complete',
        'Successfully imported 2 of 2 inboxes',
        3000,
      );
    });

    it('should not subscribe to inboxes when all imports fail', async () => {
      spyOn(mailManagerStub, 'importMultipleInboxes').and.returnValue(
        Promise.resolve([{ filename: 'bad.json', success: false, message: 'Error' }]),
      );
      spyOn(mailManagerStub, 'subscribeToAllInboxes');

      const mockFile = new File(['invalid'], 'bad.json', { type: 'application/json' });
      const mockFileList = {
        0: mockFile,
        length: 1,
        item: (index: number) => (index === 0 ? mockFile : null),
        [Symbol.iterator]: function* () {
          yield mockFile;
        },
      } as FileList;

      await component.handleImportFiles(mockFileList);

      expect(mailManagerStub.subscribeToAllInboxes).not.toHaveBeenCalled();
    });

    it('should show partial success summary for mixed results', async () => {
      spyOn(vsToastStub, 'showSuccess');
      spyOn(vsToastStub, 'showError');
      spyOn(vsToastStub, 'showInfo');
      spyOn(mailManagerStub, 'importMultipleInboxes').and.returnValue(
        Promise.resolve([
          { filename: 'file1.json', success: true, message: 'Imported file1.json' },
          { filename: 'file2.json', success: false, message: 'Invalid format' },
        ]),
      );
      spyOn(mailManagerStub, 'subscribeToAllInboxes').and.callThrough();

      const mockFile1 = new File(['{}'], 'file1.json', { type: 'application/json' });
      const mockFile2 = new File(['invalid'], 'file2.json', { type: 'application/json' });
      const mockFileList = {
        0: mockFile1,
        1: mockFile2,
        length: 2,
        item: (index: number) => (index === 0 ? mockFile1 : index === 1 ? mockFile2 : null),
        [Symbol.iterator]: function* () {
          yield mockFile1;
          yield mockFile2;
        },
      } as FileList;

      await component.handleImportFiles(mockFileList);

      expect(vsToastStub.showSuccess).toHaveBeenCalledTimes(1);
      expect(vsToastStub.showError).toHaveBeenCalledTimes(1);
      expect(vsToastStub.showInfo).toHaveBeenCalledWith(
        'Import Complete',
        'Successfully imported 1 of 2 inboxes',
        3000,
      );
      expect(mailManagerStub.subscribeToAllInboxes).toHaveBeenCalled();
    });
  });

  describe('constructor effect', () => {
    it('should set viewMode to list when selectedEmail becomes null', async () => {
      const mockInbox: InboxModel = {
        emailAddress: 'test@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'inbox-hash-123',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'sig-pk',
        secretKey: new Uint8Array(),
        emails: [
          {
            id: 'email-1',
            encryptedMetadata: null,
            decryptedMetadata: {
              from: 'sender@example.com',
              to: 'test@example.com',
              subject: 'Test',
              receivedAt: new Date().toISOString(),
            },
            isRead: false,
          },
        ],
      };
      mailManagerStub.setInboxes([mockInbox]);

      // Select an email - this sets viewMode to 'detail'
      component.viewMode.set('detail');
      mailManagerStub.selectEmail('inbox-hash-123', 'email-1');
      fixture.detectChanges();
      await fixture.whenStable();

      // Now deselect the email
      mailManagerStub.deselectEmail();
      fixture.detectChanges();
      await fixture.whenStable();

      // The effect should set viewMode back to 'list'
      expect(component.viewMode()).toBe('list');
    });
  });

  describe('openInboxChaosDialog', () => {
    it('should set chaosInbox and show chaos dialog', () => {
      const mockInbox: InboxModel = {
        emailAddress: 'test@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'inbox-hash-123',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'sig-pk',
        secretKey: new Uint8Array(),
        emails: [],
      };

      expect(component.showChaosDialog()).toBe(false);
      expect(component.chaosInbox()).toBeNull();

      component.openInboxChaosDialog(mockInbox);

      expect(component.chaosInbox()).toBe(mockInbox);
      expect(component.showChaosDialog()).toBe(true);
    });
  });

  describe('onChaosDialogClosed', () => {
    it('should hide dialog and clear chaosInbox', () => {
      const mockInbox: InboxModel = {
        emailAddress: 'test@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'inbox-hash-123',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'sig-pk',
        secretKey: new Uint8Array(),
        emails: [],
      };

      // First open the dialog
      component.openInboxChaosDialog(mockInbox);
      expect(component.showChaosDialog()).toBe(true);
      expect(component.chaosInbox()).toBe(mockInbox);

      // Then close it
      component.onChaosDialogClosed();

      expect(component.showChaosDialog()).toBe(false);
      expect(component.chaosInbox()).toBeNull();
    });
  });

  describe('onChaosStatusChanged', () => {
    it('should do nothing when chaosInbox is null', () => {
      component.onChaosStatusChanged(true);
      // Should not throw
      expect(component.selectedInboxChaosEnabled()).toBe(false);
    });

    it('should update selectedInboxChaosEnabled when chaos inbox matches selected inbox', () => {
      const mockInbox: InboxModel = {
        emailAddress: 'test@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'inbox-hash-123',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'sig-pk',
        secretKey: new Uint8Array(),
        emails: [],
      };
      mailManagerStub.setInboxes([mockInbox]);
      component.openInboxChaosDialog(mockInbox);

      component.onChaosStatusChanged(true);

      expect(component.selectedInboxChaosEnabled()).toBe(true);
    });

    it('should not update selectedInboxChaosEnabled when chaos inbox does not match selected inbox', () => {
      const mockInbox1: InboxModel = {
        emailAddress: 'test1@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'inbox-hash-1',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'sig-pk',
        secretKey: new Uint8Array(),
        emails: [],
      };
      const mockInbox2: InboxModel = {
        emailAddress: 'test2@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'inbox-hash-2',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'sig-pk',
        secretKey: new Uint8Array(),
        emails: [],
      };
      mailManagerStub.setInboxes([mockInbox1]);
      component.openInboxChaosDialog(mockInbox2);

      component.onChaosStatusChanged(true);

      // Should remain false since the chaos inbox doesn't match selected inbox
      expect(component.selectedInboxChaosEnabled()).toBe(false);
    });
  });

  describe('openSelectedInboxWebhooks', () => {
    it('should open webhooks dialog for the selected inbox', () => {
      const mockInbox: InboxModel = {
        emailAddress: 'test@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'inbox-hash-123',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'sig-pk',
        secretKey: new Uint8Array(),
        emails: [],
      };
      mailManagerStub.setInboxes([mockInbox]);

      spyOn(component, 'openInboxWebhooksDialog');

      component.openSelectedInboxWebhooks();

      expect(component.openInboxWebhooksDialog).toHaveBeenCalledWith(mockInbox);
    });

    it('should do nothing when no inbox is selected', () => {
      spyOn(component, 'openInboxWebhooksDialog');

      component.openSelectedInboxWebhooks();

      expect(component.openInboxWebhooksDialog).not.toHaveBeenCalled();
    });
  });

  describe('openSelectedInboxChaos', () => {
    it('should open chaos dialog for the selected inbox', () => {
      const mockInbox: InboxModel = {
        emailAddress: 'test@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'inbox-hash-123',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'sig-pk',
        secretKey: new Uint8Array(),
        emails: [],
      };
      mailManagerStub.setInboxes([mockInbox]);

      spyOn(component, 'openInboxChaosDialog');

      component.openSelectedInboxChaos();

      expect(component.openInboxChaosDialog).toHaveBeenCalledWith(mockInbox);
    });

    it('should do nothing when no inbox is selected', () => {
      spyOn(component, 'openInboxChaosDialog');

      component.openSelectedInboxChaos();

      expect(component.openInboxChaosDialog).not.toHaveBeenCalled();
    });
  });

  describe('webhookEnabled', () => {
    it('should return true when webhookEnabled is true in serverInfo', () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: true,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: false,
      });

      expect(component.webhookEnabled()).toBe(true);
    });

    it('should return false when webhookEnabled is false in serverInfo', () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: false,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: false,
      });

      expect(component.webhookEnabled()).toBe(false);
    });

    it('should return false when serverInfo is null', () => {
      serverInfoServiceStub.setServerInfo(null);

      expect(component.webhookEnabled()).toBe(false);
    });
  });

  describe('chaosEnabled', () => {
    it('should return true when chaosEnabled is true in serverInfo', () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: false,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: true,
      });

      expect(component.chaosEnabled()).toBe(true);
    });

    it('should return false when chaosEnabled is false in serverInfo', () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: false,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: false,
      });

      expect(component.chaosEnabled()).toBe(false);
    });

    it('should return false when serverInfo is null', () => {
      serverInfoServiceStub.setServerInfo(null);

      expect(component.chaosEnabled()).toBe(false);
    });
  });

  describe('mobileMenuItems', () => {
    it('should include only Refresh when webhooks and chaos are disabled', () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: false,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: false,
      });

      const menuItems = component.mobileMenuItems();

      expect(menuItems.length).toBe(1);
      expect(menuItems[0].label).toBe('Refresh');
    });

    it('should include Webhooks when webhookEnabled is true', () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: true,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: false,
      });

      const menuItems = component.mobileMenuItems();

      expect(menuItems.length).toBe(2);
      expect(menuItems[0].label).toBe('Refresh');
      expect(menuItems[1].label).toBe('Webhooks');
    });

    it('should include Chaos when chaosEnabled is true', () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: false,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: true,
      });

      const menuItems = component.mobileMenuItems();

      expect(menuItems.length).toBe(2);
      expect(menuItems[0].label).toBe('Refresh');
      expect(menuItems[1].label).toBe('Chaos');
    });

    it('should include all items when both webhooks and chaos are enabled', () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: true,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: true,
      });

      const menuItems = component.mobileMenuItems();

      expect(menuItems.length).toBe(3);
      expect(menuItems[0].label).toBe('Refresh');
      expect(menuItems[1].label).toBe('Webhooks');
      expect(menuItems[2].label).toBe('Chaos');
    });

    it('should execute Refresh menu command', () => {
      spyOn(component, 'handleRefresh');

      const menuItems = component.mobileMenuItems();
      const refreshItem = menuItems.find((item) => item.label === 'Refresh');
      refreshItem?.command?.({} as never);

      expect(component.handleRefresh).toHaveBeenCalled();
    });

    it('should execute Webhooks menu command', () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: true,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: false,
      });

      spyOn(component, 'openSelectedInboxWebhooks');

      const menuItems = component.mobileMenuItems();
      const webhooksItem = menuItems.find((item) => item.label === 'Webhooks');
      webhooksItem?.command?.({} as never);

      expect(component.openSelectedInboxWebhooks).toHaveBeenCalled();
    });

    it('should execute Chaos menu command', () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: false,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: true,
      });

      spyOn(component, 'openSelectedInboxChaos');

      const menuItems = component.mobileMenuItems();
      const chaosItem = menuItems.find((item) => item.label === 'Chaos');
      chaosItem?.command?.({} as never);

      expect(component.openSelectedInboxChaos).toHaveBeenCalled();
    });
  });

  describe('chaos status effect', () => {
    it('should load chaos status when inbox selected and chaos is enabled', async () => {
      chaosServiceStub.setResponse({ enabled: true });
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: false,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: true,
      });

      const mockInbox: InboxModel = {
        emailAddress: 'test@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'inbox-hash-123',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'sig-pk',
        secretKey: new Uint8Array(),
        emails: [],
      };

      mailManagerStub.setInboxes([mockInbox]);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.selectedInboxChaosEnabled()).toBe(true);
    });

    it('should set chaos to false when inbox selected but chaos feature is disabled', async () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: false,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: false,
      });

      const mockInbox: InboxModel = {
        emailAddress: 'test@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'inbox-hash-123',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'sig-pk',
        secretKey: new Uint8Array(),
        emails: [],
      };

      mailManagerStub.setInboxes([mockInbox]);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.selectedInboxChaosEnabled()).toBe(false);
    });

    it('should set chaos to false when no inbox is selected', async () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: false,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: true,
      });

      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.selectedInboxChaosEnabled()).toBe(false);
    });

    it('should set chaos to false when API returns 404', async () => {
      chaosServiceStub.setError({ name: 'HttpErrorResponse', message: 'Not Found' } as Error);
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: false,
        webhookRequireAuthDefault: true,
        spamAnalysisEnabled: false,
        chaosEnabled: true,
      });

      const mockInbox: InboxModel = {
        emailAddress: 'test@example.com',
        expiresAt: new Date().toISOString(),
        inboxHash: 'inbox-hash-123',
        encrypted: true,
        emailAuth: false,
        serverSigPk: 'sig-pk',
        secretKey: new Uint8Array(),
        emails: [],
      };

      mailManagerStub.setInboxes([mockInbox]);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.selectedInboxChaosEnabled()).toBe(false);
    });
  });
});
