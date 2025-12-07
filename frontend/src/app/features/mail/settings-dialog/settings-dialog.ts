import { Component, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { BaseDialog } from '../../../shared/components/base-dialog';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { SelectModule } from 'primeng/select';
import { VsToast } from '../../../shared/services/vs-toast';
import { ServerInfoService } from '../services/server-info.service';
import { SettingsManager, SanitizationLevel, TimeFormat } from '../services/settings-manager';
import { ConfirmationService } from 'primeng/api';
import { VaultSandboxApi } from '../services/vault-sandbox-api';
import { InboxService } from '../services/inbox.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-settings-dialog',
  imports: [CommonModule, FormsModule, DialogModule, ButtonModule, ToggleSwitchModule, SelectModule],
  templateUrl: './settings-dialog.html',
  styleUrl: './settings-dialog.scss',
  standalone: true,
})
/**
 * Dialog component allowing users to tweak mail display settings such as
 * inline image behavior, HTML sanitization level, and time format.
 */
export class SettingsDialog extends BaseDialog implements OnInit {
  private readonly settingsManager = inject(SettingsManager);
  private readonly serverInfoService = inject(ServerInfoService);
  private readonly toast = inject(VsToast, { optional: true });
  private readonly confirmationService = inject(ConfirmationService);
  private readonly api = inject(VaultSandboxApi);
  private readonly inboxService = inject(InboxService);

  /** Emits once when the dialog is closed so parent components can react. */
  @Output() override closed = new EventEmitter<void>();

  displayInlineImages = false;
  sanitizationLevel: SanitizationLevel = SanitizationLevel.DomPurify;
  timeFormat: TimeFormat = '24h';
  settingsLoaded = false;

  sanitizationOptions = [
    { label: 'Trusted Mode (No sanitization, iframe sandboxed)', value: SanitizationLevel.None },
    { label: 'Secure Mode - DOMPurify (Recommended)', value: SanitizationLevel.DomPurify },
  ];

  timeFormatOptions = [
    { label: '24-hour (15:30)', value: '24h' },
    { label: '12-hour (3:30 PM)', value: '12h' },
  ];

  ngOnInit(): void {
    void this.loadSettings();
  }

  /** Persists settings and closes the dialog. */
  onSave(): void {
    const currentSettings = this.settingsManager.getSettings();

    // If switching to 'none' (trusted mode), show confirmation
    if (
      this.sanitizationLevel === SanitizationLevel.None &&
      currentSettings.sanitizationLevel !== SanitizationLevel.None
    ) {
      this.confirmationService.confirm({
        header: 'Enable Trusted Mode?',
        message:
          'Trusted mode renders emails in a sandboxed iframe with no sanitization for full CSS/styling support. Scripts are blocked by the sandbox, but forms, iframes, and other content are allowed. Only enable for emails from sources you completely trust. Continue?',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Enable Trusted Mode',
        rejectLabel: 'Cancel',
        acceptButtonStyleClass: 'p-button-warning',
        accept: () => {
          this.saveSettingsAndClose();
        },
      });
      return;
    }

    this.saveSettingsAndClose();
  }

  /** Saves settings and closes the dialog. */
  private saveSettingsAndClose(): void {
    const currentSettings = this.settingsManager.getSettings();

    this.settingsManager.saveSettings({
      ...currentSettings,
      displayInlineImages: this.displayInlineImages,
      sanitizationLevel: this.sanitizationLevel,
      timeFormat: this.timeFormat,
    });

    this.toast?.showSuccess('Settings saved', 'Preferences updated successfully');
    this.closeDialog();
  }

  /** Cancels without persisting changes and closes the dialog. */
  onCancel(): void {
    this.closeDialog();
  }

  /**
   * Loads existing settings to prefill the form.
   */
  private async loadSettings(): Promise<void> {
    this.settingsLoaded = false;

    try {
      const settings = this.settingsManager.getSettings();
      this.displayInlineImages = settings.displayInlineImages;
      this.sanitizationLevel = settings.sanitizationLevel;
      this.timeFormat = settings.timeFormat;
    } finally {
      this.settingsLoaded = true;
    }
  }

  /**
   * Deletes all inboxes after user confirmation.
   */
  onDeleteAllInboxes(): void {
    this.confirmationService.confirm({
      header: 'Delete All Inboxes',
      message: 'Are you sure you want to delete ALL inboxes? This will remove all emails and cannot be undone.',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete All',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      accept: async () => {
        try {
          // Delete all inboxes from server
          await firstValueFrom(this.api.clearAllInboxes());

          // Clear local storage
          this.inboxService.clearLocalStorage();

          // Refresh inboxes (will be empty)
          await this.inboxService.subscribeToAllInboxes();

          this.toast?.showSuccess('All Inboxes Deleted', 'All inboxes have been cleared successfully');
        } catch (error) {
          console.error('[SettingsDialog] Error deleting all inboxes:', error);
          this.toast?.showError('Error', 'Failed to delete all inboxes. Please try again.');
        }
      },
    });
  }
}
