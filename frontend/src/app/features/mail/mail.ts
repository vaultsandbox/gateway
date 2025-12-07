import { CommonModule } from '@angular/common';
import { Component, inject, signal, computed, effect } from '@angular/core';
import { BadgeModule } from 'primeng/badge';
import { StyleClassModule } from 'primeng/styleclass';
import { ButtonModule } from 'primeng/button';
import { MenuModule } from 'primeng/menu';
import { TooltipModule } from 'primeng/tooltip';
import { RippleModule } from 'primeng/ripple';
import { MailboxSidebar } from './mailbox-sidebar/mailbox-sidebar';
import { VaultSandbox } from '../../shared/services/vault-sandbox';
import { VsThemeManagerService } from '../../shared/services/vs-theme-manager-service';
import { VsToast } from '../../shared/services/vs-toast';
import { MenuItem } from 'primeng/api';
import { MailManager } from './services/mail-manager';
import { EmailList } from './email-list/email-list';
import { EmailDetail } from './email-detail/email-detail';
import { SettingsDialog } from './settings-dialog/settings-dialog';
import { SettingsManager } from './services/settings-manager';
import { MetricsDialog } from '../metrics-dialog/metrics-dialog';
import { SseConsoleDialog } from '../sse-console/sse-console-dialog';
import { ServerInfoService } from './services/server-info.service';

/**
 * Main mail application component that manages inbox display, email viewing, and application settings.
 *
 * This component serves as the primary container for the mail application, coordinating
 * between the inbox list, email detail views, and various dialogs (settings, metrics).
 * It handles email selection, theme switching, and inbox management operations.
 */
@Component({
  selector: 'app-mail',
  imports: [
    CommonModule,
    BadgeModule,
    StyleClassModule,
    MenuModule,
    ButtonModule,
    TooltipModule,
    RippleModule,
    MailboxSidebar,
    EmailList,
    EmailDetail,
    SettingsDialog,
    MetricsDialog,
    SseConsoleDialog,
  ],
  templateUrl: './mail.html',
  styleUrl: './mail.scss',
  standalone: true,
})
export class Mail {
  private readonly vaultSandbox = inject(VaultSandbox);
  private readonly mailManager = inject(MailManager);
  private readonly vsThemeManagerService = inject(VsThemeManagerService);
  private readonly vsToast = inject(VsToast);
  private readonly settingsManager = inject(SettingsManager);
  private readonly serverInfoService = inject(ServerInfoService);

  private isDarkMode = signal(this.vsThemeManagerService.isDarkMode());

  /** Currently selected inbox from the mail manager */
  selectedInbox = this.mailManager.selectedInbox;

  /** Currently selected email from the mail manager */
  selectedEmail = this.mailManager.selectedEmail;

  /** Current view mode - either showing the email list or an email detail */
  viewMode = signal<'list' | 'detail'>('list');

  /** Controls visibility of the settings dialog */
  showSettingsDialog = signal(false);

  /** Controls visibility of the metrics dialog */
  showMetricsDialog = signal(false);

  /** Array of open console dialog IDs */
  openConsoleDialogs = signal<number[]>([]);
  private nextConsoleId = 0;

  /**
   * Date format string based on user's time format preference.
   * Returns either 24-hour format (M/d/yy, HH:mm) or 12-hour format (M/d/yy, h:mm a).
   */
  dateFormat = computed(() => {
    const settings = this.settingsManager.getSettings();
    return settings.timeFormat === '24h' ? 'M/d/yy, HH:mm' : 'M/d/yy, h:mm a';
  });

  constructor() {
    effect(() => {
      if (!this.selectedEmail()) {
        this.viewMode.set('list');
      }
    });
  }

  /**
   * Menu items for the top-left menu dropdown.
   * Dynamically updates based on dark mode state to show appropriate theme toggle option.
   * Console menu item is only shown when sseConsole is enabled on the server.
   */
  topLeftMenuitems = computed<MenuItem[]>(() => {
    const isDark = this.isDarkMode();
    const serverInfo = this.serverInfoService.serverInfo();
    const sseConsoleEnabled = serverInfo?.sseConsole ?? false;

    return [
      {
        label: 'Import Inbox',
        icon: 'pi pi-fw pi-upload',
        command: () => this.openImportDialog(),
      },
      {
        separator: true,
      },
      {
        label: 'Metrics',
        icon: 'pi pi-fw pi-chart-line',
        command: () => this.openMetricsDialog(),
      },
      ...(sseConsoleEnabled
        ? [
            {
              label: 'Console',
              icon: 'pi pi-fw pi-book',
              command: () => this.openConsoleDialog(),
            },
          ]
        : []),
      {
        label: 'Settings',
        icon: 'pi pi-fw pi-cog',
        command: () => this.openSettingsDialog(),
      },
      {
        label: isDark ? 'Light Mode' : 'Dark Mode',
        icon: isDark ? 'pi pi-fw pi-sun' : 'pi pi-fw pi-moon',
        command: () => this.switchTheme(),
      },
      {
        separator: true,
      },
      { label: 'Logout', icon: 'pi pi-fw pi-sign-out', command: () => this.doLogout() },
    ];
  });

