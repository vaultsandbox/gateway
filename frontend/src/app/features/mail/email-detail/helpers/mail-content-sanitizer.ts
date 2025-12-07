import DOMPurify, { Config as DOMPurifyConfig } from 'dompurify';
import { AttachmentData } from '../../interfaces';
import { SanitizationLevel } from '../../services/settings-manager';

/**
 * Allowed URI protocols for secure mode with images disabled.
 * Only permits cid for inline image placeholders (which get replaced).
 */
const SECURE_URI_PATTERN_WITHOUT_IMAGES = /^(?:cid:)/i;

export interface SanitizeHtmlOptions {
  displayInlineImages: boolean;
  sanitizationLevel: SanitizationLevel;
  attachments: AttachmentData[];
}

export interface SanitizedHtmlResult {
  processedHtml: string;
  sanitizedHtml: string;
  useIframe: boolean;
}

export class MailContentSanitizer {
  /**
   * Handles inline image processing and sanitization in one pass, returning raw and sanitized HTML.
   */
  static sanitizeEmailHtml(html: string, options: SanitizeHtmlOptions): SanitizedHtmlResult {
    const useIframe = options.sanitizationLevel === SanitizationLevel.None;

    // For iframe mode (trusted), skip inline image processing to preserve original HTML
    // The iframe will handle everything with its own styling
    const inlineHandled = useIframe
      ? html
      : options.displayInlineImages
        ? MailContentSanitizer.embedInlineImages(html, options.attachments)
        : MailContentSanitizer.stripInlineImages(html);

    const sanitizedHtml = MailContentSanitizer.applySanitization(
      inlineHandled,
      options.sanitizationLevel,
      options.displayInlineImages,
    );

    return {
      processedHtml: inlineHandled,
      sanitizedHtml,
      useIframe,
    };
  }

  /**
   * Base styles injected into iframe content for consistent rendering.
   * Uses system font stack for native appearance across platforms.
   */
  private static readonly IFRAME_BASE_STYLES = `<style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      margin: 8px;
    }
  </style>`;

  /**
   * Applies the configured sanitization level to HTML content.
   */
  static applySanitization(html: string, level: SanitizationLevel, displayInlineImages: boolean): string {
    // For 'none' (trusted mode with iframe), skip DOMPurify entirely for speed
    // The iframe sandbox will provide isolation
    // Inject base styles for consistent font rendering
    if (level === SanitizationLevel.None) {
      return MailContentSanitizer.IFRAME_BASE_STYLES + html;
    }

    const sanitizeConfig = MailContentSanitizer.createDomPurifyConfig(level, displayInlineImages);
    return DOMPurify.sanitize(html, sanitizeConfig) as string;
  }

  /**
   * Builds the DOMPurify configuration based on sanitization level and inline image visibility.
   */
  static createDomPurifyConfig(level: SanitizationLevel, displayInlineImages: boolean): DOMPurifyConfig {
    // Secure config: More permissive configuration for email styling while blocking dangerous elements
    const secureConfig: DOMPurifyConfig = {
      // Don't use SAFE_FOR_TEMPLATES as it can strip legitimate email styling
      SAFE_FOR_TEMPLATES: false,
      // Allow unknown protocols in CSS for better styling support (scripts still blocked via FORBID_TAGS)
      ALLOW_UNKNOWN_PROTOCOLS: true,
      // Block dangerous tags but allow most HTML for styling
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'form', 'input', 'link', 'meta'],
      FORBID_ATTR: ['action', 'formaction'],
      // Don't restrict URI patterns to allow CSS url() functions
      // Security is maintained by blocking script/iframe tags
      // Explicitly allow styling elements and attributes
      ADD_TAGS: ['style'],
      ADD_ATTR: ['style', 'class', 'id', 'width', 'height', 'align', 'valign', 'bgcolor', 'color', 'face', 'size'],
      // Allow data attributes which are sometimes used for styling
      ALLOW_DATA_ATTR: true,
    };

    // Images-off config: Extend secure config to block all image elements
    if (!displayInlineImages) {
      secureConfig.FORBID_TAGS = [...secureConfig.FORBID_TAGS!, 'img', 'picture', 'source'];
      secureConfig.FORBID_ATTR = [...secureConfig.FORBID_ATTR!, 'srcset', 'xlink:href'];
      // When images are off, restrict URIs to block remote image loading
      // But this might also affect CSS - users can use Trusted Mode for full styling
      secureConfig.ALLOWED_URI_REGEXP = SECURE_URI_PATTERN_WITHOUT_IMAGES;
    }

    return secureConfig;
  }

  /**
   * Replaces inline CID images with a user-facing placeholder.
   */
  static stripInlineImages(html: string): string {
    return html.replace(
      /<img[^>]+src=["']cid:[^"']+["'][^>]*>/gi,
      '<div class="inline-block bg-surface-200 dark:bg-surface-700 px-3 py-2 rounded text-sm text-surface-600 dark:text-surface-400 my-2">' +
        '<i class="pi pi-image mr-2"></i>Inline image hidden (enable in settings)' +
        '</div>',
    );
  }

  /**
   * Inlines CID-referenced attachments as data URLs when available.
   */
  static embedInlineImages(html: string, attachments: AttachmentData[]): string {
    if (!attachments?.length) {
      return html;
    }

    const cidMap = new Map<string, string>();

    attachments
      .filter((attachment) => attachment.contentId && attachment.contentDisposition === 'inline')
      .forEach((attachment) => {
        const dataUrl = `data:${attachment.contentType};base64,${attachment.content}`;
        const cid = attachment.contentId!.replace(/^<|>$/g, '');
        cidMap.set(cid, dataUrl);
      });

    return html.replace(/src=["']cid:([^"']+)["']/gi, (match, cid) => {
      const dataUrl = cidMap.get(cid);
      return dataUrl ? `src="${dataUrl}"` : match;
    });
  }
}
