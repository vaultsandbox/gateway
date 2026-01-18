import { Component, Output, EventEmitter, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { BaseDialog } from '../../../../shared/components/base-dialog';
import { TestWebhookResponse } from '../interfaces/webhook.interfaces';

@Component({
  selector: 'app-webhook-test-result-dialog',
  standalone: true,
  imports: [CommonModule, DialogModule, ButtonModule, MessageModule],
  templateUrl: './webhook-test-result-dialog.html',
})
export class WebhookTestResultDialog extends BaseDialog {
  @Output() override closed = new EventEmitter<void>();

  result = input.required<TestWebhookResponse>();

  onClose(): void {
    this.closeDialog();
  }

  formatPayload(): string {
    const payload = this.result().payloadSent;
    if (!payload) {
      return '';
    }
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      /* istanbul ignore next -- @preserve defensive: circular reference or non-serializable */
      return String(payload);
    }
  }
}
