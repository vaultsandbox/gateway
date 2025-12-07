import { Component, inject, model } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { VaultSandbox } from '../../shared/services/vault-sandbox';
import { VsLogo } from '../../shared/components/vs-logo/vs-logo';
import { firstValueFrom } from 'rxjs/internal/firstValueFrom';
import { environment } from '../../../environments/environment';
import { VsToast } from '../../shared/services/vs-toast';
import { TOAST_DURATION_MS } from '../../shared/constants/app.constants';

const MESSAGES = {
  SUCCESS_TITLE: 'Success',
  SUCCESS_MESSAGE: 'API key validated successfully',
  ERROR_TITLE: 'Error',
  ERROR_UNAUTHORIZED: 'Invalid API key: Unauthorized',
  ERROR_VALIDATION: 'Error validating API key',
  PLACEHOLDER: 'Enter Local API key',
  BUTTON_LABEL: 'OK',
} as const;

@Component({
  selector: 'app-no-api-key',
  imports: [FormsModule, InputTextModule, ButtonModule, VsLogo],
  standalone: true,
  templateUrl: './no-api-key.html',
})
export class NoApiKey {
  private readonly vaultSandbox = inject(VaultSandbox);
  private readonly http = inject(HttpClient);
  private readonly vsToast = inject(VsToast);

  protected readonly apiKeyInput = model('');
  protected readonly loading = model(false);

  // Expose constants for template
  protected readonly MESSAGES = MESSAGES;

  protected async saveApiKey(): Promise<void> {
    const key = this.apiKeyInput().trim();
    if (key) {
      this.loading.set(true);
      try {
        // Validate the API key first by making a direct request with custom headers
        // This bypasses the interceptor and doesn't trigger navigation
        await firstValueFrom(
          this.http.get(`${environment.apiUrl}/check-key`, {
            headers: { 'X-API-Key': key },
          }),
        );

        // Only set the key if validation succeeds
        this.vaultSandbox.setApiKey(key);
        this.vsToast.showSuccess(MESSAGES.SUCCESS_TITLE, MESSAGES.SUCCESS_MESSAGE, TOAST_DURATION_MS);
      } catch (error: unknown) {
        if (this.isHttpError(error) && error.status === 401) {
          this.vsToast.showError(MESSAGES.ERROR_TITLE, MESSAGES.ERROR_UNAUTHORIZED, TOAST_DURATION_MS);
        } else {
          this.vsToast.showError(MESSAGES.ERROR_TITLE, MESSAGES.ERROR_VALIDATION, TOAST_DURATION_MS);
        }
      } finally {
        this.loading.set(false);
      }
    }
  }

  private isHttpError(error: unknown): error is { status: number } {
    return typeof error === 'object' && error !== null && 'status' in error;
  }
}
