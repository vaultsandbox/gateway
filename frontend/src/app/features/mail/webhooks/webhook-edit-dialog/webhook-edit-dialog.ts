import { Component, Output, EventEmitter, OnInit, inject, signal, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { FieldsetModule } from 'primeng/fieldset';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { firstValueFrom } from 'rxjs';
import { BaseDialog } from '../../../../shared/components/base-dialog';
import { VsToast } from '../../../../shared/services/vs-toast';
import { ServerInfoService } from '../../services/server-info.service';
import { WebhookService } from '../services/webhook.service';
import { WebhookFilterForm } from '../components/webhook-filter-form/webhook-filter-form';
import {
  WebhookScope,
  WebhookResponse,
  WebhookEventType,
  FilterConfig,
  BuiltInTemplate,
  CustomTemplate,
  CreateWebhookDto,
  UpdateWebhookDto,
  WebhookTemplateOption,
  WEBHOOK_EVENT_OPTIONS,
  CUSTOM_TEMPLATE_OPTION,
} from '../interfaces/webhook.interfaces';

@Component({
  selector: 'app-webhook-edit-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    SelectModule,
    CheckboxModule,
    FieldsetModule,
    TooltipModule,
    WebhookFilterForm,
  ],
  templateUrl: './webhook-edit-dialog.html',
})
export class WebhookEditDialog extends BaseDialog implements OnInit {
  private readonly webhookService = inject(WebhookService);
  private readonly serverInfoService = inject(ServerInfoService);
  private readonly toast = inject(VsToast, { optional: true });
  private readonly confirmationService = inject(ConfirmationService);

  @Output() override closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<WebhookResponse>();

  scope = input.required<WebhookScope>();
  webhook = input<WebhookResponse | null>(null);

  // Form state
  url = signal<string>('');
  description = signal<string>('');
  events = signal<WebhookEventType[]>(['email.received']);
  templateType = signal<BuiltInTemplate | 'custom'>('default');
  customTemplateBody = signal<string>('');
  customContentType = signal<string>('application/json');
  filterEnabled = signal<boolean>(false);
  filterConfig = signal<FilterConfig>({ rules: [], mode: 'all' });
  saving = signal<boolean>(false);
  secretVisible = signal<boolean>(false);
  templateOptions = signal<WebhookTemplateOption[]>([]);

  // Options
  readonly eventOptions = WEBHOOK_EVENT_OPTIONS;
  readonly customTemplatePlaceholder = '{"text": "New email from {{data.from.address}}: {{data.subject}}"}';

  // Computed
  isEditMode = computed(() => !!this.webhook());

  private parsedUrl = computed(() => {
    const urlValue = this.url().trim();
    if (!urlValue) return null;
    try {
      return new URL(urlValue);
    } catch {
      return 'invalid' as const;
    }
  });

