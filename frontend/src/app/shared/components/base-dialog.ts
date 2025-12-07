import { EventEmitter, Directive } from '@angular/core';

/**
 * Base class for dialog components that need consistent close/visibility handling.
 * Provides shared logic for emitting close events only once and managing dialog visibility.
 *
 * Usage:
 * ```typescript
 * @Component({ ... })
 * export class MyDialog extends BaseDialog {
 *   @Output() override closed = new EventEmitter<void>();
 *
 *   // Use this.dialogVisible, this.onVisibleChange(), this.closeDialog(), etc.
 * }
 * ```
 */
@Directive()
export abstract class BaseDialog {
  /** Emits once when the dialog is closed so parent components can react. */
  abstract closed: EventEmitter<void>;

  /** Controls whether the PrimeNG dialog is visible. */
  dialogVisible = true;

  /** Tracks whether the close event has already been emitted. */
  private hasEmittedClose = false;

  /**
   * Handles PrimeNG dialog visibility changes and emits a close event when hidden.
   * @param nextVisible Whether the dialog should be shown.
   */
  onVisibleChange(nextVisible: boolean): void {
    if (nextVisible) {
      this.dialogVisible = true;
      return;
    }

    this.dialogVisible = false;
    this.emitClosed();
  }

  /**
   * Hides the dialog and notifies listeners that it has closed.
   */
  protected closeDialog(): void {
    this.dialogVisible = false;
    this.emitClosed();
  }

  /**
   * Emits the close event once to avoid duplicate notifications.
   */
  protected emitClosed(): void {
    if (this.hasEmittedClose) {
      return;
    }

    this.hasEmittedClose = true;
    this.closed.emit();
  }
}
