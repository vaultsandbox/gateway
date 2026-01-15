import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { BadgeModule } from 'primeng/badge';
import { TooltipModule } from 'primeng/tooltip';
import { firstValueFrom } from 'rxjs';
import { VsToast } from '../../../../shared/services/vs-toast';
import { VaultSandboxApi } from '../../services/vault-sandbox-api';
import { EmailLinksHelpers, LinkValidationStatus } from './email-links.helpers';

@Component({
  selector: 'app-email-links',
  standalone: true,
  imports: [CommonModule, ButtonModule, CardModule, BadgeModule, TooltipModule],
  templateUrl: './email-links.html',
  styleUrl: './email-links.scss',
})
export class EmailLinksComponent {
  /**
   * Accepts links from the parent and initializes validation state for each entry.
   */
  @Input() set links(value: string[] | undefined) {
    this.linkStatuses = (value || []).map((url) => ({
      url,
      status: 'unchecked' as const,
    }));
  }

  private readonly toast = inject(VsToast);
  private readonly api = inject(VaultSandboxApi);

  linkStatuses: LinkValidationStatus[] = [];
  isValidatingAll = false;
  protected readonly helpers = EmailLinksHelpers;

  /**
   * Validates a single link via the backend proxy, skipping unsupported schemes.
   */
  async validateLink(linkStatus: LinkValidationStatus): Promise<void> {
    if (linkStatus.status === 'checking') {
      return;
    }

    // Skip mailto links
    if (linkStatus.url.toLowerCase().startsWith('mailto:')) {
      this.toast.showInfo('Email Link', 'Email links cannot be validated automatically');
      return;
    }

    // Skip FTP links
    if (linkStatus.url.toLowerCase().startsWith('ftp://')) {
      this.toast.showInfo('FTP Link', 'FTP links cannot be validated automatically');
      return;
    }

    linkStatus.status = 'checking';
    linkStatus.error = undefined;
    linkStatus.statusCode = undefined;

    try {
      const result = await firstValueFrom(this.api.checkLink(linkStatus.url));

      if (result.valid) {
        linkStatus.status = 'valid';
        linkStatus.statusCode = result.status;
      } else {
        linkStatus.status = 'invalid';
        linkStatus.statusCode = result.status;
        linkStatus.error = result.status ? `HTTP ${result.status}` : 'Link unreachable';
      }
    } catch (error: unknown) {
      linkStatus.status = 'error';
      if (error instanceof Error) {
        linkStatus.error = error.message;
      } else {
        linkStatus.error = 'Failed to validate link';
      }
      this.toast.showError('Validation Failed', linkStatus.error);
    }
  }

  /**
   * Validates all links in batches, summarizing results to the user.
   */
  async validateAllLinks(): Promise<void> {
    this.isValidatingAll = true;

    try {
      // Validate links in parallel with a limit to avoid overwhelming the browser
      const batchSize = 5;
      for (let i = 0; i < this.linkStatuses.length; i += batchSize) {
        const batch = this.linkStatuses.slice(i, i + batchSize);
        await Promise.all(batch.map((linkStatus) => this.validateLink(linkStatus)));
      }

      const validCount = this.linkStatuses.filter((ls) => ls.status === 'valid').length;
      const errorCount = this.linkStatuses.filter((ls) => ls.status === 'error' || ls.status === 'invalid').length;

      this.toast.showInfo(
        'Validation Complete',
        `${validCount} valid, ${errorCount} errors out of ${this.linkStatuses.length} links`,
      );
    } catch (error) {
      console.error('Error validating all links:', error);
      this.toast.showError('Validation Error', 'An error occurred while validating links');
    } finally {
      this.isValidatingAll = false;
    }
  }

  /**
   * Copies a link to the clipboard with feedback.
   */
  async copyToClipboard(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.toast.showSuccess('Copied', 'Link copied to clipboard');
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      this.toast.showError('Copy Failed', 'Unable to copy link to clipboard');
    }
  }
}
