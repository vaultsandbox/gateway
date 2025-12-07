import { EmailHeaderFormatter } from './email-header-formatter';

describe('EmailHeaderFormatter', () => {
  describe('formatHeaderValue', () => {
    it('returns strings and handles nullish input', () => {
      expect(EmailHeaderFormatter.formatHeaderValue('Subject')).toBe('Subject');
      expect(EmailHeaderFormatter.formatHeaderValue(null)).toBe('');
      expect(EmailHeaderFormatter.formatHeaderValue(undefined)).toBe('');
    });

    it('joins array values while trimming blanks', () => {
      const value = ['First', ' ', { text: 'Second' }];
      expect(EmailHeaderFormatter.formatHeaderValue(value)).toBe('First, Second');
    });

    it('prefers text-like fields when present', () => {
      expect(EmailHeaderFormatter.formatHeaderValue({ text: 'From Text' })).toBe('From Text');
      expect(EmailHeaderFormatter.formatHeaderValue({ line: 'Line Value' })).toBe('Line Value');
    });

    it('formats raw value strings and address arrays', () => {
      expect(EmailHeaderFormatter.formatHeaderValue({ value: 'Raw' })).toBe('Raw');

      const addresses = {
        value: [{ name: 'Alice', address: 'alice@example.com' }, { address: 'bob@example.com' }],
      };
      expect(EmailHeaderFormatter.formatHeaderValue(addresses)).toBe('Alice <alice@example.com>, bob@example.com');
    });

    it('serializes params objects', () => {
      const params = { params: { charset: 'utf-8', format: { value: 'flowed' } } };
      expect(EmailHeaderFormatter.formatHeaderValue(params)).toBe('charset=utf-8; format=flowed');
    });

    it('falls back to JSON serialization when no match is found', () => {
      expect(EmailHeaderFormatter.formatHeaderValue({ foo: 'bar' })).toBe('{"foo":"bar"}');
    });
  });

  describe('formatHeaderAddress', () => {
    it('formats named addresses and groups', () => {
      expect(EmailHeaderFormatter.formatHeaderAddress({ name: 'Alice', address: 'alice@example.com' })).toBe(
        'Alice <alice@example.com>',
      );
      expect(EmailHeaderFormatter.formatHeaderAddress({ address: 'bob@example.com' })).toBe('bob@example.com');

      const group = {
        name: 'Team',
        group: [{ name: 'Alice', address: 'alice@example.com' }, { address: 'bob@example.com' }],
      };
      expect(EmailHeaderFormatter.formatHeaderAddress(group)).toBe('Team: Alice <alice@example.com>, bob@example.com');
    });
  });

  describe('buildHeadersList', () => {
    it('returns a formatted key/value list', () => {
      const headers = {
        Subject: 'Hello',
        To: { value: [{ address: 'bob@example.com' }] },
      };

      expect(EmailHeaderFormatter.buildHeadersList(headers)).toEqual([
        { key: 'Subject', value: 'Hello' },
        { key: 'To', value: 'bob@example.com' },
      ]);
    });

    it('returns an empty array for nullish headers', () => {
      expect(EmailHeaderFormatter.buildHeadersList(null)).toEqual([]);
      expect(EmailHeaderFormatter.buildHeadersList(undefined)).toEqual([]);
    });
  });
});
