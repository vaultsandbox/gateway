import { Injectable, inject } from '@angular/core';
import { ExportedInboxData } from '../interfaces';
import { InboxStorageMapper } from './helpers/storage.helpers';
import { InboxStorageService } from './inbox-storage.service';
import { InboxStateService } from './inbox-state.service';

/**
 * Service responsible for importing and exporting inbox data.
 * Handles validation, serialization, and file processing.
 */
@Injectable({
  providedIn: 'root',
})
export class InboxImportExportService {
  private readonly storage = inject(InboxStorageService);
  private readonly state = inject(InboxStateService);

  /**
   * Exports metadata for the specified inbox for backup purposes.
   */
  exportInboxMetadata(inboxHash: string): ExportedInboxData | null {
    const inbox = this.state.getInboxSnapshot(inboxHash);
    if (!inbox) {
      console.error('[InboxImportExportService] Cannot export inbox: inbox not found', inboxHash);
      return null;
    }

    return this.storage.exportInbox(inbox);
  }

  /**
   * Imports a single inbox record and persists it when valid.
   */
  importInbox(importData: ExportedInboxData): { success: boolean; message: string; emailAddress?: string } {
    if (!this.storage.validateImportData(importData)) {
      return { success: false, message: 'Invalid inbox data structure' };
    }

    const existing = this.state.getInboxSnapshot(importData.inboxHash);
    if (existing) {
      return {
        success: false,
        message: `Inbox already exists: ${importData.emailAddress}`,
        emailAddress: importData.emailAddress,
      };
    }

    try {
      const inbox = this.storage.createInboxModelFromImport(importData);
      this.state.addInbox(inbox, { persist: true });

      return {
        success: true,
        message: `Inbox imported: ${importData.emailAddress}`,
        emailAddress: importData.emailAddress,
      };
    } catch (error) {
      console.error('[InboxImportExportService] Error importing inbox:', error);
      return {
        success: false,
        message: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Imports multiple inbox files and returns per-file outcomes.
   */
  async importMultipleInboxes(
    files: File[],
  ): Promise<{ filename: string; success: boolean; message: string; emailAddress?: string }[]> {
    const results: { filename: string; success: boolean; message: string; emailAddress?: string }[] = [];

    for (const file of files) {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const result = this.importInbox(data);
        results.push({ filename: file.name, ...result });
      } catch (error) {
        results.push({
          filename: file.name,
          success: false,
          message: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    return results;
  }

  /**
   * Downloads an inbox as a JSON file.
   * Filename follows spec Section 9.6: inbox-{sanitized_email}.json
   */
  downloadInbox(inboxHash: string): boolean {
    const exportData = this.exportInboxMetadata(inboxHash);
    if (!exportData) {
      return false;
    }

    const sanitizedEmail = InboxStorageMapper.sanitizeEmailForFilename(exportData.emailAddress);
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `inbox-${sanitizedEmail}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return true;
  }
}
