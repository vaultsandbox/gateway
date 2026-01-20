import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  SimpleChanges,
  inject,
  ChangeDetectorRef,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ConfirmationService } from 'primeng/api';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ConfirmPopupModule } from 'primeng/confirmpopup';
import { TooltipModule } from 'primeng/tooltip';
import { TabsModule } from 'primeng/tabs';
import { firstValueFrom } from 'rxjs';
import { EmailItemModel } from '../interfaces';
import { MailManager } from '../services/mail-manager';
import { VsToast } from '../../../shared/services/vs-toast';
import { EmailHeadersComponent } from './email-headers/email-headers';
import { EmailAuthResultsComponent } from './email-auth-results/email-auth-results';
import { EmailAttachmentsComponent } from './email-attachments/email-attachments';
import { EmailLinksComponent } from './email-links/email-links';
import { EmailSpamAnalysisComponent } from './email-spam-analysis/email-spam-analysis';
import { ServerInfoService } from '../services/server-info.service';
import { SettingsManager, SanitizationLevel } from '../services/settings-manager';
import { DateFormatter } from '../../../shared/utils/date-formatter';
import { EmailHeaderFormatter, MailContentSanitizer, EmailDownloads, EmailScreenshot } from './helpers';
import { VaultSandboxApi } from '../services/vault-sandbox-api';

export enum EmailDetailTab {
  Html = 'html',
  Text = 'text',
  Headers = 'headers',
  Auth = 'auth',
  Spam = 'spam',
  Attachments = 'attachments',
  Links = 'links',
}

@Component({
  selector: 'app-email-detail',
  imports: [
    CommonModule,
    ButtonModule,
    CardModule,
    ConfirmPopupModule,
    ProgressSpinnerModule,
    TooltipModule,
    TabsModule,
    EmailHeadersComponent,
    EmailAuthResultsComponent,
    EmailAttachmentsComponent,
    EmailLinksComponent,
    EmailSpamAnalysisComponent,
  ],
  templateUrl: './email-detail.html',
  styleUrl: './email-detail.scss',
  standalone: true,
})
/**
 * Displays full email details with sanitization, attachments, headers, and navigation back to the list.
 */
export class EmailDetail implements OnInit, OnChanges {
  /**
   * Currently selected email to display, including parsed content and metadata.
   */
  @Input() email: EmailItemModel | null = null;
  /**
   * Event emitted when the user navigates back to the list view.
   */
  @Output() backToList = new EventEmitter<void>();
  /**
   * Reference to the email content container for screenshot capture.
   */
  @ViewChild('emailContentContainer') emailContentContainer?: ElementRef<HTMLElement>;

  protected readonly dateFormatter = DateFormatter;
  private readonly mailManager = inject(MailManager);
  private readonly settingsManager = inject(SettingsManager);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly toast = inject(VsToast);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly api = inject(VaultSandboxApi);
  private readonly serverInfoService = inject(ServerInfoService);

  /**
   * Currently active content tab.
   */
  activeTab: EmailDetailTab = EmailDetailTab.Html;
  /**
   * Whether inline images should be displayed in rendered HTML.
   */
  displayInlineImages = false;
  /**
   * User-selected sanitization level applied to HTML content.
   */
  sanitizationLevel: SanitizationLevel = SanitizationLevel.DomPurify;
  /**
   * Guards the raw email download button while a download is in progress.
   */
  isDownloadingRaw = false;
  /**
   * Guards the delete button while a delete is in progress.
   */
  isDeletingEmail = false;
  /**
   * Guards the screenshot button while a screenshot is in progress.
   */
  isTakingScreenshot = false;
  /**
   * Guards toggled content rendering to avoid blocking UI when switching emails.
   */
  isRenderingContent = false;
  /**
   * Holds the sanitized HTML content to be displayed.
   */
  sanitizedHtml: SafeHtml = '';
  /**
   * Indicates whether to use iframe rendering (trusted mode).
   */
  useIframeRendering = false;

  /**
   * Resizes an iframe to fit its content, eliminating internal scrollbars.
   */
  onIframeLoad(event: Event): void {
    const iframe = event.target as HTMLIFrameElement;
    if (!iframe?.contentWindow?.document?.body) {
      return;
    }

    try {
      // Get the full height of the iframe's content
      const contentHeight = iframe.contentWindow.document.body.scrollHeight;
      // Add some padding to avoid any edge cases
      iframe.style.height = `${contentHeight + 20}px`;
    } catch (error) {
      /* istanbul ignore next 2 - defensive catch for unexpected errors */
      // If we can't access the iframe content (shouldn't happen with allow-same-origin), fail silently
      console.warn('Could not resize iframe:', error);
    }
  }
  /**
   * Cached sanitized HTML keyed by inputs that affect the output.
   */
  private sanitizedHtmlCache: {
    rawHtml: string;
    displayInlineImages: boolean;
    sanitizationLevel: SanitizationLevel;
    safeHtml: SafeHtml;
    useIframe: boolean;
  } | null = null;

