import { Signal, signal, computed } from '@angular/core';
import { of, Subject } from 'rxjs';
import {
  EmailItemModel,
  ExportedInboxData,
  InboxModel,
  ServerInfo,
  EmailListItemResponse,
  EmailDetailResponse,
  RawEmailResponse,
} from '../app/features/mail/interfaces';
import { InboxStateService } from '../app/features/mail/services/inbox-state.service';
import { SettingsManager, SanitizationLevel, TimeFormat } from '../app/features/mail/services/settings-manager';
import { VaultSandboxApi } from '../app/features/mail/services/vault-sandbox-api';
import { EncryptionService, KeyPair } from '../app/features/mail/services/encryption.service';
import { MailManager } from '../app/features/mail/services/mail-manager';
import { InboxService } from '../app/features/mail/services/inbox.service';
import { EmailService } from '../app/features/mail/services/email.service';
import { ServerInfoService } from '../app/features/mail/services/server-info.service';
import { VaultSandbox, NewEmailEvent } from '../app/shared/services/vault-sandbox';
import { VsToast } from '../app/shared/services/vs-toast';
import { VsThemeManagerService } from '../app/shared/services/vs-theme-manager-service';
import { EncryptedPayload } from '../app/shared/interfaces/encrypted-payload';

const consumeArgs = (...args: unknown[]): void => {
  void args;
};

export class VaultSandboxStub implements Partial<VaultSandbox> {
  private readonly apiKeySignal = signal<string | null>(null);
  readonly apiKey = this.apiKeySignal.asReadonly();
  private readonly subject = new Subject<NewEmailEvent>();
  private readonly reconnectedSubject = new Subject<void>();
  readonly newEmail$ = this.subject.asObservable();
  readonly reconnected$ = this.reconnectedSubject.asObservable();

  setApiKey(key: string): void {
    this.apiKeySignal.set(key);
  }

  clearApiKey(): void {
    this.apiKeySignal.set(null);
  }

  hasApiKey(): boolean {
    return !!this.apiKeySignal();
  }

  connectToEvents(domains: string[]): void {
    consumeArgs(domains);
  }

  disconnectEvents(): void {
    return;
  }

  emit(event: NewEmailEvent): void {
    this.subject.next(event);
  }

  emitReconnected(): void {
    this.reconnectedSubject.next();
  }
}

export class VsToastStub implements Partial<VsToast> {
  showWarning(summary: string, detail: string, life?: number): void {
    consumeArgs(summary, detail, life);
  }

  showError(summary: string, detail: string, life?: number): void {
    consumeArgs(summary, detail, life);
  }

  showInfo(summary: string, detail: string, life?: number): void {
    consumeArgs(summary, detail, life);
  }

  showSuccess(summary: string, detail: string, life?: number): void {
    consumeArgs(summary, detail, life);
  }

  showInboxDeleted(emailAddress: string): void {
    consumeArgs(emailAddress);
  }
}

export class VsThemeManagerServiceStub implements Partial<VsThemeManagerService> {
  private darkMode = false;

  isDarkMode(): boolean {
    return this.darkMode;
  }

  switchHtmlDarkLight(): void {
    this.darkMode = !this.darkMode;
  }
}

export class MailManagerStub implements Partial<MailManager> {
  private inboxList: InboxModel[] = [];
  private readonly selectedInboxSignal = signal<InboxModel | null>(null);
  private readonly selectedEmailSignal = signal<EmailItemModel | null>(null);
  private readonly unreadCountSignal = signal<Record<string, number>>({});

  readonly selectedInbox = this.selectedInboxSignal.asReadonly();
  readonly selectedEmail = this.selectedEmailSignal.asReadonly();
  readonly unreadCountByInbox = this.unreadCountSignal.asReadonly();

  get inboxes(): InboxModel[] {
    return this.inboxList;
  }

  setInboxes(inboxes: InboxModel[]): void {
    this.inboxList = inboxes;
    this.selectedInboxSignal.set(inboxes[0] ?? null);
    this.recalculateUnreadCounts();
  }

