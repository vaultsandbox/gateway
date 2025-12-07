import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { VsToast } from '../../../../shared/services/vs-toast';

export interface EmailHeaderItem {
  key: string;
  value: string;
}

@Component({
  selector: 'app-email-headers',
  standalone: true,
  imports: [CommonModule, FormsModule, InputTextModule, ButtonModule, TooltipModule],
  templateUrl: 'email-headers.html',
  styleUrl: './email-headers.scss',
})
export class EmailHeadersComponent {
  @Input() headers: EmailHeaderItem[] = [];

  searchTerm = '';

  private readonly toast = inject(VsToast);

  /**
   * Returns headers filtered by the current search term (case-insensitive).
   */
  filteredHeaders(): EmailHeaderItem[] {
    if (!this.searchTerm) {
      return this.headers;
    }

    const term = this.searchTerm.toLowerCase();
    return this.headers.filter(
      (header) => header.key.toLowerCase().includes(term) || header.value.toLowerCase().includes(term),
    );
  }

  /**
   * Copies a single header value to the clipboard.
   */
  copyToClipboard(text: string): void {
    navigator.clipboard
      .writeText(text)
      .then(() => this.toast.showSuccess('', 'Copied to clipboard'))
      .catch((error) => {
        console.error('Failed to copy header value:', error);
        this.toast.showError('', 'Failed to copy to clipboard');
      });
  }

  /**
   * Copies all headers as newline-separated entries to the clipboard.
   */
  copyAllHeaders(): void {
    const allHeaders = this.headers.map((h) => `${h.key}: ${h.value}`).join('\n');

    navigator.clipboard
      .writeText(allHeaders)
      .then(() => this.toast.showSuccess('', 'All headers copied to clipboard'))
      .catch((error) => {
        console.error('Failed to copy headers:', error);
        this.toast.showError('', 'Failed to copy to clipboard');
      });
  }
}