  /**
   * Loads settings on init and primes the sanitization cache state.
   */
  ngOnInit(): void {
    const settings = this.settingsManager.getSettings();
    this.displayInlineImages = settings.displayInlineImages;
    this.sanitizationLevel = settings.sanitizationLevel;
    this.invalidateSanitizedHtmlCache();
    // Defer initial sanitization to allow UI to render first
    setTimeout(() => {
      this.sanitizedHtml = this.getSanitizedHtml();
      this.cdr.markForCheck();
    }, 0);
  }

  /**
   * Opens an inline confirmation before deleting the email.
   */
  confirmDelete(event: Event): void {
    if (this.isDeletingEmail || !this.email) {
      return;
    }

    this.confirmationService.confirm({
      target: event.target as HTMLElement,
      key: 'emailDetailDelete',
      header: 'Delete Email',
      message: `Are you sure you want to delete this email from ${this.email.decryptedMetadata?.from || 'Unknown Sender'}?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: async () => {
        await this.deleteEmail();
      },
    });
  }

  /**
   * Resets rendering state and cache when the displayed email changes.
   */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['email']) {
      // Reset rendering state when email changes
      this.isRenderingContent = false;

      this.ensureActiveTabIsValid();
      this.invalidateSanitizedHtmlCache();

      // Progressive loading: even for cached emails, defer rendering to avoid lag
      // This allows the header to render first, then content loads smoothly
      if (this.email?.parsedContent && !this.email.isLoadingBody) {
        this.isRenderingContent = true;
        // Use setTimeout with change detection for zoneless mode
        setTimeout(() => {
          this.sanitizedHtml = this.getSanitizedHtml();
          this.isRenderingContent = false;
          this.cdr.markForCheck();
        }, 0);
      } else {
        this.sanitizedHtml = this.getSanitizedHtml();
      }
    }
  }

  /**
   * Emits an event to return to the email list view.
   */
  onBackClick(): void {
    this.backToList.emit();
  }

  /**
   * Returns sanitized HTML for the current email while honoring inline image settings and cache.
   */
  getSanitizedHtml(): SafeHtml {
    const htmlContent = this.email?.parsedContent?.html;

    if (!htmlContent) {
      this.invalidateSanitizedHtmlCache();
      this.useIframeRendering = false;
      return '';
    }

    // Check cache - must match HTML, displayInlineImages, and sanitizationLevel
    if (
      this.sanitizedHtmlCache?.rawHtml === htmlContent &&
      this.sanitizedHtmlCache?.displayInlineImages === this.displayInlineImages &&
      this.sanitizedHtmlCache?.sanitizationLevel === this.sanitizationLevel
    ) {
      this.useIframeRendering = this.sanitizedHtmlCache.useIframe;
      return this.sanitizedHtmlCache.safeHtml;
    }

    const { sanitizedHtml, useIframe } = MailContentSanitizer.sanitizeEmailHtml(htmlContent, {
      displayInlineImages: this.displayInlineImages,
      sanitizationLevel: this.sanitizationLevel,
      attachments: this.email?.parsedContent?.attachments || [],
    });

    this.useIframeRendering = useIframe;

    // SafeHtml wrapping stays here to keep Angular dependency out of helpers.
    const safeHtml = this.sanitizer.bypassSecurityTrustHtml(sanitizedHtml);

    this.sanitizedHtmlCache = {
      rawHtml: htmlContent,
      displayInlineImages: this.displayInlineImages,
      sanitizationLevel: this.sanitizationLevel,
      safeHtml,
      useIframe,
    };
    return safeHtml;
  }

  /**
   * Clears the sanitized HTML cache so it can be recalculated.
   */
  private invalidateSanitizedHtmlCache(): void {
    this.sanitizedHtmlCache = null;
  }

  /**
   * Downloads the raw email in EML format using the MailManager and helper utilities.
   */
  async downloadRawEmail(): Promise<void> {
    if (!this.email) {
      return;
    }

    const selectedInbox = this.mailManager.selectedInbox();
    if (!selectedInbox) {
      this.toast.showError('Inbox not found', 'Cannot download raw email without an inbox context.');
      return;
    }

    this.isDownloadingRaw = true;

    try {
      // Fetch and decrypt raw email from server
      const rawEmailB64 = await this.mailManager.fetchAndDecryptRawEmail(selectedInbox.inboxHash, this.email.id);
      if (!rawEmailB64) {
        this.toast.showError('Raw email data not available', 'The raw email content could not be retrieved.');
        return;
      }
      const blob = EmailDownloads.decodeRawEmail(rawEmailB64);
      const filename = EmailDownloads.buildRawEmailFilenameFromEmail(this.email);
      EmailDownloads.triggerEmlDownload(blob, filename);

      this.toast.showSuccess('Email downloaded successfully', `${filename} saved`);
    } catch (error) {
      console.error('Error downloading email:', error);
      this.toast.showError('Failed to download email', 'Please try again');
    } finally {
      this.isDownloadingRaw = false;
    }
  }

  /**
   * Captures a screenshot of the email content and downloads it as PNG.
   */
  /* istanbul ignore next */
  async downloadScreenshot(): Promise<void> {
    if (!this.email || !this.emailContentContainer?.nativeElement) {
      return;
    }

    this.isTakingScreenshot = true;

    try {
      // Determine the element to capture - for iframes, use the inner document body
      let elementToCapture: HTMLElement = this.emailContentContainer.nativeElement;

      if (this.useIframeRendering) {
        const iframe = this.emailContentContainer.nativeElement as HTMLIFrameElement;
        const iframeBody = iframe.contentDocument?.body;
        if (!iframeBody) {
          this.toast.showError('Cannot capture screenshot', 'Email content not accessible');
          return;
        }
        elementToCapture = iframeBody;
      }

      await EmailScreenshot.captureAndDownload({
        api: this.api,
        element: elementToCapture,
        email: this.email,
        isIframeBody: this.useIframeRendering,
      });

      const filename = EmailScreenshot.buildScreenshotFilename(this.email);
      this.toast.showSuccess('Screenshot saved', filename);
    } catch (error) {
      console.error('Error taking screenshot:', error);
      this.toast.showError('Failed to capture screenshot', 'Please try again');
    } finally {
      this.isTakingScreenshot = false;
    }
  }

  /**
   * Deletes the current email and returns to the list view.
   */
  async deleteEmail(): Promise<void> {
    if (!this.email) {
      return;
    }

    const selectedInbox = this.mailManager.selectedInbox();
    if (!selectedInbox) {
      this.toast.showError('Inbox not found', 'Cannot delete email without an inbox context.');
      return;
    }

    this.isDeletingEmail = true;

    try {
      await firstValueFrom(this.api.deleteEmail(selectedInbox.emailAddress, this.email.id));
      this.mailManager.deleteEmail(selectedInbox.inboxHash, this.email.id);
      this.toast.showSuccess('Deleted', 'Email deleted successfully', 3000);
      this.onBackClick();
    } catch (error) {
      console.error('Error deleting email:', error);
      this.toast.showError('Failed to delete email', 'Please try again');
    } finally {
      this.isDeletingEmail = false;
    }
  }

  /**
   * Signals whether HTML content is available.
   */
  hasHtml(): boolean {
    return Boolean(this.email?.parsedContent?.html);
  }

  /**
   * Signals whether plain-text content is available.
   */
  hasText(): boolean {
    return Boolean(this.email?.parsedContent?.text);
  }

  /**
   * Signals whether attachments exist for this email.
   */
  hasAttachments(): boolean {
    return (this.email?.parsedContent?.attachments?.length || 0) > 0;
  }

  /**
   * Signals whether hyperlinks were detected in the email body.
   */
  hasLinks(): boolean {
    return (this.email?.parsedContent?.links?.length || 0) > 0;
  }

  /**
   * Produces a formatted list of headers ready for display.
   */
  getHeadersList(): { key: string; value: string }[] {
    return EmailHeaderFormatter.buildHeadersList(this.email?.parsedContent?.headers);
  }

  /**
   * Returns whether spam analysis is enabled on the server.
   */
  isSpamAnalysisEnabled(): boolean {
    return this.serverInfoService.serverInfo()?.spamAnalysisEnabled ?? false;
  }

  /**
   * Signals whether spam analysis data exists for this email.
   */
  hasSpamAnalysis(): boolean {
    return Boolean(this.email?.parsedContent?.spamAnalysis);
  }

  /**
   * Ensures the active tab remains valid when content availability changes.
   */
  private ensureActiveTabIsValid(): void {
    const availableTabs: EmailDetailTab[] = [
      EmailDetailTab.Html,
      EmailDetailTab.Text,
      EmailDetailTab.Headers,
      EmailDetailTab.Auth,
    ];
    if (this.isSpamAnalysisEnabled()) {
      availableTabs.push(EmailDetailTab.Spam);
    }
    if (this.hasAttachments()) {
      availableTabs.push(EmailDetailTab.Attachments);
    }
    if (this.hasLinks()) {
      availableTabs.push(EmailDetailTab.Links);
    }

    if (!availableTabs.includes(this.activeTab)) {
      this.activeTab = availableTabs[0];
    }
  }
}