  getUnreadCount(inboxHash: string): number {
    return this.unreadCountSignal()[inboxHash] ?? 0;
  }

  clearLocalStorage(): void {
    return;
  }

  async createInbox(): Promise<{ created: boolean; email: string }> {
    return { created: true, email: 'test@example.com' };
  }

  selectInbox(inboxHash: string): void {
    const found = this.inboxList.find((i) => i.inboxHash === inboxHash) ?? null;
    this.selectedInboxSignal.set(found);
  }

  selectEmail(inboxHash: string, emailHash: string): void {
    consumeArgs(inboxHash, emailHash);
    const currentInbox = this.selectedInboxSignal();
    const firstEmail = currentInbox?.emails[0] ?? null;
    this.selectedEmailSignal.set(firstEmail);
  }

  deselectEmail(): void {
    this.selectedEmailSignal.set(null);
  }

  deleteInbox(inboxHash: string): void {
    this.inboxList = this.inboxList.filter((inbox) => inbox.inboxHash !== inboxHash);
    if (this.selectedInboxSignal()?.inboxHash === inboxHash) {
      this.selectedInboxSignal.set(this.inboxList[0] ?? null);
    }
    this.recalculateUnreadCounts();
  }

  deleteEmail(inboxHash: string, emailHash: string): void {
    consumeArgs(inboxHash, emailHash);
    this.inboxList = this.inboxList.map((inbox) =>
      inbox.inboxHash === inboxHash
        ? { ...inbox, emails: inbox.emails.filter((email) => email.id !== emailHash) }
        : inbox,
    );
    this.recalculateUnreadCounts();
  }

  async subscribeToAllInboxes(): Promise<void> {
    return;
  }

  async loadEmailsForInbox(inboxHash: string): Promise<void> {
    consumeArgs(inboxHash);
    return;
  }

  async markEmailAsRead(inboxHash: string, emailHash: string): Promise<void> {
    consumeArgs(inboxHash, emailHash);
    return;
  }

  async fetchAndDecryptEmail(inboxHash: string, emailHash: string): Promise<void> {
    consumeArgs(inboxHash, emailHash);
    return;
  }
  async fetchAndDecryptRawEmail(inboxHash: string, emailHash: string): Promise<string> {
    consumeArgs(inboxHash, emailHash);
    return '';
  }

  exportInboxMetadata(inboxHash: string): ExportedInboxData {
    consumeArgs(inboxHash);
    const now = new Date().toISOString();
    return {
      version: 1,
      emailAddress: 'test@example.com',
      expiresAt: now,
      inboxHash: 'stub-hash',
      serverSigPk: 'stub-server-sig',
      secretKey: '',
      exportedAt: now,
    };
  }

  async importMultipleInboxes(files: File[]): Promise<{ filename: string; success: boolean; message: string }[]> {
    return files.map((file) => ({
      filename: file.name,
      success: true,
      message: `Imported ${file.name}`,
    }));
  }

  private recalculateUnreadCounts(): void {
    const map = this.inboxList.reduce<Record<string, number>>((acc, inbox) => {
      acc[inbox.inboxHash] = inbox.emails.reduce((count, email) => (email.isRead ? count : count + 1), 0);
      return acc;
    }, {});
    this.unreadCountSignal.set(map);
  }
}

export class InboxServiceStub implements Partial<InboxService> {
  private readonly inboxSignal = signal<InboxModel[]>([]);
  private readonly selectedInboxSignal = signal<InboxModel | null>(null);
  private readonly unreadCountsSignal = signal<Record<string, number>>({});

  get inboxes(): InboxModel[] {
    return this.inboxSignal();
  }

  get selectedInbox() {
    return this.selectedInboxSignal.asReadonly();
  }

  get unreadCountByInbox() {
    return this.unreadCountsSignal.asReadonly();
  }

  getUnreadCount(inboxHash: string): number {
    return this.unreadCountsSignal()[inboxHash] ?? 0;
  }

