import { parseEncryptionPolicy } from '../config.parsers';
import { EncryptionPolicy, DEFAULT_ENCRYPTION_POLICY } from '../config.constants';

describe('parseEncryptionPolicy', () => {
  it('should return ENABLED for "enabled"', () => {
    expect(parseEncryptionPolicy('enabled')).toBe(EncryptionPolicy.ENABLED);
  });

  it('should return DISABLED for "disabled"', () => {
    expect(parseEncryptionPolicy('disabled')).toBe(EncryptionPolicy.DISABLED);
  });

  it('should return ALWAYS for "always"', () => {
    expect(parseEncryptionPolicy('always')).toBe(EncryptionPolicy.ALWAYS);
  });

  it('should return NEVER for "never"', () => {
    expect(parseEncryptionPolicy('never')).toBe(EncryptionPolicy.NEVER);
  });

  it('should be case-insensitive', () => {
    expect(parseEncryptionPolicy('ENABLED')).toBe(EncryptionPolicy.ENABLED);
    expect(parseEncryptionPolicy('DISABLED')).toBe(EncryptionPolicy.DISABLED);
    expect(parseEncryptionPolicy('ALWAYS')).toBe(EncryptionPolicy.ALWAYS);
    expect(parseEncryptionPolicy('NEVER')).toBe(EncryptionPolicy.NEVER);
    expect(parseEncryptionPolicy('Enabled')).toBe(EncryptionPolicy.ENABLED);
  });

  it('should trim whitespace', () => {
    expect(parseEncryptionPolicy('  enabled  ')).toBe(EncryptionPolicy.ENABLED);
    expect(parseEncryptionPolicy('\tdisabled\n')).toBe(EncryptionPolicy.DISABLED);
  });

  it('should return default for undefined', () => {
    expect(parseEncryptionPolicy(undefined)).toBe(DEFAULT_ENCRYPTION_POLICY);
  });

  it('should return default for empty string', () => {
    expect(parseEncryptionPolicy('')).toBe(DEFAULT_ENCRYPTION_POLICY);
  });
});
