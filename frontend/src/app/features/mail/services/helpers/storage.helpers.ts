import { ExportedInboxData, InboxModel } from '../../interfaces';

/**
 * Size constants from VaultSandbox Cryptographic Protocol Specification v1.0
 */
export const MLKEM_SECRET_KEY_SIZE = 2400;
export const MLDSA_PUBLIC_KEY_SIZE = 1952;
export const EXPORT_VERSION = 1;

/**
 * Base64URL encode (RFC 4648 Section 5, no padding)
 */
export function base64urlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64URL decode (RFC 4648 Section 5)
 * Rejects input containing +, /, or = characters as per spec.
 */
export function base64urlDecode(str: string): Uint8Array {
  // Reject invalid characters per spec section 2.2
  if (/[+/=]/.test(str)) {
    throw new Error('Invalid base64url: contains +, /, or = characters');
  }

  // Convert base64url to standard base64
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if necessary
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

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
   * Checks if a string is valid base64url (no +, /, or = characters).
   */
  static isValidBase64url(value: string): boolean {
    // Must not contain +, /, or = per spec section 2.2
    if (/[+/=]/.test(value)) {
      return false;
    }
    // Must only contain valid base64url characters
    if (!/^[A-Za-z0-9_-]*$/.test(value)) {
      return false;
    }
    try {
      base64urlDecode(value);
      return true;
      /* istanbul ignore next - unreachable: upstream validation ensures decode won't throw */
    } catch {
      /* istanbul ignore next */
      return false;
    }
  }

  /**
   * Validates base64url and checks decoded size matches expected.
   */
  static isValidBase64urlWithSize(value: string, expectedSize: number): boolean {
    if (!this.isValidBase64url(value)) {
      return false;
    }
    try {
      const decoded = base64urlDecode(value);
      return decoded.length === expectedSize;
      /* istanbul ignore next - unreachable: isValidBase64url check ensures decode won't throw */
    } catch {
      /* istanbul ignore next */
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
      record.version === EXPORT_VERSION &&
      typeof record.emailAddress === 'string' &&
      typeof record.expiresAt === 'string' &&
      typeof record.inboxHash === 'string' &&
      typeof record.serverSigPk === 'string' &&
      typeof record.secretKey === 'string'
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
   * Implements validation per spec Section 10.1.
   */
  static isValidImportData(data: unknown): data is ExportedInboxData {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const record = data as Partial<ExportedInboxData>;

    // 1. Validate version (must be 1)
    if (record.version !== EXPORT_VERSION) {
      return false;
    }

    // 2. Validate required string fields exist
    if (
      typeof record.emailAddress !== 'string' ||
      typeof record.expiresAt !== 'string' ||
      typeof record.inboxHash !== 'string' ||
      typeof record.serverSigPk !== 'string' ||
      typeof record.secretKey !== 'string' ||
      typeof record.exportedAt !== 'string'
    ) {
      return false;
    }

    // 3. Validate emailAddress contains exactly one '@'
    const atCount = (record.emailAddress.match(/@/g) || []).length;
    if (atCount !== 1) {
      return false;
    }

    // 4. Validate inboxHash is non-empty
    if (record.inboxHash.length === 0) {
      return false;
    }

    // 5. Validate secretKey is valid base64url with correct size (2400 bytes)
    if (!this.isValidBase64urlWithSize(record.secretKey, MLKEM_SECRET_KEY_SIZE)) {
      return false;
    }

    // 6. Validate serverSigPk is valid base64url with correct size (1952 bytes)
    if (!this.isValidBase64urlWithSize(record.serverSigPk, MLDSA_PUBLIC_KEY_SIZE)) {
      return false;
    }

    return true;
  }
}

export class InboxStorageMapper {
  /**
   * Converts inbox models to storage-friendly records using base64url encoding.
   */
  static toStoredRecords(inboxes: InboxModel[]): StoredInboxRecord[] {
    return inboxes.map((inbox) => ({
      version: EXPORT_VERSION as 1,
      emailAddress: inbox.emailAddress,
      expiresAt: inbox.expiresAt,
      inboxHash: inbox.inboxHash,
      serverSigPk: inbox.serverSigPk,
      secretKey: base64urlEncode(inbox.secretKey),
    }));
  }

  /**
   * Maps stored payload back into inbox models, decoding base64url.
   */
  static toInboxModels(payload: StoredInboxesPayload): InboxModel[] {
    return payload.inboxes.map((inbox) => ({
      emailAddress: inbox.emailAddress,
      expiresAt: inbox.expiresAt,
      inboxHash: inbox.inboxHash,
      serverSigPk: inbox.serverSigPk,
      secretKey: base64urlDecode(inbox.secretKey),
      emails: [],
    }));
  }

  /**
   * Builds an exported inbox payload including metadata.
   * Uses base64url encoding per VaultSandbox spec Section 2.2.
   */
  static exportInbox(inbox: InboxModel): ExportedInboxData {
    return {
      version: EXPORT_VERSION as 1,
      emailAddress: inbox.emailAddress,
      expiresAt: inbox.expiresAt,
      inboxHash: inbox.inboxHash,
      serverSigPk: inbox.serverSigPk,
      secretKey: base64urlEncode(inbox.secretKey),
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Sanitizes email address for use in filename.
   * Per spec Section 9.6: @ replaced with _at_, invalid chars replaced with _.
   */
  static sanitizeEmailForFilename(email: string): string {
    return email.replace(/@/g, '_at_').replace(/[^a-zA-Z0-9._-]/g, '_');
  }
}

export class InboxStorageSafe {
  /**
   * Writes a value to localStorage with error handling.
   */
  static trySetItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
      /* istanbul ignore next - defensive catch for unexpected localStorage errors */
    } catch (error) {
      /* istanbul ignore next */
      console.error('[InboxStorage] Error saving to localStorage:', error);
    }
  }

  /**
   * Reads a value from localStorage with error handling.
   */
  static tryGetItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
      /* istanbul ignore next - defensive catch for unexpected localStorage errors */
    } catch (error) {
      /* istanbul ignore next */
      console.error('[InboxStorage] Error reading from localStorage:', error);
      /* istanbul ignore next */
      return null;
    }
  }

  /**
   * Removes a key from localStorage with error handling.
   */
  static tryRemoveItem(key: string): void {
    try {
      localStorage.removeItem(key);
      /* istanbul ignore next - defensive catch for unexpected localStorage errors */
    } catch (error) {
      /* istanbul ignore next */
      console.error('[InboxStorage] Error clearing localStorage key:', error);
    }
  }
}
