import { Component, inject, signal, computed, effect, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { MessageModule } from 'primeng/message';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { ServerInfoService } from '../services/server-info.service';
import { MailManager } from '../services/mail-manager';
import { VsToast } from '../../../shared/services/vs-toast';
import { SettingsManager, TtlUnit } from '../services/settings-manager';
import { TOAST_DURATION_MS } from '../../../shared/constants/app.constants';
import { toSeconds, fromSeconds, secondsToHours, hoursToSeconds } from '../../../shared/utils/time.utils';
import { EncryptionPolicy } from '../interfaces';

@Component({
  selector: 'app-custom-inbox-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    MessageModule,
    ToggleSwitchModule,
  ],
  templateUrl: './custom-inbox-dialog.html',
  styleUrl: './custom-inbox-dialog.scss',
})
/**
 * Dialog component for creating a custom inbox with optional alias and TTL selection.
 * Uses Angular signals to manage form state and communicates with mail services to persist inboxes.
 */
export class CustomInboxDialog {
  private readonly serverInfoService = inject(ServerInfoService);
  private readonly settingsManager = inject(SettingsManager);
  private readonly mailManager = inject(MailManager);
  private readonly vsToast = inject(VsToast);

  // Two-way binding for visibility
  visible = model.required<boolean>();

  // Internal state
  alias = signal<string>('');
  selectedDomain = signal<string>('');
  ttlValue = signal<number>(12);
  ttlUnit = signal<TtlUnit>('hours');
  creating = signal<boolean>(false);
  validationError = signal<string | null>(null);
  encryptionEnabled = signal<boolean>(true);
  emailAuthEnabled = signal<boolean>(true);
  spamAnalysisEnabled = signal<boolean>(true);

  // TTL unit options for dropdown
  ttlUnitOptions = [
    { label: 'Minutes', value: 'minutes' },
    { label: 'Hours', value: 'hours' },
    { label: 'Days', value: 'days' },
  ];

  // Computed values from server info
  serverInfo = this.serverInfoService.serverInfo;
  /** Available domains retrieved from the server for the select dropdown. */
  domainOptions = computed(() => {
    const info = this.serverInfo();
    return info?.allowedDomains ?? [];
  });
  /** Default inbox TTL in hours, derived from server config. */
  defaultTtlHours = computed(() => secondsToHours(this.serverInfo()?.defaultTtl ?? hoursToSeconds(1)));
  /** Maximum inbox TTL in hours, derived from server config. */
  maxTtlHours = computed(() => secondsToHours(this.serverInfo()?.maxTtl ?? hoursToSeconds(24)));

  // Encryption policy computed values
  /** Current encryption policy from server. */
  /* istanbul ignore next */
  encryptionPolicy = computed<EncryptionPolicy>(() => this.serverInfo()?.encryptionPolicy ?? 'always');
  /** Whether the user can override the default encryption setting. */
  canOverrideEncryption = computed(() => {
    const policy = this.encryptionPolicy();
    return policy === 'enabled' || policy === 'disabled';
  });
  /** Default encryption state based on server policy. */
  defaultEncrypted = computed(() => {
    const policy = this.encryptionPolicy();
    /* istanbul ignore next */
    return policy === 'always' || policy === 'enabled';
  });

  /** Whether spam analysis is available on this server. */
  /* istanbul ignore next */
  isSpamAnalysisAvailable = computed(() => this.serverInfo()?.spamAnalysisEnabled ?? false);

  // TTL conversion helper
  /**
   * Convert the current TTL value and unit to seconds.
   */
  private convertTtlToSeconds(): number {
    return toSeconds(this.ttlValue(), this.ttlUnit());
  }

  /**
   * Check if the current TTL exceeds the server maximum.
   */
  ttlExceedsMax = computed(() => {
    const ttlSeconds = this.convertTtlToSeconds();
    const maxTtlSeconds = hoursToSeconds(this.maxTtlHours());
    return ttlSeconds > maxTtlSeconds;
  });

  // Form validation
  /**
   * Determine if the form inputs are valid:
   * - A domain is selected
   * - TTL is within allowed server range
   * - Alias is either empty or matches the allowed pattern
   */
  isValid = computed(() => {
    const domain = this.selectedDomain();
    const alias = this.alias().trim();
    const ttlSeconds = this.convertTtlToSeconds();
    const maxTtlSeconds = hoursToSeconds(this.maxTtlHours());

    // Must have a domain selected
    if (!domain) return false;

    // TTL must be valid (greater than 0 and within max limit)
    if (this.ttlValue() <= 0 || ttlSeconds > maxTtlSeconds) return false;

    // If alias provided, validate it
    if (alias) {
      // Regex from plan-frontend.md: /^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/
      const aliasRegex = /^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/;
      if (!aliasRegex.test(alias)) {
        return false;
      }
    }

    return true;
  });

