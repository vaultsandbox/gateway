import { Component, inject, model, ViewChild, signal, computed } from '@angular/core';
import { Badge } from 'primeng/badge';
import { VsLogo } from '../../../shared/components/vs-logo/vs-logo';
import { ButtonModule } from 'primeng/button';
import { SplitButtonModule } from 'primeng/splitbutton';
import { MailManager } from '../services/mail-manager';
import { VsToast } from '../../../shared/services/vs-toast';
import { ContextMenu } from 'primeng/contextmenu';
import { MenuItem } from 'primeng/api';
import { ConfirmationService } from 'primeng/api';
import { InboxModel } from '../interfaces';
import { VaultSandboxApi } from '../services/vault-sandbox-api';
import { firstValueFrom } from 'rxjs';
import { CustomInboxDialog } from '../custom-inbox-dialog/custom-inbox-dialog';
import { ServerInfoService } from '../services/server-info.service';
import { SettingsManager } from '../services/settings-manager';
import { RippleModule } from 'primeng/ripple';
import { TOAST_DURATION_MS } from '../../../shared/constants/app.constants';

@Component({
  selector: 'app-mailbox-sidebar',
  imports: [Badge, VsLogo, ButtonModule, SplitButtonModule, ContextMenu, CustomInboxDialog, RippleModule],
  templateUrl: './mailbox-sidebar.html',
  styleUrl: './mailbox-sidebar.scss',
  standalone: true,
})
export class MailboxSidebar {
  protected readonly mailManager = inject(MailManager);
  protected readonly creatingMailbox = model(false);
  protected readonly unreadCountByInbox = this.mailManager.unreadCountByInbox;
  private readonly vsToast = inject(VsToast);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly api = inject(VaultSandboxApi);
  private readonly serverInfoService = inject(ServerInfoService);
  private readonly settingsManager = inject(SettingsManager);

  @ViewChild('cm') contextMenu!: ContextMenu;
  protected menuItems: MenuItem[] = [];
  protected selectedInboxForMenu: InboxModel | null = null;
  protected showCustomInboxDialog = signal(false);

  /**
   * Builds the "create inbox" menu with options gated by server configuration.
   */
  protected createInboxMenuItems = computed<MenuItem[]>(() => {
    const serverInfo = this.serverInfoService.serverInfo();
    const hasAllowedDomains = (serverInfo?.allowedDomains?.length ?? 0) > 0;

    return [
      {
        label: 'Custom...',
        icon: 'pi pi-pencil',
        command: () => this.openCustomInboxDialog(),
        disabled: !hasAllowedDomains,
      },
    ];
  });

  /**
   * Constructor
   */
  constructor() {
    // Server info is fetched at app initialization via APP_INITIALIZER
  }

  /**
   * Derives the unread email count for the inbox matching the provided hash.
   * @param inboxHash Unique identifier for the inbox to inspect.
   * @returns Number of unread emails; returns 0 if the inbox is not found.
   */
  getUnreadCount(inboxHash: string): number {
    return this.unreadCountByInbox()[inboxHash] ?? 0;
  }

  /**
   * Extracts the local-part (before '@') from an email address.
   * @param emailAddress Email address to split.
   * @returns Local-part when '@' is present; otherwise the original string.
   */
  getEmailLocalPart(emailAddress: string): string {
    const atIndex = emailAddress.indexOf('@');
    return atIndex !== -1 ? emailAddress.substring(0, atIndex) : emailAddress;
  }

  /**
   * Creates a new inbox using stored domain preference and default TTL.
   * Surfaces success or error feedback.
   */
  async createMailbox() {
    this.creatingMailbox.set(true);

    // Get stored domain preference
    const settings = this.settingsManager.getSettings();
    const lastUsedDomain = settings.lastUsedDomain;

    // Check if stored domain is still valid
    const serverInfo = this.serverInfoService.serverInfo();
    const allowedDomains = serverInfo?.allowedDomains ?? [];

    // Use stored domain if it exists in allowed domains, otherwise use undefined (server default)
    const domain = lastUsedDomain && allowedDomains.includes(lastUsedDomain) ? lastUsedDomain : undefined;

    const response = await this.mailManager.createInbox(domain);
    this.creatingMailbox.set(false);
    if (response.created) {
      this.vsToast.showSuccess('Created', response.email, TOAST_DURATION_MS);
    } else {
      this.vsToast.showError('Error', 'Error Creating Mailbox', TOAST_DURATION_MS);
    }
  }

  /**
   * Selects the inbox corresponding to the provided hash.
   * @param inboxHash Identifier for the inbox to open.
   */
  onInboxClick(inboxHash: string) {
    this.mailManager.selectInbox(inboxHash);
  }

  /**
   * Opens a context menu with actions for the selected inbox at the cursor position.
   * @param event Mouse event used to position the menu.
   * @param inbox Inbox to associate with the context menu actions.
   */
  onInboxRightClick(event: MouseEvent, inbox: InboxModel) {
    event.preventDefault();
    this.selectedInboxForMenu = inbox;

    // Build menu items dynamically
    this.menuItems = [
      {
        label: 'Export Inbox',
        icon: 'pi pi-download',
        command: () => this.exportInbox(this.selectedInboxForMenu!),
      },
      {
        label: 'Forget Inbox',
        icon: 'pi pi-eye-slash',
        command: () => this.forgetInbox(this.selectedInboxForMenu!),
      },
      {
        separator: true,
      },
      {
        label: 'Delete All Emails',
        icon: 'pi pi-eraser danger-icon',
        command: () => this.deleteAllEmails(this.selectedInboxForMenu!),
      },
      {
        label: 'Delete Inbox',
        icon: 'pi pi-trash danger-icon',
        command: () => this.deleteInbox(this.selectedInboxForMenu!),
      },
    ];

    // Show context menu at mouse position
    this.contextMenu.show(event);
  }

