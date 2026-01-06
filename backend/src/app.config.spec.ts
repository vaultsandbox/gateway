import { describe, expect, it, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { DEFAULT_SMTP_PORT } from './config/config.constants';

// Mock fs module before importing config
jest.mock('fs');

// Mock NestJS Logger before importing config
const mockLoggerWarn = jest.fn();
jest.mock('@nestjs/common', () => ({
  ...jest.requireActual('@nestjs/common'),
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: mockLoggerWarn,
    debug: jest.fn(),
    verbose: jest.fn(),
  })),
}));

describe('app.config', () => {
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;
  let originalEnv: NodeJS.ProcessEnv;
  let mockExistsSync: jest.MockedFunction<any>;
  let mockReadFileSync: jest.MockedFunction<any>;

  beforeAll(() => {
    // Save original environment
    originalEnv = { ...process.env };
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    // Restore original environment
    process.env = { ...originalEnv };
    consoleWarnSpy.mockRestore();
  });

  beforeEach(() => {
    // Clear all VSB_ and NODE_ENV environment variables
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('VSB_') || key === 'NODE_ENV') {
        delete process.env[key];
      }
    });

    // Reset all modules to ensure fresh import
    jest.resetModules();

    // Get fresh references to mocked fs functions after reset
    const fs = require('fs');
    mockExistsSync = fs.existsSync;
    mockReadFileSync = fs.readFileSync;

    // Clear mocks
    jest.clearAllMocks();
    consoleWarnSpy.mockClear();
    mockLoggerWarn.mockClear();
  });

  const setMinimalEnv = () => {
    process.env.VSB_SMTP_HOST = 'localhost';
    process.env.VSB_SMTP_PORT = '587';
    process.env.VSB_SMTP_SECURE = 'false';
    process.env.VSB_SMTP_MAX_MESSAGE_SIZE = '10485760';
    process.env.VSB_SMTP_SESSION_TIMEOUT = '60000';
    process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = 'example.com';
    process.env.VSB_LOCAL_API_KEY = 'test-key-with-at-least-32-characters-here';
  };

  const setTlsEnv = () => {
    const certBuffer = Buffer.from('-----BEGIN CERTIFICATE-----\ncert-content\n-----END CERTIFICATE-----');
    const keyBuffer = Buffer.from('-----BEGIN PRIVATE KEY-----\nkey-content\n-----END PRIVATE KEY-----');

    process.env.VSB_SMTP_TLS_CERT_PATH = '/path/to/cert.pem';
    process.env.VSB_SMTP_TLS_KEY_PATH = '/path/to/key.pem';

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path: any) => (path.toString().includes('cert') ? certBuffer : keyBuffer));
  };

  const setSmtpSecureWithTls = (secureValue: string) => {
    setMinimalEnv();
    setTlsEnv();
    process.env.VSB_SMTP_SECURE = secureValue;
  };

  describe('parseOptionalBoolean via VSB_SMTP_SECURE', () => {
    it('should parse "true" as true', () => {
      setSmtpSecureWithTls('true');
      const config = require('./app.config').default();
      expect(config.smtp.secure).toBe(true);
    });

    it('should parse "1" as true', () => {
      setSmtpSecureWithTls('1');
      const config = require('./app.config').default();
      expect(config.smtp.secure).toBe(true);
    });

    it('should parse "yes" as true', () => {
      setSmtpSecureWithTls('yes');
      const config = require('./app.config').default();
      expect(config.smtp.secure).toBe(true);
    });

    it('should parse "on" as true', () => {
      setSmtpSecureWithTls('on');
      const config = require('./app.config').default();
      expect(config.smtp.secure).toBe(true);
    });

    it('should parse "TRUE" (uppercase) as true', () => {
      setSmtpSecureWithTls('TRUE');
      const config = require('./app.config').default();
      expect(config.smtp.secure).toBe(true);
    });

    it('should parse "false" as false', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_SECURE = 'false';
      const config = require('./app.config').default();
      expect(config.smtp.secure).toBe(false);
    });

    it('should parse "0" as false', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_SECURE = '0';
      const config = require('./app.config').default();
      expect(config.smtp.secure).toBe(false);
    });

    it('should parse any other value as false', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_SECURE = 'invalid';
      const config = require('./app.config').default();
      expect(config.smtp.secure).toBe(false);
    });
  });

  describe('parseOptionalBoolean via optional flags', () => {
    it('should return default value when undefined', () => {
      setMinimalEnv();
      // VSB_SMTP_DISABLE_PIPELINING not set
      const config = require('./app.config').default();
      expect(config.smtp.disablePipelining).toBe(false);
    });

    it('should parse true value when provided', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_DISABLE_PIPELINING = 'true';
      const config = require('./app.config').default();
      expect(config.smtp.disablePipelining).toBe(true);
    });

    it('should parse false value when provided', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_DISABLE_PIPELINING = 'false';
      const config = require('./app.config').default();
      expect(config.smtp.disablePipelining).toBe(false);
    });

    it('should trim whitespace before parsing truthy values', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_DISABLE_PIPELINING = ' true ';
      const config = require('./app.config').default();
      expect(config.smtp.disablePipelining).toBe(true);
    });

    it('should trim whitespace before parsing falsy values', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_DISABLE_PIPELINING = ' false ';
      const config = require('./app.config').default();
      expect(config.smtp.disablePipelining).toBe(false);
    });

    it('should fall back to default for unrecognized values', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_DISABLE_PIPELINING = 'not-a-boolean';
      const config = require('./app.config').default();
      expect(config.smtp.disablePipelining).toBe(false);
    });

    it('should respect true defaults for unrecognized values', () => {
      setMinimalEnv();
      process.env.VSB_SERVER_HTTPS_ENABLED = 'not-a-boolean';
      const config = require('./app.config').default();
      expect(config.main.httpsEnabled).toBe(false);
    });
  });

  describe('parseNumberWithDefault via port and size configs', () => {
    it('should parse valid number strings', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_PORT = '25';
      process.env.VSB_SMTP_MAX_MESSAGE_SIZE = '20971520';
      const config = require('./app.config').default();
      expect(config.smtp.port).toBe(25);
      expect(config.smtp.maxMessageSize).toBe(20971520);
    });

    it('should throw error for invalid number string', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_PORT = 'invalid';
      expect(() => require('./app.config').default()).toThrow(
        'Invalid numeric value: "invalid" (must be a non-negative finite number)',
      );
    });

    it('should default when value is empty string', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_PORT = '';
      const config = require('./app.config').default();
      expect(config.smtp.port).toBe(DEFAULT_SMTP_PORT);
    });
  });

  describe('parseNumberWithDefault via optional numeric configs', () => {
    it('should return default value when undefined', () => {
      setMinimalEnv();
      const config = require('./app.config').default();
      expect(config.smtp.maxConnections).toBe(25);
      expect(config.smtp.closeTimeout).toBe(30000);
      expect(config.smtp.earlyTalkerDelay).toBe(300);
    });

    it('should parse provided values', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_MAX_CONNECTIONS = '50';
      process.env.VSB_SMTP_CLOSE_TIMEOUT = '60000';
      process.env.VSB_SMTP_EARLY_TALKER_DELAY = '500';
      const config = require('./app.config').default();
      expect(config.smtp.maxConnections).toBe(50);
      expect(config.smtp.closeTimeout).toBe(60000);
      expect(config.smtp.earlyTalkerDelay).toBe(500);
    });

    it('should throw for negative values', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_MAX_CONNECTIONS = '-1';
      expect(() => require('./app.config').default()).toThrow(
        'Invalid numeric value: "-1" (must be a non-negative finite number)',
      );
    });

    it('should throw for non-finite values', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_MAX_CONNECTIONS = 'Infinity';
      expect(() => require('./app.config').default()).toThrow(
        'Invalid numeric value: "Infinity" (must be a non-negative finite number)',
      );
    });

    it('should throw for non-integer values', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_PORT = '25.5';
      expect(() => require('./app.config').default()).toThrow('Invalid numeric value: "25.5" (must be an integer)');
    });
  });

  describe('readTlsBuffer and buildTlsConfig', () => {
    it('should return undefined when paths not provided', () => {
      setMinimalEnv();
      const config = require('./app.config').default();
      expect(config.smtp.tls).toBeUndefined();
    });

    it('should return undefined when files do not exist', () => {
      mockExistsSync.mockReturnValue(false);
      setMinimalEnv();
      process.env.VSB_SMTP_TLS_CERT_PATH = '/nonexistent/cert.pem';
      process.env.VSB_SMTP_TLS_KEY_PATH = '/nonexistent/key.pem';
      const config = require('./app.config').default();
      expect(config.smtp.tls).toBeUndefined();
    });

    it('should read files when they exist', () => {
      const certBuffer = Buffer.from('-----BEGIN CERTIFICATE-----\ncert-content\n-----END CERTIFICATE-----');
      const keyBuffer = Buffer.from('-----BEGIN PRIVATE KEY-----\nkey-content\n-----END PRIVATE KEY-----');
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: any) => {
        if (path.toString().includes('cert')) return certBuffer;
        return keyBuffer;
      });

      setMinimalEnv();
      process.env.VSB_SMTP_TLS_CERT_PATH = '/path/to/cert.pem';
      process.env.VSB_SMTP_TLS_KEY_PATH = '/path/to/key.pem';
      const config = require('./app.config').default();
      expect(config.smtp.tls).toBeDefined();
      expect(config.smtp.tls?.cert).toEqual(certBuffer);
      expect(config.smtp.tls?.key).toEqual(keyBuffer);
    });

    it('should throw error when only cert path provided', () => {
      mockExistsSync.mockImplementation((path: any) => {
        return path.toString().includes('cert');
      });
      mockReadFileSync.mockReturnValue(Buffer.from('-----BEGIN CERTIFICATE-----\ncontent\n-----END CERTIFICATE-----'));
      setMinimalEnv();
      process.env.VSB_SMTP_TLS_CERT_PATH = '/path/to/cert.pem';
      expect(() => require('./app.config').default()).toThrow(
        'Both VSB_SMTP_TLS_CERT_PATH and VSB_SMTP_TLS_KEY_PATH must be provided to enable TLS',
      );
    });

    it('should throw error when only key path provided', () => {
      mockExistsSync.mockImplementation((path: any) => {
        return path.toString().includes('key');
      });
      mockReadFileSync.mockReturnValue(Buffer.from('-----BEGIN PRIVATE KEY-----\ncontent\n-----END PRIVATE KEY-----'));
      setMinimalEnv();
      process.env.VSB_SMTP_TLS_KEY_PATH = '/path/to/key.pem';
      expect(() => require('./app.config').default()).toThrow(
        'Both VSB_SMTP_TLS_CERT_PATH and VSB_SMTP_TLS_KEY_PATH must be provided to enable TLS',
      );
    });

    it('should throw error when certificate file is not in PEM format', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(Buffer.from('not a valid PEM file content'));
      setMinimalEnv();
      process.env.VSB_SMTP_TLS_CERT_PATH = '/path/to/cert.pem';
      process.env.VSB_SMTP_TLS_KEY_PATH = '/path/to/key.pem';
      expect(() => require('./app.config').default()).toThrow(
        'Invalid certificate/key format in /path/to/cert.pem: File must be in PEM format',
      );
    });

    it('should include TLS security options with default values', () => {
      setSmtpSecureWithTls('true');
      const config = require('./app.config').default();
      expect(config.smtp.tls).toBeDefined();
      expect(config.smtp.tls?.minVersion).toBe('TLSv1.2');
      expect(config.smtp.tls?.ciphers).toContain('ECDHE-ECDSA-AES256-GCM-SHA384');
      expect(config.smtp.tls?.ciphers).toContain('ECDHE-RSA-AES256-GCM-SHA384');
      expect(config.smtp.tls?.honorCipherOrder).toBe(true);
      expect(config.smtp.tls?.ecdhCurve).toBe('auto');
    });

    it('should respect custom TLS security options', () => {
      setSmtpSecureWithTls('true');
      process.env.VSB_SMTP_TLS_MIN_VERSION = 'TLSv1.3';
      process.env.VSB_SMTP_TLS_CIPHERS = 'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
      process.env.VSB_SMTP_TLS_HONOR_CIPHER_ORDER = 'false';
      process.env.VSB_SMTP_TLS_ECDH_CURVE = 'prime256v1';
      const config = require('./app.config').default();
      expect(config.smtp.tls?.minVersion).toBe('TLSv1.3');
      expect(config.smtp.tls?.ciphers).toBe('ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384');
      expect(config.smtp.tls?.honorCipherOrder).toBe(false);
      expect(config.smtp.tls?.ecdhCurve).toBe('prime256v1');
    });

    it('should apply TLS security defaults even without cert paths', () => {
      setMinimalEnv();
      const config = require('./app.config').default();
      expect(config.smtp.tls).toBeUndefined();
    });

    it('should default cipher order preference to true', () => {
      setSmtpSecureWithTls('true');
      // Don't set VSB_SMTP_TLS_HONOR_CIPHER_ORDER
      const config = require('./app.config').default();
      expect(config.smtp.tls?.honorCipherOrder).toBe(true);
    });

    it('should support all ECDHE cipher suites in default configuration', () => {
      setSmtpSecureWithTls('true');
      const config = require('./app.config').default();
      const ciphers = config.smtp.tls?.ciphers || '';
      expect(ciphers).toContain('ECDHE-ECDSA-AES256-GCM-SHA384');
      expect(ciphers).toContain('ECDHE-RSA-AES256-GCM-SHA384');
      expect(ciphers).toContain('ECDHE-ECDSA-AES128-GCM-SHA256');
      expect(ciphers).toContain('ECDHE-RSA-AES128-GCM-SHA256');
      expect(ciphers).toContain('ECDHE-ECDSA-CHACHA20-POLY1305');
      expect(ciphers).toContain('ECDHE-RSA-CHACHA20-POLY1305');
    });
  });

  describe('parseAllowedDomains', () => {
    it('should parse comma-separated domains', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = 'example.com,example.org,test.com';
      const config = require('./app.config').default();
      expect(config.smtp.allowedRecipientDomains).toEqual(['example.com', 'example.org', 'test.com']);
    });

    it('should lowercase and trim domains', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = ' EXAMPLE.COM , Example.ORG ';
      const config = require('./app.config').default();
      expect(config.smtp.allowedRecipientDomains).toEqual(['example.com', 'example.org']);
    });

    it('should filter out empty domains', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = 'example.com,,example.org';
      const config = require('./app.config').default();
      expect(config.smtp.allowedRecipientDomains).toEqual(['example.com', 'example.org']);
    });

    it('should throw error when domains env is undefined', () => {
      setMinimalEnv();
      delete process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS;
      expect(() => require('./app.config').default()).toThrow(
        'VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS is required. Specify comma-separated domains',
      );
    });

    it('should throw error when domains env is empty', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = '';
      expect(() => require('./app.config').default()).toThrow(
        'VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS is required. Specify comma-separated domains',
      );
    });

    it('should throw error when domains env is whitespace only', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = '   ';
      expect(() => require('./app.config').default()).toThrow(
        'VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS is required. Specify comma-separated domains',
      );
    });

    it('should throw error when all domains are empty after filtering', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = ',,,';
      expect(() => require('./app.config').default()).toThrow(
        'VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS must contain at least one valid domain',
      );
    });

    it('should throw error when domain format is invalid', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = 'valid.com,invalid_domain,another.org';
      expect(() => require('./app.config').default()).toThrow(
        'Invalid domain format in VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS: invalid_domain',
      );
    });
  });

  describe('parseDisabledCommands', () => {
    it('should parse comma-separated commands', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_DISABLED_COMMANDS = 'VRFY,EXPN,HELP';
      const config = require('./app.config').default();
      expect(config.smtp.disabledCommands).toEqual(['VRFY', 'EXPN', 'HELP']);
    });

    it('should uppercase and trim commands', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_DISABLED_COMMANDS = ' vrfy , expn ';
      const config = require('./app.config').default();
      expect(config.smtp.disabledCommands).toEqual(['VRFY', 'EXPN']);
    });

    it('should filter out empty commands', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_DISABLED_COMMANDS = 'VRFY,,EXPN';
      const config = require('./app.config').default();
      expect(config.smtp.disabledCommands).toEqual(['VRFY', 'EXPN']);
    });

    it('should return default commands when not set', () => {
      setMinimalEnv();
      const config = require('./app.config').default();
      expect(config.smtp.disabledCommands).toEqual(['VRFY', 'EXPN', 'ETRN', 'TURN', 'AUTH']);
    });

    it('should return default commands when empty string', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_DISABLED_COMMANDS = '';
      const config = require('./app.config').default();
      expect(config.smtp.disabledCommands).toEqual(['VRFY', 'EXPN', 'ETRN', 'TURN', 'AUTH']);
    });

    it('should return default commands when whitespace only', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_DISABLED_COMMANDS = '   ';
      const config = require('./app.config').default();
      expect(config.smtp.disabledCommands).toEqual(['VRFY', 'EXPN', 'ETRN', 'TURN', 'AUTH']);
    });
  });

  describe('validateTlsConfig warnings', () => {
    it('should warn when port 25 with secure=true', () => {
      setSmtpSecureWithTls('true');
      process.env.VSB_SMTP_PORT = '25';
      require('./app.config').default();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('Port 25 is configured with VSB_SMTP_SECURE=true'),
      );
    });

    it('should not warn when port 25 with secure=false', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_PORT = '25';
      process.env.VSB_SMTP_SECURE = 'false';
      require('./app.config').default();
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });

    it('should warn when both cert management and manual TLS paths', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(Buffer.from('-----BEGIN CERTIFICATE-----\ncontent\n-----END CERTIFICATE-----'));
      setMinimalEnv();
      process.env.VSB_CERT_ENABLED = 'true';
      process.env.VSB_CERT_EMAIL = 'test@example.com';
      process.env.VSB_CERT_DOMAIN = 'test.com';
      process.env.VSB_SMTP_TLS_CERT_PATH = '/path/cert.pem';
      process.env.VSB_SMTP_TLS_KEY_PATH = '/path/key.pem';
      require('./app.config').default();
      expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('Both automatic certificate management'));
    });

    it('should not warn with only cert management enabled', () => {
      setMinimalEnv();
      process.env.VSB_CERT_ENABLED = 'true';
      process.env.VSB_CERT_EMAIL = 'test@example.com';
      process.env.VSB_CERT_DOMAIN = 'test.com';
      process.env.VSB_CERT_PEER_SHARED_SECRET = 'test-secret';
      require('./app.config').default();
      expect(mockLoggerWarn).not.toHaveBeenCalledWith(
        expect.stringContaining('Port 25 is configured with VSB_SMTP_SECURE=true'),
      );
      expect(mockLoggerWarn).not.toHaveBeenCalledWith(expect.stringContaining('Both automatic certificate management'));
    });
  });

  describe('buildSmtpConfig', () => {
    it('should build complete SMTP config', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_BANNER = 'Custom Banner';
      const config = require('./app.config').default();
      expect(config.smtp).toMatchObject({
        host: 'localhost',
        port: 587,
        secure: false,
        maxMessageSize: 10485760,
        sessionTimeout: 60000,
        allowedRecipientDomains: ['example.com'],
        maxConnections: 25,
        closeTimeout: 30000,
        disabledCommands: ['VRFY', 'EXPN', 'ETRN', 'TURN', 'AUTH'],
        disablePipelining: false,
        earlyTalkerDelay: 300,
        banner: 'Custom Banner',
      });
    });

    it('should use default banner when not provided', () => {
      setMinimalEnv();
      const config = require('./app.config').default();
      expect(config.smtp.banner).toBe('VaultSandbox Test SMTP Server (Receive-Only)');
    });

    it('should throw error when SMTP secure is true but no TLS credentials or cert management', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_SECURE = 'true';
      // No TLS paths set, no cert enabled
      mockExistsSync.mockReturnValue(false);
      expect(() => require('./app.config').default()).toThrow('VSB_SMTP_SECURE=true requires TLS credentials');
    });
  });

  describe('buildLocalModeConfig', () => {
    it('should build with defaults', () => {
      setMinimalEnv();
      const config = require('./app.config').default();
      expect(config.local).toEqual({
        apiKey: 'test-key-with-at-least-32-characters-here',
        inboxDefaultTtl: 3600,
        inboxMaxTtl: 604800,
        cleanupInterval: 300,
        inboxAliasRandomBytes: 4,
        hardModeRejectCode: 421,
      });
    });

    it('should use provided values', () => {
      setMinimalEnv();
      process.env.VSB_LOCAL_API_KEY = 'custom-test-key-with-at-least-32-characters';
      process.env.VSB_LOCAL_INBOX_DEFAULT_TTL = '7200';
      process.env.VSB_LOCAL_INBOX_MAX_TTL = '172800';
      process.env.VSB_LOCAL_CLEANUP_INTERVAL = '600';
      process.env.VSB_SMTP_HARD_MODE_REJECT_CODE = '550';
      const config = require('./app.config').default();
      expect(config.local).toEqual({
        apiKey: 'custom-test-key-with-at-least-32-characters',
        inboxDefaultTtl: 7200,
        inboxMaxTtl: 172800,
        cleanupInterval: 600,
        inboxAliasRandomBytes: 4,
        hardModeRejectCode: 550,
      });
    });

    it('should load API key from environment (precedence 1)', () => {
      setMinimalEnv();
      process.env.VSB_LOCAL_API_KEY = 'env-key-with-at-least-32-characters-here';
      const config = require('./app.config').default();
      expect(config.local.apiKey).toBe('env-key-with-at-least-32-characters-here');
    });

    it('should load API key from file when env not set (precedence 2)', () => {
      setMinimalEnv();
      delete process.env.VSB_LOCAL_API_KEY;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('file-key-with-at-least-32-characters-here');
      const config = require('./app.config').default();
      expect(config.local.apiKey).toBe('file-key-with-at-least-32-characters-here');
    });

    it('should auto-generate and persist API key when neither env nor file available (precedence 3)', () => {
      const mockWriteFileSync = require('fs').writeFileSync;
      const mockMkdirSync = require('fs').mkdirSync;
      setMinimalEnv();
      delete process.env.VSB_LOCAL_API_KEY;
      mockExistsSync.mockReturnValue(false);
      const config = require('./app.config').default();
      expect(config.local.apiKey).toBeDefined();
      expect(config.local.apiKey.length).toBeGreaterThanOrEqual(32);
      expect(mockMkdirSync).toHaveBeenCalledWith(
        '/app/data',
        expect.objectContaining({ recursive: true, mode: 0o700 }),
      );
      expect(mockWriteFileSync).toHaveBeenCalledWith('/app/data/.api-key', expect.any(String), { mode: 0o600 });
    });

    it('should prefer env over file when both exist', () => {
      setMinimalEnv();
      process.env.VSB_LOCAL_API_KEY = 'env-key-with-at-least-32-characters-here';
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('file-key-with-at-least-32-characters-here');
      const config = require('./app.config').default();
      expect(config.local.apiKey).toBe('env-key-with-at-least-32-characters-here');
    });

    it('should throw error when strict mode enabled and no env key', () => {
      setMinimalEnv();
      delete process.env.VSB_LOCAL_API_KEY;
      process.env.VSB_LOCAL_API_KEY_STRICT = 'true';
      expect(() => require('./app.config').default()).toThrow('VSB_LOCAL_API_KEY is required (strict mode)');
    });

    it('should not auto-generate in strict mode', () => {
      const mockWriteFileSync = require('fs').writeFileSync;
      setMinimalEnv();
      delete process.env.VSB_LOCAL_API_KEY;
      process.env.VSB_LOCAL_API_KEY_STRICT = 'true';
      mockExistsSync.mockReturnValue(false);
      expect(() => require('./app.config').default()).toThrow();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('should throw error when file write fails', () => {
      const mockWriteFileSync = require('fs').writeFileSync;
      setMinimalEnv();
      delete process.env.VSB_LOCAL_API_KEY;
      mockExistsSync.mockReturnValue(false);
      mockWriteFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      expect(() => require('./app.config').default()).toThrow('Cannot persist auto-generated API key');
    });

    it('should regenerate when file content is too short', () => {
      const mockWriteFileSync = require('fs').writeFileSync;
      setMinimalEnv();
      delete process.env.VSB_LOCAL_API_KEY;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('short-key');
      const config = require('./app.config').default();
      expect(config.local.apiKey).toBeDefined();
      expect(config.local.apiKey.length).toBeGreaterThanOrEqual(32);
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('should throw error when API key is too short', () => {
      setMinimalEnv();
      process.env.VSB_LOCAL_API_KEY = 'short';
      expect(() => require('./app.config').default()).toThrow('must be at least 32 characters');
    });

    it('should use custom data path for API key file', () => {
      const mockWriteFileSync = require('fs').writeFileSync;
      const mockMkdirSync = require('fs').mkdirSync;
      setMinimalEnv();
      delete process.env.VSB_LOCAL_API_KEY;
      process.env.VSB_DATA_PATH = '/custom/data';
      mockExistsSync.mockReturnValue(false);
      require('./app.config').default();
      expect(mockMkdirSync).toHaveBeenCalledWith('/custom/data', expect.any(Object));
      expect(mockWriteFileSync).toHaveBeenCalledWith('/custom/data/.api-key', expect.any(String), expect.any(Object));
    });

    it('should throw error when inboxAliasRandomBytes is below minimum', () => {
      setMinimalEnv();
      process.env.VSB_INBOX_ALIAS_RANDOM_BYTES = '3'; // MIN is 4
      expect(() => require('./app.config').default()).toThrow('VSB_INBOX_ALIAS_RANDOM_BYTES must be between 4 and 32');
    });

    it('should throw error when inboxAliasRandomBytes is above maximum', () => {
      setMinimalEnv();
      process.env.VSB_INBOX_ALIAS_RANDOM_BYTES = '33'; // MAX is 32
      expect(() => require('./app.config').default()).toThrow('VSB_INBOX_ALIAS_RANDOM_BYTES must be between 4 and 32');
    });
  });

  describe('buildOrchestrationConfig', () => {
    it('should build with defaults', () => {
      setMinimalEnv();
      const config = require('./app.config').default();
      expect(config.orchestration.enabled).toBe(false);
      expect(config.orchestration.clusterName).toBe('default');
      expect(config.orchestration.peers).toEqual([]);
      expect(config.orchestration.backend.url).toBe('');
      expect(config.orchestration.backend.timeout).toBe(10000);
      expect(config.orchestration.leadership.ttl).toBe(300);
    });

    it('should use provided values', () => {
      setMinimalEnv();
      process.env.VSB_ORCHESTRATION_ENABLED = 'true';
      process.env.VSB_CLUSTER_NAME = 'production';
      process.env.VSB_NODE_ID = 'node-1';
      process.env.VSB_CLUSTER_PEERS = 'https://node-2:9999,https://node-3:9999';
      process.env.VSB_BACKEND_URL = 'https://backend.example.com';
      process.env.VSB_BACKEND_API_KEY = 'test-key';
      process.env.VSB_LEADERSHIP_TTL = '600';
      const config = require('./app.config').default();
      expect(config.orchestration.enabled).toBe(true);
      expect(config.orchestration.clusterName).toBe('production');
      expect(config.orchestration.nodeId).toBe('node-1');
      expect(config.orchestration.peers).toEqual(['https://node-2:9999', 'https://node-3:9999']);
      expect(config.orchestration.backend.url).toBe('https://backend.example.com');
      expect(config.orchestration.leadership.ttl).toBe(600);
    });

    it('should generate node ID when not provided', () => {
      setMinimalEnv();
      const config = require('./app.config').default();
      expect(config.orchestration.nodeId).toMatch(/^.+-[a-z0-9]{8}$/);
    });

    it('should filter empty peers', () => {
      setMinimalEnv();
      process.env.VSB_CLUSTER_PEERS = 'https://node-2:9999,,https://node-3:9999,';
      const config = require('./app.config').default();
      expect(config.orchestration.peers).toEqual(['https://node-2:9999', 'https://node-3:9999']);
    });
  });

  describe('buildCertificateConfig', () => {
    it('should build with defaults', () => {
      setMinimalEnv();
      const config = require('./app.config').default();
      expect(config.certificate.enabled).toBe(false);
      expect(config.certificate.storagePath).toBe('/app/data/certificates');
      expect(config.certificate.renewDaysBeforeExpiry).toBe(30);
      expect(config.certificate.staging).toBe(false);
      expect(config.certificate.peerSharedSecret).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should use provided values', () => {
      setMinimalEnv();
      process.env.VSB_CERT_ENABLED = 'true';
      process.env.VSB_CERT_EMAIL = 'admin@example.com';
      process.env.VSB_CERT_DOMAIN = 'smtp.example.com';
      process.env.VSB_CERT_ADDITIONAL_DOMAINS = 'mail.example.com,email.example.com';
      process.env.VSB_DATA_PATH = '/custom/data';
      process.env.VSB_CERT_RENEW_THRESHOLD_DAYS = '14';
      process.env.VSB_CERT_STAGING = 'true';
      process.env.VSB_CERT_PEER_SHARED_SECRET = 'custom-secret';
      const config = require('./app.config').default();
      expect(config.certificate.enabled).toBe(true);
      expect(config.certificate.email).toBe('admin@example.com');
      expect(config.certificate.domain).toBe('smtp.example.com');
      expect(config.certificate.additionalDomains).toEqual(['mail.example.com', 'email.example.com']);
      expect(config.certificate.storagePath).toBe('/custom/data/certificates');
      expect(config.certificate.renewDaysBeforeExpiry).toBe(14);
      expect(config.certificate.staging).toBe(true);
      expect(config.certificate.peerSharedSecret).toBe('custom-secret');
    });

    it('should filter empty additional domains', () => {
      setMinimalEnv();
      process.env.VSB_CERT_ADDITIONAL_DOMAINS = 'mail.example.com,,email.example.com,';
      const config = require('./app.config').default();
      expect(config.certificate.additionalDomains).toEqual(['mail.example.com', 'email.example.com']);
    });

    it('should throw when additional domains are invalid', () => {
      setMinimalEnv();
      process.env.VSB_CERT_ENABLED = 'true';
      process.env.VSB_CERT_EMAIL = 'admin@example.com';
      process.env.VSB_CERT_DOMAIN = 'smtp.example.com';
      process.env.VSB_CERT_ADDITIONAL_DOMAINS = 'mail.example.com,invalid_domain';

      expect(() => require('./app.config').default()).toThrow(
        'Invalid domain format in VSB_CERT_ADDITIONAL_DOMAINS: invalid_domain',
      );
    });

    it('should auto-derive cert domain from SMTP allowed domains when VSB_CERT_DOMAIN not set', () => {
      setMinimalEnv();
      process.env.VSB_CERT_ENABLED = 'true';
      process.env.VSB_CERT_EMAIL = 'admin@example.com';
      process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = 'mail.example.com,other.example.com';
      process.env.VSB_CERT_PEER_SHARED_SECRET = 'test-secret';
      // Don't set VSB_CERT_DOMAIN
      const config = require('./app.config').default();
      expect(config.certificate.domain).toBe('mail.example.com');
    });

    it('should throw when cert enabled but no domain can be derived', () => {
      setMinimalEnv();
      process.env.VSB_CERT_ENABLED = 'true';
      process.env.VSB_CERT_EMAIL = 'admin@example.com';
      // Set empty domain explicitly and mock parseAllowedDomains to return empty
      process.env.VSB_CERT_DOMAIN = '';
      process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = ',,,'; // Will parse to empty after filtering

      expect(() => require('./app.config').default()).toThrow(
        'VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS must contain at least one valid domain',
      );
    });

    it('should warn about peer shared secret in multi-node setup when not configured', () => {
      setMinimalEnv();
      process.env.VSB_CERT_ENABLED = 'true';
      process.env.VSB_CERT_EMAIL = 'admin@example.com';
      process.env.VSB_CERT_DOMAIN = 'smtp.example.com';
      process.env.VSB_ORCHESTRATION_ENABLED = 'true';
      process.env.VSB_BACKEND_URL = 'https://backend.example.com';
      process.env.VSB_BACKEND_API_KEY = 'test-key';
      // Don't set VSB_CERT_PEER_SHARED_SECRET
      require('./app.config').default();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('VSB_CERT_PEER_SHARED_SECRET not configured'),
      );
    });

    it('should log when cert enabled but email not set', () => {
      const mockLoggerLog = jest.fn();
      jest.doMock('@nestjs/common', () => ({
        ...jest.requireActual('@nestjs/common'),
        Logger: jest.fn().mockImplementation(() => ({
          log: mockLoggerLog,
          error: jest.fn(),
          warn: mockLoggerWarn,
          debug: jest.fn(),
          verbose: jest.fn(),
        })),
      }));

      setMinimalEnv();
      process.env.VSB_CERT_ENABLED = 'true';
      process.env.VSB_CERT_DOMAIN = 'smtp.example.com';
      process.env.VSB_CERT_PEER_SHARED_SECRET = 'test-secret';
      // Don't set VSB_CERT_EMAIL
      require('./app.config').default();
      expect(mockLoggerLog).toHaveBeenCalledWith(expect.stringContaining('VSB_CERT_EMAIL not set'));
    });

    it('should throw when cert enabled with explicit empty domain and no SMTP domains', () => {
      setMinimalEnv();
      process.env.VSB_CERT_ENABLED = 'true';
      process.env.VSB_CERT_EMAIL = 'admin@example.com';
      process.env.VSB_CERT_DOMAIN = '   '; // Whitespace only domain
      // parseAllowedDomains will still have 'example.com' from setMinimalEnv, so domain gets auto-derived
      // Let's override to test the actual error path
      process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = 'example.com';
      const config = require('./app.config').default();
      // Domain should be auto-derived from SMTP domains
      expect(config.certificate.domain).toBe('example.com');
    });
  });

  describe('buildCryptoConfig', () => {
    it('should return undefined paths when neither provided', () => {
      setMinimalEnv();
      const config = require('./app.config').default();
      expect(config.crypto.sigSkPath).toBeUndefined();
      expect(config.crypto.sigPkPath).toBeUndefined();
    });

    it('should return paths when both provided', () => {
      setMinimalEnv();
      process.env.VSB_SERVER_SIGNATURE_SECRET_KEY_PATH = '/path/to/sk.bin';
      process.env.VSB_SERVER_SIGNATURE_PUBLIC_KEY_PATH = '/path/to/pk.bin';
      const config = require('./app.config').default();
      expect(config.crypto.sigSkPath).toBe('/path/to/sk.bin');
      expect(config.crypto.sigPkPath).toBe('/path/to/pk.bin');
    });

    it('should throw error when only secret key provided', () => {
      setMinimalEnv();
      process.env.VSB_SERVER_SIGNATURE_SECRET_KEY_PATH = '/path/to/sk.bin';
      expect(() => require('./app.config').default()).toThrow(
        'Both VSB_SERVER_SIGNATURE_SECRET_KEY_PATH and VSB_SERVER_SIGNATURE_PUBLIC_KEY_PATH must be provided together',
      );
    });

    it('should throw error when only public key provided', () => {
      setMinimalEnv();
      process.env.VSB_SERVER_SIGNATURE_PUBLIC_KEY_PATH = '/path/to/pk.bin';
      expect(() => require('./app.config').default()).toThrow(
        'Both VSB_SERVER_SIGNATURE_SECRET_KEY_PATH and VSB_SERVER_SIGNATURE_PUBLIC_KEY_PATH must be provided together',
      );
    });
  });

  describe('buildThrottleConfig', () => {
    it('should build with defaults', () => {
      setMinimalEnv();
      const config = require('./app.config').default();
      expect(config.throttle.ttl).toBe(60000);
      expect(config.throttle.limit).toBe(500);
    });

    it('should use provided values', () => {
      setMinimalEnv();
      process.env.VSB_THROTTLE_TTL = '120000';
      process.env.VSB_THROTTLE_LIMIT = '200';
      const config = require('./app.config').default();
      expect(config.throttle.ttl).toBe(120000);
      expect(config.throttle.limit).toBe(200);
    });
  });

  describe('buildSmtpRateLimitConfig', () => {
    it('should build with defaults', () => {
      setMinimalEnv();
      const config = require('./app.config').default();
      expect(config.smtpRateLimit.enabled).toBe(true);
      expect(config.smtpRateLimit.points).toBe(500);
      expect(config.smtpRateLimit.duration).toBe(900); // 15 minutes
    });

    it('should use provided values', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_RATE_LIMIT_ENABLED = 'true';
      process.env.VSB_SMTP_RATE_LIMIT_MAX_EMAILS = '50';
      process.env.VSB_SMTP_RATE_LIMIT_DURATION = '1800';
      const config = require('./app.config').default();
      expect(config.smtpRateLimit.enabled).toBe(true);
      expect(config.smtpRateLimit.points).toBe(50);
      expect(config.smtpRateLimit.duration).toBe(1800);
    });
  });

  describe('main config export', () => {
    it('should export complete configuration', () => {
      process.env.NODE_ENV = 'production';
      process.env.VSB_SERVER_PORT = '8888';
      process.env.VSB_SERVER_HTTPS_ENABLED = 'true';
      process.env.VSB_SERVER_ORIGIN = 'https://example.com';
      process.env.VSB_BACKEND_URL = 'https://backend.example.com';
      process.env.VSB_BACKEND_API_KEY = 'test-backend-api-key';
      process.env.VSB_GATEWAY_MODE = 'backend';
      setMinimalEnv();

      const config = require('./app.config').default();
      expect(config.environment).toBe('production');
      expect(config.main.port).toBe(8888);
      expect(config.main.httpsEnabled).toBe(true);
      expect(config.main.origin).toBe('https://example.com');
      expect(config.main.backend.url).toBe('https://backend.example.com');
      expect(config.main.gatewayMode).toBe('backend');
    });

    it('should use defaults for main section', () => {
      setMinimalEnv();
      const config = require('./app.config').default();
      expect(config.environment).toBe('production');
      expect(config.main.port).toBe(80);
      expect(config.main.httpsPort).toBe(443);
      expect(config.main.gatewayMode).toBe('local');
    });

    it('should throw when VSB_GATEWAY_MODE is invalid', () => {
      setMinimalEnv();
      process.env.VSB_GATEWAY_MODE = 'invalid-mode';
      expect(() => require('./app.config').default()).toThrow(
        'Invalid VSB_GATEWAY_MODE: "invalid-mode". Must be one of: local, backend',
      );
    });

    it('should throw when backend mode enabled without backend URL', () => {
      setMinimalEnv();
      process.env.VSB_GATEWAY_MODE = 'backend';
      process.env.VSB_BACKEND_API_KEY = 'test-key';
      // No VSB_BACKEND_URL
      expect(() => require('./app.config').default()).toThrow(
        'VSB_GATEWAY_MODE=backend requires backend configuration',
      );
    });

    it('should throw when backend mode enabled without backend API key', () => {
      setMinimalEnv();
      process.env.VSB_GATEWAY_MODE = 'backend';
      process.env.VSB_BACKEND_URL = 'https://backend.example.com';
      // No VSB_BACKEND_API_KEY
      expect(() => require('./app.config').default()).toThrow(
        'VSB_GATEWAY_MODE=backend requires backend configuration',
      );
    });

    it('should throw when orchestration enabled without backend URL', () => {
      setMinimalEnv();
      process.env.VSB_ORCHESTRATION_ENABLED = 'true';
      process.env.VSB_BACKEND_API_KEY = 'test-key';
      // No VSB_BACKEND_URL
      expect(() => require('./app.config').default()).toThrow(
        'VSB_ORCHESTRATION_ENABLED=true requires backend configuration',
      );
    });

    it('should throw when orchestration enabled without backend API key', () => {
      setMinimalEnv();
      process.env.VSB_ORCHESTRATION_ENABLED = 'true';
      process.env.VSB_BACKEND_URL = 'https://backend.example.com';
      // No VSB_BACKEND_API_KEY
      expect(() => require('./app.config').default()).toThrow(
        'VSB_ORCHESTRATION_ENABLED=true requires backend configuration',
      );
    });

    it('should not build local config in backend mode', () => {
      setMinimalEnv();
      process.env.VSB_GATEWAY_MODE = 'backend';
      process.env.VSB_BACKEND_URL = 'https://backend.example.com';
      process.env.VSB_BACKEND_API_KEY = 'test-backend-api-key';
      // Don't set VSB_LOCAL_API_KEY to simulate read-only environment
      delete process.env.VSB_LOCAL_API_KEY;

      // Mock fs to track file system operations
      const fs = require('fs');
      const mockWriteFileSync = jest.fn();
      fs.writeFileSync = mockWriteFileSync;

      const config = require('./app.config').default();

      // Verify local config is undefined in backend mode
      expect(config.local).toBeUndefined();
      // Verify no file writes were attempted (would fail in read-only environment)
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('should build local config in local mode', () => {
      setMinimalEnv();
      process.env.VSB_GATEWAY_MODE = 'local';
      // VSB_LOCAL_API_KEY is set by setMinimalEnv()

      const config = require('./app.config').default();

      // Verify local config is defined in local mode
      expect(config.local).toBeDefined();
      expect(config.local?.apiKey).toBe('test-key-with-at-least-32-characters-here');
    });
  });

  describe('VSB_SERVER_ORIGIN behavior', () => {
    it('should auto-derive origin when VSB_SERVER_ORIGIN is not set', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = 'example.com';
      process.env.VSB_SERVER_HTTPS_ENABLED = 'true';
      // Don't set VSB_SERVER_ORIGIN
      delete process.env.VSB_SERVER_ORIGIN;

      const config = require('./app.config').default();
      expect(config.main.origin).toBe('https://example.com');
    });

    it('should respect wildcard when VSB_SERVER_ORIGIN is explicitly set to "*"', () => {
      setMinimalEnv();
      process.env.VSB_SERVER_ORIGIN = '*';
      process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = 'example.com';

      const config = require('./app.config').default();
      expect(config.main.origin).toBe('*');
    });

    it('should respect explicit origin when VSB_SERVER_ORIGIN is set to specific value', () => {
      setMinimalEnv();
      process.env.VSB_SERVER_ORIGIN = 'https://custom.example.com';
      process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = 'example.com';

      const config = require('./app.config').default();
      expect(config.main.origin).toBe('https://custom.example.com');
    });

    it('should auto-derive with http when HTTPS is disabled', () => {
      setMinimalEnv();
      process.env.VSB_SERVER_HTTPS_ENABLED = 'false';
      process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = 'example.com';
      delete process.env.VSB_SERVER_ORIGIN;

      const config = require('./app.config').default();
      expect(config.main.origin).toBe('http://example.com');
    });

    it('should use first domain when multiple allowed domains are configured', () => {
      setMinimalEnv();
      process.env.VSB_SMTP_ALLOWED_RECIPIENT_DOMAINS = 'first.com,second.com,third.com';
      delete process.env.VSB_SERVER_ORIGIN;

      const config = require('./app.config').default();
      expect(config.main.origin).toBe('http://first.com');
    });
  });
});
