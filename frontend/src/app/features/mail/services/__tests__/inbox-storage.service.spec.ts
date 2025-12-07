import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { InboxStorageService } from '../inbox-storage.service';
import { InboxModel } from '../../interfaces';
import { InboxStorageKeys } from '../helpers/storage.helpers';

describe('InboxStorageService', () => {
  let service: InboxStorageService;

  const createInbox = (): InboxModel => ({
    emailAddress: 'user@example.com',
    expiresAt: new Date().toISOString(),
    inboxHash: 'hash-123',
    serverSigPk: 'server-sig',
    secretKey: new Uint8Array([1, 2, 3, 4]),
    emails: [],
  });

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });

    service = TestBed.inject(InboxStorageService);
  });

  it('saves and loads inboxes', () => {
    const inbox = createInbox();

    service.saveInboxes([inbox]);
    const loaded = service.loadInboxes();

    expect(loaded.length).toBe(1);
    expect(loaded[0].emailAddress).toBe(inbox.emailAddress);
    expect(loaded[0].secretKey).toEqual(inbox.secretKey);
  });

  it('returns empty list when payload is invalid', () => {
    localStorage.setItem(InboxStorageKeys.INBOXES_KEY, '{"not":"json"}');
    expect(service.loadInboxes()).toEqual([]);
  });

  it('validates import payloads', () => {
    const valid = {
      emailAddress: 'user@example.com',
      expiresAt: new Date().toISOString(),
      inboxHash: 'hash-123',
      serverSigPk: 'sig',
      secretKeyB64: btoa('data'),
      exportedAt: new Date().toISOString(),
    };

    expect(service.validateImportData(valid)).toBeTrue();
    expect(service.validateImportData({})).toBeFalse();
    expect(service.validateImportData({ ...valid, secretKeyB64: 'not-base64' })).toBeFalse();
  });
});
