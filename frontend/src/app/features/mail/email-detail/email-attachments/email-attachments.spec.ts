import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { EmailAttachmentsComponent } from './email-attachments';
import { VsToast } from '../../../../shared/services/vs-toast';
import { VsToastStub } from '../../../../../testing/mail-testing.mocks';
import { AttachmentData } from '../../interfaces';

describe('EmailAttachmentsComponent', () => {
  let component: EmailAttachmentsComponent;
  let fixture: ComponentFixture<EmailAttachmentsComponent>;
  let toastSpy: jasmine.SpyObj<VsToastStub>;

  const createMockAttachment = (overrides: Partial<AttachmentData> = {}): AttachmentData => ({
    filename: 'test-file.txt',
    contentType: 'text/plain',
    size: 1024,
    content: btoa('Hello World'),
    ...overrides,
  });

  beforeEach(async () => {
    toastSpy = jasmine.createSpyObj('VsToast', ['showSuccess', 'showError']);

    await TestBed.configureTestingModule({
      imports: [EmailAttachmentsComponent],
      providers: [provideZonelessChangeDetection(), { provide: VsToast, useValue: toastSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailAttachmentsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have empty attachments by default', () => {
    expect(component.attachments).toEqual([]);
  });

  describe('downloadAttachment', () => {
    let createObjectURLSpy: jasmine.Spy;
    let revokeObjectURLSpy: jasmine.Spy;
    let appendChildSpy: jasmine.Spy;
    let removeChildSpy: jasmine.Spy;
    let clickSpy: jasmine.Spy;
    let mockLink: HTMLAnchorElement;

    beforeEach(() => {
      createObjectURLSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:mock-url');
      revokeObjectURLSpy = spyOn(URL, 'revokeObjectURL');
      appendChildSpy = spyOn(document.body, 'appendChild');
      removeChildSpy = spyOn(document.body, 'removeChild');

      mockLink = document.createElement('a');
      clickSpy = spyOn(mockLink, 'click');
      spyOn(document, 'createElement').and.returnValue(mockLink);
    });

    it('downloads attachment successfully', () => {
      const attachment = createMockAttachment();

      component.downloadAttachment(attachment);

      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(mockLink.href).toBe('blob:mock-url');
      expect(mockLink.download).toBe('test-file.txt');
      expect(appendChildSpy).toHaveBeenCalledWith(mockLink);
      expect(clickSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalledWith(mockLink);
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
      expect(toastSpy.showSuccess).toHaveBeenCalledWith('Download', 'Downloaded test-file.txt');
    });

    it('creates blob with correct content type', () => {
      const attachment = createMockAttachment({ contentType: 'application/pdf' });

      component.downloadAttachment(attachment);

      const blobArg = createObjectURLSpy.calls.mostRecent().args[0] as Blob;
      expect(blobArg.type).toBe('application/pdf');
    });

    it('handles error when atob fails with invalid base64', () => {
      const consoleSpy = spyOn(console, 'error');
      const attachment = createMockAttachment({ content: 'invalid-base64!@#$' });

      component.downloadAttachment(attachment);

      expect(consoleSpy).toHaveBeenCalled();
      expect(toastSpy.showError).toHaveBeenCalledWith('Download', 'Failed to download attachment');
    });
  });

  describe('formatFileSize', () => {
    it('returns bytes for sizes less than 1024', () => {
      expect(component.formatFileSize(0)).toBe('0 B');
      expect(component.formatFileSize(512)).toBe('512 B');
      expect(component.formatFileSize(1023)).toBe('1023 B');
    });

    it('returns KB for sizes between 1KB and 1MB', () => {
      expect(component.formatFileSize(1024)).toBe('1.00 KB');
      expect(component.formatFileSize(1536)).toBe('1.50 KB');
      expect(component.formatFileSize(1024 * 1024 - 1)).toBe('1024.00 KB');
    });

    it('returns MB for sizes 1MB and above', () => {
      expect(component.formatFileSize(1024 * 1024)).toBe('1.00 MB');
      expect(component.formatFileSize(1024 * 1024 * 2.5)).toBe('2.50 MB');
      expect(component.formatFileSize(1024 * 1024 * 100)).toBe('100.00 MB');
    });
  });

  describe('getFileIcon', () => {
    it('returns image icon for image content types', () => {
      expect(component.getFileIcon('image/png')).toBe('pi pi-image text-blue-500');
      expect(component.getFileIcon('image/jpeg')).toBe('pi pi-image text-blue-500');
      expect(component.getFileIcon('image/gif')).toBe('pi pi-image text-blue-500');
    });

    it('returns video icon for video content types', () => {
      expect(component.getFileIcon('video/mp4')).toBe('pi pi-video text-purple-500');
      expect(component.getFileIcon('video/webm')).toBe('pi pi-video text-purple-500');
    });

    it('returns PDF icon for PDF content types', () => {
      expect(component.getFileIcon('application/pdf')).toBe('pi pi-file-pdf text-red-500');
    });

    it('returns Word icon for Word document content types', () => {
      expect(component.getFileIcon('application/msword')).toBe('pi pi-file-word text-blue-600');
      expect(component.getFileIcon('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(
        'pi pi-file-word text-blue-600',
      );
    });

    it('returns Excel icon for Excel spreadsheet content types', () => {
      expect(component.getFileIcon('application/vnd.ms-excel')).toBe('pi pi-file-excel text-green-600');
      expect(component.getFileIcon('application/x-spreadsheet')).toBe('pi pi-file-excel text-green-600');
    });

    it('returns archive icon for compressed content types', () => {
      expect(component.getFileIcon('application/zip')).toBe('pi pi-file text-yellow-600');
      expect(component.getFileIcon('application/x-compressed')).toBe('pi pi-file text-yellow-600');
    });

    it('returns default icon for unknown content types', () => {
      expect(component.getFileIcon('application/octet-stream')).toBe('pi pi-file text-surface-500');
      expect(component.getFileIcon('text/plain')).toBe('pi pi-file text-surface-500');
    });
  });
});
