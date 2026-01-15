import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, timeout, catchError } from 'rxjs';
import { AxiosError } from 'axios';

export interface FetchImageResult {
  buffer: Buffer;
  contentType: string;
}

export interface CheckLinkResult {
  valid: boolean;
  status?: number;
  contentType?: string;
}

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);
  private readonly REQUEST_TIMEOUT_MS = 10000; // 10 seconds
  private readonly MAX_CONTENT_LENGTH = 10 * 1024 * 1024; // 10 MB
  // Use a browser-like User-Agent to avoid being blocked by servers
  private readonly USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  /* v8 ignore next */
  constructor(private readonly httpService: HttpService) {}

  /**
   * Fetches an image from the given URL and returns the buffer and content type.
   * Validates that the URL is HTTP/HTTPS and handles errors gracefully.
   */
  async fetchImage(url: string): Promise<FetchImageResult> {
    // Validate URL
    const validatedUrl = this.validateUrl(url);

    this.logger.debug(`Fetching image from: ${validatedUrl.hostname}`);

    try {
      const response = await firstValueFrom(
        this.httpService
          .get<ArrayBuffer>(validatedUrl.href, {
            responseType: 'arraybuffer',
            timeout: this.REQUEST_TIMEOUT_MS,
            maxContentLength: this.MAX_CONTENT_LENGTH,
            maxBodyLength: this.MAX_CONTENT_LENGTH,
            headers: {
              Accept: 'image/*,*/*',
              'User-Agent': this.USER_AGENT,
            },
          })
          .pipe(
            timeout(this.REQUEST_TIMEOUT_MS),
            catchError((error: AxiosError) => {
              this.logger.warn(`Failed to fetch image from ${validatedUrl.hostname}: ${error.message}`);
              throw error;
            }),
          ),
      );

      const rawContentType = response.headers['content-type'] as string | undefined;
      const contentType: string = rawContentType || 'application/octet-stream';
      const buffer = Buffer.from(response.data);

      this.logger.debug(`Successfully fetched image: ${buffer.length} bytes, type: ${contentType}`);

      return { buffer, contentType };
    } catch (error) {
      const err = error as Error;
      this.logger.warn(`Image fetch failed: ${err.message}`);
      throw error;
    }
  }

  /**
   * Checks if a URL is valid and reachable using a HEAD request.
   * Falls back to GET request if HEAD returns 405 (Method Not Allowed).
   * Returns the validity status, HTTP status code, and content type.
   */
  async checkLink(url: string): Promise<CheckLinkResult> {
    // Validate URL (throws BadRequestException if invalid)
    const validatedUrl = this.validateUrl(url);

    this.logger.debug(`Checking link: ${validatedUrl.hostname}`);

    // Try HEAD request first
    const headResult = await this.tryHeadRequest(validatedUrl.href);

    // If HEAD returns 405, fall back to GET request
    if (headResult.status === 405) {
      this.logger.debug(`HEAD returned 405, falling back to GET for: ${validatedUrl.hostname}`);
      return this.tryGetRequest(validatedUrl.href);
    }

    return headResult;
  }

  /**
   * Attempts a HEAD request to check if a URL is reachable.
   */
  private async tryHeadRequest(url: string): Promise<CheckLinkResult> {
    try {
      const response = await firstValueFrom(
        this.httpService
          .head(url, {
            timeout: this.REQUEST_TIMEOUT_MS,
            headers: {
              'User-Agent': this.USER_AGENT,
            },
            maxRedirects: 5,
          })
          .pipe(
            timeout(this.REQUEST_TIMEOUT_MS),
            catchError((error: AxiosError) => {
              if (error.response) {
                return Promise.resolve(error.response);
              }
              throw error;
            }),
          ),
      );

      const status = response.status;
      const rawContentType = response.headers['content-type'] as string | undefined;
      const valid = status >= 200 && status < 400;

      this.logger.debug(`HEAD check result: status=${status}, valid=${valid}`);

      return {
        valid,
        status,
        contentType: rawContentType,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.debug(`HEAD check failed: ${err.message}`);
      return { valid: false };
    }
  }

  /**
   * Attempts a GET request to check if a URL is reachable.
   * Used as fallback when HEAD is not supported (405).
   */
  private async tryGetRequest(url: string): Promise<CheckLinkResult> {
    try {
      const response = await firstValueFrom(
        this.httpService
          .get(url, {
            timeout: this.REQUEST_TIMEOUT_MS,
            headers: {
              'User-Agent': this.USER_AGENT,
            },
            maxRedirects: 5,
            // Accept all status codes to get the response without throwing
            /* v8 ignore next */
            validateStatus: () => true,
          })
          .pipe(timeout(this.REQUEST_TIMEOUT_MS)),
      );

      const status = response.status;
      const rawContentType = response.headers['content-type'] as string | undefined;
      const valid = status >= 200 && status < 400;

      this.logger.debug(`GET check result: status=${status}, valid=${valid}`);

      return {
        valid,
        status,
        contentType: rawContentType,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.debug(`GET check failed: ${err.message}`);
      return { valid: false };
    }
  }

  /**
   * Validates that the URL is a valid HTTP/HTTPS URL.
   * Returns the parsed URL object or throws BadRequestException.
   */
  private validateUrl(url: string): URL {
    if (!url || typeof url !== 'string') {
      throw new BadRequestException('URL is required');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL format');
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new BadRequestException('Only HTTP/HTTPS URLs are allowed');
    }

    // Block private/internal IP ranges for security (SSRF prevention)
    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      throw new BadRequestException('Internal URLs are not allowed');
    }

    return parsedUrl;
  }
}
