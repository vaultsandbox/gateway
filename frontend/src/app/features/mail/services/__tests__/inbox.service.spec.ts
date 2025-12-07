import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { InboxService } from '../inbox.service';
import { InboxStorageService } from '../inbox-storage.service';
import { VaultSandboxApi } from '../vault-sandbox-api';
import { EncryptionService } from '../encryption.service';
import { VaultSandbox } from '../../../../shared/services/vault-sandbox';
import { VsToast } from '../../../../shared/services/vs-toast';
import { SettingsManager } from '../settings-manager';
import { Title } from '@angular/platform-browser';
import {
  EncryptionServiceStub,
  SettingsManagerStub,
  VaultSandboxApiStub,
  VaultSandboxStub,
  VsToastStub,
} from '../../../../../testing/mail-testing.mocks';
import { ExportedInboxData } from '../../interfaces';
import { InboxStorageKeys } from '../helpers/storage.helpers';

describe('InboxService', () => {
  let service: InboxService;

  class TitleStub {
    private title = '';

    getTitle(): string {
      return this.title;
    }

    setTitle(newTitle: string): void {
      this.title = newTitle;
    }
  }

  const createImportPayload = (): ExportedInboxData => ({
    emailAddress: 'user@example.com',
    expiresAt: new Date().toISOString(),
    inboxHash: 'hash-123',
    serverSigPk: 'server-sig',
    secretKeyB64: btoa('secret'),
    exportedAt: new Date().toISOString(),
  });

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        InboxStorageService,
        { provide: VaultSandboxApi, useClass: VaultSandboxApiStub },
        { provide: EncryptionService, useClass: EncryptionServiceStub },
        { provide: VaultSandbox, useClass: VaultSandboxStub },
        { provide: VsToast, useClass: VsToastStub },
        { provide: SettingsManager, useClass: SettingsManagerStub },
        { provide: Title, useClass: TitleStub },
      ],
    });

    service = TestBed.inject(InboxService);
  });

  it('creates an inbox and persists it', async () => {
    const result = await service.createInbox();
    expect(result.created).toBeTrue();
    expect(service.inboxes.length).toBe(1);

    const stored = localStorage.getItem(InboxStorageKeys.INBOXES_KEY);
    expect(stored).toContain(service.inboxes[0].inboxHash);
  });

  it('imports inbox data and rejects duplicates', () => {
    const payload = createImportPayload();

    const first = service.importInbox(payload);
    const duplicate = service.importInbox(payload);

    expect(first.success).toBeTrue();
    expect(duplicate.success).toBeFalse();
    expect(service.inboxes.length).toBe(1);
  });

  it('exports metadata for existing inboxes', () => {
    const payload = createImportPayload();
    service.importInbox(payload);

    const exported = service.exportInboxMetadata(payload.inboxHash);
    expect(exported?.emailAddress).toBe(payload.emailAddress);
    expect(exported?.secretKeyB64).toBe(payload.secretKeyB64);
  });

  it('deletes inboxes and clears selection', () => {
    const payload = createImportPayload();
    service.importInbox(payload);
    service.selectInbox(payload.inboxHash);

    service.deleteInbox(payload.inboxHash);

    expect(service.inboxes.length).toBe(0);
    expect(service.selectedInbox()).toBeNull();
  });

  it('updates the document title with unread email counts', () => {
    const title = TestBed.inject(Title);
    title.setTitle('VaultSandbox');

    const payload = createImportPayload();
    service.importInbox(payload);

    const inbox = {
      ...service.inboxes[0],
      emails: [
        { id: 'email-1', encryptedMetadata: null, isRead: false },
        { id: 'email-2', encryptedMetadata: null, isRead: false },
      ],
    };
    service.emitInboxUpdate(inbox);
    TestBed.flushEffects();
    expect(title.getTitle()).toBe('VaultSandbox (2)');

    const updatedInbox = {
      ...inbox,
      emails: [{ ...inbox.emails[0], isRead: true }, inbox.emails[1]],
    };
    service.emitInboxUpdate(updatedInbox);
    TestBed.flushEffects();
    expect(title.getTitle()).toBe('VaultSandbox (1)');
  });

  it('computes unread counts per inbox efficiently', () => {
    const payload = createImportPayload();
    service.importInbox(payload);

    const inbox = {
      ...service.inboxes[0],
      emails: [
        { id: 'email-1', encryptedMetadata: null, isRead: false },
        { id: 'email-2', encryptedMetadata: null, isRead: true },
      ],
    };
    service.emitInboxUpdate(inbox);

    expect(service.getUnreadCount(payload.inboxHash)).toBe(1);
    expect(service.unreadCountByInbox()[payload.inboxHash]).toBe(1);

    const updatedInbox = {
      ...inbox,
      emails: inbox.emails.map((email) => (email.id === 'email-1' ? { ...email, isRead: true } : email)),
    };

    service.emitInboxUpdate(updatedInbox);

    expect(service.getUnreadCount(payload.inboxHash)).toBe(0);
    expect(service.unreadCountByInbox()[payload.inboxHash]).toBe(0);
  });
});
