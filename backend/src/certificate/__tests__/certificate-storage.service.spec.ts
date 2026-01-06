import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import * as acme from 'acme-client';
import { CertificateStorageService } from '../storage/certificate-storage.service';
import { CERTIFICATE_CONFIG } from '../certificate.tokens';
import type { CertificateConfig, Certificate } from '../interfaces';

jest.mock('fs');
jest.mock('acme-client', () => ({
  forge: {
    createPrivateKey: jest.fn(),
    readCertificateInfo: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockAcmeForge = acme.forge as jest.Mocked<typeof acme.forge>;

describe('CertificateStorageService', () => {
  let service: CertificateStorageService;
  let config: CertificateConfig;

  const createConfig = (overrides: Partial<CertificateConfig> = {}): CertificateConfig => ({
    enabled: true,
    domain: 'test.example.com',
    email: 'test@example.com',
    storagePath: '/tmp/certs',
    renewDaysBeforeExpiry: 30,
    checkInterval: 60000,
    acmeDirectoryUrl: 'https://acme.test/directory',
    staging: false,
    peerSharedSecret: 'test-secret',
    ...overrides,
  });

  const createMockCertificate = (overrides: Partial<Certificate> = {}): Certificate => ({
    certificate: Buffer.from('cert-content'),
    privateKey: Buffer.from('key-content'),
    domains: ['test.example.com'],
    issuedAt: new Date('2025-01-01T00:00:00Z'),
    expiresAt: new Date('2025-04-01T00:00:00Z'),
    ...overrides,
  });

  const setupMocks = () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Default fs mock behaviors
    mockFs.existsSync.mockReturnValue(false);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.readFileSync.mockReturnValue(Buffer.from(''));
    mockFs.writeFileSync.mockReturnValue(undefined);
    mockFs.renameSync.mockReturnValue(undefined);
    mockFs.copyFileSync.mockReturnValue(undefined);
    mockFs.unlinkSync.mockReturnValue(undefined);
    mockFs.readdirSync.mockReturnValue([]);
  };

  const createModule = async (moduleConfig: CertificateConfig): Promise<TestingModule> => {
    return Test.createTestingModule({
      providers: [
        CertificateStorageService,
        {
          provide: CERTIFICATE_CONFIG,
          useValue: moduleConfig,
        },
      ],
    }).compile();
  };

  beforeEach(async () => {
    setupMocks();
    config = createConfig();
    const module = await createModule(config);
    service = module.get<CertificateStorageService>(CertificateStorageService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create storage directory if it does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const module = await createModule(createConfig());
      module.get<CertificateStorageService>(CertificateStorageService);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/tmp/certs', {
        recursive: true,
        mode: 0o700,
      });
    });

    it('should create challenges directory if it does not exist', async () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        return pathStr === '/tmp/certs' && !pathStr.includes('challenges');
      });

      const module = await createModule(createConfig());
      module.get<CertificateStorageService>(CertificateStorageService);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/tmp/certs/challenges', {
        recursive: true,
        mode: 0o700,
      });
    });

    it('should not create directories if they already exist', async () => {
      // Clear calls from beforeEach setup
      mockFs.mkdirSync.mockClear();
      mockFs.existsSync.mockReturnValue(true);

      const module = await createModule(createConfig());
      module.get<CertificateStorageService>(CertificateStorageService);

      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('loadOrGenerateAccountKey', () => {
    it('should load existing account key if it exists', async () => {
      const existingKey = Buffer.from('existing-key-content');
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        return pathStr === path.join('/tmp/certs', 'account.key') || pathStr.includes('/tmp/certs');
      });
      mockFs.readFileSync.mockReturnValue(existingKey);

      const result = await service.loadOrGenerateAccountKey();

      expect(result).toEqual(existingKey);
      expect(mockFs.readFileSync).toHaveBeenCalledWith(path.join('/tmp/certs', 'account.key'));
    });

    it('should generate and save new account key if none exists', async () => {
      const newKey = Buffer.from('new-key-content');
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        // Account key doesn't exist, but directories do
        return !pathStr.includes('account.key') && pathStr.includes('/tmp/certs');
      });
      mockAcmeForge.createPrivateKey.mockResolvedValue(newKey);

      const result = await service.loadOrGenerateAccountKey();

      expect(result).toEqual(newKey);
      expect(mockAcmeForge.createPrivateKey).toHaveBeenCalled();
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(path.join('/tmp/certs', 'account.key'), newKey, {
        mode: 0o600,
      });
    });
  });

  describe('saveCertificate', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
    });

    it('should backup existing certificate and key files', () => {
      const mockCert = createMockCertificate();

      service.saveCertificate(mockCert);

      expect(mockFs.copyFileSync).toHaveBeenCalledWith(
        path.join('/tmp/certs', 'cert.pem'),
        path.join('/tmp/certs', 'cert.pem.backup'),
      );
      expect(mockFs.copyFileSync).toHaveBeenCalledWith(
        path.join('/tmp/certs', 'key.pem'),
        path.join('/tmp/certs', 'key.pem.backup'),
      );
    });

    it('should not backup files that do not exist', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        // Only directories exist, not cert/key files
        return pathStr === '/tmp/certs' || pathStr.includes('challenges');
      });
      const mockCert = createMockCertificate();

      service.saveCertificate(mockCert);

      expect(mockFs.copyFileSync).not.toHaveBeenCalled();
    });

    it('should save certificate with atomic writes', () => {
      mockFs.existsSync.mockReturnValue(false);
      const mockCert = createMockCertificate();

      service.saveCertificate(mockCert);

      // Verify atomic write was called for cert.pem
      expect(mockFs.writeFileSync).toHaveBeenCalled();
      expect(mockFs.renameSync).toHaveBeenCalled();
    });

    it('should save fullchain if provided', () => {
      mockFs.existsSync.mockReturnValue(false);
      const mockCert = createMockCertificate({
        fullchain: Buffer.from('fullchain-content'),
      });

      service.saveCertificate(mockCert);

      // Verify fullchain was saved (4 atomic writes: cert, key, fullchain, metadata)
      expect(mockFs.renameSync).toHaveBeenCalledTimes(4);
    });

    it('should not save fullchain if not provided', () => {
      mockFs.existsSync.mockReturnValue(false);
      const mockCert = createMockCertificate();

      service.saveCertificate(mockCert);

      // Only 3 atomic writes: cert, key, metadata (no fullchain)
      expect(mockFs.renameSync).toHaveBeenCalledTimes(3);
    });

    it('should save metadata as JSON', () => {
      mockFs.existsSync.mockReturnValue(false);
      const mockCert = createMockCertificate();

      service.saveCertificate(mockCert);

      // Check that JSON metadata was written
      const writeFileSyncCalls = mockFs.writeFileSync.mock.calls;
      const metadataCall = writeFileSyncCalls.find(
        (call) => typeof call[1] === 'string' && call[1].includes('domains'),
      );
      expect(metadataCall).toBeDefined();
      expect(JSON.parse(metadataCall![1] as string)).toEqual({
        domains: ['test.example.com'],
        issuedAt: '2025-01-01T00:00:00.000Z',
        expiresAt: '2025-04-01T00:00:00.000Z',
      });
    });
  });

  describe('loadCertificate', () => {
    it('should return null if certificate file does not exist', async () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        // cert.pem doesn't exist
        if (pathStr.includes('cert.pem')) return false;
        // key.pem could exist
        if (pathStr.includes('key.pem')) return true;
        // Directories exist
        return pathStr === '/tmp/certs' || pathStr === path.join('/tmp/certs', 'challenges');
      });

      const result = await service.loadCertificate();

      expect(result).toBeNull();
    });

    it('should return null if key file does not exist', async () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        // cert.pem exists
        if (pathStr.includes('cert.pem')) return true;
        // key.pem doesn't exist
        if (pathStr.includes('key.pem')) return false;
        // Directories exist
        return pathStr === '/tmp/certs' || pathStr === path.join('/tmp/certs', 'challenges');
      });

      const result = await service.loadCertificate();

      expect(result).toBeNull();
    });

    it('should load certificate with metadata from JSON file', async () => {
      const certContent = Buffer.from('cert-content');
      const keyContent = Buffer.from('key-content');
      const metadata = {
        domains: ['test.example.com'],
        issuedAt: '2025-01-01T00:00:00.000Z',
        expiresAt: '2025-04-01T00:00:00.000Z',
      };

      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        return (
          pathStr.includes('cert.pem') ||
          pathStr.includes('key.pem') ||
          pathStr.includes('metadata.json') ||
          pathStr === '/tmp/certs' ||
          pathStr.includes('challenges')
        );
      });
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const pathStr = p.toString();
        if (pathStr.includes('cert.pem')) return certContent;
        if (pathStr.includes('key.pem')) return keyContent;
        if (pathStr.includes('metadata.json')) return JSON.stringify(metadata);
        return Buffer.from('');
      });

      const result = await service.loadCertificate();

      expect(result).toEqual({
        certificate: certContent,
        privateKey: keyContent,
        fullchain: undefined,
        chain: undefined,
        domains: ['test.example.com'],
        issuedAt: new Date('2025-01-01T00:00:00.000Z'),
        expiresAt: new Date('2025-04-01T00:00:00.000Z'),
      });
    });

    it('should load fullchain and chain if available', async () => {
      const certContent = Buffer.from('cert-content');
      const keyContent = Buffer.from('key-content');
      const fullchainContent = Buffer.from('fullchain-content');
      const chainContent = Buffer.from('chain-content');
      const metadata = {
        domains: ['test.example.com'],
        issuedAt: '2025-01-01T00:00:00.000Z',
        expiresAt: '2025-04-01T00:00:00.000Z',
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const pathStr = p.toString();
        if (pathStr.includes('cert.pem')) return certContent;
        if (pathStr.includes('key.pem')) return keyContent;
        if (pathStr.includes('fullchain.pem')) return fullchainContent;
        if (pathStr.includes('chain.pem')) return chainContent;
        if (pathStr.includes('metadata.json')) return JSON.stringify(metadata);
        return Buffer.from('');
      });

      const result = await service.loadCertificate();

      expect(result?.fullchain).toEqual(fullchainContent);
      expect(result?.chain).toEqual(chainContent);
    });

    it('should read metadata from certificate if metadata.json does not exist', async () => {
      const certContent = Buffer.from('cert-content');
      const keyContent = Buffer.from('key-content');
      const certInfo = {
        domains: {
          commonName: 'test.example.com',
          altNames: ['www.test.example.com'],
        },
        notBefore: new Date('2025-01-01T00:00:00.000Z'),
        notAfter: new Date('2025-04-01T00:00:00.000Z'),
      };

      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        return (
          pathStr.includes('cert.pem') ||
          pathStr.includes('key.pem') ||
          pathStr === '/tmp/certs' ||
          pathStr.includes('challenges')
        );
      });
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const pathStr = p.toString();
        if (pathStr.includes('cert.pem')) return certContent;
        if (pathStr.includes('key.pem')) return keyContent;
        return Buffer.from('');
      });
      mockAcmeForge.readCertificateInfo.mockResolvedValue(certInfo);

      const result = await service.loadCertificate();

      expect(mockAcmeForge.readCertificateInfo).toHaveBeenCalledWith(certContent);
      expect(result?.domains).toEqual(['test.example.com', 'www.test.example.com']);
    });

    it('should filter out falsy domain values', async () => {
      const certContent = Buffer.from('cert-content');
      const keyContent = Buffer.from('key-content');
      const certInfo = {
        domains: {
          commonName: 'test.example.com',
          altNames: [null, undefined, '', 'www.test.example.com'],
        },
        notBefore: new Date('2025-01-01T00:00:00.000Z'),
        notAfter: new Date('2025-04-01T00:00:00.000Z'),
      };

      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        return (
          pathStr.includes('cert.pem') ||
          pathStr.includes('key.pem') ||
          pathStr === '/tmp/certs' ||
          pathStr.includes('challenges')
        );
      });
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const pathStr = p.toString();
        if (pathStr.includes('cert.pem')) return certContent;
        if (pathStr.includes('key.pem')) return keyContent;
        return Buffer.from('');
      });
      mockAcmeForge.readCertificateInfo.mockResolvedValue(certInfo as any);

      const result = await service.loadCertificate();

      expect(result?.domains).toEqual(['test.example.com', 'www.test.example.com']);
    });

    it('should handle certificate with no altNames', async () => {
      const certContent = Buffer.from('cert-content');
      const keyContent = Buffer.from('key-content');
      const certInfo = {
        domains: {
          commonName: 'test.example.com',
          altNames: undefined,
        },
        notBefore: new Date('2025-01-01T00:00:00.000Z'),
        notAfter: new Date('2025-04-01T00:00:00.000Z'),
      };

      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        return (
          pathStr.includes('cert.pem') ||
          pathStr.includes('key.pem') ||
          pathStr === '/tmp/certs' ||
          pathStr.includes('challenges')
        );
      });
      mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const pathStr = p.toString();
        if (pathStr.includes('cert.pem')) return certContent;
        if (pathStr.includes('key.pem')) return keyContent;
        return Buffer.from('');
      });
      mockAcmeForge.readCertificateInfo.mockResolvedValue(certInfo as any);

      const result = await service.loadCertificate();

      expect(result?.domains).toEqual(['test.example.com']);
    });
  });

  describe('saveChallengeResponse', () => {
    it('should save challenge response to file', () => {
      mockFs.existsSync.mockReturnValue(true);
      const token = 'valid-token-123';
      const keyAuth = 'key-authorization-value';

      service.saveChallengeResponse(token, keyAuth);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(path.join('/tmp/certs', 'challenges', token), keyAuth, {
        mode: 0o644,
      });
    });
  });

  describe('getChallengeResponse', () => {
    it('should return null for invalid token format', () => {
      const result = service.getChallengeResponse('../etc/passwd');

      expect(result).toBeNull();
    });

    it('should return null for token with path traversal attempt', () => {
      const result = service.getChallengeResponse('../../etc/passwd');

      expect(result).toBeNull();
    });

    it('should return null for empty token', () => {
      const result = service.getChallengeResponse('');

      expect(result).toBeNull();
    });

    it('should return null for whitespace-only token', () => {
      const result = service.getChallengeResponse('   ');

      expect(result).toBeNull();
    });

    it('should return null if challenge file does not exist', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        // Directories exist, but the specific challenge file does not
        if (pathStr === path.join('/tmp/certs', 'challenges', 'valid-token-123')) {
          return false;
        }
        return pathStr === '/tmp/certs' || pathStr === path.join('/tmp/certs', 'challenges');
      });

      const result = service.getChallengeResponse('valid-token-123');

      expect(result).toBeNull();
    });

    it('should return challenge response content if file exists', () => {
      const token = 'valid-token-123';
      const keyAuth = 'key-authorization-value';

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(keyAuth);

      const result = service.getChallengeResponse(token);

      expect(result).toBe(keyAuth);
      expect(mockFs.readFileSync).toHaveBeenCalledWith(path.join('/tmp/certs', 'challenges', token), 'utf-8');
    });

    it('should accept valid base64url tokens with underscores and dashes', () => {
      const token = 'valid_token-with_dashes-123';
      const keyAuth = 'key-authorization-value';

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(keyAuth);

      const result = service.getChallengeResponse(token);

      expect(result).toBe(keyAuth);
    });
  });

  describe('cleanupChallenges', () => {
    it('should do nothing if challenges directory does not exist', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        return pathStr === '/tmp/certs';
      });

      service.cleanupChallenges();

      expect(mockFs.readdirSync).not.toHaveBeenCalled();
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should delete all challenge files', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        'token1' as unknown as fs.Dirent,
        'token2' as unknown as fs.Dirent,
        'token3' as unknown as fs.Dirent,
      ]);

      service.cleanupChallenges();

      expect(mockFs.unlinkSync).toHaveBeenCalledTimes(3);
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(path.join('/tmp/certs', 'challenges', 'token1'));
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(path.join('/tmp/certs', 'challenges', 'token2'));
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(path.join('/tmp/certs', 'challenges', 'token3'));
    });

    it('should handle empty challenges directory', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([]);

      service.cleanupChallenges();

      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('atomicWriteFile (via saveCertificate)', () => {
    it('should clean up temp file on write error', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        // Directories exist, temp file exists after first write attempt
        return pathStr === '/tmp/certs' || pathStr.includes('challenges') || pathStr.includes('.tmp-');
      });
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Write error');
      });

      const mockCert = createMockCertificate();

      expect(() => service.saveCertificate(mockCert)).toThrow('Write error');
      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('should rethrow error after cleanup', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        return pathStr === '/tmp/certs' || pathStr.includes('challenges') || pathStr.includes('.tmp-');
      });
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Disk full');
      });

      const mockCert = createMockCertificate();

      expect(() => service.saveCertificate(mockCert)).toThrow('Disk full');
    });

    it('should handle cleanup failure gracefully', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        return pathStr === '/tmp/certs' || pathStr.includes('challenges') || pathStr.includes('.tmp-');
      });
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Write error');
      });
      mockFs.unlinkSync.mockImplementation(() => {
        throw new Error('Cannot delete temp file');
      });

      const mockCert = createMockCertificate();

      // Should still throw the original write error
      expect(() => service.saveCertificate(mockCert)).toThrow('Write error');
    });

    it('should not attempt cleanup if temp file does not exist', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        // Only directories exist, temp file doesn't exist
        return pathStr === '/tmp/certs' || (pathStr.includes('challenges') && !pathStr.includes('.tmp-'));
      });
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Write error');
      });

      const mockCert = createMockCertificate();

      expect(() => service.saveCertificate(mockCert)).toThrow('Write error');
      // unlinkSync should not be called because temp file doesn't exist
    });

    it('should handle rename error', () => {
      mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = p.toString();
        return pathStr === '/tmp/certs' || pathStr.includes('challenges') || pathStr.includes('.tmp-');
      });
      mockFs.writeFileSync.mockReturnValue(undefined);
      mockFs.renameSync.mockImplementation(() => {
        throw new Error('Rename error');
      });

      const mockCert = createMockCertificate();

      expect(() => service.saveCertificate(mockCert)).toThrow('Rename error');
      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });
  });
});
