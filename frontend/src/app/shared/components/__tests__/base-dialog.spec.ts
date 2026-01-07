import { Component, EventEmitter } from '@angular/core';
import { BaseDialog } from '../base-dialog';

// Concrete implementation for testing
@Component({ template: '' })
class TestDialog extends BaseDialog {
  override closed = new EventEmitter<void>();

  // Expose protected methods for testing
  public testEmitClosed(): void {
    this.emitClosed();
  }

  public testCloseDialog(): void {
    this.closeDialog();
  }
}

describe('BaseDialog', () => {
  let dialog: TestDialog;

  beforeEach(() => {
    dialog = new TestDialog();
  });

  describe('initial state', () => {
    it('should have dialogVisible set to true', () => {
      expect(dialog.dialogVisible).toBeTrue();
    });
  });

  describe('onVisibleChange', () => {
    it('should set dialogVisible to true when nextVisible is true', () => {
      dialog.dialogVisible = false;

      dialog.onVisibleChange(true);

      expect(dialog.dialogVisible).toBeTrue();
    });

    it('should set dialogVisible to false and emit closed when nextVisible is false', () => {
      const emitSpy = spyOn(dialog.closed, 'emit');

      dialog.onVisibleChange(false);

      expect(dialog.dialogVisible).toBeFalse();
      expect(emitSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('closeDialog', () => {
    it('should set dialogVisible to false and emit closed', () => {
      const emitSpy = spyOn(dialog.closed, 'emit');

      dialog.testCloseDialog();

      expect(dialog.dialogVisible).toBeFalse();
      expect(emitSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('emitClosed', () => {
    it('should emit closed event on first call', () => {
      const emitSpy = spyOn(dialog.closed, 'emit');

      dialog.testEmitClosed();

      expect(emitSpy).toHaveBeenCalledTimes(1);
    });

    it('should only emit closed event once even when called multiple times', () => {
      const emitSpy = spyOn(dialog.closed, 'emit');

      dialog.testEmitClosed();
      dialog.testEmitClosed();
      dialog.testEmitClosed();

      expect(emitSpy).toHaveBeenCalledTimes(1);
    });

    it('should not emit again after closeDialog was called', () => {
      const emitSpy = spyOn(dialog.closed, 'emit');

      dialog.testCloseDialog();
      dialog.testEmitClosed();

      expect(emitSpy).toHaveBeenCalledTimes(1);
    });

    it('should not emit again after onVisibleChange(false) was called', () => {
      const emitSpy = spyOn(dialog.closed, 'emit');

      dialog.onVisibleChange(false);
      dialog.testEmitClosed();

      expect(emitSpy).toHaveBeenCalledTimes(1);
    });
  });
});
