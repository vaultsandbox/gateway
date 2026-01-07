import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { InboxImportExportService } from '../inbox-import-export.service';
import { InboxStorageService } from '../inbox-storage.service';
import { InboxStateService } from '../inbox-state.service';
import { InboxStateServiceStub } from '../../../../../testing/mail-testing.mocks';
import { ExportedInboxData, InboxModel } from '../../interfaces';

describe('InboxImportExportService', () => {
  let service: InboxImportExportService;
  let inboxStorageServiceSpy: jasmine.SpyObj<InboxStorageService>;
  let inboxStateServiceStub: InboxStateServiceStub;

  const createInbox = (overrides: Partial<InboxModel> = {}): InboxModel => ({
    emailAddress: 'test@example.com',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    inboxHash: 'test-inbox-hash',
    serverSigPk: 'test-server-sig-pk',
    secretKey: new Uint8Array([1, 2, 3, 4]),
    emails: [],
    ...overrides,
  });

  const createExportedInboxData = (overrides: Partial<ExportedInboxData> = {}): ExportedInboxData => ({
    version: 1,
    emailAddress: 'test@example.com',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    inboxHash: 'test-inbox-hash',
    serverSigPk: 'test-server-sig-pk',
    secretKey: 'dGVzdC1zZWNyZXQta2V5',
    exportedAt: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(() => {
    inboxStorageServiceSpy = jasmine.createSpyObj<InboxStorageService>('InboxStorageService', [
      'exportInbox',
      'validateImportData',
      'createInboxModelFromImport',
    ]);
    inboxStateServiceStub = new InboxStateServiceStub();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        InboxImportExportService,
        { provide: InboxStorageService, useValue: inboxStorageServiceSpy },
        { provide: InboxStateService, useValue: inboxStateServiceStub },
      ],
    });

    service = TestBed.inject(InboxImportExportService);
  });

  describe('exportInboxMetadata()', () => {
    it('should export inbox metadata when inbox exists', () => {
      const inbox = createInbox();
      const exportedData = createExportedInboxData();
      inboxStateServiceStub.setInboxes([inbox]);
      inboxStorageServiceSpy.exportInbox.and.returnValue(exportedData);

      const result = service.exportInboxMetadata(inbox.inboxHash);

      expect(result).toEqual(exportedData);
      expect(inboxStorageServiceSpy.exportInbox).toHaveBeenCalledWith(inbox);
    });

    it('should return null when inbox not found', () => {
      spyOn(console, 'error');

      const result = service.exportInboxMetadata('nonexistent-hash');

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        '[InboxImportExportService] Cannot export inbox: inbox not found',
        'nonexistent-hash',
      );
      expect(inboxStorageServiceSpy.exportInbox).not.toHaveBeenCalled();
    });
  });

  describe('importInbox()', () => {
    it('should reject invalid data structure', () => {
      const invalidData = { invalid: 'data' } as unknown as ExportedInboxData;
      inboxStorageServiceSpy.validateImportData.and.returnValue(false);

      const result = service.importInbox(invalidData);

      expect(result).toEqual({ success: false, message: 'Invalid inbox data structure' });
      expect(inboxStorageServiceSpy.createInboxModelFromImport).not.toHaveBeenCalled();
    });

    it('should reject duplicate inbox', () => {
      const existingInbox = createInbox();
      const importData = createExportedInboxData({ inboxHash: existingInbox.inboxHash });
      inboxStateServiceStub.setInboxes([existingInbox]);
      inboxStorageServiceSpy.validateImportData.and.returnValue(true);

      const result = service.importInbox(importData);

      expect(result).toEqual({
        success: false,
        message: `Inbox already exists: ${importData.emailAddress}`,
        emailAddress: importData.emailAddress,
      });
      expect(inboxStorageServiceSpy.createInboxModelFromImport).not.toHaveBeenCalled();
    });

    it('should successfully import valid inbox', () => {
      const importData = createExportedInboxData();
      const createdInbox = createInbox();
      inboxStorageServiceSpy.validateImportData.and.returnValue(true);
      inboxStorageServiceSpy.createInboxModelFromImport.and.returnValue(createdInbox);
      spyOn(inboxStateServiceStub, 'addInbox');

      const result = service.importInbox(importData);

      expect(result).toEqual({
        success: true,
        message: `Inbox imported: ${importData.emailAddress}`,
        emailAddress: importData.emailAddress,
      });
      expect(inboxStorageServiceSpy.createInboxModelFromImport).toHaveBeenCalledWith(importData);
      expect(inboxStateServiceStub.addInbox).toHaveBeenCalledWith(createdInbox, { persist: true });
    });

    it('should handle import errors gracefully', () => {
      const importData = createExportedInboxData();
      inboxStorageServiceSpy.validateImportData.and.returnValue(true);
      inboxStorageServiceSpy.createInboxModelFromImport.and.throwError(new Error('Decoding failed'));
      spyOn(console, 'error');

      const result = service.importInbox(importData);

      expect(result).toEqual({
        success: false,
        message: 'Import failed: Decoding failed',
      });
      expect(console.error).toHaveBeenCalled();
    });

    it('should handle non-Error exceptions', () => {
      const importData = createExportedInboxData();
      inboxStorageServiceSpy.validateImportData.and.returnValue(true);
      // Simulate a non-Error throw by using callFake
      inboxStorageServiceSpy.createInboxModelFromImport.and.callFake(() => {
        throw 'string error';
      });
      spyOn(console, 'error');

      const result = service.importInbox(importData);

      expect(result).toEqual({
        success: false,
        message: 'Import failed: Unknown error',
      });
    });
  });

  describe('importMultipleInboxes()', () => {
    const createMockFile = (content: string, filename: string): File => {
      return new File([content], filename, { type: 'application/json' });
    };

    it('should successfully import multiple valid files', async () => {
      const importData1 = createExportedInboxData({ emailAddress: 'user1@example.com', inboxHash: 'hash-1' });
      const importData2 = createExportedInboxData({ emailAddress: 'user2@example.com', inboxHash: 'hash-2' });

      const file1 = createMockFile(JSON.stringify(importData1), 'inbox-1.json');
      const file2 = createMockFile(JSON.stringify(importData2), 'inbox-2.json');

      inboxStorageServiceSpy.validateImportData.and.returnValue(true);
      inboxStorageServiceSpy.createInboxModelFromImport.and.callFake((data: ExportedInboxData) =>
        createInbox({ emailAddress: data.emailAddress, inboxHash: data.inboxHash }),
      );
      spyOn(inboxStateServiceStub, 'addInbox');

      const results = await service.importMultipleInboxes([file1, file2]);

      expect(results.length).toBe(2);
      expect(results[0]).toEqual({
        filename: 'inbox-1.json',
        success: true,
        message: 'Inbox imported: user1@example.com',
        emailAddress: 'user1@example.com',
      });
      expect(results[1]).toEqual({
        filename: 'inbox-2.json',
        success: true,
        message: 'Inbox imported: user2@example.com',
        emailAddress: 'user2@example.com',
      });
    });

    it('should handle file read errors', async () => {
      const badFile = {
        name: 'bad-file.json',
        text: () => Promise.reject(new Error('File read error')),
      } as unknown as File;

      const results = await service.importMultipleInboxes([badFile]);

      expect(results.length).toBe(1);
      expect(results[0]).toEqual({
        filename: 'bad-file.json',
        success: false,
        message: 'Failed to read file: File read error',
      });
    });

    it('should handle invalid JSON', async () => {
      const file = createMockFile('not valid json', 'invalid.json');

      const results = await service.importMultipleInboxes([file]);

      expect(results.length).toBe(1);
      expect(results[0].filename).toBe('invalid.json');
      expect(results[0].success).toBeFalse();
      expect(results[0].message).toContain('Failed to read file:');
    });

    it('should handle mixed success and failure', async () => {
      const validData = createExportedInboxData({ emailAddress: 'valid@example.com', inboxHash: 'valid-hash' });
      const invalidData = { invalid: true };

      const validFile = createMockFile(JSON.stringify(validData), 'valid.json');
      const invalidFile = createMockFile(JSON.stringify(invalidData), 'invalid.json');

      inboxStorageServiceSpy.validateImportData.and.callFake((data): data is ExportedInboxData => {
        return data !== null && typeof data === 'object' && 'version' in data;
      });
      inboxStorageServiceSpy.createInboxModelFromImport.and.callFake((data: ExportedInboxData) =>
        createInbox({ emailAddress: data.emailAddress, inboxHash: data.inboxHash }),
      );
      spyOn(inboxStateServiceStub, 'addInbox');

      const results = await service.importMultipleInboxes([validFile, invalidFile]);

      expect(results.length).toBe(2);
      expect(results[0].success).toBeTrue();
      expect(results[1].success).toBeFalse();
      expect(results[1].message).toBe('Invalid inbox data structure');
    });

    it('should return empty array for empty input', async () => {
      const results = await service.importMultipleInboxes([]);

      expect(results).toEqual([]);
    });
  });

  describe('downloadInbox()', () => {
    let createElementSpy: jasmine.Spy;
    let createObjectURLSpy: jasmine.Spy;
    let revokeObjectURLSpy: jasmine.Spy;
    let mockLink: {
      href: string;
      download: string;
      click: jasmine.Spy;
    };

    beforeEach(() => {
      mockLink = {
        href: '',
        download: '',
        click: jasmine.createSpy('click'),
      };

      createElementSpy = spyOn(document, 'createElement').and.returnValue(mockLink as unknown as HTMLAnchorElement);
      spyOn(document.body, 'appendChild');
      spyOn(document.body, 'removeChild');
      createObjectURLSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:test-url');
      revokeObjectURLSpy = spyOn(URL, 'revokeObjectURL');
    });

    it('should return false when inbox not found', () => {
      spyOn(console, 'error');

      const result = service.downloadInbox('nonexistent-hash');

      expect(result).toBeFalse();
      expect(createElementSpy).not.toHaveBeenCalled();
    });

    it('should create download link with correct filename', () => {
      const inbox = createInbox({ emailAddress: 'user@example.com' });
      const exportedData = createExportedInboxData({ emailAddress: 'user@example.com' });
      inboxStateServiceStub.setInboxes([inbox]);
      inboxStorageServiceSpy.exportInbox.and.returnValue(exportedData);

      const result = service.downloadInbox(inbox.inboxHash);

      expect(result).toBeTrue();
      expect(createElementSpy).toHaveBeenCalledWith('a');
      expect(mockLink.download).toBe('inbox-user_at_example.com.json');
      expect(mockLink.href).toBe('blob:test-url');
    });

    it('should trigger download and cleanup', () => {
      const inbox = createInbox();
      const exportedData = createExportedInboxData();
      inboxStateServiceStub.setInboxes([inbox]);
      inboxStorageServiceSpy.exportInbox.and.returnValue(exportedData);

      service.downloadInbox(inbox.inboxHash);

      expect(document.body.appendChild).toHaveBeenCalled();
      expect(mockLink.click).toHaveBeenCalled();
      expect(document.body.removeChild).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test-url');
    });

    it('should create blob with correct content type', () => {
      const inbox = createInbox();
      const exportedData = createExportedInboxData();
      inboxStateServiceStub.setInboxes([inbox]);
      inboxStorageServiceSpy.exportInbox.and.returnValue(exportedData);

      service.downloadInbox(inbox.inboxHash);

      expect(createObjectURLSpy).toHaveBeenCalled();
      const blobArg = createObjectURLSpy.calls.mostRecent().args[0] as Blob;
      expect(blobArg.type).toBe('application/json');
    });

    it('should handle email addresses with special characters', () => {
      const inbox = createInbox({ emailAddress: 'user+tag@sub.example.com' });
      const exportedData = createExportedInboxData({ emailAddress: 'user+tag@sub.example.com' });
      inboxStateServiceStub.setInboxes([inbox]);
      inboxStorageServiceSpy.exportInbox.and.returnValue(exportedData);

      const result = service.downloadInbox(inbox.inboxHash);

      expect(result).toBeTrue();
      expect(mockLink.download).toMatch(/^inbox-.*\.json$/);
    });
  });
});