  async createInbox(): Promise<{ created: boolean; email: string }> {
    const inbox: InboxModel = {
      emailAddress: 'stub@example.com',
      expiresAt: new Date().toISOString(),
      inboxHash: 'stub-hash',
      serverSigPk: 'stub-server-sig',
      secretKey: new Uint8Array(),
      emails: [],
    };

    this.inboxSignal.set([...this.inboxSignal(), inbox]);
    this.selectedInboxSignal.set(inbox);
    this.recalculateUnreadCounts();
    return { created: true, email: inbox.emailAddress };
  }

  selectInbox(inboxHash: string): void {
    const inbox = this.inboxSignal().find((entry) => entry.inboxHash === inboxHash) ?? null;
    this.selectedInboxSignal.set(inbox);
  }

  deleteInbox(inboxHash: string): void {
    this.inboxSignal.set(this.inboxSignal().filter((entry) => entry.inboxHash !== inboxHash));
    if (this.selectedInboxSignal()?.inboxHash === inboxHash) {
      this.selectedInboxSignal.set(this.inboxSignal()[0] ?? null);
    }
    this.recalculateUnreadCounts();
  }

  importInbox(): { success: boolean; message: string } {
    return { success: true, message: 'Imported stub inbox' };
  }

  exportInboxMetadata(): ExportedInboxData {
    const now = new Date().toISOString();
    return {
      version: 1,
      emailAddress: 'stub@example.com',
      expiresAt: now,
      inboxHash: 'stub-hash',
      serverSigPk: 'stub-server-sig',
      secretKey: '',
      exportedAt: now,
    };
  }

  clearLocalStorage(): void {
    return;
  }

  async subscribeToAllInboxes(): Promise<void> {
    return;
  }

  async loadEmailsForInbox(): Promise<void> {
    return;
  }

  private recalculateUnreadCounts(): void {
    const map = this.inboxSignal().reduce<Record<string, number>>((acc, inbox) => {
      acc[inbox.inboxHash] = inbox.emails.reduce((count, email) => (email.isRead ? count : count + 1), 0);
      return acc;
    }, {});
    this.unreadCountsSignal.set(map);
  }
}

export class EmailServiceStub implements Partial<EmailService> {
  private readonly selectedEmailSignal = signal<EmailItemModel | null>(null);

  get selectedEmail() {
    return this.selectedEmailSignal.asReadonly();
  }

  selectEmail(): void {
    this.selectedEmailSignal.set(null);
  }

  deselectEmail(): void {
    this.selectedEmailSignal.set(null);
  }

  async fetchAndDecryptEmail(): Promise<void> {
    return;
  }

  async fetchAndDecryptRawEmail(): Promise<string> {
    return '';
  }

  async markEmailAsRead(): Promise<void> {
    return;
  }

  deleteEmail(): void {
    this.selectedEmailSignal.set(null);
  }
}

export class SettingsManagerStub implements Partial<SettingsManager> {
  private settings: {
    ttlSeconds: number;
    ttlUnit: 'minutes' | 'hours' | 'days';
    lastUsedDomain: string;
    displayInlineImages: boolean;
    sanitizationLevel: SanitizationLevel;
    timeFormat: TimeFormat;
  } = {
    ttlSeconds: 3600,
    ttlUnit: 'hours',
    lastUsedDomain: '',
    displayInlineImages: false,
    sanitizationLevel: SanitizationLevel.DomPurify,
    timeFormat: '24h',
  };

  getSettings() {
    return this.settings;
  }

  saveSettings(settings: {
    ttlSeconds: number;
    ttlUnit: 'minutes' | 'hours' | 'days';
    lastUsedDomain: string;
    displayInlineImages: boolean;
    sanitizationLevel: SanitizationLevel;
    timeFormat: TimeFormat;
  }): void {
    this.settings = { ...settings };
  }

  async getTtlSetting(): Promise<{ ttlSeconds: number; ttlUnit: 'minutes' | 'hours' | 'days' }> {
    return {
      ttlSeconds: this.settings.ttlSeconds,
      ttlUnit: this.settings.ttlUnit,
    };
  }

