import { EmailDownloads } from './email-downloads';
import { EmailItemModel } from '../../interfaces';

describe('EmailDownloads', () => {
  it('sanitizes filenames and truncates control chars', () => {
    expect(EmailDownloads.sanitizeFilename('abc<>:"/\\|?*def')).toBe('abc_________def');
    expect(EmailDownloads.sanitizeFilename('a'.repeat(60)).length).toBeLessThanOrEqual(50);
  });

  it('builds filename from metadata with date fallback', () => {
    const filename = EmailDownloads.buildRawEmailFilename({ subject: 'Hello', date: '2024-01-02T00:00:00Z' });
    expect(filename).toBe('Hello_2024-01-02.eml');

    const unknown = EmailDownloads.buildRawEmailFilename({ subject: 'Hi', date: 'invalid' });
    expect(unknown).toBe('Hi_unknown.eml');
  });

  it('builds filename from EmailItemModel data', () => {
    const email = {
      parsedContent: { subject: 'Parsed Subject', date: '2024-05-10T00:00:00Z' },
      decryptedMetadata: { subject: 'Meta Subject', receivedAt: '2024-05-11T00:00:00Z' },
    } as EmailItemModel;

    expect(EmailDownloads.buildRawEmailFilenameFromEmail(email)).toBe('Parsed Subject_2024-05-10.eml');
  });

  it('decodes base64 raw email into a Blob', () => {
    const b64 = btoa('raw email content');
    const blob = EmailDownloads.decodeRawEmail(b64);
    expect(blob.type).toBe('message/rfc822');
    expect(blob.size).toBeGreaterThan(0);
  });
});
