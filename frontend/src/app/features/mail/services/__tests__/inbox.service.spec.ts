import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { throwError } from 'rxjs';
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
import {
  base64urlEncode,
  InboxStorageKeys,
  MLKEM_SECRET_KEY_SIZE,
  MLDSA_PUBLIC_KEY_SIZE,
} from '../helpers/storage.helpers';
import { InboxSyncService } from '../inbox-sync.service';

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
    version: 1,
    emailAddress: 'user@example.com',
    expiresAt: new Date().toISOString(),
    inboxHash: 'hash-123',
    serverSigPk: base64urlEncode(new Uint8Array(MLDSA_PUBLIC_KEY_SIZE)),
    secretKey: base64urlEncode(new Uint8Array(MLKEM_SECRET_KEY_SIZE)),
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
    expect(exported?.secretKey).toBe(payload.secretKey);
    expect(exported?.version).toBe(1);
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

  it('exposes inboxCreated$ observable from state service', (done) => {
    const observable = service.inboxCreated$;
    expect(observable).toBeDefined();

    const payload = createImportPayload();
    observable.subscribe((inbox) => {
      expect(inbox.inboxHash).toBe(payload.inboxHash);
      done();
    });

    service.importInbox(payload);
  });

  it('exposes inboxDeleted$ observable from state service', (done) => {
    const payload = createImportPayload();
    service.importInbox(payload);

    const observable = service.inboxDeleted$;
    expect(observable).toBeDefined();

    observable.subscribe((hash) => {
      expect(hash).toBe(payload.inboxHash);
      done();
    });

    service.deleteInbox(payload.inboxHash);
  });

  it('exposes inboxUpdated$ observable from state service', (done) => {
    const payload = createImportPayload();
    service.importInbox(payload);

    const observable = service.inboxUpdated$;
    expect(observable).toBeDefined();

    observable.subscribe((inbox) => {
      expect(inbox.inboxHash).toBe(payload.inboxHash);
      done();
    });

    const inbox = service.inboxes[0];
    service.emitInboxUpdate({ ...inbox, emails: [{ id: 'e1', encryptedMetadata: null, isRead: false }] });
  });

  it('exposes newEmailArrived$ observable from state service', () => {
    const observable = service.newEmailArrived$;
    expect(observable).toBeDefined();
  });

  it('handles createInbox errors gracefully', async () => {
    const api = TestBed.inject(VaultSandboxApi);
    spyOn(api, 'createInbox').and.returnValue(throwError(() => new Error('Network error')));
    const consoleSpy = spyOn(console, 'error');

    const result = await service.createInbox();

    expect(result.created).toBeFalse();
    expect(result.email).toBe('');
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('calls subscribeToAllInboxes on sync service', async () => {
    const sync = TestBed.inject(InboxSyncService);
    const spy = spyOn(sync, 'subscribeToAllInboxes').and.returnValue(Promise.resolve());

    await service.subscribeToAllInboxes();

    expect(spy).toHaveBeenCalled();
  });

  it('calls importMultipleInboxes on import/export service', async () => {
    const payload = createImportPayload();
    payload.inboxHash = 'unique-import-hash';
    const file = new File([JSON.stringify(payload)], 'test.json', { type: 'application/json' });
    const result = await service.importMultipleInboxes([file]);

    expect(result.length).toBe(1);
    expect(result[0].filename).toBe('test.json');
    expect(result[0].success).toBeTrue();
  });

  it('calls clearLocalStorage on state service', () => {
    service.clearLocalStorage();
    // Just verify it doesn't throw
    expect(true).toBeTrue();
  });

  it('calls loadEmailsForInbox on sync service', async () => {
    const sync = TestBed.inject(InboxSyncService);
    const spy = spyOn(sync, 'loadEmailsForInbox').and.returnValue(Promise.resolve());

    await service.loadEmailsForInbox('test-hash');

    expect(spy).toHaveBeenCalledWith('test-hash');
  });

  it('returns inbox snapshot for existing inbox', () => {
    const payload = createImportPayload();
    service.importInbox(payload);

    const snapshot = service.getInboxSnapshot(payload.inboxHash);

    expect(snapshot).toBeDefined();
    expect(snapshot?.inboxHash).toBe(payload.inboxHash);
  });

  it('returns undefined snapshot for nonexistent inbox', () => {
    const snapshot = service.getInboxSnapshot('nonexistent-hash');
    expect(snapshot).toBeUndefined();
  });

  it('disconnects sync service on ngOnDestroy', () => {
    const sync = TestBed.inject(InboxSyncService);
    const spy = spyOn(sync, 'disconnect');

    service.ngOnDestroy();

    expect(spy).toHaveBeenCalled();
  });
});
