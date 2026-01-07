import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { SettingsManager, SanitizationLevel } from '../settings-manager';
import { ServerInfoService } from '../server-info.service';
import { ServerInfo } from '../../interfaces';

describe('SettingsManager', () => {
  let service: SettingsManager;
  let serverInfoMock: jasmine.SpyObj<ServerInfoService>;

  const defaultSettings = {
    ttlSeconds: 0,
    ttlUnit: 'hours' as const,
    lastUsedDomain: '',
    displayInlineImages: true,
    sanitizationLevel: SanitizationLevel.DomPurify,
    timeFormat: '24h' as const,
  };

  beforeEach(() => {
    localStorage.clear();
    serverInfoMock = jasmine.createSpyObj('ServerInfoService', ['getServerInfo']);
    serverInfoMock.getServerInfo.and.resolveTo({ defaultTtl: 3600 } as ServerInfo);

    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: ServerInfoService, useValue: serverInfoMock }],
    });
    service = TestBed.inject(SettingsManager);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getSettings', () => {
    it('should return defaults when localStorage is empty', () => {
      const settings = service.getSettings();
      expect(settings).toEqual(defaultSettings);
    });

    it('should return defaults when localStorage has null', () => {
      localStorage.setItem('vaultsandbox_settings', 'null');
      const settings = service.getSettings();
      expect(settings).toEqual(defaultSettings);
    });

    it('should return stored valid settings', () => {
      const stored = {
        ttlSeconds: 3600,
        ttlUnit: 'days' as const,
        lastUsedDomain: 'example.com',
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.IframeSandbox,
        timeFormat: '12h' as const,
      };
      localStorage.setItem('vaultsandbox_settings', JSON.stringify(stored));

      const settings = service.getSettings();
      expect(settings).toEqual(stored);
    });

    it('should use default ttlSeconds when stored value is not a number', () => {
      localStorage.setItem('vaultsandbox_settings', JSON.stringify({ ttlSeconds: 'invalid' }));
      const settings = service.getSettings();
      expect(settings.ttlSeconds).toBe(0);
    });

    it('should use default ttlUnit when stored value is invalid', () => {
      localStorage.setItem('vaultsandbox_settings', JSON.stringify({ ttlUnit: 'invalid' }));
      const settings = service.getSettings();
      expect(settings.ttlUnit).toBe('hours');
    });

    it('should accept valid ttlUnit values', () => {
      const units: ('minutes' | 'hours' | 'days')[] = ['minutes', 'hours', 'days'];
      for (const unit of units) {
        localStorage.setItem('vaultsandbox_settings', JSON.stringify({ ttlUnit: unit }));
        const settings = service.getSettings();
        expect(settings.ttlUnit).toBe(unit);
      }
    });

    it('should use default lastUsedDomain when stored value is not a string', () => {
      localStorage.setItem('vaultsandbox_settings', JSON.stringify({ lastUsedDomain: 123 }));
      const settings = service.getSettings();
      expect(settings.lastUsedDomain).toBe('');
    });

    it('should use default displayInlineImages when stored value is not a boolean', () => {
      localStorage.setItem('vaultsandbox_settings', JSON.stringify({ displayInlineImages: 'yes' }));
      const settings = service.getSettings();
      expect(settings.displayInlineImages).toBe(true);
    });

    it('should use default sanitizationLevel when stored value is invalid', () => {
      localStorage.setItem('vaultsandbox_settings', JSON.stringify({ sanitizationLevel: 'invalid' }));
      const settings = service.getSettings();
      expect(settings.sanitizationLevel).toBe(SanitizationLevel.DomPurify);
    });

    it('should accept all valid sanitizationLevel values', () => {
      const levels = [SanitizationLevel.None, SanitizationLevel.DomPurify, SanitizationLevel.IframeSandbox];
      for (const level of levels) {
        localStorage.setItem('vaultsandbox_settings', JSON.stringify({ sanitizationLevel: level }));
        const settings = service.getSettings();
        expect(settings.sanitizationLevel).toBe(level);
      }
    });

    it('should use default timeFormat when stored value is invalid', () => {
      localStorage.setItem('vaultsandbox_settings', JSON.stringify({ timeFormat: 'invalid' }));
      const settings = service.getSettings();
      expect(settings.timeFormat).toBe('24h');
    });

    it('should accept valid timeFormat values', () => {
      const formats: ('12h' | '24h')[] = ['12h', '24h'];
      for (const format of formats) {
        localStorage.setItem('vaultsandbox_settings', JSON.stringify({ timeFormat: format }));
        const settings = service.getSettings();
        expect(settings.timeFormat).toBe(format);
      }
    });

    it('should return defaults when JSON parsing fails', () => {
      localStorage.setItem('vaultsandbox_settings', 'invalid json{');
      const consoleSpy = spyOn(console, 'error');

      const settings = service.getSettings();

      expect(settings).toEqual(defaultSettings);
      expect(consoleSpy).toHaveBeenCalledWith('[MailManager] Error loading settings:', jasmine.any(SyntaxError));
    });
  });

  describe('saveSettings', () => {
    it('should save settings to localStorage', () => {
      const settings = {
        ttlSeconds: 7200,
        ttlUnit: 'days' as const,
        lastUsedDomain: 'test.com',
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.None,
        timeFormat: '12h' as const,
      };

      service.saveSettings(settings);

      const stored = JSON.parse(localStorage.getItem('vaultsandbox_settings')!);
      expect(stored).toEqual(settings);
    });

    it('should log error when localStorage throws', () => {
      const consoleSpy = spyOn(console, 'error');
      spyOn(localStorage, 'setItem').and.throwError('QuotaExceeded');

      service.saveSettings(defaultSettings);

      expect(consoleSpy).toHaveBeenCalledWith('[MailManager] Error saving settings:', jasmine.any(Error));
    });
  });

  describe('getTtlSetting', () => {
    it('should return user settings when ttlSeconds is greater than 0', async () => {
      const stored = { ttlSeconds: 7200, ttlUnit: 'minutes' };
      localStorage.setItem('vaultsandbox_settings', JSON.stringify(stored));

      const result = await service.getTtlSetting();

      expect(result).toEqual({ ttlSeconds: 7200, ttlUnit: 'minutes' });
    });

    it('should return server default TTL when user has no saved TTL', async () => {
      serverInfoMock.getServerInfo.and.resolveTo({ defaultTtl: 1800 } as ServerInfo);

      const result = await service.getTtlSetting();

      expect(result).toEqual({ ttlSeconds: 1800, ttlUnit: 'hours' });
    });

    it('should return fallback TTL of 3600 when serverInfo has no defaultTtl', async () => {
      serverInfoMock.getServerInfo.and.resolveTo({ defaultTtl: null } as unknown as ServerInfo);

      const result = await service.getTtlSetting();

      expect(result).toEqual({ ttlSeconds: 3600, ttlUnit: 'hours' });
    });

    it('should return fallback TTL of 3600 when serverInfo is null', async () => {
      serverInfoMock.getServerInfo.and.resolveTo(null);

      const result = await service.getTtlSetting();

      expect(result).toEqual({ ttlSeconds: 3600, ttlUnit: 'hours' });
    });

    it('should return server default when user TTL is 0', async () => {
      localStorage.setItem('vaultsandbox_settings', JSON.stringify({ ttlSeconds: 0 }));
      serverInfoMock.getServerInfo.and.resolveTo({ defaultTtl: 600 } as ServerInfo);

      const result = await service.getTtlSetting();

      expect(result).toEqual({ ttlSeconds: 600, ttlUnit: 'hours' });
    });
  });

  describe('saveTtlSetting', () => {
    it('should update TTL while preserving other settings', () => {
      const existingSettings = {
        ttlSeconds: 100,
        ttlUnit: 'hours',
        lastUsedDomain: 'existing.com',
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.IframeSandbox,
        timeFormat: '12h',
      };
      localStorage.setItem('vaultsandbox_settings', JSON.stringify(existingSettings));

      service.saveTtlSetting(5000, 'days');

      const stored = JSON.parse(localStorage.getItem('vaultsandbox_settings')!);
      expect(stored.ttlSeconds).toBe(5000);
      expect(stored.ttlUnit).toBe('days');
      expect(stored.lastUsedDomain).toBe('existing.com');
      expect(stored.displayInlineImages).toBe(false);
      expect(stored.sanitizationLevel).toBe(SanitizationLevel.IframeSandbox);
      expect(stored.timeFormat).toBe('12h');
    });

    it('should save TTL with default settings when no existing settings', () => {
      service.saveTtlSetting(1800, 'minutes');

      const stored = JSON.parse(localStorage.getItem('vaultsandbox_settings')!);
      expect(stored.ttlSeconds).toBe(1800);
      expect(stored.ttlUnit).toBe('minutes');
      expect(stored.lastUsedDomain).toBe('');
      expect(stored.displayInlineImages).toBe(true);
    });
  });
});
