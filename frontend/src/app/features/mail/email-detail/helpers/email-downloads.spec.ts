import { EmailDownloads } from './email-downloads';
import { EmailItemModel } from '../../interfaces';

describe('EmailDownloads', () => {
  describe('sanitizeFilename', () => {
    it('sanitizes filenames and truncates control chars', () => {
      expect(EmailDownloads.sanitizeFilename('abc<>:"/\\|?*def')).toBe('abc_________def');
      expect(EmailDownloads.sanitizeFilename('a'.repeat(60)).length).toBeLessThanOrEqual(50);
    });

    it('replaces control characters with underscores', () => {
      const withControlChars = 'hello\x00world\x1Ftest';
      const result = EmailDownloads.sanitizeFilename(withControlChars);
      expect(result).toBe('hello_world_test');
    });
  });

  describe('buildRawEmailFilename', () => {
    it('builds filename from metadata with date', () => {
      const filename = EmailDownloads.buildRawEmailFilename({ subject: 'Hello', date: '2024-01-02T00:00:00Z' });
      expect(filename).toBe('Hello_2024-01-02.eml');
    });

    it('uses unknown when date is invalid', () => {
      const unknown = EmailDownloads.buildRawEmailFilename({ subject: 'Hi', date: 'invalid' });
      expect(unknown).toBe('Hi_unknown.eml');
    });

    it('uses fallback when subject is missing', () => {
      const filename = EmailDownloads.buildRawEmailFilename({ date: '2024-01-02T00:00:00Z' });
      expect(filename).toBe('email_2024-01-02.eml');
    });

    it('uses custom fallback when provided', () => {
      const filename = EmailDownloads.buildRawEmailFilename({}, 'message');
      expect(filename).toBe('message_unknown.eml');
    });

    it('uses receivedAt when date is missing', () => {
      const filename = EmailDownloads.buildRawEmailFilename({ subject: 'Test', receivedAt: '2024-03-15T00:00:00Z' });
      expect(filename).toBe('Test_2024-03-15.eml');
    });

    it('returns unknown date when both date and receivedAt are missing', () => {
      const filename = EmailDownloads.buildRawEmailFilename({ subject: 'Test' });
      expect(filename).toBe('Test_unknown.eml');
    });
  });

  describe('buildRawEmailFilenameFromEmail', () => {
    it('builds filename from EmailItemModel data', () => {
      const email = {
        parsedContent: { subject: 'Parsed Subject', date: '2024-05-10T00:00:00Z' },
        decryptedMetadata: { subject: 'Meta Subject', receivedAt: '2024-05-11T00:00:00Z' },
      } as EmailItemModel;

      expect(EmailDownloads.buildRawEmailFilenameFromEmail(email)).toBe('Parsed Subject_2024-05-10.eml');
    });

    it('falls back to decryptedMetadata subject when parsedContent subject missing', () => {
      const email = {
        parsedContent: { date: '2024-05-10T00:00:00Z' },
        decryptedMetadata: { subject: 'Meta Subject', receivedAt: '2024-05-11T00:00:00Z' },
      } as EmailItemModel;

      expect(EmailDownloads.buildRawEmailFilenameFromEmail(email)).toBe('Meta Subject_2024-05-10.eml');
    });

    it('handles missing receivedAt in decryptedMetadata', () => {
      const email = {
        parsedContent: { subject: 'Test', date: '2024-05-10T00:00:00Z' },
        decryptedMetadata: {},
      } as EmailItemModel;

      expect(EmailDownloads.buildRawEmailFilenameFromEmail(email)).toBe('Test_2024-05-10.eml');
    });
  });

  describe('decodeRawEmail', () => {
    it('decodes base64 raw email into a Blob', () => {
      const b64 = btoa('raw email content');
      const blob = EmailDownloads.decodeRawEmail(b64);
      expect(blob.type).toBe('message/rfc822');
      expect(blob.size).toBeGreaterThan(0);
    });
  });

  describe('triggerEmlDownload', () => {
    it('creates and clicks a download link', () => {
      const blob = new Blob(['test'], { type: 'message/rfc822' });
      const mockLink = document.createElement('a');
      const clickSpy = spyOn(mockLink, 'click');

      spyOn(document, 'createElement').and.returnValue(mockLink);
      spyOn(document.body, 'appendChild').and.callThrough();
      spyOn(document.body, 'removeChild').and.callThrough();
      spyOn(URL, 'createObjectURL').and.returnValue('blob:test-url');
      spyOn(URL, 'revokeObjectURL');

      EmailDownloads.triggerEmlDownload(blob, 'test.eml');

      expect(document.createElement).toHaveBeenCalledWith('a');
      expect(mockLink.href).toBe('blob:test-url');
      expect(mockLink.download).toBe('test.eml');
      expect(document.body.appendChild).toHaveBeenCalledWith(mockLink);
      expect(clickSpy).toHaveBeenCalled();
      expect(document.body.removeChild).toHaveBeenCalledWith(mockLink);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    });
  });
});
