import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, SimpleChange } from '@angular/core';
import { ConfirmationService } from 'primeng/api';
import { throwError } from 'rxjs';
import { EmailDetail, EmailDetailTab } from './email-detail';
import { MailManager } from '../services/mail-manager';
import { SettingsManager } from '../services/settings-manager';
import { VaultSandboxApi } from '../services/vault-sandbox-api';
import { VsToast } from '../../../shared/services/vs-toast';
import { EmailItemModel, InboxModel, ParsedEmailContent } from '../interfaces';
import {
  MailManagerStub,
  SettingsManagerStub,
  VaultSandboxApiStub,
  VsToastStub,
  ServerInfoServiceStub,
} from '../../../../testing/mail-testing.mocks';
import { EmailDownloads } from './helpers/email-downloads';
import { ServerInfoService } from '../services/server-info.service';

describe('EmailDetail', () => {
  let component: EmailDetail;
  let fixture: ComponentFixture<EmailDetail>;
  let mailManagerStub: MailManagerStub;
  let toastStub: VsToastStub;
  let apiStub: VaultSandboxApiStub;
  let confirmationService: ConfirmationService;
  let serverInfoStub: ServerInfoServiceStub;

  const createMockParsedContent = (overrides: Partial<ParsedEmailContent> = {}): ParsedEmailContent => ({
    html: '<p>Test HTML</p>',
    text: 'Test text',
    textAsHtml: '<p>Test text</p>',
    subject: 'Test Subject',
    from: 'sender@example.com',
    to: 'receiver@example.com',
    headers: { From: 'sender@example.com', To: 'receiver@example.com' },
    attachments: [],
    links: [],
    ...overrides,
  });

  const createMockEmail = (overrides: Partial<EmailItemModel> = {}): EmailItemModel => ({
    id: 'email-123',
    encryptedMetadata: null,
    isRead: false,
    isLoadingBody: false,
    decryptedMetadata: {
      from: 'sender@example.com',
      to: 'receiver@example.com',
      subject: 'Test Subject',
      receivedAt: '2024-01-01T12:00:00Z',
    },
    parsedContent: createMockParsedContent(),
    ...overrides,
  });

  const createMockInbox = (): InboxModel => ({
    emailAddress: 'test@example.com',
    expiresAt: new Date().toISOString(),
    inboxHash: 'inbox-hash-123',
    encrypted: true,
    emailAuth: false,
    serverSigPk: 'stub-sig',
    secretKey: new Uint8Array(),
    emails: [],
  });

  beforeEach(async () => {
    mailManagerStub = new MailManagerStub();
    toastStub = new VsToastStub();
    apiStub = new VaultSandboxApiStub();
    serverInfoStub = new ServerInfoServiceStub();

    await TestBed.configureTestingModule({
      imports: [EmailDetail],
      providers: [
        provideZonelessChangeDetection(),
        ConfirmationService,
        { provide: MailManager, useValue: mailManagerStub },
        { provide: SettingsManager, useClass: SettingsManagerStub },
        { provide: VaultSandboxApi, useValue: apiStub },
        { provide: VsToast, useValue: toastStub },
        { provide: ServerInfoService, useValue: serverInfoStub },
      ],
    }).compileComponents();

    confirmationService = TestBed.inject(ConfirmationService);
    fixture = TestBed.createComponent(EmailDetail);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('onIframeLoad', () => {
    it('should set iframe height based on content', () => {
      const mockIframe = {
        contentWindow: {
          document: {
            body: {
              scrollHeight: 500,
            },
          },
        },
        style: { height: '' },
      } as unknown as HTMLIFrameElement;

      const event = { target: mockIframe } as unknown as Event;
      component.onIframeLoad(event);

      expect(mockIframe.style.height).toBe('520px');
    });

    it('should return early if iframe has no contentWindow', () => {
      const mockIframe = {
        contentWindow: null,
        style: { height: '' },
      } as unknown as HTMLIFrameElement;

      const event = { target: mockIframe } as unknown as Event;
      component.onIframeLoad(event);

      expect(mockIframe.style.height).toBe('');
    });

    it('should return early if iframe has no document', () => {
      const mockIframe = {
        contentWindow: { document: null },
        style: { height: '' },
      } as unknown as HTMLIFrameElement;

      const event = { target: mockIframe } as unknown as Event;
      component.onIframeLoad(event);

      expect(mockIframe.style.height).toBe('');
    });

    it('should return early if iframe has no body', () => {
      const mockIframe = {
        contentWindow: { document: { body: null } },
        style: { height: '' },
      } as unknown as HTMLIFrameElement;

      const event = { target: mockIframe } as unknown as Event;
      component.onIframeLoad(event);

      expect(mockIframe.style.height).toBe('');
    });
  });

  describe('onBackClick', () => {
    it('should emit backToList event', () => {
      const emitSpy = spyOn(component.backToList, 'emit');
      component.onBackClick();
      expect(emitSpy).toHaveBeenCalled();
    });
  });

  describe('confirmDelete', () => {
    it('should return early if already deleting', () => {
      component.isDeletingEmail = true;
      component.email = createMockEmail();
      const confirmSpy = spyOn(confirmationService, 'confirm');

      component.confirmDelete(new MouseEvent('click'));

      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('should return early if no email', () => {
      component.email = null;
      const confirmSpy = spyOn(confirmationService, 'confirm');

      component.confirmDelete(new MouseEvent('click'));

      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('should open confirmation dialog with sender from metadata', () => {
      component.email = createMockEmail();
      const confirmSpy = spyOn(confirmationService, 'confirm');

      component.confirmDelete(new MouseEvent('click'));

      expect(confirmSpy).toHaveBeenCalled();
      const callArgs = confirmSpy.calls.mostRecent().args[0];
      expect(callArgs.message).toContain('sender@example.com');
    });

    it('should use Unknown Sender when from is not available', () => {
      component.email = createMockEmail({ decryptedMetadata: undefined });
      const confirmSpy = spyOn(confirmationService, 'confirm');

      component.confirmDelete(new MouseEvent('click'));

      const callArgs = confirmSpy.calls.mostRecent().args[0];
      expect(callArgs.message).toContain('Unknown Sender');
    });

    it('should call deleteEmail when confirmed', async () => {
      const inbox = createMockInbox();
      mailManagerStub.setInboxes([inbox]);
      component.email = createMockEmail();
      const deleteEmailSpy = spyOn(component, 'deleteEmail').and.returnValue(Promise.resolve());

      spyOn(confirmationService, 'confirm').and.callFake((options) => {
        if (options.accept) {
          options.accept();
        }
        return confirmationService;
      });

      component.confirmDelete(new MouseEvent('click'));
      await fixture.whenStable();

      expect(deleteEmailSpy).toHaveBeenCalled();
    });
  });

  describe('downloadRawEmail', () => {
    it('should return early if no email', async () => {
      component.email = null;
      const fetchSpy = spyOn(mailManagerStub, 'fetchAndDecryptRawEmail');

      await component.downloadRawEmail();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should show error if no inbox selected', async () => {
      component.email = createMockEmail();
      const showErrorSpy = spyOn(toastStub, 'showError');

      await component.downloadRawEmail();

      expect(showErrorSpy).toHaveBeenCalledWith('Inbox not found', jasmine.any(String));
    });

    it('should show error if raw email data not available', async () => {
      const inbox = createMockInbox();
      mailManagerStub.setInboxes([inbox]);
      component.email = createMockEmail();
      spyOn(mailManagerStub, 'fetchAndDecryptRawEmail').and.returnValue(Promise.resolve(''));
      const showErrorSpy = spyOn(toastStub, 'showError');

      await component.downloadRawEmail();

      expect(showErrorSpy).toHaveBeenCalledWith('Raw email data not available', jasmine.any(String));
    });

    it('should download raw email successfully', async () => {
      const inbox = createMockInbox();
      mailManagerStub.setInboxes([inbox]);
      component.email = createMockEmail();
      spyOn(mailManagerStub, 'fetchAndDecryptRawEmail').and.returnValue(Promise.resolve('dGVzdA==')); // valid base64
      spyOn(EmailDownloads, 'decodeRawEmail').and.returnValue(new Blob(['test'], { type: 'message/rfc822' }));
      const triggerDownloadSpy = spyOn(EmailDownloads, 'triggerEmlDownload');
      const showSuccessSpy = spyOn(toastStub, 'showSuccess');

      await component.downloadRawEmail();

      expect(triggerDownloadSpy).toHaveBeenCalled();
      expect(showSuccessSpy).toHaveBeenCalled();
    });

    it('should handle download errors', async () => {
      const inbox = createMockInbox();
      mailManagerStub.setInboxes([inbox]);
      component.email = createMockEmail();
      spyOn(mailManagerStub, 'fetchAndDecryptRawEmail').and.rejectWith(new Error('Network error'));
      const showErrorSpy = spyOn(toastStub, 'showError');
      const consoleSpy = spyOn(console, 'error');

      await component.downloadRawEmail();

      expect(consoleSpy).toHaveBeenCalled();
      expect(showErrorSpy).toHaveBeenCalledWith('Failed to download email', 'Please try again');
    });

    it('should set and reset isDownloadingRaw flag', async () => {
      const inbox = createMockInbox();
      mailManagerStub.setInboxes([inbox]);
      component.email = createMockEmail();
      spyOn(mailManagerStub, 'fetchAndDecryptRawEmail').and.returnValue(Promise.resolve('dGVzdA==')); // valid base64
      spyOn(EmailDownloads, 'decodeRawEmail').and.returnValue(new Blob(['test'], { type: 'message/rfc822' }));
      spyOn(EmailDownloads, 'triggerEmlDownload');

      expect(component.isDownloadingRaw).toBeFalse();
      const promise = component.downloadRawEmail();
      expect(component.isDownloadingRaw).toBeTrue();
      await promise;
      expect(component.isDownloadingRaw).toBeFalse();
    });
  });

  describe('deleteEmail', () => {
    it('should return early if no email', async () => {
      component.email = null;
      const deleteSpy = spyOn(apiStub, 'deleteEmail');

      await component.deleteEmail();

      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('should show error if no inbox selected', async () => {
      component.email = createMockEmail();
      const showErrorSpy = spyOn(toastStub, 'showError');

      await component.deleteEmail();

      expect(showErrorSpy).toHaveBeenCalledWith('Inbox not found', jasmine.any(String));
    });

    it('should delete email successfully', async () => {
      const inbox = createMockInbox();
      mailManagerStub.setInboxes([inbox]);
      component.email = createMockEmail();
      const deleteMailManagerSpy = spyOn(mailManagerStub, 'deleteEmail');
      const showSuccessSpy = spyOn(toastStub, 'showSuccess');
      const backClickSpy = spyOn(component, 'onBackClick');

      await component.deleteEmail();

      expect(deleteMailManagerSpy).toHaveBeenCalled();
      expect(showSuccessSpy).toHaveBeenCalledWith('Deleted', 'Email deleted successfully', 3000);
      expect(backClickSpy).toHaveBeenCalled();
    });

    it('should handle delete errors', async () => {
      const inbox = createMockInbox();
      mailManagerStub.setInboxes([inbox]);
      component.email = createMockEmail();
      spyOn(apiStub, 'deleteEmail').and.returnValue(throwError(() => new Error('Delete failed')));
      const showErrorSpy = spyOn(toastStub, 'showError');
      const consoleSpy = spyOn(console, 'error');

      await component.deleteEmail();

      expect(consoleSpy).toHaveBeenCalled();
      expect(showErrorSpy).toHaveBeenCalledWith('Failed to delete email', 'Please try again');
    });

    it('should set and reset isDeletingEmail flag', async () => {
      const inbox = createMockInbox();
      mailManagerStub.setInboxes([inbox]);
      component.email = createMockEmail();

      expect(component.isDeletingEmail).toBeFalse();
      const promise = component.deleteEmail();
      expect(component.isDeletingEmail).toBeTrue();
      await promise;
      expect(component.isDeletingEmail).toBeFalse();
    });
  });

  describe('hasHtml', () => {
    it('should return true when email has HTML content', () => {
      component.email = createMockEmail();
      expect(component.hasHtml()).toBeTrue();
    });

    it('should return false when email has no HTML content', () => {
      component.email = createMockEmail({
        parsedContent: createMockParsedContent({ html: null }),
      });
      expect(component.hasHtml()).toBeFalse();
    });

    it('should return false when no email', () => {
      component.email = null;
      expect(component.hasHtml()).toBeFalse();
    });
  });

  describe('hasText', () => {
    it('should return true when email has text content', () => {
      component.email = createMockEmail();
      expect(component.hasText()).toBeTrue();
    });

    it('should return false when email has no text content', () => {
      component.email = createMockEmail({
        parsedContent: createMockParsedContent({ text: null }),
      });
      expect(component.hasText()).toBeFalse();
    });

    it('should return false when no email', () => {
      component.email = null;
      expect(component.hasText()).toBeFalse();
    });
  });

  describe('hasAttachments', () => {
    it('should return true when email has attachments', () => {
      component.email = createMockEmail({
        parsedContent: createMockParsedContent({
          attachments: [{ filename: 'test.pdf', contentType: 'application/pdf', size: 1000, content: '' }],
        }),
      });
      expect(component.hasAttachments()).toBeTrue();
    });

    it('should return false when email has no attachments', () => {
      component.email = createMockEmail();
      expect(component.hasAttachments()).toBeFalse();
    });
  });

  describe('hasLinks', () => {
    it('should return true when email has links', () => {
      component.email = createMockEmail({
        parsedContent: createMockParsedContent({
          links: ['https://example.com'],
        }),
      });
      expect(component.hasLinks()).toBeTrue();
    });

    it('should return false when email has no links', () => {
      component.email = createMockEmail();
      expect(component.hasLinks()).toBeFalse();
    });
  });

  describe('getHeadersList', () => {
    it('should return formatted headers list', () => {
      component.email = createMockEmail();
      const headers = component.getHeadersList();
      expect(headers.length).toBeGreaterThan(0);
    });

    it('should return empty list when no email', () => {
      component.email = null;
      const headers = component.getHeadersList();
      expect(headers).toEqual([]);
    });
  });

  describe('getSanitizedHtml', () => {
    it('should return empty string when no HTML content', () => {
      component.email = createMockEmail({
        parsedContent: createMockParsedContent({ html: null }),
      });
      const result = component.getSanitizedHtml();
      expect(result).toBe('');
    });

    it('should return cached result on subsequent calls', () => {
      component.email = createMockEmail();

      const firstResult = component.getSanitizedHtml();
      const secondResult = component.getSanitizedHtml();

      expect(firstResult).toBe(secondResult);
    });

    it('should invalidate cache when settings change', () => {
      component.email = createMockEmail();

      component.getSanitizedHtml();
      component.displayInlineImages = true;
      const newResult = component.getSanitizedHtml();

      expect(newResult).toBeTruthy();
    });

    it('should handle missing attachments array with fallback', () => {
      const parsedContent = createMockParsedContent();
      // Force attachments to undefined to test the || [] fallback
      (parsedContent as { attachments: unknown }).attachments = undefined;
      component.email = createMockEmail({ parsedContent });

      const result = component.getSanitizedHtml();

      expect(result).toBeTruthy();
    });
  });

  describe('ngOnChanges', () => {
    it('should handle email change with parsed content', async () => {
      const email = createMockEmail();
      component.email = email;

      component.ngOnChanges({
        email: new SimpleChange(null, email, true),
      });

      // Wait for setTimeout to complete
      await new Promise((resolve) => setTimeout(resolve, 10));
      fixture.detectChanges();

      expect(component.isRenderingContent).toBeFalse();
    });

    it('should handle email change without parsed content', () => {
      const email = createMockEmail({ parsedContent: undefined });
      component.email = email;

      component.ngOnChanges({
        email: new SimpleChange(null, email, true),
      });

      expect(component.isRenderingContent).toBeFalse();
    });

    it('should not process non-email changes', () => {
      const getSanitizedHtmlSpy = spyOn(component, 'getSanitizedHtml');

      component.ngOnChanges({
        otherProperty: new SimpleChange(null, 'value', true),
      });

      expect(getSanitizedHtmlSpy).not.toHaveBeenCalled();
    });

    it('should handle email with isLoadingBody true', () => {
      const email = createMockEmail({ isLoadingBody: true });
      component.email = email;

      component.ngOnChanges({
        email: new SimpleChange(null, email, true),
      });

      expect(component.isRenderingContent).toBeFalse();
    });
  });

  describe('ensureActiveTabIsValid', () => {
    it('should keep valid tab when available', () => {
      component.email = createMockEmail();
      component.activeTab = EmailDetailTab.Html;

      component.ngOnChanges({
        email: new SimpleChange(null, component.email, true),
      });

      expect(component.activeTab).toBe(EmailDetailTab.Html);
    });

    it('should reset to first available tab when current tab is invalid', () => {
      component.email = createMockEmail();
      component.activeTab = EmailDetailTab.Attachments;

      component.ngOnChanges({
        email: new SimpleChange(null, component.email, true),
      });

      expect(component.activeTab).toBe(EmailDetailTab.Html);
    });

    it('should include Attachments tab when email has attachments', () => {
      component.email = createMockEmail({
        parsedContent: createMockParsedContent({
          attachments: [{ filename: 'test.pdf', contentType: 'application/pdf', size: 1000, content: '' }],
        }),
      });
      component.activeTab = EmailDetailTab.Attachments;

      component.ngOnChanges({
        email: new SimpleChange(null, component.email, true),
      });

      expect(component.activeTab).toBe(EmailDetailTab.Attachments);
    });

    it('should include Links tab when email has links', () => {
      component.email = createMockEmail({
        parsedContent: createMockParsedContent({
          links: ['https://example.com'],
        }),
      });
      component.activeTab = EmailDetailTab.Links;

      component.ngOnChanges({
        email: new SimpleChange(null, component.email, true),
      });

      expect(component.activeTab).toBe(EmailDetailTab.Links);
    });
  });

  describe('ngOnInit', () => {
    it('should load settings and schedule sanitization', async () => {
      const getSanitizedHtmlSpy = spyOn(component, 'getSanitizedHtml').and.returnValue('');

      component.ngOnInit();

      // Wait for setTimeout to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(getSanitizedHtmlSpy).toHaveBeenCalled();
    });
  });

  describe('isSpamAnalysisEnabled', () => {
    it('should return true when server info has spamAnalysisEnabled', () => {
      serverInfoStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: true,
        webhookRequireAuthDefault: false,
        spamAnalysisEnabled: true,
      });

      expect(component.isSpamAnalysisEnabled()).toBeTrue();
    });

    it('should return false when server info has spamAnalysisEnabled false', () => {
      serverInfoStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: true,
        webhookRequireAuthDefault: false,
        spamAnalysisEnabled: false,
      });

      expect(component.isSpamAnalysisEnabled()).toBeFalse();
    });

    it('should return false when server info is null', () => {
      serverInfoStub.setServerInfo(null);

      expect(component.isSpamAnalysisEnabled()).toBeFalse();
    });
  });

  describe('hasSpamAnalysis', () => {
    it('should return true when email has spam analysis data', () => {
      component.email = createMockEmail({
        parsedContent: createMockParsedContent({
          spamAnalysis: {
            status: 'analyzed',
            isSpam: false,
            score: 0.1,
            requiredScore: 5.0,
          },
        }),
      });

      expect(component.hasSpamAnalysis()).toBeTrue();
    });

    it('should return false when email has no spam analysis', () => {
      component.email = createMockEmail();

      expect(component.hasSpamAnalysis()).toBeFalse();
    });

    it('should return false when no email', () => {
      component.email = null;

      expect(component.hasSpamAnalysis()).toBeFalse();
    });
  });

  describe('ensureActiveTabIsValid with spam analysis', () => {
    it('should include Spam tab when spam analysis is enabled', () => {
      serverInfoStub.setServerInfo({
        serverSigPk: 'stub',
        algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
        context: 'stub',
        maxTtl: 86400,
        defaultTtl: 3600,
        sseConsole: false,
        allowClearAllInboxes: true,
        allowedDomains: [],
        encryptionPolicy: 'always',
        webhookEnabled: true,
        webhookRequireAuthDefault: false,
        spamAnalysisEnabled: true,
      });

      component.email = createMockEmail();
      component.activeTab = EmailDetailTab.Spam;

      component.ngOnChanges({
        email: new SimpleChange(null, component.email, true),
      });

      expect(component.activeTab).toBe(EmailDetailTab.Spam);
    });
  });
});
