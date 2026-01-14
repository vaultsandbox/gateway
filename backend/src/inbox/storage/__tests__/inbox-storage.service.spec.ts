import { ConflictException, NotFoundException } from '@nestjs/common';
import { InboxStorageService } from '../inbox-storage.service';
import { silenceNestLogger } from '../../../../test/helpers/silence-logger';
import { EncryptedStoredEmail } from '../../interfaces';

describe('InboxStorageService', () => {
  let service: InboxStorageService;
  const restoreLogger = silenceNestLogger();

  afterAll(() => restoreLogger());

  beforeEach(() => {
    service = new InboxStorageService();
  });

  function createMockEmail(id: string, isRead = false): EncryptedStoredEmail {
    return {
      id,
      encryptedMetadata: { ciphertext: 'meta', nonce: 'n', kemCiphertext: 'k' },
      encryptedParsed: { ciphertext: 'parsed', nonce: 'n', kemCiphertext: 'k' },
      encryptedRaw: { ciphertext: 'raw', nonce: 'n', kemCiphertext: 'k' },
      isRead,
    };
  }

  describe('createInbox', () => {
    it('should create an inbox with normalized email address', () => {
      const inbox = service.createInbox('TEST@Example.com', 'clientKemPk123', new Date('2025-01-01'), 'hash123');

      expect(inbox.emailAddress).toBe('test@example.com');
      expect(inbox.clientKemPk).toBe('clientKemPk123');
      expect(inbox.inboxHash).toBe('hash123');
      expect(inbox.expiresAt).toEqual(new Date('2025-01-01'));
      expect(inbox.emails).toBeInstanceOf(Map);
      expect(inbox.emails.size).toBe(0);
      expect(inbox.emailsHash).toBeDefined();
    });

    it('should throw ConflictException for duplicate inboxHash', () => {
      service.createInbox('user1@test.com', 'kem1', new Date('2025-01-01'), 'sameHash');

      expect(() => service.createInbox('user2@test.com', 'kem2', new Date('2025-01-01'), 'sameHash')).toThrow(
        ConflictException,
      );
    });

    it('should calculate emailsHash on creation', () => {
      const inbox = service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');

      // Empty inbox should still have a consistent hash
      expect(inbox.emailsHash).toBeDefined();
      expect(typeof inbox.emailsHash).toBe('string');
    });
  });

  describe('getInbox', () => {
    it('should get inbox by email address', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');

      const inbox = service.getInbox('user@test.com');

      expect(inbox).toBeDefined();
      expect(inbox?.emailAddress).toBe('user@test.com');
    });

    it('should return undefined for non-existent inbox', () => {
      const inbox = service.getInbox('nonexistent@test.com');

      expect(inbox).toBeUndefined();
    });

    it('should perform case-insensitive lookup', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');

      const inbox = service.getInbox('USER@TEST.COM');

      expect(inbox).toBeDefined();
      expect(inbox?.emailAddress).toBe('user@test.com');
    });
  });

  describe('getAllInboxes', () => {
    it('should return all inboxes', () => {
      service.createInbox('user1@test.com', 'kem1', new Date('2025-01-01'), 'hash1');
      service.createInbox('user2@test.com', 'kem2', new Date('2025-01-01'), 'hash2');

      const inboxes = service.getAllInboxes();

      expect(inboxes).toHaveLength(2);
    });

    it('should return empty array when no inboxes', () => {
      const inboxes = service.getAllInboxes();

      expect(inboxes).toEqual([]);
    });
  });

  describe('setEmailStorageService', () => {
    it('should set the email storage service reference', () => {
      const mockEmailStorageService = {
        onInboxDeleted: jest.fn(),
        onEmailDeleted: jest.fn(),
      };

      service.setEmailStorageService(mockEmailStorageService);

      // Verify it was set by triggering a deletion
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');
      service.deleteInbox('user@test.com');

      expect(mockEmailStorageService.onInboxDeleted).toHaveBeenCalledWith('user@test.com');
    });
  });

  describe('deleteInbox', () => {
    it('should delete existing inbox', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');

      const result = service.deleteInbox('user@test.com');

      expect(result).toBe(true);
      expect(service.getInbox('user@test.com')).toBeUndefined();
    });

    it('should return true for already deleted inbox', () => {
      const result = service.deleteInbox('nonexistent@test.com');

      expect(result).toBe(true);
    });

    it('should perform case-insensitive deletion', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');

      const result = service.deleteInbox('USER@TEST.COM');

      expect(result).toBe(true);
      expect(service.getInbox('user@test.com')).toBeUndefined();
    });

    it('should remove inboxHash mapping when deleted', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');
      service.deleteInbox('user@test.com');

      // Should be able to create new inbox with same hash
      expect(() => service.createInbox('user2@test.com', 'kem2', new Date('2025-01-01'), 'hash1')).not.toThrow();
    });

    it('should notify EmailStorageService when available', () => {
      const mockEmailStorageService = {
        onInboxDeleted: jest.fn(),
        onEmailDeleted: jest.fn(),
      };
      service.setEmailStorageService(mockEmailStorageService);
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');

      service.deleteInbox('user@test.com');

      expect(mockEmailStorageService.onInboxDeleted).toHaveBeenCalledWith('user@test.com');
    });

    it('should not notify EmailStorageService when not set', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');

      // Should not throw even without EmailStorageService
      expect(() => service.deleteInbox('user@test.com')).not.toThrow();
    });
  });

  describe('deleteEmail', () => {
    it('should delete existing email', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');
      service.addEmail('user@test.com', createMockEmail('email1'));

      const result = service.deleteEmail('user@test.com', 'email1');

      expect(result).toBe(true);
    });

    it('should throw NotFoundException when inbox not found', () => {
      expect(() => service.deleteEmail('nonexistent@test.com', 'email1')).toThrow(NotFoundException);
    });

    it('should throw NotFoundException when email not found', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');

      expect(() => service.deleteEmail('user@test.com', 'nonexistent')).toThrow(NotFoundException);
    });

    it('should update emailsHash after deletion', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');
      service.addEmail('user@test.com', createMockEmail('email1'));
      const hashBefore = service.getInbox('user@test.com')?.emailsHash;

      service.deleteEmail('user@test.com', 'email1');

      const hashAfter = service.getInbox('user@test.com')?.emailsHash;
      expect(hashAfter).not.toBe(hashBefore);
    });

    it('should notify EmailStorageService when available', () => {
      const mockEmailStorageService = {
        onInboxDeleted: jest.fn(),
        onEmailDeleted: jest.fn(),
      };
      service.setEmailStorageService(mockEmailStorageService);
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');
      service.addEmail('user@test.com', createMockEmail('email1'));

      service.deleteEmail('user@test.com', 'email1');

      expect(mockEmailStorageService.onEmailDeleted).toHaveBeenCalledWith('user@test.com', 'email1');
    });
  });

  describe('evictEmail', () => {
    it('should evict existing email without throwing', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');
      service.addEmail('user@test.com', createMockEmail('email1'));

      expect(() => service.evictEmail('user@test.com', 'email1')).not.toThrow();
      expect(service.getInbox('user@test.com')?.emails.has('email1')).toBe(false);
    });

    it('should not throw when inbox not found', () => {
      expect(() => service.evictEmail('nonexistent@test.com', 'email1')).not.toThrow();
    });

    it('should not throw when email not found', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');

      expect(() => service.evictEmail('user@test.com', 'nonexistent')).not.toThrow();
    });

    it('should update emailsHash when email is removed', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');
      service.addEmail('user@test.com', createMockEmail('email1'));
      const hashBefore = service.getInbox('user@test.com')?.emailsHash;

      service.evictEmail('user@test.com', 'email1');

      const hashAfter = service.getInbox('user@test.com')?.emailsHash;
      expect(hashAfter).not.toBe(hashBefore);
    });
  });

  describe('addEmail', () => {
    it('should add email to inbox', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');
      const email = createMockEmail('email1');

      service.addEmail('user@test.com', email);

      const inbox = service.getInbox('user@test.com');
      expect(inbox?.emails.get('email1')).toEqual(email);
    });

    it('should throw NotFoundException when inbox not found', () => {
      expect(() => service.addEmail('nonexistent@test.com', createMockEmail('email1'))).toThrow(NotFoundException);
    });

    it('should perform case-insensitive email lookup', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');

      service.addEmail('USER@TEST.COM', createMockEmail('email1'));

      expect(service.getInbox('user@test.com')?.emails.has('email1')).toBe(true);
    });

    it('should update emailsHash after adding email', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');
      const hashBefore = service.getInbox('user@test.com')?.emailsHash;

      service.addEmail('user@test.com', createMockEmail('email1'));

      const hashAfter = service.getInbox('user@test.com')?.emailsHash;
      expect(hashAfter).not.toBe(hashBefore);
    });
  });

  describe('getEmails', () => {
    it('should return emails in reverse order (newest first)', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');
      service.addEmail('user@test.com', createMockEmail('email1'));
      service.addEmail('user@test.com', createMockEmail('email2'));
      service.addEmail('user@test.com', createMockEmail('email3'));

      const emails = service.getEmails('user@test.com');

      expect(emails.map((e) => e.id)).toEqual(['email3', 'email2', 'email1']);
    });

    it('should throw NotFoundException when inbox not found', () => {
      expect(() => service.getEmails('nonexistent@test.com')).toThrow(NotFoundException);
    });

    it('should return empty array for inbox with no emails', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');

      const emails = service.getEmails('user@test.com');

      expect(emails).toEqual([]);
    });
  });

  describe('getEmail', () => {
    it('should get specific email', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');
      const mockEmail = createMockEmail('email1');
      service.addEmail('user@test.com', mockEmail);

      const email = service.getEmail('user@test.com', 'email1');

      expect(email).toEqual(mockEmail);
    });

    it('should throw NotFoundException when inbox not found', () => {
      expect(() => service.getEmail('nonexistent@test.com', 'email1')).toThrow(NotFoundException);
    });

    it('should throw NotFoundException when email not found', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');

      expect(() => service.getEmail('user@test.com', 'nonexistent')).toThrow(NotFoundException);
    });
  });

  describe('markEmailAsRead', () => {
    it('should mark email as read', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');
      service.addEmail('user@test.com', createMockEmail('email1', false));

      service.markEmailAsRead('user@test.com', 'email1');

      const email = service.getEmail('user@test.com', 'email1');
      expect(email.isRead).toBe(true);
    });

    it('should throw NotFoundException when inbox not found', () => {
      expect(() => service.markEmailAsRead('nonexistent@test.com', 'email1')).toThrow(NotFoundException);
    });

    it('should throw NotFoundException when email not found', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');

      expect(() => service.markEmailAsRead('user@test.com', 'nonexistent')).toThrow(NotFoundException);
    });
  });

  describe('inboxExists', () => {
    it('should return true for existing inbox', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');

      expect(service.inboxExists('user@test.com')).toBe(true);
    });

    it('should return false for non-existing inbox', () => {
      expect(service.inboxExists('nonexistent@test.com')).toBe(false);
    });

    it('should perform case-insensitive check', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');

      expect(service.inboxExists('USER@TEST.COM')).toBe(true);
    });
  });

  describe('getInboxByHash', () => {
    it('should get inbox by hash', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash123');

      const inbox = service.getInboxByHash('hash123');

      expect(inbox).toBeDefined();
      expect(inbox?.emailAddress).toBe('user@test.com');
    });

    it('should return undefined for non-existing hash', () => {
      const inbox = service.getInboxByHash('nonexistent');

      expect(inbox).toBeUndefined();
    });
  });

  describe('listInboxHashes', () => {
    it('should return all inbox hashes', () => {
      service.createInbox('user1@test.com', 'kem1', new Date('2025-01-01'), 'hash1');
      service.createInbox('user2@test.com', 'kem2', new Date('2025-01-01'), 'hash2');

      const hashes = service.listInboxHashes();

      expect(hashes).toContain('hash1');
      expect(hashes).toContain('hash2');
      expect(hashes).toHaveLength(2);
    });

    it('should return empty array when no inboxes', () => {
      const hashes = service.listInboxHashes();

      expect(hashes).toEqual([]);
    });
  });

  describe('getInboxCount', () => {
    it('should return correct inbox count', () => {
      expect(service.getInboxCount()).toBe(0);

      service.createInbox('user1@test.com', 'kem1', new Date('2025-01-01'), 'hash1');
      expect(service.getInboxCount()).toBe(1);

      service.createInbox('user2@test.com', 'kem2', new Date('2025-01-01'), 'hash2');
      expect(service.getInboxCount()).toBe(2);
    });
  });

  describe('getTotalEmailCount', () => {
    it('should return total email count across all inboxes', () => {
      service.createInbox('user1@test.com', 'kem1', new Date('2025-01-01'), 'hash1');
      service.createInbox('user2@test.com', 'kem2', new Date('2025-01-01'), 'hash2');
      service.addEmail('user1@test.com', createMockEmail('email1'));
      service.addEmail('user1@test.com', createMockEmail('email2'));
      service.addEmail('user2@test.com', createMockEmail('email3'));

      expect(service.getTotalEmailCount()).toBe(3);
    });

    it('should return 0 when no inboxes', () => {
      expect(service.getTotalEmailCount()).toBe(0);
    });

    it('should return 0 when inboxes have no emails', () => {
      service.createInbox('user@test.com', 'kem', new Date('2025-01-01'), 'hash1');

      expect(service.getTotalEmailCount()).toBe(0);
    });
  });

  describe('clearAllInboxes', () => {
    it('should clear all inboxes and return count', () => {
      service.createInbox('user1@test.com', 'kem1', new Date('2025-01-01'), 'hash1');
      service.createInbox('user2@test.com', 'kem2', new Date('2025-01-01'), 'hash2');

      const count = service.clearAllInboxes();

      expect(count).toBe(2);
      expect(service.getInboxCount()).toBe(0);
      expect(service.listInboxHashes()).toEqual([]);
    });

    it('should notify EmailStorageService for each inbox', () => {
      const mockEmailStorageService = {
        onInboxDeleted: jest.fn(),
        onEmailDeleted: jest.fn(),
      };
      service.setEmailStorageService(mockEmailStorageService);
      service.createInbox('user1@test.com', 'kem1', new Date('2025-01-01'), 'hash1');
      service.createInbox('user2@test.com', 'kem2', new Date('2025-01-01'), 'hash2');

      service.clearAllInboxes();

      expect(mockEmailStorageService.onInboxDeleted).toHaveBeenCalledTimes(2);
      expect(mockEmailStorageService.onInboxDeleted).toHaveBeenCalledWith('user1@test.com');
      expect(mockEmailStorageService.onInboxDeleted).toHaveBeenCalledWith('user2@test.com');
    });

    it('should return 0 when no inboxes to clear', () => {
      const count = service.clearAllInboxes();

      expect(count).toBe(0);
    });
  });
});