  saveTtlSetting(ttlSeconds: number, ttlUnit: 'minutes' | 'hours' | 'days'): void {
    this.settings = { ...this.settings, ttlSeconds, ttlUnit };
  }
}

export class ServerInfoServiceStub implements Partial<ServerInfoService> {
  private readonly serverInfoSignal = signal<ServerInfo | null>({
    serverSigPk: 'stub',
    algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
    context: 'stub',
    maxTtl: 86400,
    defaultTtl: 3600,
    sseConsole: false,
    allowClearAllInboxes: true,
    allowedDomains: [],
  });

  get serverInfo() {
    return this.serverInfoSignal.asReadonly();
  }

  async getServerInfo(): Promise<ServerInfo | null> {
    return this.serverInfoSignal();
  }

  // Test helper method
  setServerInfo(info: ServerInfo | null): void {
    this.serverInfoSignal.set(info);
  }
}

export class VaultSandboxApiStub implements Partial<VaultSandboxApi> {
  private createEncryptedPayload(): EncryptedPayload {
    return {
      v: 1,
      algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
      ct_kem: '',
      nonce: '',
      aad: '',
      ciphertext: '',
      sig: '',
      server_sig_pk: 'stub',
    };
  }

  checkKey() {
    return of({ ok: true });
  }

  getServerInfo() {
    return of({
      serverSigPk: 'stub',
      algs: { kem: 'ml-kem', sig: 'ml-dsa', aead: 'aes-gcm', kdf: 'hkdf' },
      context: 'stub',
      maxTtl: 86400,
      defaultTtl: 3600,
      sseConsole: false,
      allowClearAllInboxes: true,
      allowedDomains: [],
    });
  }

  createInbox(domain: string, ttlSeconds?: number, emailAddress?: string) {
    consumeArgs(domain, ttlSeconds);
    return of({
      emailAddress: emailAddress ?? 'stub@example.com',
      expiresAt: new Date().toISOString(),
      inboxHash: 'stub-hash',
      serverSigPk: 'stub',
    });
  }

  listEmails(emailAddress: string) {
    consumeArgs(emailAddress);
    return of<EmailListItemResponse[]>([]);
  }

  getInboxSyncStatus(emailAddress: string) {
    consumeArgs(emailAddress);
    return of({ emailsHash: 'hash', emailCount: 0 });
  }

  getEmail(emailAddress: string, emailId: string) {
    consumeArgs(emailAddress, emailId);
    return of<EmailDetailResponse>({
      encryptedMetadata: this.createEncryptedPayload(),
      isRead: false,
    });
  }

  getRawEmail(emailAddress: string, emailId: string) {
    consumeArgs(emailAddress, emailId);
    return of<RawEmailResponse>({
      encryptedRaw: this.createEncryptedPayload(),
    });
  }

  deleteInbox(emailAddress: string) {
    consumeArgs(emailAddress);
    return of<void>(void 0);
  }

  markEmailAsRead(emailAddress: string, emailId: string) {
    consumeArgs(emailAddress, emailId);
    return of<void>(void 0);
  }

  deleteEmail(emailAddress: string, emailId: string) {
    consumeArgs(emailAddress, emailId);
    return of<void>(void 0);
  }

  clearAllInboxes() {
    return of<void>(void 0);
  }
}

export class EncryptionServiceStub implements Partial<EncryptionService> {
  generateKeypair(): KeyPair {
    const bytes = new Uint8Array(32);
    return {
      publicKey: bytes,
      secretKey: bytes,
      publicKeyB64: '',
      secretKeyB64: '',
    };
  }

  async decryptMetadata(
    encryptedMetadata: EncryptedPayload,
    clientSecretKey: Uint8Array,
  ): Promise<Record<string, unknown>> {
    consumeArgs(encryptedMetadata, clientSecretKey);
    return {
      from: 'stub@example.com',
      to: 'stub@example.com',
      subject: 'Stub Subject',
      receivedAt: new Date().toISOString(),
    };
  }

