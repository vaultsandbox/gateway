import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailStorageService } from '../email-storage.service';
import { InboxStorageService } from '../../../inbox/storage/inbox-storage.service';
import type { EncryptedPayload } from '../../../crypto/interfaces';

// Helper to create mock encrypted payloads of a specific size
function createMockPayloads(size: number = 1000): {
  encryptedMetadata: EncryptedPayload;
  encryptedParsed: EncryptedPayload;
  encryptedRaw: EncryptedPayload;
} {
  // Each payload has 6 Uint8Array fields plus ~100 bytes overhead
  // Total size = 3 * (sum of field lengths + 100)
  // To get a specific total size, we divide by 3 and subtract overhead
  const perPayloadSize = Math.floor(size / 3) - 100;
  const fieldSize = Math.max(1, Math.floor(perPayloadSize / 6));

  const createPayload = (): EncryptedPayload => ({
    ct_kem: new Uint8Array(fieldSize),
    nonce: new Uint8Array(fieldSize),
    aad: new Uint8Array(fieldSize),
    ciphertext: new Uint8Array(fieldSize),
    sig: new Uint8Array(fieldSize),
    server_sig_pk: new Uint8Array(fieldSize),
  });

  return {
    encryptedMetadata: createPayload(),
    encryptedParsed: createPayload(),
    encryptedRaw: createPayload(),
  };
}

