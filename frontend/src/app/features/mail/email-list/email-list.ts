import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { DataViewModule } from 'primeng/dataview';
import { ConfirmationService } from 'primeng/api';
import { EmailItemModel } from '../interfaces';
import { MailManager } from '../services/mail-manager';
import { VaultSandboxApi } from '../services/vault-sandbox-api';
import { VsToast } from '../../../shared/services/vs-toast';
import { firstValueFrom } from 'rxjs';
import { DateFormatter } from '../../../shared/utils/date-formatter';
import { TOAST_DURATION_MS } from '../../../shared/constants/app.constants';

@Component({
  selector: 'app-email-list',
  imports: [CommonModule, ButtonModule, DataViewModule],
  templateUrl: './email-list.html',
  styleUrl: './email-list.scss',
  standalone: true,
})
/**
 * Renders a list of emails with inline actions and emits selection events.
 */
export class EmailList {
  /**
   * Emails to display in the list.
   */
  @Input() emails: EmailItemModel[] = [];
  /**
   * Identifier for the current inbox, used for delete operations.
   */
  @Input() inboxHash = '';
  /**
   * Email address associated with the inbox; required for delete API calls.
   */
  @Input() emailAddress = '';
  /**
   * Emits the selected email id when a user opens an email.
   */
  @Output() emailSelected = new EventEmitter<string>();

  protected readonly dateFormatter = DateFormatter;

  private readonly mailManager = inject(MailManager);
  private readonly api = inject(VaultSandboxApi);
  private readonly vsToast = inject(VsToast);
  private readonly confirmationService = inject(ConfirmationService);

  /**
   * Emits the selected email id to parent components.
   */
  onEmailClick(emailId: string): void {
    this.emailSelected.emit(emailId);
  }

  /**
   * Confirms and deletes an email via API and local MailManager state.
   */
  deleteEmail(email: EmailItemModel) {
    this.confirmationService.confirm({
      header: 'Delete Email',
      message: `Are you sure you want to delete this email from ${email.decryptedMetadata?.from || 'Unknown Sender'}?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: async () => {
        try {
          // First, delete from server via API
          await firstValueFrom(this.api.deleteEmail(this.emailAddress, email.id));

          // Then delete from MailManager (local state)
          this.mailManager.deleteEmail(this.inboxHash, email.id);

          // Show success toast
          this.vsToast.showSuccess('Deleted', 'Email deleted successfully', TOAST_DURATION_MS);
        } catch (error) {
          console.error('Error deleting email:', error);
          this.vsToast.showError('Error', 'Failed to delete email', TOAST_DURATION_MS);
        }
      },
    });
  }

  /**
   * Handles inline delete button click without triggering email open.
   */
  onDeleteClick(event: Event, email: EmailItemModel) {
    event.preventDefault();
    event.stopPropagation();
    this.deleteEmail(email);
  }
}