  async decryptBody(encryptedBody: EncryptedPayload, clientSecretKey: Uint8Array): Promise<string> {
    consumeArgs(encryptedBody, clientSecretKey);
    return '{}';
  }
}

export class InboxStateServiceStub implements Partial<InboxStateService> {
  private readonly inboxesSignal = signal<InboxModel[]>([]);
  private readonly selectedInboxSignal = signal<InboxModel | null>(null);
  private readonly unreadCountMapSignal = computed<Record<string, number>>(() => {
    return this.inboxesSignal().reduce<Record<string, number>>((acc, inbox) => {
      acc[inbox.inboxHash] = inbox.emails.reduce((count, email) => (email.isRead ? count : count + 1), 0);
      return acc;
    }, {});
  });

  readonly totalUnreadCount = computed<number>(() =>
    Object.values(this.unreadCountMapSignal()).reduce((sum, count) => sum + count, 0),
  );

  private readonly inboxCreatedSubject = new Subject<InboxModel>();
  private readonly inboxDeletedSubject = new Subject<string>();
  private readonly inboxUpdatedSubject = new Subject<InboxModel>();
  private readonly newEmailArrivedSubject = new Subject<EmailItemModel>();

  get inboxes(): InboxModel[] {
    return this.inboxesSignal();
  }

  get selectedInbox(): Signal<InboxModel | null> {
    return this.selectedInboxSignal.asReadonly();
  }

  get unreadCountByInbox(): Signal<Record<string, number>> {
    return this.unreadCountMapSignal;
  }

  get inboxCreated$() {
    return this.inboxCreatedSubject.asObservable();
  }

  get inboxDeleted$() {
    return this.inboxDeletedSubject.asObservable();
  }

  get inboxUpdated$() {
    return this.inboxUpdatedSubject.asObservable();
  }

  get newEmailArrived$() {
    return this.newEmailArrivedSubject.asObservable();
  }

  selectInbox(inboxHash: string): void {
    const inbox = this.inboxesSignal().find((i) => i.inboxHash === inboxHash);
    if (inbox) {
      this.selectedInboxSignal.set(inbox);
    }
  }

  getInboxSnapshot(inboxHash: string): InboxModel | undefined {
    return this.inboxesSignal().find((inbox) => inbox.inboxHash === inboxHash);
  }

  getInboxHashes(): string[] {
    return this.inboxesSignal().map((inbox) => inbox.inboxHash);
  }

  getUnreadCount(inboxHash: string): number {
    return this.unreadCountMapSignal()[inboxHash] ?? 0;
  }

  addInbox(inbox: InboxModel, options?: { persist?: boolean }): void {
    consumeArgs(options);
    this.inboxesSignal.set([...this.inboxesSignal(), inbox]);
    this.inboxCreatedSubject.next(inbox);
  }

  removeInbox(inboxHash: string): InboxModel[] {
    const updatedInboxes = this.inboxesSignal().filter((i) => i.inboxHash !== inboxHash);
    this.inboxesSignal.set(updatedInboxes);
    this.inboxDeletedSubject.next(inboxHash);

    if (this.selectedInboxSignal()?.inboxHash === inboxHash) {
      this.selectedInboxSignal.set(updatedInboxes[0] ?? null);
    }

    return updatedInboxes;
  }

  updateInbox(inbox: InboxModel): void {
    const inboxes = this.inboxesSignal();
    const updated = inboxes.map((existing) => (existing.inboxHash === inbox.inboxHash ? inbox : existing));
    this.inboxesSignal.set(updated);
    this.inboxUpdatedSubject.next(inbox);
  }

  notifyNewEmail(email: EmailItemModel): void {
    this.newEmailArrivedSubject.next(email);
  }

  clearLocalStorage(): void {
    return;
  }

  // Test helper methods
  setInboxes(inboxes: InboxModel[]): void {
    this.inboxesSignal.set(inboxes);
  }
}
