import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ConfirmationService } from 'primeng/api';
import { SettingsDialog } from './settings-dialog';
import { SettingsManager, SanitizationLevel } from '../services/settings-manager';
import { ServerInfoService } from '../services/server-info.service';
import { VaultSandboxApi } from '../services/vault-sandbox-api';
import { InboxService } from '../services/inbox.service';
import { VsToast } from '../../../shared/services/vs-toast';
import {
  ServerInfoServiceStub,
  SettingsManagerStub,
  VaultSandboxApiStub,
  InboxServiceStub,
  VsToastStub,
} from '../../../../testing/mail-testing.mocks';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';

describe('SettingsDialog', () => {
  let component: SettingsDialog;
  let fixture: ComponentFixture<SettingsDialog>;
  let settingsManager: SettingsManagerStub;
  let confirmationService: ConfirmationService;
  let toastStub: VsToastStub;
  let apiStub: VaultSandboxApiStub;
  let inboxServiceStub: InboxServiceStub;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsDialog],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        ConfirmationService,
        { provide: SettingsManager, useClass: SettingsManagerStub },
        { provide: ServerInfoService, useClass: ServerInfoServiceStub },
        { provide: VaultSandboxApi, useClass: VaultSandboxApiStub },
        { provide: InboxService, useClass: InboxServiceStub },
        { provide: VsToast, useClass: VsToastStub },
      ],
    }).compileComponents();

    settingsManager = TestBed.inject(SettingsManager) as unknown as SettingsManagerStub;
    confirmationService = TestBed.inject(ConfirmationService);
    toastStub = TestBed.inject(VsToast) as unknown as VsToastStub;
    apiStub = TestBed.inject(VaultSandboxApi) as unknown as VaultSandboxApiStub;
    inboxServiceStub = TestBed.inject(InboxService) as unknown as InboxServiceStub;

    fixture = TestBed.createComponent(SettingsDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('loads settings on initialization', async () => {
      settingsManager.saveSettings({
        ttlSeconds: 3600,
        ttlUnit: 'hours',
        lastUsedDomain: '',
        displayInlineImages: true,
        sanitizationLevel: SanitizationLevel.None,
        timeFormat: '12h',
      });

      // Create new component to trigger ngOnInit
      const newFixture = TestBed.createComponent(SettingsDialog);
      newFixture.detectChanges();
      await newFixture.whenStable();

      expect(newFixture.componentInstance.displayInlineImages).toBe(true);
      expect(newFixture.componentInstance.sanitizationLevel).toBe(SanitizationLevel.None);
      expect(newFixture.componentInstance.timeFormat).toBe('12h');
      expect(newFixture.componentInstance.settingsLoaded).toBe(true);
    });
  });

  describe('onSave', () => {
    it('saves settings directly when not switching to trusted mode', () => {
      const saveSpy = spyOn(settingsManager, 'saveSettings').and.callThrough();
      const closedSpy = spyOn(component.closed, 'emit');
      const toastSpy = spyOn(toastStub, 'showSuccess');

      // Set to DomPurify (not switching to None)
      component.sanitizationLevel = SanitizationLevel.DomPurify;
      component.displayInlineImages = true;
      component.timeFormat = '12h';

      component.onSave();

      expect(saveSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          displayInlineImages: true,
          sanitizationLevel: SanitizationLevel.DomPurify,
          timeFormat: '12h',
        }),
      );
      expect(toastSpy).toHaveBeenCalledWith('Settings saved', 'Preferences updated successfully');
      expect(closedSpy).toHaveBeenCalled();
    });

    it('shows confirmation dialog when switching to trusted mode', () => {
      const confirmSpy = spyOn(confirmationService, 'confirm').and.returnValue(confirmationService);

      // Start with DomPurify in settings
      settingsManager.saveSettings({
        ttlSeconds: 3600,
        ttlUnit: 'hours',
        lastUsedDomain: '',
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.DomPurify,
        timeFormat: '24h',
      });

      // Switch to None (trusted mode)
      component.sanitizationLevel = SanitizationLevel.None;

      component.onSave();

      expect(confirmSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          header: 'Enable Trusted Mode?',
          acceptLabel: 'Enable Trusted Mode',
          rejectLabel: 'Cancel',
          acceptButtonStyleClass: 'p-button-warning',
        }),
      );
    });

    it('saves settings when confirmation is accepted', () => {
      const saveSpy = spyOn(settingsManager, 'saveSettings').and.callThrough();
      const closedSpy = spyOn(component.closed, 'emit');
      const toastSpy = spyOn(toastStub, 'showSuccess');

      // Mock confirmation to auto-accept
      spyOn(confirmationService, 'confirm').and.callFake((config) => {
        config.accept?.();
        return confirmationService;
      });

      // Start with DomPurify in settings
      settingsManager.saveSettings({
        ttlSeconds: 3600,
        ttlUnit: 'hours',
        lastUsedDomain: '',
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.DomPurify,
        timeFormat: '24h',
      });

      // Switch to None (trusted mode)
      component.sanitizationLevel = SanitizationLevel.None;

      component.onSave();

      expect(saveSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          sanitizationLevel: SanitizationLevel.None,
        }),
      );
      expect(toastSpy).toHaveBeenCalled();
      expect(closedSpy).toHaveBeenCalled();
    });

    it('does not save when already in trusted mode', () => {
      const confirmSpy = spyOn(confirmationService, 'confirm').and.returnValue(confirmationService);
      const saveSpy = spyOn(settingsManager, 'saveSettings').and.callThrough();
      const closedSpy = spyOn(component.closed, 'emit');

      // Already in None (trusted mode)
      settingsManager.saveSettings({
        ttlSeconds: 3600,
        ttlUnit: 'hours',
        lastUsedDomain: '',
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.None,
        timeFormat: '24h',
      });

      // Still None - no change
      component.sanitizationLevel = SanitizationLevel.None;

      component.onSave();

      // Should not show confirmation since already in trusted mode
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(saveSpy).toHaveBeenCalled();
      expect(closedSpy).toHaveBeenCalled();
    });
  });

  describe('onCancel', () => {
    it('closes dialog without saving', () => {
      const saveSpy = spyOn(settingsManager, 'saveSettings');
      const closedSpy = spyOn(component.closed, 'emit');

      component.onCancel();

      expect(saveSpy).not.toHaveBeenCalled();
      expect(closedSpy).toHaveBeenCalled();
    });
  });

  describe('onDeleteAllInboxes', () => {
    it('shows confirmation dialog', () => {
      const confirmSpy = spyOn(confirmationService, 'confirm').and.returnValue(confirmationService);

      component.onDeleteAllInboxes();

      expect(confirmSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          header: 'Delete All Inboxes',
          acceptLabel: 'Delete All',
          rejectLabel: 'Cancel',
          acceptButtonStyleClass: 'p-button-danger',
        }),
      );
    });

    it('deletes all inboxes when confirmed', async () => {
      const clearApiSpy = spyOn(apiStub, 'clearAllInboxes').and.returnValue(of(void 0));
      const clearStorageSpy = spyOn(inboxServiceStub, 'clearLocalStorage');
      const subscribeSpy = spyOn(inboxServiceStub, 'subscribeToAllInboxes').and.returnValue(Promise.resolve());
      const toastSpy = spyOn(toastStub, 'showSuccess');

      spyOn(confirmationService, 'confirm').and.callFake((config) => {
        // Call accept callback
        (config.accept as () => Promise<void>)();
        return confirmationService;
      });

      component.onDeleteAllInboxes();
      await fixture.whenStable();

      expect(clearApiSpy).toHaveBeenCalled();
      expect(clearStorageSpy).toHaveBeenCalled();
      expect(subscribeSpy).toHaveBeenCalled();
      expect(toastSpy).toHaveBeenCalledWith('All Inboxes Deleted', 'All inboxes have been cleared successfully');
    });

    it('shows error toast when deletion fails', async () => {
      spyOn(console, 'error');
      spyOn(apiStub, 'clearAllInboxes').and.returnValue(throwError(() => new Error('Network error')));
      const toastErrorSpy = spyOn(toastStub, 'showError');

      spyOn(confirmationService, 'confirm').and.callFake((config) => {
        (config.accept as () => Promise<void>)();
        return confirmationService;
      });

      component.onDeleteAllInboxes();
      await fixture.whenStable();

      expect(toastErrorSpy).toHaveBeenCalledWith('Error', 'Failed to delete all inboxes. Please try again.');
    });
  });

  describe('sanitizationOptions', () => {
    it('contains correct options', () => {
      expect(component.sanitizationOptions).toEqual([
        { label: 'Trusted Mode (No sanitization, iframe sandboxed)', value: SanitizationLevel.None },
        { label: 'Secure Mode - DOMPurify (Recommended)', value: SanitizationLevel.DomPurify },
      ]);
    });
  });

  describe('timeFormatOptions', () => {
    it('contains correct options', () => {
      expect(component.timeFormatOptions).toEqual([
        { label: '24-hour (15:30)', value: '24h' },
        { label: '12-hour (3:30 PM)', value: '12h' },
      ]);
    });
  });

  describe('allowClearAllInboxes', () => {
    let serverInfoServiceStub: ServerInfoServiceStub;

    beforeEach(() => {
      serverInfoServiceStub = TestBed.inject(ServerInfoService) as unknown as ServerInfoServiceStub;
    });

    it('returns true when server allows clear all inboxes', () => {
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
      });

      expect(component.allowClearAllInboxes()).toBe(true);
    });

    it('returns false when server disallows clear all inboxes', () => {
      serverInfoServiceStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: false,
        allowedDomains: [],
        encryptionPolicy: 'always',
      });

      expect(component.allowClearAllInboxes()).toBe(false);
    });

    it('defaults to true when server info is null', () => {
      serverInfoServiceStub.setServerInfo(null);

      expect(component.allowClearAllInboxes()).toBe(true);
    });
  });
});
