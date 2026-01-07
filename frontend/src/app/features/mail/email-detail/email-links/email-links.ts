import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { BadgeModule } from 'primeng/badge';
import { TooltipModule } from 'primeng/tooltip';
import { VsToast } from '../../../../shared/services/vs-toast';
import { EmailLinksHelpers, LinkValidationStatus } from './email-links.helpers';
import { FETCH_TIMEOUT_MS } from '../../../../shared/constants/app.constants';

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

  linkStatuses: LinkValidationStatus[] = [];
  isValidatingAll = false;
  protected readonly helpers = EmailLinksHelpers;

  /**
   * Validates a single link, skipping unsupported schemes and updating status+toast.
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
      this.toast.showInfo('FTP Link', 'FTP links cannot be validated from the browser');
      return;
    }

    linkStatus.status = 'checking';
    linkStatus.error = undefined;
    linkStatus.statusCode = undefined;

    try {
      // Use fetch with no-cors mode to check if the link is accessible
      // Note: This is a basic check and won't work for all URLs due to CORS
      const controller = new AbortController();
      /* istanbul ignore next - timeout callback only fires when fetch takes too long */
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(linkStatus.url, {
        method: 'HEAD',
        mode: 'no-cors', // Bypass CORS restrictions
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // With no-cors, we won't get the actual status code
      // If the fetch completes without error, we assume the link is valid
      linkStatus.status = 'valid';
      linkStatus.statusCode = response.status || undefined;

      //this.toast.showSuccess('Link Validated', 'Link appears to be accessible');
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          linkStatus.status = 'error';
          linkStatus.error = `Request timeout (${FETCH_TIMEOUT_MS / 1000}s)`;
        } else if (error.message.includes('Failed to fetch')) {
          // This might be due to CORS, so we'll try a different approach
          linkStatus.status = 'valid';
          linkStatus.error = 'CORS blocked (link might still be valid)';
        } else {
          linkStatus.status = 'error';
          linkStatus.error = error.message;
        }
      } else {
        linkStatus.status = 'error';
        linkStatus.error = 'Unknown error occurred';
      }

      if (linkStatus.status === 'error') {
        this.toast.showError('Validation Failed', linkStatus.error || 'Unable to validate link');
      }
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
