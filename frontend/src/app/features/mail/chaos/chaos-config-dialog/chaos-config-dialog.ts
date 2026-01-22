import { Component, Output, EventEmitter, OnInit, inject, signal, input, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { InputNumberModule } from 'primeng/inputnumber';
import { SliderModule } from 'primeng/slider';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { firstValueFrom } from 'rxjs';
import { BaseDialog } from '../../../../shared/components/base-dialog';
import { VsToast } from '../../../../shared/services/vs-toast';
import { ChaosService } from '../services/chaos.service';
import { InboxModel } from '../../interfaces';
import {
  ChaosConfigRequest,
  ChaosConfigResponse,
  SmtpErrorType,
  GreylistTrackBy,
} from '../interfaces/chaos.interfaces';

/** Option for dropdown selects */
interface SelectOption<T> {
  label: string;
  value: T;
}

@Component({
  selector: 'app-chaos-config-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    ButtonModule,
    ToggleSwitchModule,
    InputNumberModule,
    SliderModule,
    SelectModule,
    MultiSelectModule,
    CheckboxModule,
    DatePickerModule,
    ProgressSpinnerModule,
    TooltipModule,
  ],
  templateUrl: './chaos-config-dialog.html',
})
export class ChaosConfigDialog extends BaseDialog implements OnInit {
  private readonly chaosService = inject(ChaosService);
  private readonly toast = inject(VsToast, { optional: true });
  private readonly confirmationService = inject(ConfirmationService);

  @Output() override closed = new EventEmitter<void>();
  @Output() statusChanged = new EventEmitter<boolean>();

  inbox = input.required<InboxModel>();

  // State
  loading = signal<boolean>(false);
  saving = signal<boolean>(false);
  error = signal<string | null>(null);

  // Form state - main
  enabled = signal<boolean>(false);
  expiresAt = signal<Date | null>(null);

  // Form state - latency
  latencyEnabled = signal<boolean>(false);
  latencyMinDelayMs = signal<number>(500);
  latencyMaxDelayMs = signal<number>(10000);
  latencyJitter = signal<boolean>(true);
  latencyProbability = signal<number>(100);

  // Form state - connection drop
  connectionDropEnabled = signal<boolean>(false);
  connectionDropProbability = signal<number>(100);
  connectionDropGraceful = signal<boolean>(true);

  // Form state - random error
  randomErrorEnabled = signal<boolean>(false);
  randomErrorRate = signal<number>(10);
  randomErrorTypes = signal<SmtpErrorType[]>(['temporary']);

  // Form state - greylist
  greylistEnabled = signal<boolean>(false);
  greylistRetryWindowMs = signal<number>(300000);
  greylistMaxAttempts = signal<number>(2);
  greylistTrackBy = signal<GreylistTrackBy>('ip_sender');

  // Form state - blackhole
  blackholeEnabled = signal<boolean>(false);
  blackholeTriggerWebhooks = signal<boolean>(false);

  // Computed: check if any chaos type is enabled
  private anyChaosTypeEnabled = computed(
    () =>
      this.connectionDropEnabled() ||
      this.greylistEnabled() ||
      this.randomErrorEnabled() ||
      this.blackholeEnabled() ||
      this.latencyEnabled(),
  );

  // Effect: sync global enabled with individual chaos types
  private syncGlobalEnabled = effect(() => {
    const anyEnabled = this.anyChaosTypeEnabled();
    if (anyEnabled && !this.enabled()) {
      this.enabled.set(true);
    } else if (!anyEnabled && this.enabled()) {
      this.enabled.set(false);
    }
  });

  // Select options
  readonly errorTypeOptions: SelectOption<SmtpErrorType>[] = [
    { label: 'Temporary (4xx)', value: 'temporary' },
    { label: 'Permanent (5xx)', value: 'permanent' },
  ];

  readonly trackByOptions: SelectOption<GreylistTrackBy>[] = [
    { label: 'IP Address', value: 'ip' },
    { label: 'Sender Email', value: 'sender' },
    { label: 'IP + Sender', value: 'ip_sender' },
  ];

  // Min date for expiration picker (now)
  minExpirationDate = new Date();

  ngOnInit(): void {
    void this.loadConfig();
  }

