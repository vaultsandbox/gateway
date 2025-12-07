import { Injectable } from '@angular/core';
import { ExportedInboxData, InboxModel } from '../interfaces';
import {
  InboxStorageKeys,
  InboxStorageMapper,
  InboxStorageSafe,
  InboxStorageValidator,
  StoredInboxesPayload,
} from './helpers/storage.helpers';

@Injectable({
  providedIn: 'root',
})
export class InboxStorageService {
  /**
   * Persists inbox records to local storage.
   * @param inboxes Inbox models to serialize and save.
   */
  saveInboxes(inboxes: InboxModel[]): void {
    const storedInboxes = InboxStorageMapper.toStoredRecords(inboxes);
    const payload: StoredInboxesPayload = { inboxes: storedInboxes };
    InboxStorageSafe.trySetItem(InboxStorageKeys.INBOXES_KEY, JSON.stringify(payload));
  }

  /**
   * Loads inbox records from local storage and maps them to models.
   */
  loadInboxes(): InboxModel[] {
    const raw = InboxStorageSafe.tryGetItem(InboxStorageKeys.INBOXES_KEY);
    if (!raw) {
      return [];
    }

    try {
      const data = JSON.parse(raw) as unknown;
      if (!InboxStorageValidator.isStoredInboxesPayload(data)) {
        return [];
      }

      return InboxStorageMapper.toInboxModels(data);
    } catch (error) {
      console.error('[InboxStorage] Error parsing localStorage payload:', error);
      return [];
    }
  }

  /**
   * Removes all inbox and settings records from storage.
   */
  clearStorage(): void {
    InboxStorageSafe.tryRemoveItem(InboxStorageKeys.INBOXES_KEY);
    InboxStorageSafe.tryRemoveItem(InboxStorageKeys.SETTINGS_KEY);
  }

  /**
   * Converts an inbox to the exported payload format.
   * @param inbox Inbox model to export.
   */
  exportInbox(inbox: InboxModel): ExportedInboxData {
    return InboxStorageMapper.exportInbox(inbox);
  }

  /**
   * Validates whether the provided data matches an inbox export payload.
   * @param data Raw data parsed from an import file.
   */
  validateImportData(data: unknown): data is ExportedInboxData {
    return InboxStorageValidator.isValidImportData(data);
  }

  /**
   * Builds an inbox model from imported data, decoding secret keys.
   * @param importData Validated inbox export payload.
   */
  createInboxModelFromImport(importData: ExportedInboxData): InboxModel {
    return {
      emailAddress: importData.emailAddress,
      expiresAt: importData.expiresAt,
      inboxHash: importData.inboxHash,
      serverSigPk: importData.serverSigPk,
      secretKey: Uint8Array.from(atob(importData.secretKeyB64), (c) => c.charCodeAt(0)),
      emails: [],
      emailsHash: undefined,
    };
  }
}