describe('EmailStorageService', () => {
  let service: EmailStorageService;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockInboxStorageService: jest.Mocked<InboxStorageService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'vsb.smtp.maxMemoryMB') return defaultValue ?? 500;
        if (key === 'vsb.smtp.maxEmailAgeSeconds') return defaultValue ?? 0;
        return defaultValue;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    mockInboxStorageService = {
      setEmailStorageService: jest.fn(),
      addEmail: jest.fn(),
      getInbox: jest.fn(),
      evictEmail: jest.fn(),
    } as unknown as jest.Mocked<InboxStorageService>;

    service = new EmailStorageService(mockConfigService, mockInboxStorageService);
  });

  describe('constructor', () => {
    it('initializes with default memory limit of 500MB', () => {
      const metrics = service.getMetrics();
      expect(metrics.storage.maxMemoryMB).toBe('500.00');
    });

    it('initializes with custom memory limit from config', () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'vsb.smtp.maxMemoryMB') return 100;
        if (key === 'vsb.smtp.maxEmailAgeSeconds') return 0;
        return defaultValue;
      });

      const customService = new EmailStorageService(mockConfigService, mockInboxStorageService);
      const metrics = customService.getMetrics();
      expect(metrics.storage.maxMemoryMB).toBe('100.00');
    });

    it('registers with InboxStorageService', () => {
      expect(mockInboxStorageService.setEmailStorageService).toHaveBeenCalledWith(service);
    });

    it('initializes with max age disabled by default', () => {
      const metrics = service.getMetrics();
      expect(metrics.eviction.maxAgeEnabled).toBe(false);
      expect(metrics.eviction.maxAgeSeconds).toBeNull();
    });

    it('initializes with max age enabled when configured', () => {
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'vsb.smtp.maxMemoryMB') return 500;
        if (key === 'vsb.smtp.maxEmailAgeSeconds') return 3600;
        return defaultValue;
      });

      const customService = new EmailStorageService(mockConfigService, mockInboxStorageService);
      const metrics = customService.getMetrics();
      expect(metrics.eviction.maxAgeEnabled).toBe(true);
      expect(metrics.eviction.maxAgeSeconds).toBe(3600);
    });
  });

  describe('storeEmail', () => {
    it('stores an email and returns the email ID', () => {
      const payloads = createMockPayloads(1000);
      const result = service.storeEmail('test@example.com', 'email-123', payloads);

      expect(result).toBe('email-123');
      expect(mockInboxStorageService.addEmail).toHaveBeenCalledWith('test@example.com', {
        id: 'email-123',
        encryptedMetadata: payloads.encryptedMetadata,
        encryptedParsed: payloads.encryptedParsed,
        encryptedRaw: payloads.encryptedRaw,
        isRead: false,
      });
    });

    it('tracks memory usage after storing email', () => {
      const payloads = createMockPayloads(1000);
      service.storeEmail('test@example.com', 'email-123', payloads);

      const metrics = service.getMetrics();
      expect(metrics.storage.usedMemoryBytes).toBeGreaterThan(0);
      expect(metrics.emails.totalStored).toBe(1);
    });

    it('stores multiple emails and tracks all of them', () => {
      const payloads1 = createMockPayloads(1000);
      const payloads2 = createMockPayloads(2000);

      service.storeEmail('test@example.com', 'email-1', payloads1);
      service.storeEmail('test@example.com', 'email-2', payloads2);

      const metrics = service.getMetrics();
      expect(metrics.emails.totalStored).toBe(2);
    });

    it('rejects email that exceeds max memory limit', () => {
      // Set a small memory limit
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'vsb.smtp.maxMemoryMB') return 0.001; // ~1KB
        if (key === 'vsb.smtp.maxEmailAgeSeconds') return 0;
        return defaultValue;
      });

      const smallLimitService = new EmailStorageService(mockConfigService, mockInboxStorageService);
      const payloads = createMockPayloads(10000); // 10KB

      expect(() => smallLimitService.storeEmail('test@example.com', 'email-123', payloads)).toThrow(
        /exceeds max memory limit/,
      );
    });
  });

  describe('eviction', () => {
    let smallMemoryService: EmailStorageService;

    beforeEach(() => {
      // Create a service with ~5KB memory limit (0.005 MB = 5242 bytes)
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'vsb.smtp.maxMemoryMB') return 0.005;
        if (key === 'vsb.smtp.maxEmailAgeSeconds') return 0;
        return defaultValue;
      });

      smallMemoryService = new EmailStorageService(mockConfigService, mockInboxStorageService);
    });

    it('evicts oldest emails when memory limit is reached', () => {
      // Mock getInbox to return an inbox with emails
      const mockInbox = {
        emails: new Map([['email-1', { id: 'email-1' }]]),
      };
      mockInboxStorageService.getInbox.mockReturnValue(mockInbox as never);

      // Store first email (~3KB, should fit in 5KB limit)
      const payloads1 = createMockPayloads(3000);
      smallMemoryService.storeEmail('test@example.com', 'email-1', payloads1);

      // Store second email (~3KB, total ~6KB > 5KB limit, should trigger eviction)
      const payloads2 = createMockPayloads(3000);
      mockInbox.emails.set('email-2', { id: 'email-2' } as never);
      smallMemoryService.storeEmail('test@example.com', 'email-2', payloads2);

      // Should have evicted oldest email
      expect(mockInboxStorageService.evictEmail).toHaveBeenCalled();
    });

    it('handles missing inbox during eviction gracefully', () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      mockInboxStorageService.getInbox.mockReturnValue(undefined);

      // Store first email (~3KB)
      const payloads1 = createMockPayloads(3000);
      smallMemoryService.storeEmail('test@example.com', 'email-1', payloads1);

      // Store second email (~3KB, triggers eviction)
      const payloads2 = createMockPayloads(3000);
      smallMemoryService.storeEmail('test@example.com', 'email-2', payloads2);

      // Should not throw, should mark as tombstone anyway
      const metrics = smallMemoryService.getMetrics();
      expect(metrics.emails.totalEvicted).toBeGreaterThan(0);
      warnSpy.mockRestore();
    });

    it('handles missing email during eviction gracefully', () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const mockInbox = {
        emails: new Map(), // Empty - email not found
      };
      mockInboxStorageService.getInbox.mockReturnValue(mockInbox as never);

      // Store first email (~3KB)
      const payloads1 = createMockPayloads(3000);
      smallMemoryService.storeEmail('test@example.com', 'email-1', payloads1);

      // Store second email (~3KB, triggers eviction)
      const payloads2 = createMockPayloads(3000);
      smallMemoryService.storeEmail('test@example.com', 'email-2', payloads2);

      // Should not throw, should mark as tombstone anyway
      const metrics = smallMemoryService.getMetrics();
      expect(metrics.emails.totalEvicted).toBeGreaterThan(0);
      warnSpy.mockRestore();
    });

    it('handles exception during eviction gracefully', () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      mockInboxStorageService.getInbox.mockImplementation(() => {
        throw new Error('Test error');
      });

      // Store first email (~3KB)
      const payloads1 = createMockPayloads(3000);
      smallMemoryService.storeEmail('test@example.com', 'email-1', payloads1);

      // Store second email (~3KB, triggers eviction)
      const payloads2 = createMockPayloads(3000);
      smallMemoryService.storeEmail('test@example.com', 'email-2', payloads2);

      // Should not throw, should mark as tombstone anyway
      const metrics = smallMemoryService.getMetrics();
      expect(metrics.emails.totalEvicted).toBeGreaterThan(0);
      errorSpy.mockRestore();
    });
  });

  describe('getMetrics', () => {
    it('returns correct initial metrics', () => {
      const metrics = service.getMetrics();

      expect(metrics.storage.usedMemoryBytes).toBe(0);
      expect(metrics.storage.usedMemoryMB).toBe('0.00');
      expect(parseFloat(metrics.storage.utilizationPercent)).toBe(0);
      expect(metrics.emails.totalStored).toBe(0);
      expect(metrics.emails.totalEvicted).toBe(0);
      expect(metrics.emails.tombstones).toBe(0);
      expect(metrics.emails.oldestEmailAge).toBeNull();
      expect(metrics.emails.newestEmailAge).toBeNull();
    });

    it('returns correct metrics after storing emails', () => {
      const payloads = createMockPayloads(1000);
      service.storeEmail('test@example.com', 'email-1', payloads);

      const metrics = service.getMetrics();
      expect(metrics.emails.totalStored).toBe(1);
      expect(metrics.storage.usedMemoryBytes).toBeGreaterThan(0);
      expect(metrics.emails.oldestEmailAge).not.toBeNull();
      expect(metrics.emails.newestEmailAge).not.toBeNull();
    });

    it('calculates available memory correctly', () => {
      const payloads = createMockPayloads(1000);
      service.storeEmail('test@example.com', 'email-1', payloads);

      const metrics = service.getMetrics();
      expect(metrics.storage.availableMemoryBytes).toBe(
        metrics.storage.maxMemoryBytes - metrics.storage.usedMemoryBytes,
      );
    });
  });

  describe('compactStorage', () => {
    it('removes tombstone entries from tracking', () => {
      // Set small memory to force eviction (~3KB limit)
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'vsb.smtp.maxMemoryMB') return 0.003;
        if (key === 'vsb.smtp.maxEmailAgeSeconds') return 0;
        return defaultValue;
      });

      const smallService = new EmailStorageService(mockConfigService, mockInboxStorageService);

      // Mock inbox to allow eviction
      const mockInbox = {
        emails: new Map([['email-1', { id: 'email-1' }]]),
      };
      mockInboxStorageService.getInbox.mockReturnValue(mockInbox as never);

      // Store first email (~2KB)
      const payloads1 = createMockPayloads(2000);
      smallService.storeEmail('test@example.com', 'email-1', payloads1);

      // Store second email (~2KB, triggers eviction of first)
      const payloads2 = createMockPayloads(2000);
      mockInbox.emails.set('email-2', { id: 'email-2' } as never);
      smallService.storeEmail('test@example.com', 'email-2', payloads2);

      // Verify we have tombstones
      const beforeMetrics = smallService.getMetrics();
      expect(beforeMetrics.emails.tombstones).toBeGreaterThan(0);

      // Run compaction
      smallService.compactStorage();

      // Tombstones should be removed
      const afterMetrics = smallService.getMetrics();
      expect(afterMetrics.emails.tombstones).toBe(0);
    });

    it('does nothing when there are no tombstones', () => {
      const payloads = createMockPayloads(1000);
      service.storeEmail('test@example.com', 'email-1', payloads);

      const beforeMetrics = service.getMetrics();
      service.compactStorage();
      const afterMetrics = service.getMetrics();

      expect(beforeMetrics.emails.totalStored).toBe(afterMetrics.emails.totalStored);
    });
  });

  describe('evictStaleEmails', () => {
    it('does nothing when max age is disabled', () => {
      const payloads = createMockPayloads(1000);
      service.storeEmail('test@example.com', 'email-1', payloads);

      service.evictStaleEmails();

      const metrics = service.getMetrics();
      expect(metrics.emails.totalEvicted).toBe(0);
    });

    it('evicts emails older than max age', () => {
      // Enable max age
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'vsb.smtp.maxMemoryMB') return 500;
        if (key === 'vsb.smtp.maxEmailAgeSeconds') return 1; // 1 second
        return defaultValue;
      });

      const ageService = new EmailStorageService(mockConfigService, mockInboxStorageService);

      // Mock inbox
      const mockInbox = {
        emails: new Map([['email-1', { id: 'email-1' }]]),
      };
      mockInboxStorageService.getInbox.mockReturnValue(mockInbox as never);

      // Store an email
      const payloads = createMockPayloads(1000);
      ageService.storeEmail('test@example.com', 'email-1', payloads);

      // Wait for email to become stale
      jest.useFakeTimers();
      jest.advanceTimersByTime(2000); // 2 seconds

      ageService.evictStaleEmails();

      const metrics = ageService.getMetrics();
      expect(metrics.emails.totalEvicted).toBe(1);

      jest.useRealTimers();
    });

    it('does not evict emails that are not old enough', () => {
      // Enable max age
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'vsb.smtp.maxMemoryMB') return 500;
        if (key === 'vsb.smtp.maxEmailAgeSeconds') return 3600; // 1 hour
        return defaultValue;
      });

      const ageService = new EmailStorageService(mockConfigService, mockInboxStorageService);

      const payloads = createMockPayloads(1000);
      ageService.storeEmail('test@example.com', 'email-1', payloads);

      ageService.evictStaleEmails();

      const metrics = ageService.getMetrics();
      expect(metrics.emails.totalEvicted).toBe(0);
      expect(metrics.emails.totalStored).toBe(1);
    });
  });

  describe('onEmailDeleted', () => {
    it('removes email from tracking when deleted by user', () => {
      const payloads = createMockPayloads(1000);
      service.storeEmail('test@example.com', 'email-1', payloads);

      const beforeMetrics = service.getMetrics();
      expect(beforeMetrics.emails.totalStored).toBe(1);

      service.onEmailDeleted('test@example.com', 'email-1');

      const afterMetrics = service.getMetrics();
      expect(afterMetrics.emails.totalStored).toBe(0);
      expect(afterMetrics.storage.usedMemoryBytes).toBe(0);
    });

    it('does nothing when email is not found', () => {
      const payloads = createMockPayloads(1000);
      service.storeEmail('test@example.com', 'email-1', payloads);

      service.onEmailDeleted('test@example.com', 'nonexistent');

      const metrics = service.getMetrics();
      expect(metrics.emails.totalStored).toBe(1);
    });

    it('does nothing when inbox email does not match', () => {
      const payloads = createMockPayloads(1000);
      service.storeEmail('test@example.com', 'email-1', payloads);

      service.onEmailDeleted('other@example.com', 'email-1');

      const metrics = service.getMetrics();
      expect(metrics.emails.totalStored).toBe(1);
    });

    it('handles already tombstoned email', () => {
      // Create service with small memory to force eviction (~2KB limit)
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'vsb.smtp.maxMemoryMB') return 0.002;
        if (key === 'vsb.smtp.maxEmailAgeSeconds') return 0;
        return defaultValue;
      });

      const smallService = new EmailStorageService(mockConfigService, mockInboxStorageService);

      // Mock inbox
      const mockInbox = {
        emails: new Map([['email-1', { id: 'email-1' }]]),
      };
      mockInboxStorageService.getInbox.mockReturnValue(mockInbox as never);

      // Store first email (~1.5KB)
      const payloads1 = createMockPayloads(1500);
      smallService.storeEmail('test@example.com', 'email-1', payloads1);

      // Store second email (~1.5KB, total ~3KB > 2KB limit, triggers eviction of first)
      const payloads2 = createMockPayloads(1500);
      mockInbox.emails.set('email-2', { id: 'email-2' } as never);
      smallService.storeEmail('test@example.com', 'email-2', payloads2);

      // Try to delete the already-evicted email (should find tombstoned entry)
      smallService.onEmailDeleted('test@example.com', 'email-1');

      // Should not throw
      const metrics = smallService.getMetrics();
      expect(metrics.emails.totalEvicted).toBeGreaterThan(0);
    });
  });

  describe('onInboxDeleted', () => {
    it('removes all emails for inbox from tracking', () => {
      const payloads1 = createMockPayloads(1000);
      const payloads2 = createMockPayloads(1000);

      service.storeEmail('test@example.com', 'email-1', payloads1);
      service.storeEmail('test@example.com', 'email-2', payloads2);

      const beforeMetrics = service.getMetrics();
      expect(beforeMetrics.emails.totalStored).toBe(2);

      service.onInboxDeleted('test@example.com');

      const afterMetrics = service.getMetrics();
      expect(afterMetrics.emails.totalStored).toBe(0);
      expect(afterMetrics.storage.usedMemoryBytes).toBe(0);
    });

    it('only removes emails for the specified inbox', () => {
      const payloads1 = createMockPayloads(1000);
      const payloads2 = createMockPayloads(1000);

      service.storeEmail('test1@example.com', 'email-1', payloads1);
      service.storeEmail('test2@example.com', 'email-2', payloads2);

      service.onInboxDeleted('test1@example.com');

      const metrics = service.getMetrics();
      expect(metrics.emails.totalStored).toBe(1);
    });

    it('does nothing when inbox has no emails', () => {
      service.onInboxDeleted('nonexistent@example.com');

      const metrics = service.getMetrics();
      expect(metrics.emails.totalStored).toBe(0);
    });

    it('handles mixed tombstoned and active emails', () => {
      // Create service with small memory to force eviction
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'vsb.smtp.maxMemoryMB') return 0.005; // ~5KB
        if (key === 'vsb.smtp.maxEmailAgeSeconds') return 0;
        return defaultValue;
      });

      const smallService = new EmailStorageService(mockConfigService, mockInboxStorageService);

      // Mock inbox
      const mockInbox = {
        emails: new Map([['email-1', { id: 'email-1' }]]),
      };
      mockInboxStorageService.getInbox.mockReturnValue(mockInbox as never);

      // Store emails (first will be evicted)
      const payloads1 = createMockPayloads(2500);
      smallService.storeEmail('test@example.com', 'email-1', payloads1);

      const payloads2 = createMockPayloads(2500);
      mockInbox.emails.set('email-2', { id: 'email-2' } as never);
      smallService.storeEmail('test@example.com', 'email-2', payloads2);

      // Delete the inbox
      smallService.onInboxDeleted('test@example.com');

      const metrics = smallService.getMetrics();
      expect(metrics.emails.totalStored).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles zero-size payloads', () => {
      const emptyPayload: EncryptedPayload = {
        ct_kem: new Uint8Array(0),
        nonce: new Uint8Array(0),
        aad: new Uint8Array(0),
        ciphertext: new Uint8Array(0),
        sig: new Uint8Array(0),
        server_sig_pk: new Uint8Array(0),
      };

      const payloads = {
        encryptedMetadata: emptyPayload,
        encryptedParsed: emptyPayload,
        encryptedRaw: emptyPayload,
      };

      const result = service.storeEmail('test@example.com', 'email-1', payloads);
      expect(result).toBe('email-1');

      const metrics = service.getMetrics();
      // Should still have overhead bytes
      expect(metrics.storage.usedMemoryBytes).toBe(300); // 3 * 100 overhead
    });

    it('tracks email age correctly', () => {
      jest.useFakeTimers();
      const now = Date.now();
      jest.setSystemTime(now);

      const payloads = createMockPayloads(1000);
      service.storeEmail('test@example.com', 'email-1', payloads);

      // Advance time by 5 seconds
      jest.advanceTimersByTime(5000);

      const metrics = service.getMetrics();
      expect(metrics.emails.oldestEmailAge).toBeGreaterThanOrEqual(5000);

      jest.useRealTimers();
    });

    it('maintains FIFO order for eviction', () => {
      // Create service with ~4KB memory limit
      mockConfigService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'vsb.smtp.maxMemoryMB') return 0.004;
        if (key === 'vsb.smtp.maxEmailAgeSeconds') return 0;
        return defaultValue;
      });

      const smallService = new EmailStorageService(mockConfigService, mockInboxStorageService);

      // Mock inbox
      const mockInbox = {
        emails: new Map<string, object>(),
      };
      mockInboxStorageService.getInbox.mockReturnValue(mockInbox as never);

      // Store 3 emails of ~2KB each (total ~6KB > 4KB limit)
      const payloads1 = createMockPayloads(2000);
      mockInbox.emails.set('email-1', { id: 'email-1' });
      smallService.storeEmail('test@example.com', 'email-1', payloads1);

      const payloads2 = createMockPayloads(2000);
      mockInbox.emails.set('email-2', { id: 'email-2' });
      smallService.storeEmail('test@example.com', 'email-2', payloads2);

      const payloads3 = createMockPayloads(2000);
      mockInbox.emails.set('email-3', { id: 'email-3' });
      smallService.storeEmail('test@example.com', 'email-3', payloads3);

      // First email should have been evicted first (FIFO)
      expect(mockInboxStorageService.evictEmail).toHaveBeenCalledWith('test@example.com', 'email-1');
    });
  });
});
