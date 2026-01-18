import { Component, Output, EventEmitter, OnInit, inject, signal, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ConfirmationService } from 'primeng/api';
import { firstValueFrom } from 'rxjs';
import { BaseDialog } from '../../../../shared/components/base-dialog';
import { VsToast } from '../../../../shared/services/vs-toast';
import { WebhookService } from '../services/webhook.service';
import { WebhookEditDialog } from '../webhook-edit-dialog/webhook-edit-dialog';
import { WebhookTestResultDialog } from '../webhook-test-result-dialog/webhook-test-result-dialog';
import { WebhookScope, WebhookResponse, TestWebhookResponse } from '../interfaces/webhook.interfaces';

@Component({
  selector: 'app-webhook-list-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    ButtonModule,
    TagModule,
    ToggleSwitchModule,
    TooltipModule,
    ProgressSpinnerModule,
    WebhookEditDialog,
    WebhookTestResultDialog,
  ],
  templateUrl: './webhook-list-dialog.html',
})
export class WebhookListDialog extends BaseDialog implements OnInit {
  private readonly webhookService = inject(WebhookService);
  private readonly toast = inject(VsToast, { optional: true });
  private readonly confirmationService = inject(ConfirmationService);

  @Output() override closed = new EventEmitter<void>();

  scope = input.required<WebhookScope>();

  // State
  webhooks = signal<WebhookResponse[]>([]);
  loading = signal<boolean>(false);
  error = signal<string | null>(null);

  // Child dialogs
  editDialogVisible = signal<boolean>(false);
  editingWebhook = signal<WebhookResponse | null>(null);
  testResultDialogVisible = signal<boolean>(false);
  testResult = signal<TestWebhookResponse | null>(null);
  testingWebhookId = signal<string | null>(null);

  // Computed
  scopeTitle = computed(() => {
    const scopeValue = this.scope();
    return scopeValue.type === 'global' ? 'Global' : `Inbox: ${scopeValue.email}`;
  });

  dialogTitle = computed(() => {
    const scopeValue = this.scope();
    return scopeValue.type === 'global' ? 'Global Webhooks' : 'Inbox Webhooks';
  });

  ngOnInit(): void {
    void this.loadWebhooks();
  }

  async loadWebhooks(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(this.webhookService.list(this.scope()));
      this.webhooks.set(response.webhooks);
    } catch (err) {
      console.error('[WebhookListDialog] Error loading webhooks:', err);
      this.error.set('Failed to load webhooks');
      this.toast?.showError('Error', 'Failed to load webhooks');
    } finally {
      this.loading.set(false);
    }
  }

  openCreateDialog(): void {
    this.editingWebhook.set(null);
    this.editDialogVisible.set(true);
  }

  openEditDialog(webhook: WebhookResponse): void {
    this.editingWebhook.set(webhook);
    this.editDialogVisible.set(true);
  }

  onEditDialogClosed(): void {
    this.editDialogVisible.set(false);
    this.editingWebhook.set(null);
  }

  onWebhookSaved(webhook: WebhookResponse): void {
    // Update the local list
    const currentWebhooks = this.webhooks();
    const existingIndex = currentWebhooks.findIndex((w) => w.id === webhook.id);

    if (existingIndex >= 0) {
      // Update existing webhook
      const updated = [...currentWebhooks];
      updated[existingIndex] = webhook;
      this.webhooks.set(updated);
    } else {
      // Add new webhook
      this.webhooks.set([webhook, ...currentWebhooks]);
    }

    this.editDialogVisible.set(false);
    this.editingWebhook.set(null);
  }

  async toggleEnabled(webhook: WebhookResponse): Promise<void> {
    const newEnabled = !webhook.enabled;

    try {
      const response = await firstValueFrom(
        this.webhookService.update(this.scope(), webhook.id, { enabled: newEnabled }),
      );

      // Update local state
      const currentWebhooks = this.webhooks();
      const index = currentWebhooks.findIndex((w) => w.id === webhook.id);
      if (index >= 0) {
        const updated = [...currentWebhooks];
        updated[index] = response;
        this.webhooks.set(updated);
      }

      this.toast?.showSuccess('Webhook Updated', `Webhook ${newEnabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      console.error('[WebhookListDialog] Error toggling webhook:', err);
      this.toast?.showError('Error', 'Failed to update webhook');
    }
  }

  async testWebhook(webhook: WebhookResponse): Promise<void> {
    this.testingWebhookId.set(webhook.id);

    try {
      const result = await firstValueFrom(this.webhookService.test(this.scope(), webhook.id));
      this.testResult.set(result);
      this.testResultDialogVisible.set(true);
    } catch (err) {
      console.error('[WebhookListDialog] Error testing webhook:', err);
      this.toast?.showError('Error', 'Failed to test webhook');
    } finally {
      this.testingWebhookId.set(null);
    }
  }

  onTestResultDialogClosed(): void {
    this.testResultDialogVisible.set(false);
    this.testResult.set(null);
  }

  confirmDelete(webhook: WebhookResponse): void {
    this.confirmationService.confirm({
      header: 'Delete Webhook?',
      message: `Are you sure you want to delete this webhook? This action cannot be undone.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      accept: async () => {
        await this.deleteWebhook(webhook);
      },
    });
  }

  private async deleteWebhook(webhook: WebhookResponse): Promise<void> {
    try {
      await firstValueFrom(this.webhookService.delete(this.scope(), webhook.id));

      // Remove from local state
      this.webhooks.set(this.webhooks().filter((w) => w.id !== webhook.id));

      this.toast?.showSuccess('Webhook Deleted', 'Webhook has been deleted successfully');
    } catch (err) {
      console.error('[WebhookListDialog] Error deleting webhook:', err);
      this.toast?.showError('Error', 'Failed to delete webhook');
    }
  }

  /* istanbul ignore next -- @preserve default parameter */
  truncateUrl(url: string, maxLength = 40): string {
    if (url.length <= maxLength) {
      return url;
    }
    return url.substring(0, maxLength - 3) + '...';
  }

  formatTimeAgo(dateString: string | undefined): string {
    if (!dateString) {
      return 'Never';
    }

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) {
      return 'Just now';
    }
    if (diffMinutes < 60) {
      return `${diffMinutes}m ago`;
    }
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }
    return date.toLocaleDateString();
  }

  trackByWebhookId(_index: number, webhook: WebhookResponse): string {
    return webhook.id;
  }
}
