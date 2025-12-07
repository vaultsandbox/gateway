import { EmailItemModel } from '../../interfaces';

export class MetadataNormalizer {
  /**
   * Normalizes decrypted metadata with fallbacks for missing fields.
   * @param metadata Raw decrypted metadata object.
   * @param fallbackTo Inbox email address to use when "to" is missing.
   * @param fallbackReceivedAt Optional timestamp to use when absent.
   */
  static normalize(
    metadata: Record<string, unknown> | null | undefined,
    fallbackTo: string,
    fallbackReceivedAt?: string,
  ): EmailItemModel['decryptedMetadata'] {
    const from = this.getMetadataString(metadata, 'from') ?? 'unknown';
    const to = this.getMetadataString(metadata, 'to') ?? fallbackTo;
    const subject = this.getMetadataString(metadata, 'subject') ?? '(no subject)';
    const receivedAt = this.getMetadataString(metadata, 'receivedAt') ?? fallbackReceivedAt ?? new Date().toISOString();

    return { from, to, subject, receivedAt };
  }

  /**
   * Safely extracts a string metadata field, returning null when absent.
   */
  private static getMetadataString(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
    if (!metadata) {
      return null;
    }

    const value = metadata[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }

    return null;
  }
}
