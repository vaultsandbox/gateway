import { inject, Injectable } from '@angular/core';
import { ServerInfoService } from './server-info.service';

export enum SanitizationLevel {
  None = 'none',
  DomPurify = 'dompurify',
  IframeSandbox = 'iframe-sandbox',
}
export type TimeFormat = '12h' | '24h';
export type TtlUnit = 'minutes' | 'hours' | 'days';

interface VaultSandboxSettings {
  ttlSeconds: number;
  ttlUnit: TtlUnit;
  lastUsedDomain: string;
  displayInlineImages: boolean;
  sanitizationLevel: SanitizationLevel;
  timeFormat: TimeFormat;
}

@Injectable({
  providedIn: 'root',
})
export class SettingsManager {
  private readonly serverInfoService = inject(ServerInfoService);

  /**
   * Loads cached VaultSandbox settings from localStorage, falling back to defaults
   * when the payload is missing or malformed.
   * @returns Settings snapshot containing TTL, inline image, and sanitization preferences.
   */
  getSettings(): VaultSandboxSettings {
    const defaults: VaultSandboxSettings = {
      ttlSeconds: 0,
      ttlUnit: 'hours',
      lastUsedDomain: '',
      displayInlineImages: true,
      sanitizationLevel: SanitizationLevel.DomPurify,
      timeFormat: '24h',
    };

    try {
      const stored = localStorage.getItem('vaultsandbox_settings');
      if (!stored) {
        return defaults;
      }

      const settings = JSON.parse(stored);
      const validLevels = Object.values(SanitizationLevel);
      const validTimeFormats: TimeFormat[] = ['12h', '24h'];
      const validTtlUnits: TtlUnit[] = ['minutes', 'hours', 'days'];
      return {
        ttlSeconds: typeof settings.ttlSeconds === 'number' ? settings.ttlSeconds : defaults.ttlSeconds,
        ttlUnit: validTtlUnits.includes(settings.ttlUnit) ? settings.ttlUnit : defaults.ttlUnit,
        lastUsedDomain: typeof settings.lastUsedDomain === 'string' ? settings.lastUsedDomain : defaults.lastUsedDomain,
        displayInlineImages:
          typeof settings.displayInlineImages === 'boolean'
            ? settings.displayInlineImages
            : defaults.displayInlineImages,
        sanitizationLevel: validLevels.includes(settings.sanitizationLevel)
          ? settings.sanitizationLevel
          : defaults.sanitizationLevel,
        timeFormat: validTimeFormats.includes(settings.timeFormat) ? settings.timeFormat : defaults.timeFormat,
      };
    } catch (error) {
      console.error('[MailManager] Error loading settings:', error);
      return defaults;
    }
  }

  /**
   * Persists the provided VaultSandbox settings to localStorage.
   * @param settings Settings object to store.
   */
  saveSettings(settings: VaultSandboxSettings): void {
    try {
      localStorage.setItem('vaultsandbox_settings', JSON.stringify(settings));
    } catch (error) {
      console.error('[MailManager] Error saving settings:', error);
    }
  }

  /**
   * Resolves the TTL setting in seconds using user settings if present,
   * otherwise uses server defaults and finally a 1-hour fallback.
   * @returns Object containing TTL value in seconds and the unit.
   */
  async getTtlSetting(): Promise<{ ttlSeconds: number; ttlUnit: TtlUnit }> {
    const settings = this.getSettings();
    if (settings.ttlSeconds > 0) {
      return {
        ttlSeconds: settings.ttlSeconds,
        ttlUnit: settings.ttlUnit,
      };
    }

    const serverInfo = await this.serverInfoService.getServerInfo();
    const defaultTtlSeconds = serverInfo?.defaultTtl ?? 3600;
    return {
      ttlSeconds: defaultTtlSeconds,
      ttlUnit: 'hours',
    };
  }

  /**
   * Updates only the TTL setting while preserving other saved settings fields.
   * @param ttlSeconds TTL value in seconds to persist.
   * @param ttlUnit The unit of time used (minutes, hours, or days).
   */
  saveTtlSetting(ttlSeconds: number, ttlUnit: TtlUnit): void {
    const currentSettings = this.getSettings();
    this.saveSettings({
      ...currentSettings,
      ttlSeconds,
      ttlUnit,
    });
  }
}
