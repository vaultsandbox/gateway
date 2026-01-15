import { parseEncryptionPolicy, isDevMode } from '../config.parsers';
import { EncryptionPolicy, DEFAULT_ENCRYPTION_POLICY } from '../config.constants';

describe('isDevMode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should return true when VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS is undefined', () => {
    delete process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS;
    expect(isDevMode()).toBe(true);
  });

  it('should return true when VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS is empty', () => {
    process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = '';
    expect(isDevMode()).toBe(true);
  });

  it('should return true when VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS is whitespace only', () => {
    process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = '   ';
    expect(isDevMode()).toBe(true);
  });

  it('should return false when VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS is set', () => {
    process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = 'example.com';
    expect(isDevMode()).toBe(false);
  });

  it('should return false when VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS is localhost (explicitly set)', () => {
    process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = 'localhost';
    expect(isDevMode()).toBe(false);
  });

  it('should return false when VSB_VSX_DNS_ENABLED is true (even without domains)', () => {
    delete process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS;
    process.env.VSB_VSX_DNS_ENABLED = 'true';
    expect(isDevMode()).toBe(false);
  });

  it('should return false when VSB_VSX_DNS_ENABLED is "1"', () => {
    delete process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS;
    process.env.VSB_VSX_DNS_ENABLED = '1';
    expect(isDevMode()).toBe(false);
  });

  it('should return true when VSB_VSX_DNS_ENABLED is false and no domains set', () => {
    delete process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS;
    process.env.VSB_VSX_DNS_ENABLED = 'false';
    expect(isDevMode()).toBe(true);
  });
});

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
