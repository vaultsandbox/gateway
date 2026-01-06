import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InboxCleanupService } from '../inbox-cleanup.service';
import { InboxStorageService } from '../../storage/inbox-storage.service';
import { InboxService } from '../../inbox.service';
import { silenceNestLogger } from '../../../../test/helpers/silence-logger';
import { Inbox } from '../../interfaces';

describe('InboxCleanupService', () => {
  let service: InboxCleanupService;
  let storageService: jest.Mocked<InboxStorageService>;
  let inboxService: jest.Mocked<InboxService>;

  const restoreLogger = silenceNestLogger();

  afterAll(() => restoreLogger());

  beforeEach(async () => {
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboxCleanupService,
        {
          provide: InboxStorageService,
          useValue: {
            getAllInboxes: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(300), // 5 minutes default
          },
        },
        {
          provide: InboxService,
          useValue: {
            deleteInbox: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<InboxCleanupService>(InboxCleanupService);
    storageService = module.get(InboxStorageService);
    inboxService = module.get(InboxService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should start cleanup interval and run initial cleanup', () => {
      const expiredInbox = createMockInbox('expired@test.com', new Date(Date.now() - 1000));
      storageService.getAllInboxes.mockReturnValue([expiredInbox]);

      service.onModuleInit();

      // Initial cleanup should have been called
      expect(storageService.getAllInboxes).toHaveBeenCalled();
      expect(inboxService.deleteInbox).toHaveBeenCalledWith('expired@test.com');
    });

    it('should run cleanup at configured interval', () => {
      const expiredInbox = createMockInbox('expired@test.com', new Date(Date.now() - 1000));
      storageService.getAllInboxes.mockReturnValue([expiredInbox]);

      service.onModuleInit();

      // Clear initial calls
      storageService.getAllInboxes.mockClear();
      inboxService.deleteInbox.mockClear();

      // Advance time by interval (300 seconds = 300000ms)
      jest.advanceTimersByTime(300000);

      expect(storageService.getAllInboxes).toHaveBeenCalled();
      expect(inboxService.deleteInbox).toHaveBeenCalledWith('expired@test.com');
    });
  });

  describe('onModuleDestroy', () => {
    it('should clear cleanup interval when it exists', () => {
      service.onModuleInit();
      service.onModuleDestroy();

      // After destroy, interval should be cleared - advancing time should not trigger cleanup
      storageService.getAllInboxes.mockClear();
      jest.advanceTimersByTime(300000);
      expect(storageService.getAllInboxes).not.toHaveBeenCalled();
    });

    it('should handle case when interval does not exist', () => {
      // Don't call onModuleInit, so no interval is set
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });

  describe('triggerCleanup', () => {
    it('should manually trigger cleanup', () => {
      const expiredInbox = createMockInbox('expired@test.com', new Date(Date.now() - 1000));
      storageService.getAllInboxes.mockReturnValue([expiredInbox]);

      service.triggerCleanup();

      expect(storageService.getAllInboxes).toHaveBeenCalled();
      expect(inboxService.deleteInbox).toHaveBeenCalledWith('expired@test.com');
    });
  });

  describe('cleanupExpiredInboxes', () => {
    it('should delete expired inboxes', () => {
      const expiredInbox = createMockInbox('expired@test.com', new Date(Date.now() - 1000));
      storageService.getAllInboxes.mockReturnValue([expiredInbox]);

      service.triggerCleanup();

      expect(inboxService.deleteInbox).toHaveBeenCalledWith('expired@test.com');
    });

    it('should not delete non-expired inboxes', () => {
      const validInbox = createMockInbox('valid@test.com', new Date(Date.now() + 60000));
      storageService.getAllInboxes.mockReturnValue([validInbox]);

      service.triggerCleanup();

      expect(inboxService.deleteInbox).not.toHaveBeenCalled();
    });

    it('should handle multiple inboxes with mixed expiration', () => {
      const expiredInbox1 = createMockInbox('expired1@test.com', new Date(Date.now() - 1000));
      const validInbox = createMockInbox('valid@test.com', new Date(Date.now() + 60000));
      const expiredInbox2 = createMockInbox('expired2@test.com', new Date(Date.now() - 2000));

      storageService.getAllInboxes.mockReturnValue([expiredInbox1, validInbox, expiredInbox2]);

      service.triggerCleanup();

      expect(inboxService.deleteInbox).toHaveBeenCalledTimes(2);
      expect(inboxService.deleteInbox).toHaveBeenCalledWith('expired1@test.com');
      expect(inboxService.deleteInbox).toHaveBeenCalledWith('expired2@test.com');
      expect(inboxService.deleteInbox).not.toHaveBeenCalledWith('valid@test.com');
    });

    it('should handle empty inbox list', () => {
      storageService.getAllInboxes.mockReturnValue([]);

      service.triggerCleanup();

      expect(inboxService.deleteInbox).not.toHaveBeenCalled();
    });
  });
});

function createMockInbox(emailAddress: string, expiresAt: Date): Inbox {
  return {
    emailAddress,
    clientKemPk: 'mock-kem-pk',
    inboxHash: 'mock-hash',
    createdAt: new Date(),
    expiresAt,
    emails: new Map(),
    emailsHash: '',
  };
}
