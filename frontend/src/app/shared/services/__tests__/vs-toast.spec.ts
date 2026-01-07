import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MessageService } from 'primeng/api';
import { VsToast } from '../vs-toast';

describe('VsToast', () => {
  let service: VsToast;
  let messageService: jasmine.SpyObj<MessageService>;

  beforeEach(() => {
    const messageServiceSpy = jasmine.createSpyObj('MessageService', ['add']);

    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: MessageService, useValue: messageServiceSpy }],
    });

    service = TestBed.inject(VsToast);
    messageService = TestBed.inject(MessageService) as jasmine.SpyObj<MessageService>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('showWarning', () => {
    it('should show warning toast with default life', () => {
      service.showWarning('Warning Title', 'Warning message');

      expect(messageService.add).toHaveBeenCalledWith({
        severity: 'warn',
        summary: 'Warning Title',
        detail: 'Warning message',
        life: 3000,
      });
    });

    it('should show warning toast with custom life', () => {
      service.showWarning('Warning Title', 'Warning message', 5000);

      expect(messageService.add).toHaveBeenCalledWith({
        severity: 'warn',
        summary: 'Warning Title',
        detail: 'Warning message',
        life: 5000,
      });
    });
  });

  describe('showError', () => {
    it('should show error toast with default life', () => {
      service.showError('Error Title', 'Error message');

      expect(messageService.add).toHaveBeenCalledWith({
        severity: 'error',
        summary: 'Error Title',
        detail: 'Error message',
        life: 3000,
      });
    });

    it('should show error toast with custom life', () => {
      service.showError('Error Title', 'Error message', 10000);

      expect(messageService.add).toHaveBeenCalledWith({
        severity: 'error',
        summary: 'Error Title',
        detail: 'Error message',
        life: 10000,
      });
    });
  });

  describe('showInfo', () => {
    it('should show info toast with default life', () => {
      service.showInfo('Info Title', 'Info message');

      expect(messageService.add).toHaveBeenCalledWith({
        severity: 'info',
        summary: 'Info Title',
        detail: 'Info message',
        life: 3000,
      });
    });

    it('should show info toast with custom life', () => {
      service.showInfo('Info Title', 'Info message', 2000);

      expect(messageService.add).toHaveBeenCalledWith({
        severity: 'info',
        summary: 'Info Title',
        detail: 'Info message',
        life: 2000,
      });
    });
  });

  describe('showSuccess', () => {
    it('should show success toast with default life', () => {
      service.showSuccess('Success Title', 'Success message');

      expect(messageService.add).toHaveBeenCalledWith({
        severity: 'success',
        summary: 'Success Title',
        detail: 'Success message',
        life: 3000,
      });
    });

    it('should show success toast with custom life', () => {
      service.showSuccess('Success Title', 'Success message', 1500);

      expect(messageService.add).toHaveBeenCalledWith({
        severity: 'success',
        summary: 'Success Title',
        detail: 'Success message',
        life: 1500,
      });
    });
  });

  describe('showInboxDeleted', () => {
    it('should show inbox deleted warning with correct message', () => {
      service.showInboxDeleted('test@example.com');

      expect(messageService.add).toHaveBeenCalledWith({
        severity: 'warn',
        summary: 'Inbox Deleted',
        detail: 'Inbox test@example.com was automatically removed because it no longer exists on the server',
        life: 5000,
      });
    });
  });
});
