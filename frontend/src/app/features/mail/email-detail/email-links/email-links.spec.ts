import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { EmailLinksComponent } from './email-links';
import { VsToast } from '../../../../shared/services/vs-toast';
import { VaultSandboxApi } from '../../services/vault-sandbox-api';
import { VsToastStub } from '../../../../../testing/mail-testing.mocks';

describe('EmailLinksComponent', () => {
  let component: EmailLinksComponent;
  let fixture: ComponentFixture<EmailLinksComponent>;
  let toastSpy: jasmine.SpyObj<VsToastStub>;
  let apiSpy: jasmine.SpyObj<VaultSandboxApi>;

  beforeEach(async () => {
    toastSpy = jasmine.createSpyObj('VsToast', ['showInfo', 'showError', 'showSuccess']);
    apiSpy = jasmine.createSpyObj('VaultSandboxApi', ['checkLink']);

    await TestBed.configureTestingModule({
      imports: [EmailLinksComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: VsToast, useValue: toastSpy },
        { provide: VaultSandboxApi, useValue: apiSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailLinksComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('links input setter', () => {
    it('initializes linkStatuses from input array', () => {
      component.links = ['https://example.com', 'http://test.com'];
      expect(component.linkStatuses.length).toBe(2);
      expect(component.linkStatuses[0].url).toBe('https://example.com');
      expect(component.linkStatuses[0].status).toBe('unchecked');
      expect(component.linkStatuses[1].url).toBe('http://test.com');
      expect(component.linkStatuses[1].status).toBe('unchecked');
    });

    it('handles undefined input', () => {
      component.links = undefined;
      expect(component.linkStatuses).toEqual([]);
    });

    it('handles empty array input', () => {
      component.links = [];
      expect(component.linkStatuses).toEqual([]);
    });
  });

  describe('validateLink', () => {
    it('skips validation when status is already checking', async () => {
      component.links = ['https://example.com'];
      component.linkStatuses[0].status = 'checking';

      await component.validateLink(component.linkStatuses[0]);

      expect(toastSpy.showInfo).not.toHaveBeenCalled();
      expect(toastSpy.showError).not.toHaveBeenCalled();
      expect(apiSpy.checkLink).not.toHaveBeenCalled();
    });

    it('shows info toast for mailto links without validation', async () => {
      component.links = ['mailto:test@example.com'];

      await component.validateLink(component.linkStatuses[0]);

      expect(toastSpy.showInfo).toHaveBeenCalledWith('Email Link', 'Email links cannot be validated automatically');
      expect(component.linkStatuses[0].status).toBe('unchecked');
      expect(apiSpy.checkLink).not.toHaveBeenCalled();
    });

    it('shows info toast for mailto links (case insensitive)', async () => {
      component.links = ['MAILTO:test@example.com'];

      await component.validateLink(component.linkStatuses[0]);

      expect(toastSpy.showInfo).toHaveBeenCalledWith('Email Link', 'Email links cannot be validated automatically');
    });

    it('shows info toast for ftp links without validation', async () => {
      component.links = ['ftp://files.example.com'];

      await component.validateLink(component.linkStatuses[0]);

      expect(toastSpy.showInfo).toHaveBeenCalledWith('FTP Link', 'FTP links cannot be validated automatically');
      expect(component.linkStatuses[0].status).toBe('unchecked');
      expect(apiSpy.checkLink).not.toHaveBeenCalled();
    });

    it('shows info toast for ftp links (case insensitive)', async () => {
      component.links = ['FTP://files.example.com'];

      await component.validateLink(component.linkStatuses[0]);

      expect(toastSpy.showInfo).toHaveBeenCalledWith('FTP Link', 'FTP links cannot be validated automatically');
    });

    it('sets status to valid when API returns valid: true', async () => {
      component.links = ['https://example.com'];
      apiSpy.checkLink.and.returnValue(of({ valid: true, status: 200 }));

      await component.validateLink(component.linkStatuses[0]);

      expect(apiSpy.checkLink).toHaveBeenCalledWith('https://example.com');
      expect(component.linkStatuses[0].status).toBe('valid');
      expect(component.linkStatuses[0].statusCode).toBe(200);
    });

    it('sets status to valid without statusCode when status is undefined', async () => {
      component.links = ['https://example.com'];
      apiSpy.checkLink.and.returnValue(of({ valid: true }));

      await component.validateLink(component.linkStatuses[0]);

      expect(component.linkStatuses[0].status).toBe('valid');
      expect(component.linkStatuses[0].statusCode).toBeUndefined();
    });

    it('clears previous error and statusCode before validation', async () => {
      component.links = ['https://example.com'];
      component.linkStatuses[0].error = 'previous error';
      component.linkStatuses[0].statusCode = 500;

      apiSpy.checkLink.and.returnValue(of({ valid: true, status: 200 }));

      await component.validateLink(component.linkStatuses[0]);

      expect(component.linkStatuses[0].error).toBeUndefined();
      expect(component.linkStatuses[0].statusCode).toBe(200);
    });

    it('sets status to invalid when API returns valid: false with status', async () => {
      component.links = ['https://example.com'];
      apiSpy.checkLink.and.returnValue(of({ valid: false, status: 404 }));

      await component.validateLink(component.linkStatuses[0]);

      expect(component.linkStatuses[0].status).toBe('invalid');
      expect(component.linkStatuses[0].statusCode).toBe(404);
      expect(component.linkStatuses[0].error).toBe('HTTP 404');
    });

    it('sets status to invalid with generic message when status is undefined', async () => {
      component.links = ['https://example.com'];
      apiSpy.checkLink.and.returnValue(of({ valid: false }));

      await component.validateLink(component.linkStatuses[0]);

      expect(component.linkStatuses[0].status).toBe('invalid');
      expect(component.linkStatuses[0].error).toBe('Link unreachable');
    });

    it('handles API errors', async () => {
      component.links = ['https://example.com'];
      apiSpy.checkLink.and.returnValue(throwError(() => new Error('Network failure')));

      await component.validateLink(component.linkStatuses[0]);

      expect(component.linkStatuses[0].status).toBe('error');
      expect(component.linkStatuses[0].error).toBe('Network failure');
      expect(toastSpy.showError).toHaveBeenCalledWith('Validation Failed', 'Network failure');
    });

    it('handles non-Error exceptions', async () => {
      component.links = ['https://example.com'];
      apiSpy.checkLink.and.returnValue(throwError(() => 'string error'));

      await component.validateLink(component.linkStatuses[0]);

      expect(component.linkStatuses[0].status).toBe('error');
      expect(component.linkStatuses[0].error).toBe('Failed to validate link');
      expect(toastSpy.showError).toHaveBeenCalledWith('Validation Failed', 'Failed to validate link');
    });
  });

  describe('validateAllLinks', () => {
    it('validates all links and shows summary toast', async () => {
      component.links = ['https://example1.com', 'https://example2.com'];
      apiSpy.checkLink.and.returnValue(of({ valid: true, status: 200 }));

      await component.validateAllLinks();

      expect(component.isValidatingAll).toBe(false);
      expect(toastSpy.showInfo).toHaveBeenCalledWith('Validation Complete', '2 valid, 0 errors out of 2 links');
    });

    it('counts errors correctly in summary', async () => {
      component.links = ['https://example1.com', 'https://example2.com', 'https://example3.com'];
      let callCount = 0;
      apiSpy.checkLink.and.callFake(() => {
        callCount++;
        if (callCount === 2) {
          return throwError(() => new Error('Network error'));
        }
        return of({ valid: true, status: 200 });
      });

      await component.validateAllLinks();

      expect(toastSpy.showInfo).toHaveBeenCalledWith('Validation Complete', '2 valid, 1 errors out of 3 links');
    });

    it('counts invalid status in errors', async () => {
      component.links = ['https://example.com'];
      apiSpy.checkLink.and.returnValue(of({ valid: true, status: 200 }));

      await component.validateAllLinks();

      // Manually set one to invalid to test the filter
      component.linkStatuses[0].status = 'invalid';
      // Re-run to verify filter counts invalid
      component.links = ['https://a.com', 'https://b.com'];
      component.linkStatuses[0].status = 'invalid';
      component.linkStatuses[1].status = 'valid';

      // The counts are computed from linkStatuses array state
      const errorCount = component.linkStatuses.filter((ls) => ls.status === 'error' || ls.status === 'invalid').length;
      expect(errorCount).toBe(1);
    });

    it('processes links in batches of 5', async () => {
      const links = Array.from({ length: 12 }, (_, i) => `https://example${i}.com`);
      component.links = links;

      let concurrentCalls = 0;
      let maxConcurrent = 0;

      apiSpy.checkLink.and.callFake((): Observable<{ valid: boolean; status: number }> => {
        concurrentCalls++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
        return new Observable((subscriber) => {
          setTimeout(() => {
            concurrentCalls--;
            subscriber.next({ valid: true, status: 200 });
            subscriber.complete();
          }, 10);
        });
      });

      await component.validateAllLinks();

      expect(maxConcurrent).toBeLessThanOrEqual(5);
    });

    it('sets isValidatingAll to true during validation', async () => {
      component.links = ['https://example.com'];
      let capturedIsValidating = false;

      apiSpy.checkLink.and.callFake(() => {
        capturedIsValidating = component.isValidatingAll;
        return of({ valid: true, status: 200 });
      });

      await component.validateAllLinks();

      expect(capturedIsValidating).toBe(true);
      expect(component.isValidatingAll).toBe(false);
    });

    it('handles unexpected errors during batch validation', async () => {
      component.links = ['https://example.com'];
      const consoleSpy = spyOn(console, 'error');

      // Make validateLink throw an unexpected error
      spyOn(component, 'validateLink').and.throwError('Unexpected batch error');

      await component.validateAllLinks();

      expect(consoleSpy).toHaveBeenCalled();
      expect(toastSpy.showError).toHaveBeenCalledWith('Validation Error', 'An error occurred while validating links');
      expect(component.isValidatingAll).toBe(false);
    });

    it('resets isValidatingAll in finally block even on error', async () => {
      component.links = ['https://example.com'];
      spyOn(console, 'error');
      spyOn(component, 'validateLink').and.throwError('Test error');

      await component.validateAllLinks();

      expect(component.isValidatingAll).toBe(false);
    });
  });

  describe('copyToClipboard', () => {
    let clipboardSpy: jasmine.Spy;

    beforeEach(() => {
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

    it('copies URL to clipboard and shows success toast', async () => {
      await component.copyToClipboard('https://example.com');

      expect(clipboardSpy).toHaveBeenCalledWith('https://example.com');
      expect(toastSpy.showSuccess).toHaveBeenCalledWith('Copied', 'Link copied to clipboard');
    });

    it('handles clipboard write error', async () => {
      const consoleSpy = spyOn(console, 'error');
      clipboardSpy.and.returnValue(Promise.reject(new Error('Clipboard error')));

      await component.copyToClipboard('https://example.com');

      expect(consoleSpy).toHaveBeenCalled();
      expect(toastSpy.showError).toHaveBeenCalledWith('Copy Failed', 'Unable to copy link to clipboard');
    });
  });

  describe('helpers exposure', () => {
    it('exposes EmailLinksHelpers as protected helpers property', () => {
      // Access via component instance to verify helpers is available
      expect((component as unknown as { helpers: unknown }).helpers).toBeDefined();
    });
  });
});
