import { MetadataNormalizer } from '../metadata-normalizer.helper';

describe('MetadataNormalizer', () => {
  const fallbackTo = 'fallback@example.com';
  const fallbackReceivedAt = '2024-01-01T00:00:00.000Z';

  describe('normalize', () => {
    it('returns all values from metadata when present', () => {
      const metadata = {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        receivedAt: '2024-06-15T10:30:00.000Z',
      };

      const result = MetadataNormalizer.normalize(metadata, fallbackTo, fallbackReceivedAt);

      expect(result).toEqual({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        receivedAt: '2024-06-15T10:30:00.000Z',
      });
    });

    it('uses fallback values when metadata is null', () => {
      const result = MetadataNormalizer.normalize(null, fallbackTo, fallbackReceivedAt);

      expect(result).toEqual({
        from: 'unknown',
        to: fallbackTo,
        subject: '(no subject)',
        receivedAt: fallbackReceivedAt,
      });
    });

    it('uses fallback values when metadata is undefined', () => {
      const result = MetadataNormalizer.normalize(undefined, fallbackTo, fallbackReceivedAt);

      expect(result).toEqual({
        from: 'unknown',
        to: fallbackTo,
        subject: '(no subject)',
        receivedAt: fallbackReceivedAt,
      });
    });

    it('uses fallbackTo when "to" field is missing', () => {
      const metadata = {
        from: 'sender@example.com',
        subject: 'Test Subject',
        receivedAt: '2024-06-15T10:30:00.000Z',
      };

      const result = MetadataNormalizer.normalize(metadata, fallbackTo, fallbackReceivedAt);

      expect(result!.to).toBe(fallbackTo);
    });

    it('uses fallback "unknown" when "from" field is missing', () => {
      const metadata = {
        to: 'recipient@example.com',
        subject: 'Test Subject',
        receivedAt: '2024-06-15T10:30:00.000Z',
      };

      const result = MetadataNormalizer.normalize(metadata, fallbackTo, fallbackReceivedAt);

      expect(result!.from).toBe('unknown');
    });

    it('uses fallback "(no subject)" when subject is missing', () => {
      const metadata = {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        receivedAt: '2024-06-15T10:30:00.000Z',
      };

      const result = MetadataNormalizer.normalize(metadata, fallbackTo, fallbackReceivedAt);

      expect(result!.subject).toBe('(no subject)');
    });

    it('uses fallbackReceivedAt when receivedAt is missing', () => {
      const metadata = {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
      };

      const result = MetadataNormalizer.normalize(metadata, fallbackTo, fallbackReceivedAt);

      expect(result!.receivedAt).toBe(fallbackReceivedAt);
    });

    it('uses current date when receivedAt is missing and no fallback provided', () => {
      const beforeTest = new Date().toISOString();
      const metadata = {
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
      };

      const result = MetadataNormalizer.normalize(metadata, fallbackTo);
      const afterTest = new Date().toISOString();

      expect(result!.receivedAt >= beforeTest).toBeTrue();
      expect(result!.receivedAt <= afterTest).toBeTrue();
    });

    it('ignores non-string values in metadata', () => {
      const metadata = {
        from: 123,
        to: { email: 'test@example.com' },
        subject: ['Test Subject'],
        receivedAt: null,
      };

      const result = MetadataNormalizer.normalize(metadata as Record<string, unknown>, fallbackTo, fallbackReceivedAt);

      expect(result).toEqual({
        from: 'unknown',
        to: fallbackTo,
        subject: '(no subject)',
        receivedAt: fallbackReceivedAt,
      });
    });

    it('ignores empty string values in metadata', () => {
      const metadata = {
        from: '',
        to: '',
        subject: '',
        receivedAt: '',
      };

      const result = MetadataNormalizer.normalize(metadata, fallbackTo, fallbackReceivedAt);

      expect(result).toEqual({
        from: 'unknown',
        to: fallbackTo,
        subject: '(no subject)',
        receivedAt: fallbackReceivedAt,
      });
    });

    it('ignores whitespace-only string values in metadata', () => {
      const metadata = {
        from: '   ',
        to: '\t',
        subject: '\n',
        receivedAt: '  \t\n  ',
      };

      const result = MetadataNormalizer.normalize(metadata, fallbackTo, fallbackReceivedAt);

      expect(result).toEqual({
        from: 'unknown',
        to: fallbackTo,
        subject: '(no subject)',
        receivedAt: fallbackReceivedAt,
      });
    });

    it('handles partial metadata correctly', () => {
      const metadata = {
        from: 'sender@example.com',
        subject: '',
      };

      const result = MetadataNormalizer.normalize(metadata, fallbackTo, fallbackReceivedAt);

      expect(result).toEqual({
        from: 'sender@example.com',
        to: fallbackTo,
        subject: '(no subject)',
        receivedAt: fallbackReceivedAt,
      });
    });
  });
});
