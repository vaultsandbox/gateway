import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal, WritableSignal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CustomInboxDialog } from './custom-inbox-dialog';
import { MailManager } from '../services/mail-manager';
import { ServerInfoService } from '../services/server-info.service';
import { SettingsManager, SanitizationLevel } from '../services/settings-manager';
import { VsToast } from '../../../shared/services/vs-toast';
import { MailManagerStub, SettingsManagerStub } from '../../../../testing/mail-testing.mocks';
import { TOAST_DURATION_MS } from '../../../shared/constants/app.constants';
import { ServerInfo } from '../interfaces';

// Custom stub for ServerInfoService that exposes a writable signal
class ConfigurableServerInfoServiceStub {
  private serverInfoSignal: WritableSignal<ServerInfo | null> = signal({
    serverSigPk: 'stub',
    algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
    context: 'stub',
    maxTtl: 86400, // 24 hours
    defaultTtl: 3600, // 1 hour
    sseConsole: false,
    allowClearAllInboxes: true,
    allowedDomains: ['example.com', 'test.com'],
    encryptionPolicy: 'always',
  });

  get serverInfo() {
    return this.serverInfoSignal.asReadonly();
  }

  setServerInfo(info: ServerInfo | null) {
    this.serverInfoSignal.set(info);
  }

  async getServerInfo(): Promise<ServerInfo | null> {
    return this.serverInfoSignal();
  }
}