  async loadConfig(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const config = await firstValueFrom(this.chaosService.get(this.inbox().emailAddress));
      this.applyConfigToForm(config);
    } catch (err) {
      // 404 means no config exists yet, which is fine
      if ((err as { status?: number })?.status !== 404) {
        console.error('[ChaosConfigDialog] Error loading config:', err);
        this.error.set('Failed to load chaos configuration');
        this.toast?.showError('Error', 'Failed to load chaos configuration');
      }
    } finally {
      this.loading.set(false);
    }
  }

  private applyConfigToForm(config: ChaosConfigResponse): void {
    // Main
    this.enabled.set(config.enabled);
    this.expiresAt.set(config.expiresAt ? new Date(config.expiresAt) : null);

    // Latency
    if (config.latency) {
      this.latencyEnabled.set(config.latency.enabled);
      this.latencyMinDelayMs.set(config.latency.minDelayMs ?? 500);
      this.latencyMaxDelayMs.set(config.latency.maxDelayMs ?? 10000);
      this.latencyJitter.set(config.latency.jitter ?? true);
      this.latencyProbability.set((config.latency.probability ?? 1.0) * 100);
    }

    // Connection Drop
    if (config.connectionDrop) {
      this.connectionDropEnabled.set(config.connectionDrop.enabled);
      this.connectionDropProbability.set((config.connectionDrop.probability ?? 1.0) * 100);
      this.connectionDropGraceful.set(config.connectionDrop.graceful ?? true);
    }

    // Random Error
    if (config.randomError) {
      this.randomErrorEnabled.set(config.randomError.enabled);
      this.randomErrorRate.set((config.randomError.errorRate ?? 0.1) * 100);
      this.randomErrorTypes.set(config.randomError.errorTypes ?? ['temporary']);
    }

    // Greylist
    if (config.greylist) {
      this.greylistEnabled.set(config.greylist.enabled);
      this.greylistRetryWindowMs.set(config.greylist.retryWindowMs ?? 300000);
      this.greylistMaxAttempts.set(config.greylist.maxAttempts ?? 2);
      this.greylistTrackBy.set(config.greylist.trackBy ?? 'ip_sender');
    }

    // Blackhole
    if (config.blackhole) {
      this.blackholeEnabled.set(config.blackhole.enabled);
      this.blackholeTriggerWebhooks.set(config.blackhole.triggerWebhooks ?? false);
    }
  }

  private buildConfigFromForm(): ChaosConfigRequest {
    const config: ChaosConfigRequest = {
      enabled: this.enabled(),
    };

    // Expiration
    if (this.expiresAt()) {
      config.expiresAt = this.expiresAt()!.toISOString();
    }

    // Latency - only include if enabled or has non-default values
    if (this.latencyEnabled()) {
      config.latency = {
        enabled: true,
        minDelayMs: this.latencyMinDelayMs(),
        maxDelayMs: this.latencyMaxDelayMs(),
        jitter: this.latencyJitter(),
        probability: this.latencyProbability() / 100,
      };
    }

    // Connection Drop
    if (this.connectionDropEnabled()) {
      config.connectionDrop = {
        enabled: true,
        probability: this.connectionDropProbability() / 100,
        graceful: this.connectionDropGraceful(),
      };
    }

    // Random Error
    if (this.randomErrorEnabled()) {
      config.randomError = {
        enabled: true,
        errorRate: this.randomErrorRate() / 100,
        errorTypes: this.randomErrorTypes(),
      };
    }

    // Greylist
    if (this.greylistEnabled()) {
      config.greylist = {
        enabled: true,
        retryWindowMs: this.greylistRetryWindowMs(),
        maxAttempts: this.greylistMaxAttempts(),
        trackBy: this.greylistTrackBy(),
      };
    }

    // Blackhole
    if (this.blackholeEnabled()) {
      config.blackhole = {
        enabled: true,
        triggerWebhooks: this.blackholeTriggerWebhooks(),
      };
    }

    return config;
  }

  async saveConfig(): Promise<void> {
    this.saving.set(true);

    try {
      const config = this.buildConfigFromForm();
      await firstValueFrom(this.chaosService.set(this.inbox().emailAddress, config));
      this.toast?.showSuccess('Saved', 'Chaos configuration saved');
      this.statusChanged.emit(config.enabled);
      this.closeDialog();
    } catch (err) {
      console.error('[ChaosConfigDialog] Error saving config:', err);
      this.toast?.showError('Error', 'Failed to save chaos configuration');
    } finally {
      this.saving.set(false);
    }
  }

  confirmDisableAll(): void {
    this.confirmationService.confirm({
      header: 'Disable All Chaos?',
      message: 'Are you sure you want to disable all chaos for this inbox? This will remove all configuration.',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Disable All',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      accept: async () => {
        await this.disableAll();
      },
    });
  }

  private async disableAll(): Promise<void> {
    this.saving.set(true);

    try {
      await firstValueFrom(this.chaosService.disable(this.inbox().emailAddress));
      this.toast?.showSuccess('Disabled', 'All chaos has been disabled');
      this.statusChanged.emit(false);
      this.closeDialog();
    } catch (err) {
      console.error('[ChaosConfigDialog] Error disabling chaos:', err);
      this.toast?.showError('Error', 'Failed to disable chaos');
    } finally {
      this.saving.set(false);
    }
  }

  cancel(): void {
    this.closeDialog();
  }

  /** Formats milliseconds to a human-readable string */
  formatMs(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    const seconds = ms / 1000;
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = seconds / 60;
    return `${minutes}m`;
  }
}
