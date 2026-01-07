import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { EmailHeadersComponent, EmailHeaderItem } from './email-headers';
import { VsToast } from '../../../../shared/services/vs-toast';
import { VsToastStub } from '../../../../../testing/mail-testing.mocks';

/** Flushes the microtask queue to allow promise callbacks to execute. */
const flushPromises = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('EmailHeadersComponent', () => {
  let component: EmailHeadersComponent;
  let fixture: ComponentFixture<EmailHeadersComponent>;
  let toastSpy: jasmine.SpyObj<VsToastStub>;
  let clipboardSpy: jasmine.Spy;

  beforeEach(async () => {
    toastSpy = jasmine.createSpyObj('VsToast', ['showSuccess', 'showError']);

    await TestBed.configureTestingModule({
      imports: [EmailHeadersComponent],
      providers: [provideZonelessChangeDetection(), { provide: VsToast, useValue: toastSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailHeadersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    // Handle case where clipboard.writeText may already be spied by another test suite
    const existingSpy = navigator.clipboard.writeText as jasmine.Spy;
    if (existingSpy && typeof existingSpy.and === 'object') {
      clipboardSpy = existingSpy;
    } else {
      clipboardSpy = spyOn(navigator.clipboard, 'writeText');
    }
    clipboardSpy.calls.reset();
    clipboardSpy.and.returnValue(Promise.resolve());
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('filteredHeaders', () => {
    const testHeaders: EmailHeaderItem[] = [
      { key: 'From', value: 'sender@example.com' },
      { key: 'To', value: 'recipient@test.org' },
      { key: 'Subject', value: 'Hello World' },
    ];

    beforeEach(() => {
      component.headers = testHeaders;
    });

    it('returns all headers when searchTerm is empty', () => {
      component.searchTerm = '';
      expect(component.filteredHeaders()).toEqual(testHeaders);
    });

    it('filters headers by key (case-insensitive)', () => {
      component.searchTerm = 'from';
      const result = component.filteredHeaders();
      expect(result.length).toBe(1);
      expect(result[0].key).toBe('From');
    });

    it('filters headers by value (case-insensitive)', () => {
      component.searchTerm = 'EXAMPLE';
      const result = component.filteredHeaders();
      expect(result.length).toBe(1);
      expect(result[0].value).toBe('sender@example.com');
    });

    it('returns empty array when no headers match', () => {
      component.searchTerm = 'nonexistent';
      expect(component.filteredHeaders()).toEqual([]);
    });

    it('matches headers where key or value contains the term', () => {
      component.searchTerm = 'to';
      const result = component.filteredHeaders();
      // Matches 'To' key and 'recipient@test.org' (no 'to') - only 'To' key
      expect(result.length).toBe(1);
      expect(result[0].key).toBe('To');
    });
  });

  describe('copyToClipboard', () => {
    it('copies text to clipboard and shows success toast', async () => {
      component.copyToClipboard('test-value');
      await flushPromises();

      expect(clipboardSpy).toHaveBeenCalledWith('test-value');
      expect(toastSpy.showSuccess).toHaveBeenCalledWith('', 'Copied to clipboard');
    });

    it('logs error and shows error toast on clipboard failure', async () => {
      const consoleSpy = spyOn(console, 'error');
      clipboardSpy.and.returnValue(Promise.reject(new Error('Clipboard error')));

      component.copyToClipboard('test-value');
      await flushPromises();

      expect(consoleSpy).toHaveBeenCalled();
      expect(toastSpy.showError).toHaveBeenCalledWith('', 'Failed to copy to clipboard');
    });
  });

  describe('copyAllHeaders', () => {
    it('copies all headers as formatted text and shows success toast', async () => {
      component.headers = [
        { key: 'From', value: 'sender@example.com' },
        { key: 'To', value: 'recipient@test.org' },
      ];

      component.copyAllHeaders();
      await flushPromises();

      expect(clipboardSpy).toHaveBeenCalledWith('From: sender@example.com\nTo: recipient@test.org');
      expect(toastSpy.showSuccess).toHaveBeenCalledWith('', 'All headers copied to clipboard');
    });

    it('logs error and shows error toast on clipboard failure', async () => {
      component.headers = [{ key: 'Test', value: 'value' }];
      const consoleSpy = spyOn(console, 'error');
      clipboardSpy.and.returnValue(Promise.reject(new Error('Clipboard error')));

      component.copyAllHeaders();
      await flushPromises();

      expect(consoleSpy).toHaveBeenCalled();
      expect(toastSpy.showError).toHaveBeenCalledWith('', 'Failed to copy to clipboard');
    });

    it('handles empty headers array', async () => {
      component.headers = [];

      component.copyAllHeaders();
      await flushPromises();

      expect(clipboardSpy).toHaveBeenCalledWith('');
      expect(toastSpy.showSuccess).toHaveBeenCalledWith('', 'All headers copied to clipboard');
    });
  });
});
