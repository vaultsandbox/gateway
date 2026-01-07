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

    it('coerces numbers to strings', () => {
      expect(EmailHeaderFormatter.formatHeaderValue(42)).toBe('42');
    });

    it('coerces booleans to strings', () => {
      expect(EmailHeaderFormatter.formatHeaderValue(true)).toBe('true');
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

    it('returns string value when passed a string', () => {
      expect(EmailHeaderFormatter.formatHeaderAddress('plain@example.com')).toBe('plain@example.com');
    });

    it('returns empty string for non-object non-string values', () => {
      expect(EmailHeaderFormatter.formatHeaderAddress(null)).toBe('');
      expect(EmailHeaderFormatter.formatHeaderAddress(undefined)).toBe('');
      expect(EmailHeaderFormatter.formatHeaderAddress(123)).toBe('');
    });

    it('handles group without name', () => {
      const group = {
        group: [{ name: 'Alice', address: 'alice@example.com' }, { address: 'bob@example.com' }],
      };
      expect(EmailHeaderFormatter.formatHeaderAddress(group)).toBe('Alice <alice@example.com>, bob@example.com');
    });

    it('returns name only when address is missing', () => {
      expect(EmailHeaderFormatter.formatHeaderAddress({ name: 'Alice' })).toBe('Alice');
    });

    it('returns empty string when neither name nor address present', () => {
      expect(EmailHeaderFormatter.formatHeaderAddress({})).toBe('');
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
