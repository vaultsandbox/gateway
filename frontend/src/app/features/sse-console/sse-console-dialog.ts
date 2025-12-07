import { Component, Output, EventEmitter, OnInit, OnDestroy, inject, effect, signal, DestroyRef } from '@angular/core';
import { BaseDialog } from '../../shared/components/base-dialog';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { SseConsoleService, ConsoleMessage } from './sse-console.service';
import { VaultSandbox } from '../../shared/services/vault-sandbox';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DateFormatter } from '../../shared/utils/date-formatter';

/**
 * Dialog component that displays a real-time console stream of email events.
 * Connects to SSE console endpoint and shows color-coded messages.
 */
@Component({
  selector: 'app-sse-console-dialog',
  imports: [CommonModule, DialogModule, ButtonModule],
  templateUrl: './sse-console-dialog.html',
  styleUrl: './sse-console-dialog.scss',
  standalone: true,
})
export class SseConsoleDialog extends BaseDialog implements OnInit, OnDestroy {
  private readonly sseConsoleService = inject(SseConsoleService);
  private readonly vaultSandbox = inject(VaultSandbox);
  private readonly destroyRef = inject(DestroyRef);

  @Output() override closed = new EventEmitter<void>();

  messages = signal<ConsoleMessage[]>([]);
  private autoScrollEnabled = true;

  readonly connected = this.sseConsoleService.connected;

  constructor() {
    super();
    // Effect to auto-scroll when messages change and auto-scroll is enabled
    effect(() => {
      if (this.messages().length > 0 && this.autoScrollEnabled) {
        queueMicrotask(() => this.scrollToBottom());
      }
    });
  }

  /**
   * Connects to the SSE console stream on initialization.
   */
  ngOnInit(): void {
    const apiKey = this.vaultSandbox.apiKey();
    if (!apiKey) {
      console.error('[SseConsoleDialog] No API key available');
      return;
    }

    this.sseConsoleService.connect(apiKey);

    this.sseConsoleService.messages$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((message) => {
      this.messages.update((current) => {
        const nextMessages = [...current, message];
        return nextMessages.length > 1000 ? nextMessages.slice(-1000) : nextMessages;
      });
    });
  }

  /**
   * Disconnects from the SSE console stream when the component is destroyed.
   */
  ngOnDestroy(): void {
    this.sseConsoleService.disconnect();
  }

  /**
   * Triggered by the dialog close button.
   */
  onClose(): void {
    this.closeDialog();
  }

  /**
   * Clears all messages from the console.
   */
  clearConsole(): void {
    this.messages.set([]);
  }

  /**
   * Returns the CSS class for a message based on its type.
   */
  getMessageClass(type: string): string {
    return `message-${type}`;
  }

  /**
   * Formats the timestamp for display.
   */
  formatTimestamp(timestamp: string): string {
    return DateFormatter.formatTimeOnly(timestamp);
  }

  /**
   * Scrolls the message container to the bottom.
   */
  private scrollToBottom(): void {
    const container = document.querySelector('.console-messages');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  /**
   * Handles scroll events to detect if user scrolled up (disables auto-scroll).
   */
  onScroll(event: Event): void {
    const container = event.target as HTMLElement;
    const isAtBottom = container.scrollHeight - container.scrollTop === container.clientHeight;
    this.autoScrollEnabled = isAtBottom;
  }
}