  /**
   * Constructor
   */
  constructor() {
    // Initialize domain selection when domains load
    effect(() => {
      const domains = this.domainOptions();
      if (domains.length > 0 && !this.selectedDomain()) {
        // Try to use last used domain from settings
        const lastUsedDomain = this.settingsManager.getSettings().lastUsedDomain;

        // Check if the last used domain is still available
        if (lastUsedDomain && domains.includes(lastUsedDomain)) {
          this.selectedDomain.set(lastUsedDomain);
        } else {
          // Fall back to first domain
          this.selectedDomain.set(domains[0]);
        }
      }
    });

    // Initialize encryption setting from server policy
    effect(() => {
      this.encryptionEnabled.set(this.defaultEncrypted());
    });

    // Initialize TTL with configured setting
    this.loadTtlFromSettings();
  }

  /**
   * Load TTL value and unit from settings.
   */
  private async loadTtlFromSettings() {
    const { ttlSeconds, ttlUnit } = await this.settingsManager.getTtlSetting();

    // Convert seconds back to the stored unit
    const value = fromSeconds(ttlSeconds, ttlUnit);

    this.ttlValue.set(value);
    this.ttlUnit.set(ttlUnit);
  }

  /**
   * Validate form inputs and request inbox creation with an optional alias and TTL.
   * Shows validation errors in-place and success/failure notifications via toast.
   */
  async handleCreate() {
    this.validationError.set(null);

    // Validate
    if (!this.isValid()) {
      this.validationError.set('Please fix validation errors before creating inbox');
      return;
    }

    this.creating.set(true);

    try {
      const alias = this.alias().trim();
      const domain = this.selectedDomain();

      // Convert TTL to seconds
      const ttlSeconds = this.convertTtlToSeconds();

      // Build emailAddress parameter
      // - If alias is empty: send domain only → random email with that domain
      // - If alias provided: send full email → specific email (or random if taken)
      const emailAddress = alias ? `${alias}@${domain}` : domain;

      // Determine encryption preference
      // Only pass explicit preference if user can override and choice differs from default
      /* istanbul ignore next */
      const encryption = this.canOverrideEncryption() ? (this.encryptionEnabled() ? 'encrypted' : 'plain') : undefined;

      // Determine email auth preference
      // Pass explicit value only when user disables it (false), otherwise omit to use server default
      const emailAuth = this.emailAuthEnabled() ? undefined : false;

      // Determine spam analysis preference (only if feature is available on server)
      // Pass explicit value only when user disables it (false), otherwise omit to use server default
      /* istanbul ignore next */
      const spamAnalysis = this.isSpamAnalysisAvailable() && !this.spamAnalysisEnabled() ? false : undefined;

      // Create inbox
      const response = await this.mailManager.createInbox(
        emailAddress,
        ttlSeconds,
        encryption,
        emailAuth,
        spamAnalysis,
      );

      if (response.created) {
        // Save this TTL and domain as the new defaults (sticky settings)
        const currentSettings = this.settingsManager.getSettings();
        this.settingsManager.saveSettings({
          ...currentSettings,
          ttlSeconds,
          ttlUnit: this.ttlUnit(),
          lastUsedDomain: this.selectedDomain(),
        });

        this.vsToast.showSuccess('Created', response.email, TOAST_DURATION_MS);
        this.closeDialog();
      } else {
        this.validationError.set('Failed to create inbox. Please try again.');
      }
    } catch (error: unknown) {
      console.error('Error creating custom inbox:', error);

      // Parse error message from backend
      let errorMsg = 'Failed to create inbox';
      if (typeof error === 'object' && error !== null) {
        const maybeHttpError = error as { error?: { message?: string } };
        if (maybeHttpError.error?.message) {
          errorMsg = maybeHttpError.error.message;
        }
      }

      this.validationError.set(errorMsg);
    } finally {
      this.creating.set(false);
    }
  }

  /**
   * Reset TTL to server default value.
   */
  async resetToServerDefault() {
    const serverInfo = await this.serverInfoService.getServerInfo();
    if (serverInfo) {
      this.ttlValue.set(secondsToHours(serverInfo.defaultTtl));
      this.ttlUnit.set('hours');
    }
  }

  /**
   * Set TTL to the server maximum value.
   */
  setToMaxTtl() {
    this.ttlValue.set(this.maxTtlHours());
    this.ttlUnit.set('hours');
  }

  /**
   * Close the dialog without creating an inbox and reset form state.
   */
  onCancel() {
    this.closeDialog();
  }

  /**
   * Reset dialog fields to defaults and hide the dialog.
   */
  private async closeDialog() {
    // Reset form
    this.alias.set('');

    // Reset TTL to configured setting
    await this.loadTtlFromSettings();

    // Reset encryption to server default
    this.encryptionEnabled.set(this.defaultEncrypted());

    // Reset email auth to enabled (server default)
    this.emailAuthEnabled.set(true);

    // Reset spam analysis to enabled (server default)
    this.spamAnalysisEnabled.set(true);

    this.validationError.set(null);

    // Close
    this.visible.set(false);
  }
}
