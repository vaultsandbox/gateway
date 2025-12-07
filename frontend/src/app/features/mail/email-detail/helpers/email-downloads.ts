import { EmailItemModel } from '../../interfaces';

export interface RawEmailMetadata {
  subject?: string | null;
  date?: string | null;
  receivedAt?: string | null;
}

export class EmailDownloads {
  /**
   * Builds a safe EML filename from subject/date metadata, applying fallbacks.
   */
  static buildRawEmailFilename(metadata: RawEmailMetadata, fallback = 'email'): string {
    const subject = metadata.subject || fallback;
    const rawDate = metadata.date || metadata.receivedAt;
    const datePart = rawDate ? EmailDownloads.safeDatePart(rawDate) : 'unknown';
    return `${EmailDownloads.sanitizeFilename(subject)}_${datePart}.eml`;
  }

  /**
   * Sanitizes a filename for cross-platform compatibility and length limits.
   */
  static sanitizeFilename(name: string): string {
    const sanitized = name
      .replace(/[<>:"/\\|?*]/g, '_')
      .split('')
      .map((char) => (char.charCodeAt(0) < 32 ? '_' : char))
      .join('');

    return sanitized.substring(0, 50).trim();
  }

  /**
   * Decodes a base64-encoded raw email into a Blob suitable for download.
   */
  static decodeRawEmail(rawEmailB64: string): Blob {
    const rawEmailData = atob(rawEmailB64);
    return new Blob([rawEmailData], { type: 'message/rfc822' });
  }

  /**
   * Triggers a browser download for an EML Blob using a generated object URL.
   */
  static triggerEmlDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Builds a safe EML filename from an EmailItemModel by preferring parsed content values.
   */
  static buildRawEmailFilenameFromEmail(email: EmailItemModel): string {
    const subject = email.parsedContent?.subject || email.decryptedMetadata?.subject;
    const date = email.parsedContent?.date;
    const receivedAt = email.decryptedMetadata?.receivedAt || null;

    return EmailDownloads.buildRawEmailFilename({ subject, date, receivedAt });
  }

  /**
   * Returns a YYYY-MM-DD date segment or 'unknown' when parsing fails.
   */
  private static safeDatePart(dateValue: string): string {
    const parsed = new Date(dateValue);
    return Number.isNaN(parsed.getTime()) ? 'unknown' : parsed.toISOString().split('T')[0];
  }
}
