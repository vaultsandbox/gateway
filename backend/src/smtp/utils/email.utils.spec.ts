/**
 * Email Utility Functions Tests
 *
 * Comprehensive test coverage for email address handling, domain extraction,
 * IP normalization, and string extraction utilities.
 *
 * @module email-utils-spec
 */

import {
  normalizeIp,
  extractDomain,
  isEmailLike,
  extractString,
  getBaseEmail,
  validateEmailAddress,
  EmailValidationError,
} from './email.utils';

describe('Email Utils', () => {
  describe('normalizeIp', () => {
    it('should return undefined for undefined input', () => {
      expect(normalizeIp(undefined)).toBeUndefined();
    });

    it('should trim whitespace from IP addresses', () => {
      expect(normalizeIp('  192.168.1.1  ')).toBe('192.168.1.1');
      expect(normalizeIp('\t203.0.113.45\n')).toBe('203.0.113.45');
      expect(normalizeIp(' 2001:db8::1 ')).toBe('2001:db8::1');
    });

    it('should remove IPv6 zone identifiers', () => {
      expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
      expect(normalizeIp('fe80::dead:beef%wlan0')).toBe('fe80::dead:beef');
      expect(normalizeIp('::1%lo')).toBe('::1');
    });

    it('should strip IPv6-to-IPv4 mapping prefix', () => {
      expect(normalizeIp('::ffff:192.168.1.1')).toBe('192.168.1.1');
      expect(normalizeIp('::ffff:203.0.113.45')).toBe('203.0.113.45');
      expect(normalizeIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
    });

    it('should handle IPv6-to-IPv4 mapping with zone identifier', () => {
      expect(normalizeIp('::ffff:192.168.1.1%eth0')).toBe('192.168.1.1');
    });

    it('should handle combination of whitespace, zone, and mapping', () => {
      expect(normalizeIp('  ::ffff:192.168.1.1%eth0  ')).toBe('192.168.1.1');
    });

    it('should handle empty string', () => {
      expect(normalizeIp('')).toBeUndefined();
    });

    it('should handle whitespace-only string', () => {
      expect(normalizeIp('   ')).toBe('');
    });

    it('should preserve regular IPv4 addresses', () => {
      expect(normalizeIp('192.168.1.1')).toBe('192.168.1.1');
      expect(normalizeIp('203.0.113.45')).toBe('203.0.113.45');
    });

    it('should preserve regular IPv6 addresses', () => {
      expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
      expect(normalizeIp('fe80::dead:beef')).toBe('fe80::dead:beef');
    });
  });

  describe('extractDomain', () => {
    it('should extract and lowercase domain from email', () => {
      expect(extractDomain('user@Example.COM')).toBe('example.com');
      expect(extractDomain('admin@MAIL.EXAMPLE.ORG')).toBe('mail.example.org');
    });

    it('should handle already lowercase domains', () => {
      expect(extractDomain('user@example.com')).toBe('example.com');
      expect(extractDomain('test@subdomain.example.org')).toBe('subdomain.example.org');
    });

    it('should return undefined for emails without @ symbol', () => {
      expect(extractDomain('invalid-email')).toBeUndefined();
      expect(extractDomain('user.example.com')).toBeUndefined();
      expect(extractDomain('')).toBeUndefined();
    });

    it('should handle @ at the start', () => {
      expect(extractDomain('@example.com')).toBe('example.com');
    });

    it('should handle @ at the end', () => {
      expect(extractDomain('user@')).toBe('');
    });

    it('should take domain after first @ symbol', () => {
      expect(extractDomain('user@domain@example.com')).toBe('domain@example.com');
    });

    it('should handle complex email addresses', () => {
      expect(extractDomain('user+tag@Example.COM')).toBe('example.com');
      expect(extractDomain('firstname.lastname@MAIL.COMPANY.ORG')).toBe('mail.company.org');
    });
  });

  describe('isEmailLike', () => {
    it('should return true for valid email-like strings', () => {
      expect(isEmailLike('user@example.com')).toBe(true);
      expect(isEmailLike('admin@mail.example.org')).toBe(true);
      expect(isEmailLike('test+tag@domain.com')).toBe(true);
      expect(isEmailLike('a@b')).toBe(true);
    });

    it('should return false for strings without @ symbol', () => {
      expect(isEmailLike('user')).toBe(false);
      expect(isEmailLike('user.example.com')).toBe(false);
      expect(isEmailLike('plaintext')).toBe(false);
    });

    it('should return false for @ at start', () => {
      expect(isEmailLike('@example.com')).toBe(false);
    });

    it('should return false for @ at end', () => {
      expect(isEmailLike('user@')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isEmailLike('')).toBe(false);
    });

    it('should return false for only @ symbol', () => {
      expect(isEmailLike('@')).toBe(false);
    });

    it('should return true for multiple @ symbols with text on both sides', () => {
      expect(isEmailLike('user@domain@example.com')).toBe(true);
    });

    it('should handle whitespace around email', () => {
      expect(isEmailLike('  user@example.com  ')).toBe(true);
    });
  });

  describe('extractString', () => {
    it('should return string when input is string', () => {
      expect(extractString('hello')).toBe('hello');
      expect(extractString('test string')).toBe('test string');
      expect(extractString('')).toBe('');
    });

    it('should convert Buffer to UTF-8 string', () => {
      expect(extractString(Buffer.from('world'))).toBe('world');
      expect(extractString(Buffer.from('Hello, World!'))).toBe('Hello, World!');
      expect(extractString(Buffer.from('UTF-8: ñ é ü'))).toBe('UTF-8: ñ é ü');
    });

    it('should return undefined for numbers', () => {
      expect(extractString(123)).toBeUndefined();
      expect(extractString(0)).toBeUndefined();
      expect(extractString(3.14)).toBeUndefined();
    });

    it('should return undefined for null', () => {
      expect(extractString(null)).toBeUndefined();
    });

    it('should return undefined for undefined', () => {
      expect(extractString(undefined)).toBeUndefined();
    });

    it('should return undefined for objects', () => {
      expect(extractString({})).toBeUndefined();
      expect(extractString({ key: 'value' })).toBeUndefined();
      expect(extractString([])).toBeUndefined();
      expect(extractString([1, 2, 3])).toBeUndefined();
    });

    it('should return undefined for boolean', () => {
      expect(extractString(true)).toBeUndefined();
      expect(extractString(false)).toBeUndefined();
    });

    it('should handle empty Buffer', () => {
      expect(extractString(Buffer.from(''))).toBe('');
    });

    it('should handle Buffer with special characters', () => {
      const specialChars = Buffer.from('Special: \n\t\r');
      expect(extractString(specialChars)).toBe('Special: \n\t\r');
    });
  });

  describe('getBaseEmail', () => {
    it('should remove +tag from local part', () => {
      expect(getBaseEmail('test1+shopping@example.com')).toBe('test1@example.com');
      expect(getBaseEmail('user+newsletter@domain.org')).toBe('user@domain.org');
      expect(getBaseEmail('admin+spam@mail.example.com')).toBe('admin@mail.example.com');
    });

    it('should return email as-is when no +tag present', () => {
      expect(getBaseEmail('simple@example.com')).toBe('simple@example.com');
      expect(getBaseEmail('no-plus@example.com')).toBe('no-plus@example.com');
      expect(getBaseEmail('user@domain.org')).toBe('user@domain.org');
    });

    it('should return email as-is when no @ symbol', () => {
      expect(getBaseEmail('invalid-email')).toBe('invalid-email');
      expect(getBaseEmail('no-at-sign')).toBe('no-at-sign');
    });

    it('should handle + in domain (should not affect domain)', () => {
      expect(getBaseEmail('user@domain+test.com')).toBe('user@domain+test.com');
    });

    it('should remove everything after first + in local part', () => {
      expect(getBaseEmail('user+tag1+tag2@example.com')).toBe('user@example.com');
      expect(getBaseEmail('test+a+b+c@domain.org')).toBe('test@domain.org');
    });

    it('should handle + at start of local part', () => {
      expect(getBaseEmail('+tag@example.com')).toBe('@example.com');
    });

    it('should handle empty local part after removing +tag', () => {
      expect(getBaseEmail('+@example.com')).toBe('@example.com');
    });

    it('should preserve domain case', () => {
      expect(getBaseEmail('user+tag@Example.COM')).toBe('user@Example.COM');
      expect(getBaseEmail('test+newsletter@MAIL.ORG')).toBe('test@MAIL.ORG');
    });

    it('should handle complex email addresses', () => {
      expect(getBaseEmail('firstname.lastname+work@company.example.com')).toBe(
        'firstname.lastname@company.example.com',
      );
    });

    it('should handle edge case with @ in local part (malformed)', () => {
      // This handles the case where there might be @ in local part
      // The function takes the first @ as the separator
      expect(getBaseEmail('user+tag@test@example.com')).toBe('user@test@example.com');
    });
  });

  describe('validateEmailAddress', () => {
    describe('valid addresses', () => {
      it('should accept valid email addresses', () => {
        expect(() => validateEmailAddress('user@example.com')).not.toThrow();
        expect(() => validateEmailAddress('admin@mail.example.org')).not.toThrow();
        expect(() => validateEmailAddress('test+tag@domain.com')).not.toThrow();
        expect(() => validateEmailAddress('a@b.co')).not.toThrow();
      });

      it('should accept null sender (empty string) for bounce messages', () => {
        expect(() => validateEmailAddress('')).not.toThrow();
      });

      it('should accept null sender (<>) for bounce messages', () => {
        expect(() => validateEmailAddress('<>')).not.toThrow();
      });

      it('should accept addresses with special characters in local part', () => {
        expect(() => validateEmailAddress('user.name@example.com')).not.toThrow();
        expect(() => validateEmailAddress('user+tag@example.com')).not.toThrow();
        expect(() => validateEmailAddress('user-name@example.com')).not.toThrow();
        expect(() => validateEmailAddress("user!#$%&'*+/=?^_`{|}~@example.com")).not.toThrow();
      });

      it('should accept addresses at RFC 5321 limits', () => {
        // Local part at exactly 64 characters
        const maxLocal = 'a'.repeat(64);
        expect(() => validateEmailAddress(`${maxLocal}@example.com`)).not.toThrow();

        // Domain at exactly 255 characters
        const maxDomain = 'a'.repeat(251) + '.com';
        expect(() => validateEmailAddress(`user@${maxDomain}`)).not.toThrow();
      });
    });

    describe('invalid format', () => {
      it('should reject addresses without @ symbol', () => {
        expect(() => validateEmailAddress('userexample.com')).toThrow(EmailValidationError);
        expect(() => validateEmailAddress('plaintext')).toThrow(EmailValidationError);
      });

      it('should reject addresses with @ at start', () => {
        expect(() => validateEmailAddress('@example.com')).toThrow(EmailValidationError);
      });

      it('should reject addresses with @ at end', () => {
        expect(() => validateEmailAddress('user@')).toThrow(EmailValidationError);
      });

      it('should provide correct error code for invalid format', () => {
        try {
          validateEmailAddress('invalid');
          fail('Should have thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(EmailValidationError);
          expect((e as EmailValidationError).code).toBe('INVALID_FORMAT');
        }
      });
    });

    describe('length limits (RFC 5321)', () => {
      it('should reject local part exceeding 64 characters', () => {
        const longLocal = 'a'.repeat(65);
        expect(() => validateEmailAddress(`${longLocal}@example.com`)).toThrow(EmailValidationError);
      });

      it('should reject domain exceeding 255 characters', () => {
        const longDomain = 'a'.repeat(256);
        expect(() => validateEmailAddress(`user@${longDomain}`)).toThrow(EmailValidationError);
      });

      it('should reject total length exceeding 320 characters', () => {
        // Create an address that exceeds 320 total but individual parts are within limits
        const local = 'a'.repeat(64);
        const domain = 'b'.repeat(255) + '.com';
        expect(() => validateEmailAddress(`${local}@${domain}`)).toThrow(EmailValidationError);
      });

      it('should provide correct error code for length violations', () => {
        try {
          validateEmailAddress('a'.repeat(65) + '@example.com');
          fail('Should have thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(EmailValidationError);
          expect((e as EmailValidationError).code).toBe('TOO_LONG');
        }
      });
    });

    describe('control character injection prevention', () => {
      it('should reject null byte (\\x00)', () => {
        expect(() => validateEmailAddress('user\x00@example.com')).toThrow(EmailValidationError);
        expect(() => validateEmailAddress('user@example\x00.com')).toThrow(EmailValidationError);
      });

      it('should reject newline characters (\\n, \\r)', () => {
        expect(() => validateEmailAddress('user\n@example.com')).toThrow(EmailValidationError);
        expect(() => validateEmailAddress('user\r@example.com')).toThrow(EmailValidationError);
        expect(() => validateEmailAddress('user@example\n.com')).toThrow(EmailValidationError);
      });

      it('should reject tab character (\\t)', () => {
        expect(() => validateEmailAddress('user\t@example.com')).toThrow(EmailValidationError);
      });

      it('should reject escape character (\\x1B)', () => {
        expect(() => validateEmailAddress('user\x1B[31m@example.com')).toThrow(EmailValidationError);
      });

      it('should reject DEL character (\\x7F)', () => {
        expect(() => validateEmailAddress('user\x7F@example.com')).toThrow(EmailValidationError);
      });

      it('should reject bell character (\\x07)', () => {
        expect(() => validateEmailAddress('user\x07@example.com')).toThrow(EmailValidationError);
      });

      it('should provide correct error code for control characters', () => {
        try {
          validateEmailAddress('user\x00@example.com');
          fail('Should have thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(EmailValidationError);
          expect((e as EmailValidationError).code).toBe('CONTROL_CHARS');
        }
      });
    });

    describe('EmailValidationError', () => {
      it('should have correct name property', () => {
        const error = new EmailValidationError('test', 'INVALID_FORMAT');
        expect(error.name).toBe('EmailValidationError');
      });

      it('should have correct message property', () => {
        const error = new EmailValidationError('Custom message', 'TOO_LONG');
        expect(error.message).toBe('Custom message');
      });

      it('should have correct code property', () => {
        const error = new EmailValidationError('test', 'CONTROL_CHARS');
        expect(error.code).toBe('CONTROL_CHARS');
      });

      it('should be instance of Error', () => {
        const error = new EmailValidationError('test', 'EMPTY');
        expect(error).toBeInstanceOf(Error);
      });
    });
  });
});
