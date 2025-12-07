import { Injectable, inject } from '@angular/core';
import { MessageService } from 'primeng/api';

/**
 * Wrapper around PrimeNG's MessageService with app-specific helpers.
 */
@Injectable({
  providedIn: 'root',
})
export class VsToast {
  private readonly messageService = inject(MessageService);

  /**
   * Shows a warning toast message.
   *
   * @param tSummary Title of the toast.
   * @param tDetail Body text.
   * @param tLife Lifespan in milliseconds.
   */
  showWarning(tSummary: string, tDetail: string, tLife = 3000): void {
    this.messageService.add({ severity: 'warn', summary: tSummary, detail: tDetail, life: tLife });
  }

  /**
   * Shows an error toast message.
   *
   * @param tSummary Title of the toast.
   * @param tDetail Body text.
   * @param tLife Lifespan in milliseconds.
   */
  showError(tSummary: string, tDetail: string, tLife = 3000): void {
    this.messageService.add({ severity: 'error', summary: tSummary, detail: tDetail, life: tLife });
  }

  /**
   * Shows an informational toast message.
   *
   * @param tSummary Title of the toast.
   * @param tDetail Body text.
   * @param tLife Lifespan in milliseconds.
   */
  showInfo(tSummary: string, tDetail: string, tLife = 3000): void {
    this.messageService.add({ severity: 'info', summary: tSummary, detail: tDetail, life: tLife });
  }

  /**
   * Shows a success toast message.
   *
   * @param tSummary Title of the toast.
   * @param tDetail Body text.
   * @param tLife Lifespan in milliseconds.
   */
  showSuccess(tSummary: string, tDetail: string, tLife = 3000): void {
    this.messageService.add({ severity: 'success', summary: tSummary, detail: tDetail, life: tLife });
  }

  /**
   * Displays a standardised message for inbox deletion warnings.
   *
   * @param emailAddress Email address that was removed.
   */
  showInboxDeleted(emailAddress: string): void {
    this.messageService.add({
      severity: 'warn',
      summary: 'Inbox Deleted',
      detail: `Inbox ${emailAddress} was automatically removed because it no longer exists on the server`,
      life: 5000,
    });
  }
}
