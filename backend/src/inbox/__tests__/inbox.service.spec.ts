import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InboxService } from '../inbox.service';
import { InboxStorageService } from '../storage/inbox-storage.service';
import { MetricsService } from '../../metrics/metrics.service';
import { CryptoService } from '../../crypto/crypto.service';
import { METRIC_PATHS } from '../../metrics/metrics.constants';
import { silenceNestLogger } from '../../../test/helpers/silence-logger';
import { Inbox, EncryptedEmail } from '../interfaces';
import { EncryptedPayload } from '../../crypto/interfaces';

describe('InboxService', () => {
  let service: InboxService;
  let storageService: jest.Mocked<InboxStorageService>;
  let metricsService: jest.Mocked<MetricsService>;

  const restoreLogger = silenceNestLogger();
  afterAll(() => restoreLogger());

  // Valid ML-KEM-768 public key (1184 bytes encoded as base64url, ~1579 chars)
  const validClientKemPk = 'A'.repeat(1579);

  function createMockEncryptedPayload(): EncryptedPayload {
    return {
      v: 1,
      algs: { kem: 'ML-KEM-768', sig: 'ML-DSA-65', aead: 'AES-256-GCM', kdf: 'HKDF-SHA-512' },
      ct_kem: new Uint8Array([1, 2, 3]),
      nonce: new Uint8Array([4, 5, 6]),
      aad: new Uint8Array([7, 8, 9]),
      ciphertext: new Uint8Array([10, 11, 12]),
      sig: new Uint8Array([13, 14, 15]),
      server_sig_pk: new Uint8Array([16, 17, 18]),
    };
  }

  function createMockEmail(id: string, isRead = false): EncryptedEmail {
    return {
      id,
      encryptedMetadata: createMockEncryptedPayload(),
      encryptedParsed: createMockEncryptedPayload(),
      encryptedRaw: createMockEncryptedPayload(),
      isRead,
    };
  }

  function createMockInbox(emailAddress: string, clientKemPk = 'kemPk123'): Inbox {
    return {
      emailAddress,
      clientKemPk,
      inboxHash: 'hash123',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
      emails: new Map(),
      emailsHash: 'emailsHash123',
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboxService,
        {
          provide: InboxStorageService,
          useValue: {
            createInbox: jest.fn(),
            getInbox: jest.fn(),
            getInboxByHash: jest.fn(),
            listInboxHashes: jest.fn(),
            deleteInbox: jest.fn(),
            deleteEmail: jest.fn(),
            clearAllInboxes: jest.fn(),
            addEmail: jest.fn(),
            getEmails: jest.fn(),
            getEmail: jest.fn(),
            markEmailAsRead: jest.fn(),
            inboxExists: jest.fn(),
            getInboxCount: jest.fn(),
          },
        },
        {
          provide: CryptoService,
          useValue: {
            getServerSigningPublicKey: jest.fn().mockReturnValue('serverSigPk123'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue: unknown) => {
              const configMap: Record<string, unknown> = {
                'vsb.local.inboxDefaultTtl': 3600,
                'vsb.local.inboxMaxTtl': 604800,
                'vsb.sseConsole.enabled': false,
                'vsb.local.inboxAliasRandomBytes': 4,
                'vsb.smtp.allowedRecipientDomains': ['vaultsandbox.test', 'example.com'],
              };
              return configMap[key] ?? defaultValue;
            }),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            increment: jest.fn(),
            set: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<InboxService>(InboxService);
    storageService = module.get(InboxStorageService);
    metricsService = module.get(MetricsService);
  });

  describe('constructor', () => {
    it('should initialize with configured values', () => {
      expect(service).toBeDefined();
    });

    it('should handle non-finite aliasRandomBytes', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          InboxService,
          {
            provide: InboxStorageService,
            useValue: {
              createInbox: jest.fn(),
              getInbox: jest.fn(),
              getInboxByHash: jest.fn(),
              listInboxHashes: jest.fn(),
              deleteInbox: jest.fn(),
              deleteEmail: jest.fn(),
              clearAllInboxes: jest.fn(),
              addEmail: jest.fn(),
              getEmails: jest.fn(),
              getEmail: jest.fn(),
              markEmailAsRead: jest.fn(),
              inboxExists: jest.fn(),
              getInboxCount: jest.fn(),
            },
          },
          {
            provide: CryptoService,
            useValue: {
              getServerSigningPublicKey: jest.fn().mockReturnValue('serverSigPk123'),
            },
          },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue: unknown) => {
                if (key === 'vsb.local.inboxAliasRandomBytes') return NaN;
                if (key === 'vsb.smtp.allowedRecipientDomains') return ['vaultsandbox.test'];
                return defaultValue;
              }),
            },
          },
          {
            provide: MetricsService,
            useValue: {
              increment: jest.fn(),
              set: jest.fn(),
            },
          },
        ],
      }).compile();

      const testService = module.get<InboxService>(InboxService);
      expect(testService).toBeDefined();
    });

    it('should clamp aliasRandomBytes to minimum', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          InboxService,
          {
            provide: InboxStorageService,
            useValue: {
              createInbox: jest.fn(),
              getInbox: jest.fn(),
              getInboxByHash: jest.fn(),
              listInboxHashes: jest.fn(),
              deleteInbox: jest.fn(),
              deleteEmail: jest.fn(),
              clearAllInboxes: jest.fn(),
              addEmail: jest.fn(),
              getEmails: jest.fn(),
              getEmail: jest.fn(),
              markEmailAsRead: jest.fn(),
              inboxExists: jest.fn(),
              getInboxCount: jest.fn(),
            },
          },
          {
            provide: CryptoService,
            useValue: {
              getServerSigningPublicKey: jest.fn().mockReturnValue('serverSigPk123'),
            },
          },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue: unknown) => {
                if (key === 'vsb.local.inboxAliasRandomBytes') return 1; // Below minimum of 4
                if (key === 'vsb.smtp.allowedRecipientDomains') return ['vaultsandbox.test'];
                return defaultValue;
              }),
            },
          },
          {
            provide: MetricsService,
            useValue: {
              increment: jest.fn(),
              set: jest.fn(),
            },
          },
        ],
      }).compile();

      const testService = module.get<InboxService>(InboxService);
      expect(testService).toBeDefined();
    });

    it('should clamp aliasRandomBytes to maximum', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          InboxService,
          {
            provide: InboxStorageService,
            useValue: {
              createInbox: jest.fn(),
              getInbox: jest.fn(),
              getInboxByHash: jest.fn(),
              listInboxHashes: jest.fn(),
              deleteInbox: jest.fn(),
              deleteEmail: jest.fn(),
              clearAllInboxes: jest.fn(),
              addEmail: jest.fn(),
              getEmails: jest.fn(),
              getEmail: jest.fn(),
              markEmailAsRead: jest.fn(),
              inboxExists: jest.fn(),
              getInboxCount: jest.fn(),
            },
          },
          {
            provide: CryptoService,
            useValue: {
              getServerSigningPublicKey: jest.fn().mockReturnValue('serverSigPk123'),
            },
          },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultValue: unknown) => {
                if (key === 'vsb.local.inboxAliasRandomBytes') return 100; // Above maximum of 32
                if (key === 'vsb.smtp.allowedRecipientDomains') return ['vaultsandbox.test'];
                return defaultValue;
              }),
            },
          },
          {
            provide: MetricsService,
            useValue: {
              increment: jest.fn(),
              set: jest.fn(),
            },
          },
        ],
      }).compile();

      const testService = module.get<InboxService>(InboxService);
      expect(testService).toBeDefined();
    });
  });

  describe('createInbox', () => {
    beforeEach(() => {
      storageService.inboxExists.mockReturnValue(false);
      storageService.getInboxCount.mockReturnValue(1);
      storageService.createInbox.mockImplementation((email, kemPk) => createMockInbox(email, kemPk));
    });

    it('should create inbox with default TTL when not specified', () => {
      const result = service.createInbox(validClientKemPk);

      expect(storageService.createInbox).toHaveBeenCalled();
      expect(result.inbox).toBeDefined();
      expect(result.serverSigPk).toBe('serverSigPk123');
      expect(metricsService.increment).toHaveBeenCalledWith(METRIC_PATHS.INBOX_CREATED_TOTAL);
    });

    it('should create inbox with custom TTL', () => {
      const result = service.createInbox(validClientKemPk, 7200);

      expect(storageService.createInbox).toHaveBeenCalled();
      expect(result.inbox).toBeDefined();
    });

    it('should create inbox with specified email address', () => {
      service.createInbox(validClientKemPk, undefined, 'test@vaultsandbox.test');

      expect(storageService.createInbox).toHaveBeenCalledWith(
        'test@vaultsandbox.test',
        validClientKemPk,
        expect.any(Date),
        expect.any(String),
      );
    });

    it('should throw BadRequestException for invalid base64url clientKemPk', () => {
      expect(() => service.createInbox('invalid+key/with=chars')).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for clientKemPk that is too short', () => {
      const shortKey = 'A'.repeat(100); // Way too short for ML-KEM-768
      expect(() => service.createInbox(shortKey)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for clientKemPk that is too long', () => {
      const longKey = 'A'.repeat(2000); // Too long
      expect(() => service.createInbox(longKey)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for TTL less than 60 seconds', () => {
      expect(() => service.createInbox(validClientKemPk, 30)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for TTL exceeding max', () => {
      expect(() => service.createInbox(validClientKemPk, 999999999)).toThrow(BadRequestException);
    });

    it('should handle email address collision with retry', () => {
      storageService.inboxExists
        .mockReturnValueOnce(true) // First collision (while loop check)
        .mockReturnValueOnce(false) // Second attempt succeeds (while loop check)
        .mockReturnValueOnce(false); // Final safety check after while loop

      const result = service.createInbox(validClientKemPk, undefined, 'test@vaultsandbox.test');

      expect(result.inbox).toBeDefined();
      // 3 calls: initial while check (true), retry while check (false), final safety check (false)
      expect(storageService.inboxExists).toHaveBeenCalledTimes(3);
    });

    it('should throw InternalServerErrorException after max collision retries', () => {
      storageService.inboxExists.mockReturnValue(true); // Always collide

      expect(() => service.createInbox(validClientKemPk, undefined, 'test@vaultsandbox.test')).toThrow(
        InternalServerErrorException,
      );
    });

    it('should handle domain-only input', () => {
      service.createInbox(validClientKemPk, undefined, 'vaultsandbox.test');

      expect(storageService.createInbox).toHaveBeenCalledWith(
        expect.stringMatching(/@vaultsandbox\.test$/),
        validClientKemPk,
        expect.any(Date),
        expect.any(String),
      );
    });

    it('should throw BadRequestException for disallowed domain in email', () => {
      expect(() => service.createInbox(validClientKemPk, undefined, 'test@disallowed-domain.com')).toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for disallowed domain-only input', () => {
      expect(() => service.createInbox(validClientKemPk, undefined, 'disallowed-domain.com')).toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for multiple plus signs in email', () => {
      expect(() => service.createInbox(validClientKemPk, undefined, 'test+one+two@vaultsandbox.test')).toThrow(
        BadRequestException,
      );
    });

    it('should strip +tag from email address (auto-aliasing)', () => {
      service.createInbox(validClientKemPk, undefined, 'test+tag@vaultsandbox.test');

      expect(storageService.createInbox).toHaveBeenCalledWith(
        'test@vaultsandbox.test',
        validClientKemPk,
        expect.any(Date),
        expect.any(String),
      );
    });

    it('should throw BadRequestException for invalid local part with special chars', () => {
      expect(() => service.createInbox(validClientKemPk, undefined, 'test!special@vaultsandbox.test')).toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for local part with consecutive dots', () => {
      expect(() => service.createInbox(validClientKemPk, undefined, 'test..double@vaultsandbox.test')).toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for local part starting with dot', () => {
      expect(() => service.createInbox(validClientKemPk, undefined, '.startdot@vaultsandbox.test')).toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for local part ending with dot', () => {
      expect(() => service.createInbox(validClientKemPk, undefined, 'enddot.@vaultsandbox.test')).toThrow(
        BadRequestException,
      );
    });

    it('should allow valid local part with dots, hyphens, and underscores', () => {
      service.createInbox(validClientKemPk, undefined, 'test.user-name_123@vaultsandbox.test');

      expect(storageService.createInbox).toHaveBeenCalledWith(
        'test.user-name_123@vaultsandbox.test',
        validClientKemPk,
        expect.any(Date),
        expect.any(String),
      );
    });

    it('should normalize email to lowercase', () => {
      service.createInbox(validClientKemPk, undefined, 'TEST@VAULTSANDBOX.TEST');

      expect(storageService.createInbox).toHaveBeenCalledWith(
        'test@vaultsandbox.test',
        validClientKemPk,
        expect.any(Date),
        expect.any(String),
      );
    });

    it('should use null TTL as default', () => {
      const result = service.createInbox(validClientKemPk, null as unknown as number);

      expect(result.inbox).toBeDefined();
    });
  });

  describe('getInboxByEmail', () => {
    it('should return inbox when found', () => {
      const mockInbox = createMockInbox('test@example.com');
      storageService.getInbox.mockReturnValue(mockInbox);

      const result = service.getInboxByEmail('test@example.com');

      expect(result).toBe(mockInbox);
    });

    it('should return undefined when not found', () => {
      storageService.getInbox.mockReturnValue(undefined);

      const result = service.getInboxByEmail('nonexistent@example.com');

      expect(result).toBeUndefined();
    });
  });

  describe('getInboxByHash', () => {
    it('should return inbox when found', () => {
      const mockInbox = createMockInbox('test@example.com');
      storageService.getInboxByHash.mockReturnValue(mockInbox);

      const result = service.getInboxByHash('hash123');

      expect(result).toBe(mockInbox);
    });

    it('should return undefined when not found', () => {
      storageService.getInboxByHash.mockReturnValue(undefined);

      const result = service.getInboxByHash('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  describe('listInboxHashes', () => {
    it('should return list of inbox hashes', () => {
      storageService.listInboxHashes.mockReturnValue(['hash1', 'hash2', 'hash3']);

      const result = service.listInboxHashes();

      expect(result).toEqual(['hash1', 'hash2', 'hash3']);
    });
  });

  describe('deleteInbox', () => {
    it('should delete inbox and update metrics when inbox exists and is deleted', () => {
      const mockInbox = createMockInbox('test@example.com');
      storageService.getInbox.mockReturnValue(mockInbox);
      storageService.deleteInbox.mockReturnValue(true);
      storageService.getInboxCount.mockReturnValue(0);

      const result = service.deleteInbox('test@example.com');

      expect(result).toBe(true);
      expect(metricsService.increment).toHaveBeenCalledWith(METRIC_PATHS.INBOX_DELETED_TOTAL);
      expect(metricsService.set).toHaveBeenCalledWith(METRIC_PATHS.INBOX_ACTIVE_TOTAL, 0);
    });

    it('should not update metrics when inbox does not exist', () => {
      storageService.getInbox.mockReturnValue(undefined);
      storageService.deleteInbox.mockReturnValue(false);

      const result = service.deleteInbox('nonexistent@example.com');

      expect(result).toBe(false);
      expect(metricsService.increment).not.toHaveBeenCalled();
    });

    it('should not update metrics when delete returns false', () => {
      const mockInbox = createMockInbox('test@example.com');
      storageService.getInbox.mockReturnValue(mockInbox);
      storageService.deleteInbox.mockReturnValue(false);

      const result = service.deleteInbox('test@example.com');

      expect(result).toBe(false);
      expect(metricsService.increment).not.toHaveBeenCalled();
    });
  });

  describe('deleteEmail', () => {
    it('should delegate to storage service', () => {
      storageService.deleteEmail.mockReturnValue(true);

      const result = service.deleteEmail('test@example.com', 'email123');

      expect(result).toBe(true);
      expect(storageService.deleteEmail).toHaveBeenCalledWith('test@example.com', 'email123');
    });
  });

  describe('clearAllInboxes', () => {
    it('should clear all inboxes and update metrics when inboxes exist', () => {
      storageService.clearAllInboxes.mockReturnValue(5);
      storageService.getInboxCount.mockReturnValue(0);

      const result = service.clearAllInboxes();

      expect(result).toBe(5);
      expect(metricsService.increment).toHaveBeenCalledWith(METRIC_PATHS.INBOX_DELETED_TOTAL, 5);
      expect(metricsService.set).toHaveBeenCalledWith(METRIC_PATHS.INBOX_ACTIVE_TOTAL, 0);
    });

    it('should not increment deleted metric when no inboxes cleared', () => {
      storageService.clearAllInboxes.mockReturnValue(0);
      storageService.getInboxCount.mockReturnValue(0);

      const result = service.clearAllInboxes();

      expect(result).toBe(0);
      expect(metricsService.increment).not.toHaveBeenCalled();
      expect(metricsService.set).toHaveBeenCalledWith(METRIC_PATHS.INBOX_ACTIVE_TOTAL, 0);
    });
  });

  describe('addEmail', () => {
    it('should delegate to storage service', () => {
      const email = createMockEmail('email123');

      service.addEmail('test@example.com', email);

      expect(storageService.addEmail).toHaveBeenCalledWith('test@example.com', email);
    });
  });

  describe('getEmails', () => {
    it('should return serialized emails without content by default', () => {
      const email = createMockEmail('email123');
      storageService.getEmails.mockReturnValue([email]);

      const result = service.getEmails('test@example.com');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('email123');
      expect(result[0].encryptedMetadata).toBeDefined();
      expect(result[0].encryptedMetadata.v).toBe(1);
      expect(result[0].encryptedParsed).toBeUndefined();
    });

    it('should include content when includeContent is true', () => {
      const email = createMockEmail('email123');
      storageService.getEmails.mockReturnValue([email]);

      const result = service.getEmails('test@example.com', true);

      expect(result).toHaveLength(1);
      expect(result[0].encryptedParsed).toBeDefined();
    });
  });

  describe('getEmail', () => {
    it('should return serialized email', () => {
      const email = createMockEmail('email123', true);
      storageService.getEmail.mockReturnValue(email);

      const result = service.getEmail('test@example.com', 'email123');

      expect(result.id).toBe('email123');
      expect(result.isRead).toBe(true);
      expect(result.encryptedMetadata).toBeDefined();
      expect(result.encryptedParsed).toBeDefined();
    });
  });

  describe('getRawEmail', () => {
    it('should return serialized raw email', () => {
      const email = createMockEmail('email123');
      storageService.getEmail.mockReturnValue(email);

      const result = service.getRawEmail('test@example.com', 'email123');

      expect(result.id).toBe('email123');
      expect(result.encryptedRaw).toBeDefined();
    });
  });

  describe('markEmailAsRead', () => {
    it('should delegate to storage service', () => {
      service.markEmailAsRead('test@example.com', 'email123');

      expect(storageService.markEmailAsRead).toHaveBeenCalledWith('test@example.com', 'email123');
    });
  });

  describe('getServerInfo', () => {
    it('should return server info with all fields', () => {
      const result = service.getServerInfo();

      expect(result).toEqual({
        serverSigPk: 'serverSigPk123',
        algs: {
          kem: 'ML-KEM-768',
          sig: 'ML-DSA-65',
          aead: 'AES-256-GCM',
          kdf: 'HKDF-SHA-512',
        },
        context: 'vaultsandbox:email:v1',
        maxTtl: 604800,
        defaultTtl: 3600,
        sseConsole: false,
        allowedDomains: ['vaultsandbox.test', 'example.com'],
      });
    });
  });
});