  /**
   * Logs out the current user by clearing local data and API key.
   * Clears all mail manager data from local storage and removes the API key,
   * which triggers navigation to the login page.
   */
  doLogout() {
    // Clear MailManager data
    this.mailManager.clearLocalStorage();

    // The VaultSandbox.clearApiKey() will trigger a navigation to login/no-api-key page
    // which will destroy this component and all its state
    this.vaultSandbox.clearApiKey();
  }

  /**
   * Toggles between light and dark theme modes.
   * Updates the HTML theme class and refreshes the isDarkMode signal.
   */
  switchTheme() {
    this.vsThemeManagerService.switchHtmlDarkLight();
    this.isDarkMode.set(this.vsThemeManagerService.isDarkMode());
  }

  /**
   * Copies the provided text to the system clipboard.
   * @param text - The text to copy to clipboard
   */
  async copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  }

  /**
   * Handles email selection from the email list.
   * Selects the email, switches to detail view, marks the email as read,
   * and fetches/decrypts the full email content in the background.
   * @param emailId - The ID of the email to select and view
   */
  async handleEmailSelected(emailId: string): Promise<void> {
    const inbox = this.selectedInbox();
    if (!inbox) return;

    // Select the email
    this.mailManager.selectEmail(inbox.inboxHash, emailId);

    // Switch to detail view
    this.viewMode.set('detail');

    // Mark email as read
    await this.mailManager.markEmailAsRead(inbox.inboxHash, emailId);

    // Fetch and decrypt full email in background
    await this.mailManager.fetchAndDecryptEmail(inbox.inboxHash, emailId);
  }

  /**
   * Handles navigation back from email detail view to the email list.
   * Deselects the current email and switches to list view mode.
   */
  handleBackToList(): void {
    this.mailManager.deselectEmail();
    this.viewMode.set('list');
  }

  /**
   * Refreshes the email list for the currently selected inbox.
   * Reloads all emails from the server for the active inbox.
   */
  async handleRefresh(): Promise<void> {
    const inbox = this.selectedInbox();
    if (!inbox) return;

    try {
      await this.mailManager.loadEmailsForInbox(inbox.inboxHash);
    } catch (error) {
      console.error('[Mail] Error refreshing emails:', error);
    }
  }

  /**
   * Opens a file picker dialog to import inbox JSON files.
   * Allows selecting multiple JSON files for inbox import.
   */
  openImportDialog(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.multiple = true;
    input.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        await this.handleImportFiles(target.files);
      }
    };
    input.click();
  }

  /**
   * Opens the settings dialog.
   * Allows users to configure application preferences.
   */
  openSettingsDialog(): void {
    this.showSettingsDialog.set(true);
  }

  /**
   * Opens the metrics dialog.
   * Displays usage metrics and statistics for the application.
   */
  openMetricsDialog(): void {
    this.showMetricsDialog.set(true);
  }

  /**
   * Opens a new console dialog.
   * Creates a new independent console instance each time it's called.
   */
  openConsoleDialog(): void {
    const consoleId = this.nextConsoleId++;
    this.openConsoleDialogs.update((dialogs) => [...dialogs, consoleId]);
  }

  /**
   * Closes a console dialog by its ID.
   * @param consoleId - The ID of the console dialog to close
   */
  closeConsoleDialog(consoleId: number): void {
    this.openConsoleDialogs.update((dialogs) => dialogs.filter((id) => id !== consoleId));
  }

  /**
   * Handles import of multiple inbox JSON files.
   * Processes each file, displays individual results via toasts, and shows a summary.
   * If any imports succeed, updates SSE subscriptions for the new inboxes.
   * @param fileList - The list of files selected for import
   */
  async handleImportFiles(fileList: FileList): Promise<void> {
    const files = Array.from(fileList);
    const results = await this.mailManager.importMultipleInboxes(files);

    let successCount = 0;

    results.forEach((result) => {
      if (result.success) {
        successCount++;
        this.vsToast.showSuccess('Imported', result.message, 3000);
      } else {
        this.vsToast.showError('Import Failed', result.message, 5000);
      }
    });

    // Show summary if multiple files
    if (files.length > 1) {
      this.vsToast.showInfo(
        'Import Complete',
        `Successfully imported ${successCount} of ${files.length} inboxes`,
        3000,
      );
    }

    // Update SSE subscriptions if any imports were successful
    if (successCount > 0) {
      await this.mailManager.subscribeToAllInboxes();
    }
  }
}
