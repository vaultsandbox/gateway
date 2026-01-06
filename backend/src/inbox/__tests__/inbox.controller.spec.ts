import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { InboxController } from '../inbox.controller';
import { InboxService } from '../inbox.service';
import { ApiKeyGuard } from '../guards/api-key.guard';
import { silenceNestLogger } from '../../../test/helpers/silence-logger';
import { Inbox } from '../interfaces';
import { CreateInboxDto } from '../dto/create-inbox.dto';

describe('InboxController', () => {
  let controller: InboxController;
  let inboxService: jest.Mocked<InboxService>;

  const restoreLogger = silenceNestLogger();
  afterAll(() => restoreLogger());

  function createMockInbox(emailAddress: string): Inbox {
    return {
      emailAddress,
      clientKemPk: 'mockKemPk',
      inboxHash: 'mockHash',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
      emails: new Map(),
      emailsHash: 'mockEmailsHash',
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InboxController],
      providers: [
        {
          provide: InboxService,
          useValue: {
            getServerInfo: jest.fn(),
            createInbox: jest.fn(),
            getInboxByEmail: jest.fn(),
            getEmails: jest.fn(),
            getEmail: jest.fn(),
            getRawEmail: jest.fn(),
            markEmailAsRead: jest.fn(),
            deleteInbox: jest.fn(),
            deleteEmail: jest.fn(),
            clearAllInboxes: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-api-key'),
          },
        },
        ApiKeyGuard,
      ],
    }).compile();

    controller = module.get<InboxController>(InboxController);
    inboxService = module.get(InboxService);
  });

  describe('getCheckKey', () => {
    it('should return ok: true', () => {
      const result = controller.getCheckKey();

      expect(result).toEqual({ ok: true });
    });
  });

  describe('getServerInfo', () => {
    it('should return server info from service', () => {
      const mockServerInfo = {
        serverSigPk: 'sigPk123',
        algs: {
          kem: 'ML-KEM-768' as const,
          sig: 'ML-DSA-65' as const,
          aead: 'AES-256-GCM' as const,
          kdf: 'HKDF-SHA-512' as const,
        },
        context: 'vaultsandbox:email:v1',
        maxTtl: 604800,
        defaultTtl: 3600,
        sseConsole: false,
        allowedDomains: ['test.com'],
      };
      inboxService.getServerInfo.mockReturnValue(mockServerInfo);

      const result = controller.getServerInfo();

      expect(result).toBe(mockServerInfo);
      expect(inboxService.getServerInfo).toHaveBeenCalled();
    });
  });

  describe('createInbox', () => {
    it('should create inbox and return response', () => {
      const dto: CreateInboxDto = {
        clientKemPk: 'validKemPk',
        ttl: 3600,
        emailAddress: 'test@example.com',
      };
      const mockInbox = createMockInbox('test@example.com');
      inboxService.createInbox.mockReturnValue({
        inbox: mockInbox,
        serverSigPk: 'serverSigPk123',
      });

      const result = controller.createInbox(dto);

      expect(result).toEqual({
        emailAddress: 'test@example.com',
        expiresAt: mockInbox.expiresAt.toISOString(),
        inboxHash: 'mockHash',
        serverSigPk: 'serverSigPk123',
      });
      expect(inboxService.createInbox).toHaveBeenCalledWith('validKemPk', 3600, 'test@example.com');
    });

    it('should create inbox without optional parameters', () => {
      const dto: CreateInboxDto = {
        clientKemPk: 'validKemPk',
      };
      const mockInbox = createMockInbox('generated@example.com');
      inboxService.createInbox.mockReturnValue({
        inbox: mockInbox,
        serverSigPk: 'serverSigPk123',
      });

      const result = controller.createInbox(dto);

      expect(result.emailAddress).toBe('generated@example.com');
      expect(inboxService.createInbox).toHaveBeenCalledWith('validKemPk', undefined, undefined);
    });
  });

  describe('listEmails', () => {
    it('should return emails when inbox exists', () => {
      const mockInbox = createMockInbox('test@example.com');
      const mockEmails = [
        {
          id: 'email1',
          encryptedMetadata: {
            v: 1 as const,
            algs: {} as never,
            ct_kem: '',
            nonce: '',
            aad: '',
            ciphertext: '',
            sig: '',
            server_sig_pk: '',
          },
          isRead: false,
        },
      ];
      inboxService.getInboxByEmail.mockReturnValue(mockInbox);
      inboxService.getEmails.mockReturnValue(mockEmails);

      const result = controller.listEmails('test@example.com', false);

      expect(result).toBe(mockEmails);
      expect(inboxService.getInboxByEmail).toHaveBeenCalledWith('test@example.com');
      expect(inboxService.getEmails).toHaveBeenCalledWith('test@example.com', false);
    });

    it('should return emails with content when includeContent is true', () => {
      const mockInbox = createMockInbox('test@example.com');
      const mockEmails = [
        {
          id: 'email1',
          encryptedMetadata: {
            v: 1 as const,
            algs: {} as never,
            ct_kem: '',
            nonce: '',
            aad: '',
            ciphertext: '',
            sig: '',
            server_sig_pk: '',
          },
          encryptedParsed: {
            v: 1 as const,
            algs: {} as never,
            ct_kem: '',
            nonce: '',
            aad: '',
            ciphertext: '',
            sig: '',
            server_sig_pk: '',
          },
          isRead: false,
        },
      ];
      inboxService.getInboxByEmail.mockReturnValue(mockInbox);
      inboxService.getEmails.mockReturnValue(mockEmails);

      const result = controller.listEmails('test@example.com', true);

      expect(result).toBe(mockEmails);
      expect(inboxService.getEmails).toHaveBeenCalledWith('test@example.com', true);
    });

    it('should throw NotFoundException when inbox does not exist', () => {
      inboxService.getInboxByEmail.mockReturnValue(undefined);

      expect(() => controller.listEmails('nonexistent@example.com')).toThrow(NotFoundException);
    });
  });

  describe('getInboxSyncStatus', () => {
    it('should return sync status when inbox exists', () => {
      const mockInbox = createMockInbox('test@example.com');
      mockInbox.emails.set('email1', {} as never);
      mockInbox.emails.set('email2', {} as never);
      inboxService.getInboxByEmail.mockReturnValue(mockInbox);

      const result = controller.getInboxSyncStatus('test@example.com');

      expect(result).toEqual({
        emailsHash: 'mockEmailsHash',
        emailCount: 2,
      });
    });

    it('should throw NotFoundException when inbox does not exist', () => {
      inboxService.getInboxByEmail.mockReturnValue(undefined);

      expect(() => controller.getInboxSyncStatus('nonexistent@example.com')).toThrow(NotFoundException);
    });
  });

  describe('getEmail', () => {
    it('should return email from service', () => {
      const mockEmail = {
        id: 'email1',
        encryptedMetadata: {
          v: 1 as const,
          algs: {} as never,
          ct_kem: '',
          nonce: '',
          aad: '',
          ciphertext: '',
          sig: '',
          server_sig_pk: '',
        },
        encryptedParsed: {
          v: 1 as const,
          algs: {} as never,
          ct_kem: '',
          nonce: '',
          aad: '',
          ciphertext: '',
          sig: '',
          server_sig_pk: '',
        },
        isRead: false,
      };
      inboxService.getEmail.mockReturnValue(mockEmail);

      const result = controller.getEmail('test@example.com', 'email1');

      expect(result).toBe(mockEmail);
      expect(inboxService.getEmail).toHaveBeenCalledWith('test@example.com', 'email1');
    });
  });

  describe('getRawEmail', () => {
    it('should return raw email from service', () => {
      const mockRawEmail = {
        id: 'email1',
        encryptedRaw: {
          v: 1 as const,
          algs: {} as never,
          ct_kem: '',
          nonce: '',
          aad: '',
          ciphertext: '',
          sig: '',
          server_sig_pk: '',
        },
      };
      inboxService.getRawEmail.mockReturnValue(mockRawEmail);

      const result = controller.getRawEmail('test@example.com', 'email1');

      expect(result).toBe(mockRawEmail);
      expect(inboxService.getRawEmail).toHaveBeenCalledWith('test@example.com', 'email1');
    });
  });

  describe('markEmailAsRead', () => {
    it('should call service and return void', () => {
      const result = controller.markEmailAsRead('test@example.com', 'email1');

      expect(result).toBeUndefined();
      expect(inboxService.markEmailAsRead).toHaveBeenCalledWith('test@example.com', 'email1');
    });
  });

  describe('deleteInbox', () => {
    it('should call service and return void', () => {
      inboxService.deleteInbox.mockReturnValue(true);

      const result = controller.deleteInbox('test@example.com');

      expect(result).toBeUndefined();
      expect(inboxService.deleteInbox).toHaveBeenCalledWith('test@example.com');
    });

    it('should return void even when inbox does not exist (idempotent)', () => {
      inboxService.deleteInbox.mockReturnValue(false);

      const result = controller.deleteInbox('nonexistent@example.com');

      expect(result).toBeUndefined();
    });
  });

  describe('deleteEmail', () => {
    it('should call service and return void', () => {
      inboxService.deleteEmail.mockReturnValue(true);

      const result = controller.deleteEmail('test@example.com', 'email1');

      expect(result).toBeUndefined();
      expect(inboxService.deleteEmail).toHaveBeenCalledWith('test@example.com', 'email1');
    });
  });

  describe('clearAllInboxes', () => {
    it('should return deleted count', () => {
      inboxService.clearAllInboxes.mockReturnValue(5);

      const result = controller.clearAllInboxes();

      expect(result).toEqual({ deleted: 5 });
      expect(inboxService.clearAllInboxes).toHaveBeenCalled();
    });

    it('should return zero when no inboxes exist', () => {
      inboxService.clearAllInboxes.mockReturnValue(0);

      const result = controller.clearAllInboxes();

      expect(result).toEqual({ deleted: 0 });
    });
  });
});