  /**
   * Confirms and deletes all emails from the inbox, one by one.
   * Only deletes emails that have already been fetched locally.
   * @param inbox Inbox containing the emails to delete.
   */
  deleteAllEmails(inbox: InboxModel) {
    const emailCount = inbox.emails.length;

    if (emailCount === 0) {
      this.vsToast.showInfo('No Emails', 'This inbox has no emails to delete', TOAST_DURATION_MS);
      return;
    }

    this.confirmationService.confirm({
      header: 'Delete All Emails',
      message: `Are you sure you want to delete all ${emailCount} email${emailCount > 1 ? 's' : ''} from ${inbox.emailAddress}? This action cannot be undone.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete All',
      rejectLabel: 'Cancel',
      accept: async () => {
        try {
          let successCount = 0;
          let failCount = 0;

          // Delete each email one by one
          for (const email of inbox.emails) {
            try {
              // Delete from server via API
              await firstValueFrom(this.api.deleteEmail(inbox.emailAddress, email.id));

              // Delete from MailManager (local state)
              this.mailManager.deleteEmail(inbox.inboxHash, email.id);

              successCount++;
            } catch (error) {
              console.error(`Error deleting email ${email.id}:`, error);
              failCount++;
            }
          }

          // Show result feedback
          if (failCount === 0) {
            this.vsToast.showSuccess('Deleted', `All ${successCount} emails deleted successfully`, TOAST_DURATION_MS);
          } else if (successCount > 0) {
            this.vsToast.showWarning(
              'Partially Deleted',
              `${successCount} emails deleted, ${failCount} failed`,
              TOAST_DURATION_MS,
            );
          } else {
            this.vsToast.showError('Error', 'Failed to delete emails', TOAST_DURATION_MS);
          }
        } catch (error) {
          console.error('Error deleting all emails:', error);
          this.vsToast.showError('Error', 'Failed to delete emails', TOAST_DURATION_MS);
        }
      },
    });
  }

  /**
   * Confirms and deletes the given inbox from the API and local state, showing feedback.
   * @param inbox Inbox selected for deletion.
   */
  deleteInbox(inbox: InboxModel) {
    this.confirmationService.confirm({
      header: 'Delete Inbox',
      message: `Are you sure you want to delete ${inbox.emailAddress}? This action cannot be undone.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: async () => {
        try {
          // First, delete from server via API
          await firstValueFrom(this.api.deleteInbox(inbox.emailAddress));

          // Then delete from MailManager (local state and localStorage)
          this.mailManager.deleteInbox(inbox.inboxHash);

          // Update SSE subscriptions
          await this.mailManager.subscribeToAllInboxes();

          // Show success toast
          this.vsToast.showSuccess('Deleted', `Inbox deleted: ${inbox.emailAddress}`, TOAST_DURATION_MS);
        } catch (error) {
          console.error('Error deleting inbox:', error);
          this.vsToast.showError('Error', 'Failed to delete inbox', TOAST_DURATION_MS);
        }
      },
    });
  }

  /**
   * Removes the inbox from local storage without deleting it from the server.
   * @param inbox Inbox to forget.
   */
  async forgetInbox(inbox: InboxModel) {
    try {
      // Delete from MailManager (local state and localStorage only)
      this.mailManager.deleteInbox(inbox.inboxHash);

      // Update SSE subscriptions
      await this.mailManager.subscribeToAllInboxes();

      // Show success toast
      this.vsToast.showSuccess('Forgotten', `Inbox removed from list: ${inbox.emailAddress}`, TOAST_DURATION_MS);
    } catch (error) {
      console.error('Error forgetting inbox:', error);
      this.vsToast.showError('Error', 'Failed to forget inbox', TOAST_DURATION_MS);
    }
  }

  /**
   * Exports inbox metadata as a downloadable JSON file and notifies the user.
   * @param inbox Inbox to export.
   */
  exportInbox(inbox: InboxModel) {
    try {
      // Get export data from MailManager
      const exportData = this.mailManager.exportInboxMetadata(inbox.inboxHash);

      if (!exportData) {
        this.vsToast.showError('Error', 'Failed to export inbox', TOAST_DURATION_MS);
        return;
      }

      // Convert to JSON with pretty formatting
      const jsonString = JSON.stringify(exportData, null, 2);

      // Create blob and download
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      // Filename format: inbox-{emailAddress}-{timestamp}.json
      const sanitizedEmail = inbox.emailAddress.replace(/@/g, '_at_').replace(/[^a-zA-Z0-9._-]/g, '_');
      a.download = `inbox-${sanitizedEmail}.json`;

      a.click();
      URL.revokeObjectURL(url);

      // Show success toast
      this.vsToast.showSuccess('Exported', `Inbox exported: ${a.download}`, TOAST_DURATION_MS);
    } catch (error) {
      console.error('Error exporting inbox:', error);
      this.vsToast.showError('Error', 'Failed to export inbox', TOAST_DURATION_MS);
    }
  }

  /**
   * Opens the dialog for creating a custom inbox.
   */
  openCustomInboxDialog() {
    this.showCustomInboxDialog.set(true);
  }
}
