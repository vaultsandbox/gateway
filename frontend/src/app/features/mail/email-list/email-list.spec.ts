import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ConfirmationService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { EmailList } from './email-list';
import { MailManager } from '../services/mail-manager';
import { VaultSandboxApi } from '../services/vault-sandbox-api';
import { VsToast } from '../../../shared/services/vs-toast';
import { MailManagerStub } from '../../../../testing/mail-testing.mocks';
import { EmailItemModel } from '../interfaces';
import { TOAST_DURATION_MS } from '../../../shared/constants/app.constants';

describe('EmailList', () => {
  let component: EmailList;
  let fixture: ComponentFixture<EmailList>;
  let confirmationService: ConfirmationService;
  let mailManager: MailManagerStub;
  let apiSpy: jasmine.SpyObj<VaultSandboxApi>;
  let toastSpy: jasmine.SpyObj<VsToast>;

  const createMockEmail = (overrides: Partial<EmailItemModel> = {}): EmailItemModel => ({
    id: 'test-email-id',
    encryptedMetadata: null,
    isRead: false,
    decryptedMetadata: {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Test Subject',
      receivedAt: new Date().toISOString(),
    },
    ...overrides,
  });

  beforeEach(async () => {
    apiSpy = jasmine.createSpyObj('VaultSandboxApi', ['deleteEmail']);
    apiSpy.deleteEmail.and.returnValue(of(void 0));

    toastSpy = jasmine.createSpyObj('VsToast', ['showSuccess', 'showError']);

    await TestBed.configureTestingModule({
      imports: [EmailList],
      providers: [
        provideZonelessChangeDetection(),
        ConfirmationService,
        { provide: MailManager, useClass: MailManagerStub },
        { provide: VaultSandboxApi, useValue: apiSpy },
        { provide: VsToast, useValue: toastSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailList);
    component = fixture.componentInstance;
    confirmationService = TestBed.inject(ConfirmationService);
    mailManager = TestBed.inject(MailManager) as unknown as MailManagerStub;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have empty emails array by default', () => {
    expect(component.emails).toEqual([]);
  });

  it('should have empty inboxHash by default', () => {
    expect(component.inboxHash).toBe('');
  });

  it('should have empty emailAddress by default', () => {
    expect(component.emailAddress).toBe('');
  });

  describe('onEmailClick', () => {
    it('emits the email id when clicked', () => {
      const emitSpy = spyOn(component.emailSelected, 'emit');

      component.onEmailClick('test-email-123');

      expect(emitSpy).toHaveBeenCalledWith('test-email-123');
    });
  });

  describe('deleteEmail', () => {
    let confirmSpy: jasmine.Spy;

    beforeEach(() => {
      confirmSpy = spyOn(confirmationService, 'confirm');
      component.emailAddress = 'test@example.com';
      component.inboxHash = 'test-inbox-hash';
    });

    it('calls confirmationService.confirm with correct options', () => {
      const email = createMockEmail();

      component.deleteEmail(email);

      expect(confirmSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          header: 'Delete Email',
          message: 'Are you sure you want to delete this email from sender@example.com?',
          icon: 'pi pi-exclamation-triangle',
          acceptLabel: 'Delete',
          rejectLabel: 'Cancel',
        }),
      );
    });

    it('uses Unknown Sender when decryptedMetadata.from is missing', () => {
      const email = createMockEmail({ decryptedMetadata: undefined });

      component.deleteEmail(email);

      expect(confirmSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          message: 'Are you sure you want to delete this email from Unknown Sender?',
        }),
      );
    });

    it('deletes email successfully on accept', async () => {
      const email = createMockEmail();
      const deleteEmailSpy = spyOn(mailManager, 'deleteEmail');

      confirmSpy.and.callFake((options: { accept: () => Promise<void> }) => {
        options.accept();
      });

      component.deleteEmail(email);

      await fixture.whenStable();

      expect(apiSpy.deleteEmail).toHaveBeenCalledWith('test@example.com', 'test-email-id');
      expect(deleteEmailSpy).toHaveBeenCalledWith('test-inbox-hash', 'test-email-id');
      expect(toastSpy.showSuccess).toHaveBeenCalledWith('Deleted', 'Email deleted successfully', TOAST_DURATION_MS);
    });

    it('shows error toast when API call fails', async () => {
      const email = createMockEmail();
      const consoleSpy = spyOn(console, 'error');
      apiSpy.deleteEmail.and.returnValue(throwError(() => new Error('API Error')));

      confirmSpy.and.callFake((options: { accept: () => Promise<void> }) => {
        options.accept();
      });

      component.deleteEmail(email);

      await fixture.whenStable();

      expect(consoleSpy).toHaveBeenCalled();
      expect(toastSpy.showError).toHaveBeenCalledWith('Error', 'Failed to delete email', TOAST_DURATION_MS);
    });
  });

  describe('onDeleteClick', () => {
    it('prevents default and stops propagation', () => {
      const event = jasmine.createSpyObj('Event', ['preventDefault', 'stopPropagation']);
      const email = createMockEmail();
      spyOn(component, 'deleteEmail');

      component.onDeleteClick(event, email);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('calls deleteEmail with the email', () => {
      const event = jasmine.createSpyObj('Event', ['preventDefault', 'stopPropagation']);
      const email = createMockEmail();
      const deleteEmailSpy = spyOn(component, 'deleteEmail');

      component.onDeleteClick(event, email);

      expect(deleteEmailSpy).toHaveBeenCalledWith(email);
    });
  });
});
