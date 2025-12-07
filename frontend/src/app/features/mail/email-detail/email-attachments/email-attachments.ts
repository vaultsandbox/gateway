import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { BadgeModule } from 'primeng/badge';
import { AttachmentData } from '../../interfaces';
import { VsToast } from '../../../../shared/services/vs-toast';

@Component({
  selector: 'app-email-attachments',
  standalone: true,
  imports: [CommonModule, ButtonModule, CardModule, BadgeModule],
  templateUrl: './email-attachments.html',
  styleUrl: './email-attachments.scss',
})
export class EmailAttachmentsComponent {
  @Input() attachments: AttachmentData[] = [];

  private readonly toast = inject(VsToast);

  /**
   * Downloads a single attachment by constructing a Blob and triggering a browser download.
   */
  downloadAttachment(attachment: AttachmentData): void {
    try {
      const binaryString = atob(attachment.content);
      const bytes = new Uint8Array(binaryString.length);

      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: attachment.contentType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      this.toast.showSuccess('Download', `Downloaded ${attachment.filename}`);
    } catch (error) {
      console.error('Error downloading attachment:', error);
      this.toast.showError('Download', 'Failed to download attachment');
    }
  }

  /**
   * Formats a byte size into a human-readable string (B, KB, MB).
   */
  formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return bytes + ' B';
    }

    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(2) + ' KB';
    }

    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  /**
   * Chooses an icon class based on the attachment MIME type.
   */
  getFileIcon(contentType: string): string {
    if (contentType.startsWith('image/')) {
      return 'pi pi-image text-blue-500';
    }

    if (contentType.startsWith('video/')) {
      return 'pi pi-video text-purple-500';
    }

    if (contentType.includes('pdf')) {
      return 'pi pi-file-pdf text-red-500';
    }

    if (contentType.includes('word') || contentType.includes('document')) {
      return 'pi pi-file-word text-blue-600';
    }

    if (contentType.includes('excel') || contentType.includes('spreadsheet')) {
      return 'pi pi-file-excel text-green-600';
    }

    if (contentType.includes('zip') || contentType.includes('compressed')) {
      return 'pi pi-file text-yellow-600';
    }

    return 'pi pi-file text-surface-500';
  }
}
