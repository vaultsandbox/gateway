import { ExportedInboxData, InboxModel } from '../../interfaces';

export type StoredInboxRecord = Omit<ExportedInboxData, 'exportedAt'>;

export interface StoredInboxesPayload {
  inboxes: StoredInboxRecord[];
}

export class InboxStorageKeys {
  static readonly INBOXES_KEY = 'vaultsandbox_inboxes';
  static readonly SETTINGS_KEY = 'vaultsandbox_settings';
}

export class InboxStorageValidator {
  /**
   * Checks if a string is valid base64.
   */
  static isValidBase64(value: string): boolean {
    try {
      return btoa(atob(value)) === value;
    } catch {
      return false;
    }
  }

  /**
   * Validates shape of a stored inbox record.
   */
  static isStoredInboxRecord(value: unknown): value is StoredInboxRecord {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const record = value as Partial<StoredInboxRecord>;
    return (
      typeof record.emailAddress === 'string' &&
      typeof record.expiresAt === 'string' &&
      typeof record.inboxHash === 'string' &&
      typeof record.serverSigPk === 'string' &&
      typeof record.secretKeyB64 === 'string'
    );
  }

  /**
   * Validates an inboxes payload structure loaded from storage.
   */
  static isStoredInboxesPayload(data: unknown): data is StoredInboxesPayload {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const inboxes = (data as { inboxes?: unknown }).inboxes;
    if (!Array.isArray(inboxes)) {
      return false;
    }

    return inboxes.every((inbox) => this.isStoredInboxRecord(inbox));
  }

  /**
   * Verifies raw import data matches the exported inbox schema.
   */
  static isValidImportData(data: unknown): data is ExportedInboxData {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const record = data as Partial<ExportedInboxData>;
    return (
      typeof record.emailAddress === 'string' &&
      typeof record.expiresAt === 'string' &&
      typeof record.inboxHash === 'string' &&
      typeof record.serverSigPk === 'string' &&
      typeof record.secretKeyB64 === 'string' &&
      record.emailAddress.includes('@') &&
      record.inboxHash.length > 0 &&
      this.isValidBase64(record.secretKeyB64)
    );
  }
}

export class InboxStorageMapper {
  /**
   * Converts inbox models to storage-friendly records.
   */
  static toStoredRecords(inboxes: InboxModel[]): StoredInboxRecord[] {
    return inboxes.map((inbox) => ({
      emailAddress: inbox.emailAddress,
      expiresAt: inbox.expiresAt,
      inboxHash: inbox.inboxHash,
      serverSigPk: inbox.serverSigPk,
      secretKeyB64: btoa(String.fromCharCode(...inbox.secretKey)),
    }));
  }

  /**
   * Maps stored payload back into inbox models.
   */
  static toInboxModels(payload: StoredInboxesPayload): InboxModel[] {
    return payload.inboxes.map((inbox) => ({
      emailAddress: inbox.emailAddress,
      expiresAt: inbox.expiresAt,
      inboxHash: inbox.inboxHash,
      serverSigPk: inbox.serverSigPk,
      secretKey: Uint8Array.from(atob(inbox.secretKeyB64), (c) => c.charCodeAt(0)),
      emails: [],
      emailsHash: undefined,
    }));
  }

  /**
   * Builds an exported inbox payload including metadata.
   */
  static exportInbox(inbox: InboxModel): ExportedInboxData {
    return {
      emailAddress: inbox.emailAddress,
      expiresAt: inbox.expiresAt,
      inboxHash: inbox.inboxHash,
      serverSigPk: inbox.serverSigPk,
      secretKeyB64: btoa(String.fromCharCode(...inbox.secretKey)),
      exportedAt: new Date().toISOString(),
    };
  }
}

export class InboxStorageSafe {
  /**
   * Writes a value to localStorage with error handling.
   */
  static trySetItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.error('[InboxStorage] Error saving to localStorage:', error);
    }
  }

  /**
   * Reads a value from localStorage with error handling.
   */
  static tryGetItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error('[InboxStorage] Error reading from localStorage:', error);
      return null;
    }
  }

  /**
   * Removes a key from localStorage with error handling.
   */
  static tryRemoveItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('[InboxStorage] Error clearing localStorage key:', error);
    }
  }
}