  urlError = computed(() => {
    const parsed = this.parsedUrl();
    if (parsed === null) return null;
    if (parsed === 'invalid') return 'Invalid URL format';
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return 'URL must use HTTPS or HTTP protocol';
    }
    return null;
  });

  urlWarning = computed(() => {
    const parsed = this.parsedUrl();
    if (parsed === null || parsed === 'invalid') return null;
    if (parsed.protocol === 'http:') {
      return 'HTTP is not secure. Consider using HTTPS.';
    }
    return null;
  });

  templateError = computed(() => {
    if (this.templateType() !== 'custom') {
      return null;
    }
    const body = this.customTemplateBody().trim();
    if (!body) {
      return 'Custom template body is required';
    }
    try {
      JSON.parse(body);
      return null;
    } catch {
      return 'Invalid JSON format';
    }
  });

  isValid = computed(() => {
    const urlValue = this.url().trim();
    if (!urlValue) {
      return false;
    }
    if (this.urlError()) {
      return false;
    }
    if (this.events().length === 0) {
      return false;
    }
    if (this.templateType() === 'custom' && this.templateError()) {
      return false;
    }
    if (this.description().length > 500) {
      return false;
    }
    return true;
  });

  ngOnInit(): void {
    this.loadTemplates();
    this.loadWebhookData();
  }

  private async loadTemplates(): Promise<void> {
    try {
      const response = await firstValueFrom(this.webhookService.getTemplates());
      this.templateOptions.set([...response.templates, CUSTOM_TEMPLATE_OPTION]);
    } catch (error) {
      console.error('[WebhookEditDialog] Error loading templates:', error);
      // Fallback to just custom option if API fails
      this.templateOptions.set([CUSTOM_TEMPLATE_OPTION]);
    }
  }

  private loadWebhookData(): void {
    const webhookData = this.webhook();
    const serverInfo = this.serverInfoService.serverInfo();
    /* istanbul ignore next -- @preserve defensive: fallback when serverInfo undefined */
    const requireAuthDefault = serverInfo?.webhookRequireAuthDefault ?? false;

    if (!webhookData) {
      // New webhook - set default requireAuth from server config
      this.filterConfig.set({ rules: [], mode: 'all', requireAuth: requireAuthDefault });
      return;
    }

    this.url.set(webhookData.url);
    this.description.set(webhookData.description ?? '');
    this.events.set([...webhookData.events]);

    // Load template
    if (webhookData.template) {
      if (typeof webhookData.template === 'string') {
        this.templateType.set(webhookData.template as BuiltInTemplate);
      } else if (webhookData.template.type === 'custom') {
        this.templateType.set('custom');
        this.customTemplateBody.set(webhookData.template.body);
        /* istanbul ignore next -- @preserve defensive: contentType should always exist */
        this.customContentType.set(webhookData.template.contentType ?? 'application/json');
      }
    }

    // Load filter
    if (webhookData.filter) {
      this.filterEnabled.set(true);
      this.filterConfig.set({ ...webhookData.filter });
    } else {
      // No filter on existing webhook - set default requireAuth from server config
      this.filterConfig.set({ rules: [], mode: 'all', requireAuth: requireAuthDefault });
    }
  }

  onEventToggle(eventType: WebhookEventType, checked: boolean): void {
    const currentEvents = this.events();
    if (checked) {
      if (!currentEvents.includes(eventType)) {
        this.events.set([...currentEvents, eventType]);
      }
    } else {
      this.events.set(currentEvents.filter((e) => e !== eventType));
    }
  }

  isEventChecked(eventType: WebhookEventType): boolean {
    return this.events().includes(eventType);
  }

  async onSave(): Promise<void> {
    if (!this.isValid()) {
      return;
    }

    this.saving.set(true);

    try {
      const template = this.buildTemplate();
      const filter = this.filterEnabled() && this.filterConfig().rules.length > 0 ? this.filterConfig() : undefined;

      if (this.isEditMode()) {
        const dto: UpdateWebhookDto = {
          url: this.url().trim(),
          events: this.events(),
          description: this.description().trim() || undefined,
          template: template,
          filter: filter ?? null,
        };

        const response = await firstValueFrom(this.webhookService.update(this.scope(), this.webhook()!.id, dto));
        this.toast?.showSuccess('Webhook Updated', 'Webhook has been updated successfully');
        this.saved.emit(response);
      } else {
        const dto: CreateWebhookDto = {
          url: this.url().trim(),
          events: this.events(),
          description: this.description().trim() || undefined,
          template: template,
          filter: filter,
        };

        const response = await firstValueFrom(this.webhookService.create(this.scope(), dto));
        this.toast?.showSuccess('Webhook Created', 'New webhook has been created successfully');
        this.saved.emit(response);
      }

      this.closeDialog();
    } catch (error) {
      console.error('[WebhookEditDialog] Error saving webhook:', error);
      const message = this.getErrorMessage(error);
      this.toast?.showError('Error', message);
    } finally {
      this.saving.set(false);
    }
  }

  private buildTemplate(): BuiltInTemplate | CustomTemplate | undefined {
    const type = this.templateType();
    if (type === 'default') {
      return undefined;
    }
    if (type === 'custom') {
      return {
        type: 'custom',
        body: this.customTemplateBody().trim(),
        contentType: this.customContentType().trim() || 'application/json',
      };
    }
    return type;
  }

  onCancel(): void {
    this.closeDialog();
  }

  copySecret(): void {
    const secret = this.webhook()?.secret;
    if (secret) {
      navigator.clipboard.writeText(secret);
      this.toast?.showSuccess('Copied', 'Secret copied to clipboard');
    }
  }

  confirmRotateSecret(): void {
    this.confirmationService.confirm({
      header: 'Rotate Secret?',
      message:
        'A new secret will be generated immediately. The old secret will remain valid for 1 hour. Make sure to update your webhook endpoint with the new secret.',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Rotate Secret',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-warning',
      accept: async () => {
        await this.rotateSecret();
      },
    });
  }

  private async rotateSecret(): Promise<void> {
    const webhookData = this.webhook();
    /* istanbul ignore if -- @preserve defensive: only called in edit mode */
    if (!webhookData) {
      return;
    }

    try {
      const response = await firstValueFrom(this.webhookService.rotateSecret(this.scope(), webhookData.id));
      this.toast?.showSuccess(
        'Secret Rotated',
        `New secret generated. Old secret valid until ${new Date(response.previousSecretValidUntil).toLocaleString()}`,
      );

      // Emit updated webhook with new secret
      this.saved.emit({
        ...webhookData,
        secret: response.secret,
      });
    } catch (error) {
      console.error('[WebhookEditDialog] Error rotating secret:', error);
      const message = this.getErrorMessage(error);
      this.toast?.showError('Error', message);
    }
  }

  private getErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null) {
      const httpError = error as { error?: { message?: string | string[] } };
      if (httpError.error?.message) {
        const msg = httpError.error.message;
        return Array.isArray(msg) ? msg.join(', ') : msg;
      }
    }
    return 'An unexpected error occurred';
  }
}