describe('CustomInboxDialog', () => {
  let component: CustomInboxDialog;
  let fixture: ComponentFixture<CustomInboxDialog>;
  let mailManager: MailManagerStub;
  let serverInfoService: ConfigurableServerInfoServiceStub;
  let settingsManager: SettingsManagerStub;
  let toastSpy: jasmine.SpyObj<VsToast>;

  const createServerInfo = (overrides: Partial<ServerInfo> = {}): ServerInfo => ({
    serverSigPk: 'stub',
    algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
    context: 'stub',
    maxTtl: 86400, // 24 hours in seconds
    defaultTtl: 3600, // 1 hour in seconds
    sseConsole: false,
    allowClearAllInboxes: true,
    allowedDomains: ['example.com', 'test.com'],
    encryptionPolicy: 'always',
    ...overrides,
  });

  beforeEach(async () => {
    toastSpy = jasmine.createSpyObj('VsToast', ['showSuccess', 'showError', 'showWarning', 'showInfo']);

    await TestBed.configureTestingModule({
      imports: [CustomInboxDialog],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MailManager, useClass: MailManagerStub },
        { provide: ServerInfoService, useClass: ConfigurableServerInfoServiceStub },
        { provide: SettingsManager, useClass: SettingsManagerStub },
        { provide: VsToast, useValue: toastSpy },
      ],
    }).compileComponents();

    serverInfoService = TestBed.inject(ServerInfoService) as unknown as ConfigurableServerInfoServiceStub;
    mailManager = TestBed.inject(MailManager) as unknown as MailManagerStub;
    settingsManager = TestBed.inject(SettingsManager) as unknown as SettingsManagerStub;

    fixture = TestBed.createComponent(CustomInboxDialog);
    component = fixture.componentInstance;
    // Set required input
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('domainOptions', () => {
    it('returns allowed domains from server info', () => {
      serverInfoService.setServerInfo(createServerInfo({ allowedDomains: ['domain1.com', 'domain2.com'] }));

      expect(component.domainOptions()).toEqual(['domain1.com', 'domain2.com']);
    });

    it('returns empty array when server info is null', () => {
      serverInfoService.setServerInfo(null);

      expect(component.domainOptions()).toEqual([]);
    });
  });

  describe('defaultTtlHours', () => {
    it('returns default TTL in hours from server info', () => {
      serverInfoService.setServerInfo(createServerInfo({ defaultTtl: 7200 })); // 2 hours

      expect(component.defaultTtlHours()).toBe(2);
    });

    it('returns 1 hour as fallback when server info is null', () => {
      serverInfoService.setServerInfo(null);

      expect(component.defaultTtlHours()).toBe(1);
    });
  });

  describe('maxTtlHours', () => {
    it('returns max TTL in hours from server info', () => {
      serverInfoService.setServerInfo(createServerInfo({ maxTtl: 172800 })); // 48 hours

      expect(component.maxTtlHours()).toBe(48);
    });

    it('returns 24 hours as fallback when server info is null', () => {
      serverInfoService.setServerInfo(null);

      expect(component.maxTtlHours()).toBe(24);
    });
  });

  describe('ttlExceedsMax', () => {
    it('returns true when TTL exceeds max', () => {
      serverInfoService.setServerInfo(createServerInfo({ maxTtl: 3600 })); // 1 hour max
      component.ttlValue.set(2);
      component.ttlUnit.set('hours');

      expect(component.ttlExceedsMax()).toBe(true);
    });

    it('returns false when TTL is within max', () => {
      serverInfoService.setServerInfo(createServerInfo({ maxTtl: 86400 })); // 24 hours max
      component.ttlValue.set(12);
      component.ttlUnit.set('hours');

      expect(component.ttlExceedsMax()).toBe(false);
    });
  });

  describe('isValid', () => {
    beforeEach(() => {
      serverInfoService.setServerInfo(createServerInfo({ maxTtl: 86400 }));
      component.selectedDomain.set('example.com');
      component.ttlValue.set(12);
      component.ttlUnit.set('hours');
    });

    it('returns false when no domain is selected', () => {
      component.selectedDomain.set('');

      expect(component.isValid()).toBe(false);
    });

    it('returns false when TTL value is 0', () => {
      component.ttlValue.set(0);

      expect(component.isValid()).toBe(false);
    });

    it('returns false when TTL value is negative', () => {
      component.ttlValue.set(-1);

      expect(component.isValid()).toBe(false);
    });

    it('returns false when TTL exceeds max', () => {
      component.ttlValue.set(25);
      component.ttlUnit.set('hours');

      expect(component.isValid()).toBe(false);
    });

    it('returns false for invalid alias starting with special char', () => {
      component.alias.set('-invalid');

      expect(component.isValid()).toBe(false);
    });

    it('returns false for invalid alias ending with special char', () => {
      component.alias.set('invalid-');

      expect(component.isValid()).toBe(false);
    });

    it('returns false for alias with uppercase letters', () => {
      component.alias.set('Invalid');

      expect(component.isValid()).toBe(false);
    });

    it('returns false for alias with invalid characters', () => {
      component.alias.set('inv@lid');

      expect(component.isValid()).toBe(false);
    });

    it('returns false for alias that is too long (over 64 chars)', () => {
      component.alias.set('a'.repeat(65));

      expect(component.isValid()).toBe(false);
    });

    it('returns true for valid alias', () => {
      component.alias.set('valid-alias.123');

      expect(component.isValid()).toBe(true);
    });

    it('returns true for single character alias', () => {
      component.alias.set('a');

      expect(component.isValid()).toBe(true);
    });

    it('returns true for two character alias', () => {
      component.alias.set('ab');

      expect(component.isValid()).toBe(true);
    });

    it('returns true for empty alias', () => {
      component.alias.set('');

      expect(component.isValid()).toBe(true);
    });

    it('returns true for alias with only whitespace (trimmed to empty)', () => {
      component.alias.set('   ');

      expect(component.isValid()).toBe(true);
    });
  });

  describe('constructor effect for domain initialization', () => {
    it('sets last used domain when available in allowed domains', async () => {
      // Configure settings before creating component
      settingsManager.saveSettings({
        ttlSeconds: 3600,
        ttlUnit: 'hours',
        lastUsedDomain: 'test.com',
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.DomPurify,
        timeFormat: '24h',
      });

      serverInfoService.setServerInfo(createServerInfo({ allowedDomains: ['example.com', 'test.com'] }));

      // Create new component to trigger constructor effect
      const newFixture = TestBed.createComponent(CustomInboxDialog);
      newFixture.componentRef.setInput('visible', true);
      newFixture.detectChanges();
      await newFixture.whenStable();

      expect(newFixture.componentInstance.selectedDomain()).toBe('test.com');
    });

    it('falls back to first domain when last used domain not in allowed list', async () => {
      settingsManager.saveSettings({
        ttlSeconds: 3600,
        ttlUnit: 'hours',
        lastUsedDomain: 'invalid.com',
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.DomPurify,
        timeFormat: '24h',
      });

      serverInfoService.setServerInfo(createServerInfo({ allowedDomains: ['first.com', 'second.com'] }));

      const newFixture = TestBed.createComponent(CustomInboxDialog);
      newFixture.componentRef.setInput('visible', true);
      newFixture.detectChanges();
      await newFixture.whenStable();

      expect(newFixture.componentInstance.selectedDomain()).toBe('first.com');
    });

    it('falls back to first domain when lastUsedDomain is empty', async () => {
      settingsManager.saveSettings({
        ttlSeconds: 3600,
        ttlUnit: 'hours',
        lastUsedDomain: '',
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.DomPurify,
        timeFormat: '24h',
      });

      serverInfoService.setServerInfo(createServerInfo({ allowedDomains: ['first.com'] }));

      const newFixture = TestBed.createComponent(CustomInboxDialog);
      newFixture.componentRef.setInput('visible', true);
      newFixture.detectChanges();
      await newFixture.whenStable();

      expect(newFixture.componentInstance.selectedDomain()).toBe('first.com');
    });

    it('does not change domain when already set', async () => {
      serverInfoService.setServerInfo(createServerInfo({ allowedDomains: ['example.com', 'other.com'] }));

      const newFixture = TestBed.createComponent(CustomInboxDialog);
      newFixture.componentRef.setInput('visible', true);
      newFixture.componentInstance.selectedDomain.set('other.com');
      newFixture.detectChanges();
      await newFixture.whenStable();

      // Domain should remain as set, not changed to first
      expect(newFixture.componentInstance.selectedDomain()).toBe('other.com');
    });

    it('does not set domain when no domains available', async () => {
      serverInfoService.setServerInfo(createServerInfo({ allowedDomains: [] }));

      const newFixture = TestBed.createComponent(CustomInboxDialog);
      newFixture.componentRef.setInput('visible', true);
      newFixture.detectChanges();
      await newFixture.whenStable();

      expect(newFixture.componentInstance.selectedDomain()).toBe('');
    });
  });

  describe('loadTtlFromSettings', () => {
    it('loads TTL value and unit from settings', async () => {
      settingsManager.saveSettings({
        ttlSeconds: 86400,
        ttlUnit: 'days',
        lastUsedDomain: '',
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.DomPurify,
        timeFormat: '24h',
      });

      // Access private method through cast
      await (component as unknown as { loadTtlFromSettings: () => Promise<void> }).loadTtlFromSettings();

      expect(component.ttlValue()).toBe(1); // 86400 seconds = 1 day
      expect(component.ttlUnit()).toBe('days');
    });
  });

  describe('handleCreate', () => {
    beforeEach(() => {
      serverInfoService.setServerInfo(createServerInfo({ maxTtl: 86400 }));
      component.selectedDomain.set('example.com');
      component.ttlValue.set(12);
      component.ttlUnit.set('hours');
    });

    it('sets validation error when form is invalid', async () => {
      component.selectedDomain.set(''); // Make form invalid

      await component.handleCreate();

      expect(component.validationError()).toBe('Please fix validation errors before creating inbox');
    });

    it('creates inbox with alias when provided', async () => {
      let capturedEmail: string | undefined;
      let capturedTtl: number | undefined;
      spyOn(mailManager, 'createInbox').and.callFake((email?: string, ttl?: number) => {
        capturedEmail = email;
        capturedTtl = ttl;
        return Promise.resolve({ created: true, email: 'myalias@example.com' });
      });
      component.alias.set('myalias');

      await component.handleCreate();

      expect(capturedEmail).toBe('myalias@example.com');
      expect(capturedTtl).toBe(43200); // 12 hours = 43200 seconds
    });

    it('creates inbox with domain only when no alias', async () => {
      let capturedEmail: string | undefined;
      let capturedTtl: number | undefined;
      spyOn(mailManager, 'createInbox').and.callFake((email?: string, ttl?: number) => {
        capturedEmail = email;
        capturedTtl = ttl;
        return Promise.resolve({ created: true, email: 'random@example.com' });
      });
      component.alias.set('');

      await component.handleCreate();

      expect(capturedEmail).toBe('example.com');
      expect(capturedTtl).toBe(43200);
    });

    it('shows success toast and closes dialog on successful creation', async () => {
      spyOn(mailManager, 'createInbox').and.returnValue(Promise.resolve({ created: true, email: 'new@example.com' }));

      await component.handleCreate();
      await fixture.whenStable();

      expect(toastSpy.showSuccess).toHaveBeenCalledWith('Created', 'new@example.com', TOAST_DURATION_MS);
      expect(component.visible()).toBe(false);
    });

    it('saves settings on successful creation', async () => {
      const saveSpy = spyOn(settingsManager, 'saveSettings');
      spyOn(mailManager, 'createInbox').and.returnValue(Promise.resolve({ created: true, email: 'new@example.com' }));
      component.ttlUnit.set('hours');

      await component.handleCreate();

      expect(saveSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          ttlSeconds: 43200,
          ttlUnit: 'hours',
          lastUsedDomain: 'example.com',
        }),
      );
    });

    it('sets validation error when created is false', async () => {
      spyOn(mailManager, 'createInbox').and.returnValue(Promise.resolve({ created: false, email: '' }));

      await component.handleCreate();

      expect(component.validationError()).toBe('Failed to create inbox. Please try again.');
    });

    it('shows error from backend when available', async () => {
      spyOn(console, 'error');
      spyOn(mailManager, 'createInbox').and.rejectWith({
        error: { message: 'Email already exists' },
      });

      await component.handleCreate();

      expect(component.validationError()).toBe('Email already exists');
    });

    it('shows generic error when backend error has no message', async () => {
      spyOn(console, 'error');
      spyOn(mailManager, 'createInbox').and.rejectWith(new Error('Network error'));

      await component.handleCreate();

      expect(component.validationError()).toBe('Failed to create inbox');
    });

    it('shows generic error for null error', async () => {
      spyOn(console, 'error');
      spyOn(mailManager, 'createInbox').and.rejectWith(null);

      await component.handleCreate();

      expect(component.validationError()).toBe('Failed to create inbox');
    });

    it('shows generic error for non-object error', async () => {
      spyOn(console, 'error');
      spyOn(mailManager, 'createInbox').and.rejectWith('string error');

      await component.handleCreate();

      expect(component.validationError()).toBe('Failed to create inbox');
    });

    it('resets creating flag after success', async () => {
      spyOn(mailManager, 'createInbox').and.returnValue(Promise.resolve({ created: true, email: 'new@example.com' }));

      expect(component.creating()).toBe(false);
      const promise = component.handleCreate();
      expect(component.creating()).toBe(true);
      await promise;
      expect(component.creating()).toBe(false);
    });

    it('resets creating flag after failure', async () => {
      spyOn(console, 'error');
      spyOn(mailManager, 'createInbox').and.rejectWith(new Error('fail'));

      await component.handleCreate();

      expect(component.creating()).toBe(false);
    });

    it('trims alias whitespace', async () => {
      let capturedEmail: string | undefined;
      spyOn(mailManager, 'createInbox').and.callFake((email?: string) => {
        capturedEmail = email;
        return Promise.resolve({ created: true, email: 'trimmed@example.com' });
      });
      component.alias.set('  trimmed  ');

      await component.handleCreate();

      expect(capturedEmail).toBe('trimmed@example.com');
    });
  });

  describe('resetToServerDefault', () => {
    it('sets TTL to server default value', async () => {
      spyOn(serverInfoService, 'getServerInfo').and.returnValue(
        Promise.resolve(createServerInfo({ defaultTtl: 7200 })),
      ); // 2 hours

      await component.resetToServerDefault();

      expect(component.ttlValue()).toBe(2);
      expect(component.ttlUnit()).toBe('hours');
    });

    it('does nothing when server info is null', async () => {
      spyOn(serverInfoService, 'getServerInfo').and.returnValue(Promise.resolve(null));
      component.ttlValue.set(5);
      component.ttlUnit.set('days');

      await component.resetToServerDefault();

      expect(component.ttlValue()).toBe(5);
      expect(component.ttlUnit()).toBe('days');
    });
  });

  describe('setToMaxTtl', () => {
    it('sets TTL to max value in hours', () => {
      serverInfoService.setServerInfo(createServerInfo({ maxTtl: 172800 })); // 48 hours

      component.setToMaxTtl();

      expect(component.ttlValue()).toBe(48);
      expect(component.ttlUnit()).toBe('hours');
    });
  });

  describe('onCancel', () => {
    it('closes dialog and resets form', async () => {
      component.alias.set('test');
      component.validationError.set('Some error');

      component.onCancel();
      await fixture.whenStable();

      expect(component.visible()).toBe(false);
      expect(component.alias()).toBe('');
      expect(component.validationError()).toBe(null);
    });
  });

  describe('closeDialog', () => {
    it('resets form fields', async () => {
      component.alias.set('test-alias');
      component.validationError.set('error');

      // Access private method through cast
      await (component as unknown as { closeDialog: () => Promise<void> }).closeDialog();

      expect(component.alias()).toBe('');
      expect(component.validationError()).toBe(null);
      expect(component.visible()).toBe(false);
    });

    it('reloads TTL from settings', async () => {
      settingsManager.saveSettings({
        ttlSeconds: 1800,
        ttlUnit: 'minutes',
        lastUsedDomain: '',
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.DomPurify,
        timeFormat: '24h',
      });

      await (component as unknown as { closeDialog: () => Promise<void> }).closeDialog();

      expect(component.ttlValue()).toBe(30); // 1800 seconds = 30 minutes
      expect(component.ttlUnit()).toBe('minutes');
    });
  });

  describe('ttlUnitOptions', () => {
    it('contains correct unit options', () => {
      expect(component.ttlUnitOptions).toEqual([
        { label: 'Minutes', value: 'minutes' },
        { label: 'Hours', value: 'hours' },
        { label: 'Days', value: 'days' },
      ]);
    });
  });

  describe('emailAuthEnabled', () => {
    beforeEach(() => {
      serverInfoService.setServerInfo(createServerInfo({ maxTtl: 86400 }));
      component.selectedDomain.set('example.com');
      component.ttlValue.set(12);
      component.ttlUnit.set('hours');
    });

    it('is initialized to true by default', () => {
      expect(component.emailAuthEnabled()).toBe(true);
    });

    it('passes undefined emailAuth when enabled (server default)', async () => {
      let capturedEmailAuth: boolean | undefined;
      spyOn(mailManager, 'createInbox').and.callFake(
        (_email?: string, _ttl?: number, _encryption?: 'encrypted' | 'plain', emailAuth?: boolean) => {
          capturedEmailAuth = emailAuth;
          return Promise.resolve({ created: true, email: 'test@example.com' });
        },
      );
      component.emailAuthEnabled.set(true);

      await component.handleCreate();

      expect(capturedEmailAuth).toBeUndefined();
    });

    it('passes false emailAuth when disabled', async () => {
      let capturedEmailAuth: boolean | undefined;
      spyOn(mailManager, 'createInbox').and.callFake(
        (_email?: string, _ttl?: number, _encryption?: 'encrypted' | 'plain', emailAuth?: boolean) => {
          capturedEmailAuth = emailAuth;
          return Promise.resolve({ created: true, email: 'test@example.com' });
        },
      );
      component.emailAuthEnabled.set(false);

      await component.handleCreate();

      expect(capturedEmailAuth).toBe(false);
    });

    it('resets to true when dialog closes', async () => {
      component.emailAuthEnabled.set(false);

      await (component as unknown as { closeDialog: () => Promise<void> }).closeDialog();

      expect(component.emailAuthEnabled()).toBe(true);
    });
  });
});
