import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { InboxStorageService } from '../inbox-storage.service';
import { InboxModel } from '../../interfaces';
import {
  base64urlEncode,
  InboxStorageKeys,
  MLKEM_SECRET_KEY_SIZE,
  MLDSA_PUBLIC_KEY_SIZE,
} from '../helpers/storage.helpers';

describe('InboxStorageService', () => {
  let service: InboxStorageService;

  const createInbox = (): InboxModel => ({
    emailAddress: 'user@example.com',
    expiresAt: new Date().toISOString(),
    inboxHash: 'hash-123',
    encrypted: true,
    emailAuth: false,
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

  it('returns empty list when localStorage is empty', () => {
    expect(service.loadInboxes()).toEqual([]);
  });

  it('returns empty list when payload is invalid', () => {
    localStorage.setItem(InboxStorageKeys.INBOXES_KEY, '{"not":"json"}');
    expect(service.loadInboxes()).toEqual([]);
  });

  it('returns empty list and logs error on JSON parse error', () => {
    localStorage.setItem(InboxStorageKeys.INBOXES_KEY, 'invalid json {{{');
    spyOn(console, 'error');

    const result = service.loadInboxes();

    expect(result).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(
      '[InboxStorage] Error parsing localStorage payload:',
      jasmine.any(SyntaxError),
    );
  });

  it('clears storage keys', () => {
    localStorage.setItem(InboxStorageKeys.INBOXES_KEY, 'test-inboxes');
    localStorage.setItem(InboxStorageKeys.SETTINGS_KEY, 'test-settings');

    service.clearStorage();

    expect(localStorage.getItem(InboxStorageKeys.INBOXES_KEY)).toBeNull();
    expect(localStorage.getItem(InboxStorageKeys.SETTINGS_KEY)).toBeNull();
  });

  it('validates import payloads', () => {
    const valid = {
      version: 1 as const,
      emailAddress: 'user@example.com',
      expiresAt: new Date().toISOString(),
      inboxHash: 'hash-123',
      encrypted: true,
      serverSigPk: base64urlEncode(new Uint8Array(MLDSA_PUBLIC_KEY_SIZE)),
      secretKey: base64urlEncode(new Uint8Array(MLKEM_SECRET_KEY_SIZE)),
      exportedAt: new Date().toISOString(),
    };

    expect(service.validateImportData(valid)).toBeTrue();
    expect(service.validateImportData({})).toBeFalse();
    // Invalid base64url (contains + character)
    expect(service.validateImportData({ ...valid, secretKey: 'not+valid' })).toBeFalse();
    // Missing version
    expect(service.validateImportData({ ...valid, version: undefined })).toBeFalse();
    // Wrong key size
    expect(service.validateImportData({ ...valid, secretKey: base64urlEncode(new Uint8Array(100)) })).toBeFalse();
  });

  it('exports inbox to export format', () => {
    const inbox = createInbox();

    const exported = service.exportInbox(inbox);

    expect(exported.version).toBe(1);
    expect(exported.emailAddress).toBe(inbox.emailAddress);
    expect(exported.inboxHash).toBe(inbox.inboxHash);
    expect(exported.serverSigPk).toBe(inbox.serverSigPk);
    expect(exported.expiresAt).toBe(inbox.expiresAt);
    expect(exported.exportedAt).toBeDefined();
    expect(exported.secretKey).toBeDefined();
  });

  it('creates inbox model from import data', () => {
    const importData = {
      version: 1 as const,
      emailAddress: 'imported@example.com',
      expiresAt: new Date().toISOString(),
      inboxHash: 'import-hash',
      encrypted: true,
      emailAuth: false,
      serverSigPk: base64urlEncode(new Uint8Array(MLDSA_PUBLIC_KEY_SIZE)),
      secretKey: base64urlEncode(new Uint8Array(MLKEM_SECRET_KEY_SIZE)),
      exportedAt: new Date().toISOString(),
    };

    const inbox = service.createInboxModelFromImport(importData);

    expect(inbox.emailAddress).toBe(importData.emailAddress);
    expect(inbox.expiresAt).toBe(importData.expiresAt);
    expect(inbox.inboxHash).toBe(importData.inboxHash);
    expect(inbox.encrypted).toBe(true);
    expect(inbox.serverSigPk).toBe(importData.serverSigPk);
    expect(inbox.secretKey).toBeInstanceOf(Uint8Array);
    expect(inbox.emails).toEqual([]);
  });
});
