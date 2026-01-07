import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { InboxStateService } from '../inbox-state.service';
import { InboxStorageService } from '../inbox-storage.service';
import { EmailItemModel, InboxModel } from '../../interfaces';

describe('InboxStateService', () => {
  let service: InboxStateService;
  let storageService: InboxStorageServiceStub;
  let titleService: TitleStub;

  class TitleStub {
    private title = 'VaultSandbox';

    getTitle(): string {
      return this.title;
    }

    setTitle(newTitle: string): void {
      this.title = newTitle;
    }
  }

  class InboxStorageServiceStub implements Partial<InboxStorageService> {
    private savedInboxes: InboxModel[] = [];
    private loadedInboxes: InboxModel[] = [];

    setLoadedInboxes(inboxes: InboxModel[]): void {
      this.loadedInboxes = inboxes;
    }

    loadInboxes(): InboxModel[] {
      return this.loadedInboxes;
    }

    saveInboxes(inboxes: InboxModel[]): void {
      this.savedInboxes = [...inboxes];
    }

    getSavedInboxes(): InboxModel[] {
      return this.savedInboxes;
    }

    clearStorage(): void {
      this.savedInboxes = [];
    }
  }

  const createMockInbox = (overrides: Partial<InboxModel> = {}): InboxModel => ({
    emailAddress: 'test@example.com',
    expiresAt: new Date().toISOString(),
    inboxHash: 'hash-123',
    serverSigPk: 'server-sig-pk',
    secretKey: new Uint8Array(32),
    emails: [],
    ...overrides,
  });

  const createMockEmail = (overrides: Partial<EmailItemModel> = {}): EmailItemModel => ({
    id: 'email-1',
    encryptedMetadata: null,
    isRead: false,
    ...overrides,
  });

  beforeEach(() => {
    localStorage.clear();
    storageService = new InboxStorageServiceStub();
    titleService = new TitleStub();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        InboxStateService,
        { provide: InboxStorageService, useValue: storageService },
        { provide: Title, useValue: titleService },
      ],
    });

    service = TestBed.inject(InboxStateService);
  });

  describe('initialization', () => {
    it('should load saved inboxes from storage on construction', () => {
      const savedInbox = createMockInbox({ inboxHash: 'saved-hash' });
      storageService.setLoadedInboxes([savedInbox]);

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          InboxStateService,
          { provide: InboxStorageService, useValue: storageService },
          { provide: Title, useValue: titleService },
        ],
      });

      const newService = TestBed.inject(InboxStateService);
      expect(newService.inboxes.length).toBe(1);
      expect(newService.inboxes[0].inboxHash).toBe('saved-hash');
    });

    it('should start with empty inboxes when storage is empty', () => {
      expect(service.inboxes.length).toBe(0);
    });
  });

  describe('selectInbox()', () => {
    it('should set the active inbox when inbox exists', () => {
      const inbox = createMockInbox();
      service.addInbox(inbox);

      service.selectInbox(inbox.inboxHash);

      expect(service.selectedInbox()).not.toBeNull();
      expect(service.selectedInbox()?.inboxHash).toBe(inbox.inboxHash);
    });

    it('should not change selection when inbox does not exist', () => {
      const inbox = createMockInbox();
      service.addInbox(inbox);
      service.selectInbox(inbox.inboxHash);

      service.selectInbox('non-existent-hash');

      expect(service.selectedInbox()?.inboxHash).toBe(inbox.inboxHash);
    });

    it('should keep null selection when no inbox exists', () => {
      service.selectInbox('non-existent-hash');

      expect(service.selectedInbox()).toBeNull();
    });
  });

  describe('getInboxSnapshot()', () => {
    it('should return inbox copy when inbox exists', () => {
      const inbox = createMockInbox();
      service.addInbox(inbox);

      const snapshot = service.getInboxSnapshot(inbox.inboxHash);

      expect(snapshot).toBeDefined();
      expect(snapshot?.inboxHash).toBe(inbox.inboxHash);
      expect(snapshot?.emailAddress).toBe(inbox.emailAddress);
    });

    it('should return undefined when inbox does not exist', () => {
      const snapshot = service.getInboxSnapshot('non-existent-hash');

      expect(snapshot).toBeUndefined();
    });
  });

  describe('getInboxHashes()', () => {
    it('should return empty array when no inboxes exist', () => {
      const hashes = service.getInboxHashes();

      expect(hashes).toEqual([]);
    });

    it('should return all inbox hashes', () => {
      const inbox1 = createMockInbox({ inboxHash: 'hash-1' });
      const inbox2 = createMockInbox({ inboxHash: 'hash-2' });
      const inbox3 = createMockInbox({ inboxHash: 'hash-3' });

      service.addInbox(inbox1);
      service.addInbox(inbox2);
      service.addInbox(inbox3);

      const hashes = service.getInboxHashes();

      expect(hashes).toEqual(['hash-1', 'hash-2', 'hash-3']);
    });
  });

  describe('addInbox()', () => {
    it('should add inbox to state', () => {
      const inbox = createMockInbox();

      service.addInbox(inbox);

      expect(service.inboxes.length).toBe(1);
      expect(service.inboxes[0].inboxHash).toBe(inbox.inboxHash);
    });

    it('should emit inboxCreated event', (done) => {
      const inbox = createMockInbox();

      service.inboxCreated$.subscribe((createdInbox) => {
        expect(createdInbox.inboxHash).toBe(inbox.inboxHash);
        done();
      });

      service.addInbox(inbox);
    });

    it('should persist to storage by default', () => {
      const inbox = createMockInbox();

      service.addInbox(inbox);

      expect(storageService.getSavedInboxes().length).toBe(1);
    });

    it('should not persist to storage when persist is false', () => {
      const inbox = createMockInbox();

      service.addInbox(inbox, { persist: false });

      expect(storageService.getSavedInboxes().length).toBe(0);
    });
  });

  describe('removeInbox()', () => {
    it('should remove inbox from state', () => {
      const inbox = createMockInbox();
      service.addInbox(inbox);

      const remaining = service.removeInbox(inbox.inboxHash);

      expect(remaining.length).toBe(0);
      expect(service.inboxes.length).toBe(0);
    });

    it('should emit inboxDeleted event', (done) => {
      const inbox = createMockInbox();
      service.addInbox(inbox);

      service.inboxDeleted$.subscribe((deletedHash) => {
        expect(deletedHash).toBe(inbox.inboxHash);
        done();
      });

      service.removeInbox(inbox.inboxHash);
    });

    it('should clear selection when selected inbox is deleted (even with other inboxes)', () => {
      const inbox1 = createMockInbox({ inboxHash: 'hash-1' });
      const inbox2 = createMockInbox({ inboxHash: 'hash-2' });
      service.addInbox(inbox1);
      service.addInbox(inbox2);
      service.selectInbox(inbox1.inboxHash);

      service.removeInbox(inbox1.inboxHash);

      // Selection is cleared because setInboxes() updates selection when the selected inbox
      // is no longer in the inboxes array (before removeInbox's explicit selection update)
      expect(service.selectedInbox()).toBeNull();
    });

    it('should clear selection when last inbox is deleted', () => {
      const inbox = createMockInbox();
      service.addInbox(inbox);
      service.selectInbox(inbox.inboxHash);

      service.removeInbox(inbox.inboxHash);

      expect(service.selectedInbox()).toBeNull();
    });

    it('should not change selection when different inbox is deleted', () => {
      const inbox1 = createMockInbox({ inboxHash: 'hash-1' });
      const inbox2 = createMockInbox({ inboxHash: 'hash-2' });
      service.addInbox(inbox1);
      service.addInbox(inbox2);
      service.selectInbox(inbox1.inboxHash);

      service.removeInbox(inbox2.inboxHash);

      expect(service.selectedInbox()?.inboxHash).toBe('hash-1');
    });

    it('should return current inboxes when inbox not found', () => {
      const inbox = createMockInbox();
      service.addInbox(inbox);

      const remaining = service.removeInbox('non-existent-hash');

      expect(remaining.length).toBe(1);
      expect(service.inboxes.length).toBe(1);
    });

    it('should persist changes to storage', () => {
      const inbox1 = createMockInbox({ inboxHash: 'hash-1' });
      const inbox2 = createMockInbox({ inboxHash: 'hash-2' });
      service.addInbox(inbox1);
      service.addInbox(inbox2);

      service.removeInbox(inbox1.inboxHash);

      expect(storageService.getSavedInboxes().length).toBe(1);
      expect(storageService.getSavedInboxes()[0].inboxHash).toBe('hash-2');
    });
  });

  describe('updateInbox()', () => {
    it('should update inbox in state', () => {
      const inbox = createMockInbox({ emailAddress: 'old@example.com' });
      service.addInbox(inbox);

      const updatedInbox = { ...inbox, emailAddress: 'new@example.com' };
      service.updateInbox(updatedInbox);

      expect(service.inboxes[0].emailAddress).toBe('new@example.com');
    });

    it('should emit inboxUpdated event', (done) => {
      const inbox = createMockInbox();
      service.addInbox(inbox);

      service.inboxUpdated$.subscribe((updatedInbox) => {
        expect(updatedInbox.inboxHash).toBe(inbox.inboxHash);
        done();
      });

      service.updateInbox(inbox);
    });

    it('should not persist by default', () => {
      const inbox = createMockInbox();
      service.addInbox(inbox);
      storageService.saveInboxes([]); // Clear saved state

      service.updateInbox({ ...inbox, emailAddress: 'updated@example.com' });

      expect(storageService.getSavedInboxes().length).toBe(0);
    });

    it('should persist when persist option is true', () => {
      const inbox = createMockInbox();
      service.addInbox(inbox);
      storageService.saveInboxes([]); // Clear saved state

      service.updateInbox({ ...inbox, emailAddress: 'updated@example.com' }, { persist: true });

      expect(storageService.getSavedInboxes().length).toBe(1);
    });

    it('should preserve existing inboxes when updating non-matching inbox', () => {
      const inbox1 = createMockInbox({ inboxHash: 'hash-1', emailAddress: 'one@example.com' });
      const inbox2 = createMockInbox({ inboxHash: 'hash-2', emailAddress: 'two@example.com' });
      service.addInbox(inbox1);
      service.addInbox(inbox2);

      const nonMatchingInbox = createMockInbox({ inboxHash: 'non-existent', emailAddress: 'new@example.com' });
      service.updateInbox(nonMatchingInbox);

      expect(service.inboxes.length).toBe(2);
      expect(service.inboxes[0].emailAddress).toBe('one@example.com');
      expect(service.inboxes[1].emailAddress).toBe('two@example.com');
    });

    it('should update selected inbox reference when selected inbox is updated', () => {
      const inbox = createMockInbox();
      service.addInbox(inbox);
      service.selectInbox(inbox.inboxHash);

      const updatedInbox = {
        ...inbox,
        emails: [createMockEmail()],
      };
      service.updateInbox(updatedInbox);

      expect(service.selectedInbox()?.emails.length).toBe(1);
    });
  });

  describe('notifyNewEmail()', () => {
    it('should emit newEmailArrived event', (done) => {
      const email = createMockEmail();

      service.newEmailArrived$.subscribe((receivedEmail) => {
        expect(receivedEmail.id).toBe(email.id);
        done();
      });

      service.notifyNewEmail(email);
    });
  });

  describe('clearLocalStorage()', () => {
    it('should call storage clearStorage', () => {
      const inbox = createMockInbox();
      service.addInbox(inbox);

      service.clearLocalStorage();

      expect(storageService.getSavedInboxes().length).toBe(0);
    });
  });

  describe('getUnreadCount()', () => {
    it('should return 0 for non-existent inbox', () => {
      expect(service.getUnreadCount('non-existent')).toBe(0);
    });

    it('should return correct unread count for inbox', () => {
      const inbox = createMockInbox({
        emails: [
          createMockEmail({ id: 'email-1', isRead: false }),
          createMockEmail({ id: 'email-2', isRead: true }),
          createMockEmail({ id: 'email-3', isRead: false }),
        ],
      });
      service.addInbox(inbox);

      expect(service.getUnreadCount(inbox.inboxHash)).toBe(2);
    });

    it('should return 0 when all emails are read', () => {
      const inbox = createMockInbox({
        emails: [createMockEmail({ id: 'email-1', isRead: true }), createMockEmail({ id: 'email-2', isRead: true })],
      });
      service.addInbox(inbox);

      expect(service.getUnreadCount(inbox.inboxHash)).toBe(0);
    });
  });

  describe('unreadCountByInbox', () => {
    it('should return empty object when no inboxes exist', () => {
      expect(service.unreadCountByInbox()).toEqual({});
    });

    it('should return correct counts per inbox', () => {
      const inbox1 = createMockInbox({
        inboxHash: 'hash-1',
        emails: [createMockEmail({ isRead: false }), createMockEmail({ id: 'e2', isRead: false })],
      });
      const inbox2 = createMockInbox({
        inboxHash: 'hash-2',
        emails: [createMockEmail({ isRead: true })],
      });
      service.addInbox(inbox1);
      service.addInbox(inbox2);

      const counts = service.unreadCountByInbox();

      expect(counts['hash-1']).toBe(2);
      expect(counts['hash-2']).toBe(0);
    });
  });

  describe('totalUnreadCount', () => {
    it('should return 0 when no inboxes exist', () => {
      expect(service.totalUnreadCount()).toBe(0);
    });

    it('should return sum of all unread emails across inboxes', () => {
      const inbox1 = createMockInbox({
        inboxHash: 'hash-1',
        emails: [createMockEmail({ isRead: false }), createMockEmail({ id: 'e2', isRead: false })],
      });
      const inbox2 = createMockInbox({
        inboxHash: 'hash-2',
        emails: [createMockEmail({ id: 'e3', isRead: false }), createMockEmail({ id: 'e4', isRead: true })],
      });
      service.addInbox(inbox1);
      service.addInbox(inbox2);

      expect(service.totalUnreadCount()).toBe(3);
    });

    it('should update when inbox is updated', () => {
      const inbox = createMockInbox({
        emails: [createMockEmail({ isRead: false })],
      });
      service.addInbox(inbox);
      expect(service.totalUnreadCount()).toBe(1);

      service.updateInbox({
        ...inbox,
        emails: [createMockEmail({ isRead: true })],
      });

      expect(service.totalUnreadCount()).toBe(0);
    });
  });

  describe('document title effect', () => {
    it('should update title with unread count', () => {
      titleService.setTitle('VaultSandbox');

      const inbox = createMockInbox({
        emails: [createMockEmail({ isRead: false }), createMockEmail({ id: 'e2', isRead: false })],
      });
      service.addInbox(inbox);
      TestBed.flushEffects();

      expect(titleService.getTitle()).toBe('VaultSandbox (2)');
    });

    it('should reset title when no unread emails', () => {
      titleService.setTitle('VaultSandbox');

      const inbox = createMockInbox({
        emails: [createMockEmail({ isRead: false })],
      });
      service.addInbox(inbox);
      TestBed.flushEffects();

      expect(titleService.getTitle()).toBe('VaultSandbox (1)');

      service.updateInbox({
        ...inbox,
        emails: [createMockEmail({ isRead: true })],
      });
      TestBed.flushEffects();

      expect(titleService.getTitle()).toBe('VaultSandbox');
    });

    it('should use base title from initial page load', () => {
      titleService.setTitle('Custom Title');

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          InboxStateService,
          { provide: InboxStorageService, useValue: storageService },
          { provide: Title, useValue: titleService },
        ],
      });

      const newService = TestBed.inject(InboxStateService);
      const inbox = createMockInbox({
        emails: [createMockEmail({ isRead: false })],
      });
      newService.addInbox(inbox);
      TestBed.flushEffects();

      expect(titleService.getTitle()).toBe('Custom Title (1)');
    });
  });

  describe('ngOnDestroy', () => {
    it('should clean up effect on destroy', () => {
      service.ngOnDestroy();
      // If it doesn't throw, the cleanup was successful
      expect(true).toBeTrue();
    });
  });
});
