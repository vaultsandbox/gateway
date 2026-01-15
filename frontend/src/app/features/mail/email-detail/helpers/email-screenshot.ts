import { toPng } from 'html-to-image';
import { firstValueFrom } from 'rxjs';
import { EmailItemModel } from '../../interfaces';
import { VaultSandboxApi } from '../../services/vault-sandbox-api';
import { EmailDownloads } from './email-downloads';

interface ScreenshotOptions {
  api: VaultSandboxApi;
  element: HTMLElement;
  email: EmailItemModel;
  isIframeBody?: boolean;
}

interface FailedImageInfo {
  img: HTMLImageElement;
  originalSrc: string;
  placeholder: HTMLElement;
}

/* istanbul ignore file */
export class EmailScreenshot {
  // 1x1 transparent PNG as base64 data URL - used to replace failed images
  private static readonly TRANSPARENT_PIXEL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  /**
   * Captures a screenshot of the email content and triggers a download.
   * Handles CORS by proxying external images through the backend.
   */
  static async captureAndDownload(options: ScreenshotOptions): Promise<void> {
    const { api, element, email, isIframeBody } = options;

    // Store original image sources for restoration after capture
    const originalSources = new Map<HTMLImageElement, string>();

    // Track failed images with placeholders
    const failedImages: FailedImageInfo[] = [];

    // Store original styles for iframe body
    let originalMargin = '';
    let originalPadding = '';

    // Track if we added fallback styles for sanitized content
    let addedFallbackStyles = false;
    let originalMinWidth = '';
    let originalMinHeight = '';

    try {
      // For iframe bodies, temporarily remove margins/padding to avoid offset
      if (isIframeBody) {
        originalMargin = element.style.margin;
        originalPadding = element.style.padding;
        element.style.margin = '0';
        element.style.padding = '0';
      } else {
        // For sanitized (non-iframe) content, check if element has collapsed
        // This can happen when DOMPurify strips CSS that controls layout
        const rect = element.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) {
          // Element has collapsed - add fallback dimensions
          originalMinWidth = element.style.minWidth;
          originalMinHeight = element.style.minHeight;
          element.style.minWidth = '600px';
          element.style.minHeight = '100px';
          addedFallbackStyles = true;
        }
      }

      // Replace external images with base64 data URLs via proxy
      await EmailScreenshot.replaceExternalImages(element, api, originalSources, failedImages);

      // Get the final dimensions after any style adjustments
      const finalRect = element.getBoundingClientRect();

      // Generate PNG using html-to-image on the original element
      // Pass explicit dimensions to avoid issues with collapsed/miscalculated sizes
      const dataUrl = await toPng(element, {
        cacheBust: false,
        pixelRatio: window.devicePixelRatio,
        skipFonts: true,
        width: Math.max(finalRect.width, 100),
        height: Math.max(finalRect.height, 50),
        style: {
          // Ensure the element is visible and has proper display
          display: 'block',
          visibility: 'visible',
        },
      });

      // Generate filename and trigger download
      const filename = EmailScreenshot.buildScreenshotFilename(email);
      EmailScreenshot.triggerDownload(dataUrl, filename);
    } finally {
      // Restore original image sources
      originalSources.forEach((src, img) => {
        img.src = src;
      });

      // Remove placeholders and restore failed images
      failedImages.forEach(({ img, originalSrc, placeholder }) => {
        img.src = originalSrc;
        img.style.display = '';
        placeholder.remove();
      });

      // Restore original iframe body styles
      if (isIframeBody) {
        element.style.margin = originalMargin;
        element.style.padding = originalPadding;
      }

      // Restore fallback styles if added
      if (addedFallbackStyles) {
        element.style.minWidth = originalMinWidth;
        element.style.minHeight = originalMinHeight;
      }
    }
  }

  /**
   * Builds a PNG filename from email metadata.
   */
  static buildScreenshotFilename(email: EmailItemModel): string {
    const subject = email.parsedContent?.subject || email.decryptedMetadata?.subject || 'email';
    const sanitizedSubject = EmailDownloads.sanitizeFilename(subject);
    const timestamp = new Date().toISOString().split('T')[0];
    return `${sanitizedSubject}_screenshot_${timestamp}.png`;
  }

  /**
   * Replaces external image sources with base64 data URLs to bypass CORS.
   * Saves original sources to the map for later restoration.
   * For failed images, creates a placeholder and tracks them for cleanup.
   */
  private static async replaceExternalImages(
    container: HTMLElement,
    api: VaultSandboxApi,
    originalSources: Map<HTMLImageElement, string>,
    failedImages: FailedImageInfo[],
  ): Promise<void> {
    const images = container.querySelectorAll('img');
    const externalImages = Array.from(images).filter((img) => EmailScreenshot.isExternalUrl(img.src));

    if (externalImages.length === 0) {
      return;
    }

    // Fetch all images in parallel and convert to base64 data URLs
    const fetchPromises = externalImages.map(async (img) => {
      const originalSrc = img.src;
      try {
        const blob = await firstValueFrom(api.getProxyImage(originalSrc));
        const dataUrl = await EmailScreenshot.blobToDataUrl(blob);
        originalSources.set(img, originalSrc);
        img.src = dataUrl;
      } catch (error) {
        // If fetching fails, create a placeholder and replace the image src
        // with a transparent pixel to prevent html-to-image from failing
        console.warn(`Failed to proxy image: ${originalSrc}`, error);
        const placeholder = EmailScreenshot.createImagePlaceholder(img);
        img.parentNode?.insertBefore(placeholder, img);
        img.style.display = 'none';
        // Use a 1x1 transparent PNG to avoid html-to-image trying to fetch the broken URL
        img.src = EmailScreenshot.TRANSPARENT_PIXEL;
        failedImages.push({ img, originalSrc, placeholder });
      }
    });

    await Promise.all(fetchPromises);
  }

  /**
   * Creates a placeholder element for a failed image.
   */
  private static createImagePlaceholder(img: HTMLImageElement): HTMLElement {
    const placeholder = document.createElement('div');

    // Get dimensions from the image, with fallbacks
    const width = img.width || img.naturalWidth || 150;
    const height = img.height || img.naturalHeight || 100;

    placeholder.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: ${width}px;
      height: ${height}px;
      background-color: #f0f0f0;
      border: 1px solid #ddd;
      color: #999;
      font-size: 12px;
      box-sizing: border-box;
    `;

    // Add a simple "image unavailable" icon using unicode
    placeholder.innerHTML = `
      <span style="text-align: center; line-height: 1.3;">
        <span style="font-size: 24px; display: block;">&#128247;</span>
        <span>Image unavailable</span>
      </span>
    `;

    return placeholder;
  }

  /**
   * Converts a Blob to a base64 data URL.
   */
  private static blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Checks if a URL is an external HTTP/HTTPS URL.
   */
  private static isExternalUrl(url: string): boolean {
    if (!url) return false;
    return url.startsWith('http://') || url.startsWith('https://');
  }

  /**
   * Triggers a browser download for a data URL.
   */
  private static triggerDownload(dataUrl: string, filename: string): void {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
