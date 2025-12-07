/**
 * Unit tests for URL extraction utilities
 *
 * @module url-extraction.utils.spec
 */

import { extractUrls } from './url-extraction.utils';

describe('URL Extraction Utils', () => {
  describe('extractUrls', () => {
    describe('Basic URL extraction from text', () => {
      it('should extract a single HTTP URL from plain text', () => {
        const text = 'Visit https://example.com for more info';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['https://example.com']);
      });

      it('should extract multiple URLs from plain text', () => {
        const text = 'Visit https://example.com and http://test.org';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['https://example.com', 'http://test.org']);
      });

      it('should extract FTP URLs', () => {
        const text = 'Download from ftp://files.example.com/file.zip';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['ftp://files.example.com/file.zip']);
      });

      it('should extract mailto URLs', () => {
        const text = 'Contact us at mailto:support@example.com';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['mailto:support@example.com']);
      });
    });

    describe('URL extraction from HTML anchor tags', () => {
      it('should extract URL from HTML anchor tag with double quotes', () => {
        const html = '<a href="https://example.com">Link</a>';
        const urls = extractUrls(html, undefined);
        expect(urls).toEqual(['https://example.com']);
      });

      it('should extract URL from HTML anchor tag with single quotes', () => {
        const html = "<a href='https://example.com'>Link</a>";
        const urls = extractUrls(html, undefined);
        expect(urls).toEqual(['https://example.com']);
      });

      it('should extract URL from HTML anchor tag without quotes', () => {
        const html = '<a href=https://example.com>Link</a>';
        const urls = extractUrls(html, undefined);
        expect(urls).toEqual(['https://example.com']);
      });

      it('should extract URLs from multiple anchor tags', () => {
        const html = `
          <a href="https://example.com">First</a>
          <a href="https://test.org">Second</a>
        `;
        const urls = extractUrls(html, undefined);
        expect(urls).toEqual(['https://example.com', 'https://test.org']);
      });

      it('should extract URL with attributes before href', () => {
        const html = '<a class="link" id="main" href="https://example.com">Link</a>';
        const urls = extractUrls(html, undefined);
        expect(urls).toEqual(['https://example.com']);
      });

      it('should extract URL with attributes after href', () => {
        const html = '<a href="https://example.com" class="link" target="_blank">Link</a>';
        const urls = extractUrls(html, undefined);
        expect(urls).toEqual(['https://example.com']);
      });
    });

    describe('URL deduplication', () => {
      it('should deduplicate identical URLs from text', () => {
        const text = 'Visit https://example.com and https://example.com again';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['https://example.com']);
      });

      it('should deduplicate URLs between HTML and text', () => {
        const html = '<a href="https://example.com">Link</a>';
        const text = 'Visit https://example.com';
        const urls = extractUrls(html, text);
        expect(urls).toEqual(['https://example.com']);
      });

      it('should preserve order of first occurrence', () => {
        const html = '<a href="https://second.com">Second</a>';
        const text = 'First: https://first.com, Second: https://second.com';
        const urls = extractUrls(html, text);
        // HTML is processed first, then text
        expect(urls).toEqual(['https://second.com', 'https://first.com']);
      });
    });

    describe('Different URL schemes', () => {
      it('should support HTTP scheme', () => {
        const text = 'Visit http://example.com';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['http://example.com']);
      });

      it('should support HTTPS scheme', () => {
        const text = 'Visit https://example.com';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['https://example.com']);
      });

      it('should support FTP scheme', () => {
        const text = 'Download ftp://files.example.com/file.zip';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['ftp://files.example.com/file.zip']);
      });

      it('should support mailto scheme', () => {
        const text = 'Email mailto:user@example.com';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['mailto:user@example.com']);
      });

      it('should mix different schemes', () => {
        const text = 'Visit https://example.com or ftp://files.example.com or mailto:user@example.com';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['https://example.com', 'ftp://files.example.com', 'mailto:user@example.com']);
      });
    });

    describe('URLs with query parameters and fragments', () => {
      it('should extract URL with query parameters', () => {
        const text = 'Verify at https://example.com/verify?token=abc123&user=john';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['https://example.com/verify?token=abc123&user=john']);
      });

      it('should extract URL with fragment', () => {
        const text = 'See https://example.com/docs#section-1';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['https://example.com/docs#section-1']);
      });

      it('should extract URL with both query and fragment', () => {
        const text = 'Check https://example.com/page?id=1#top';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['https://example.com/page?id=1#top']);
      });
    });

    describe('URLs with ports', () => {
      it('should extract URL with port number', () => {
        const text = 'Connect to https://example.com:8080/api';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['https://example.com:8080/api']);
      });

      it('should extract URL with non-standard port', () => {
        const text = 'Visit http://localhost:3000/app';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['http://localhost:3000/app']);
      });
    });

    describe('URLs with encoded characters', () => {
      it('should extract URL with percent-encoded characters', () => {
        const text = 'Search https://example.com/search?q=hello%20world';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['https://example.com/search?q=hello%20world']);
      });

      it('should extract URL with multiple encoded characters', () => {
        const text = 'Visit https://example.com/path%2Fto%2Fresource';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['https://example.com/path%2Fto%2Fresource']);
      });
    });

    describe('Edge cases', () => {
      it('should return empty array when no URLs found', () => {
        const text = 'This text has no URLs';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual([]);
      });

      it('should return empty array when inputs are undefined', () => {
        const urls = extractUrls(undefined, undefined);
        expect(urls).toEqual([]);
      });

      it('should return empty array when inputs are empty strings', () => {
        const urls = extractUrls('', '');
        expect(urls).toEqual([]);
      });

      it('should handle HTML with no anchor tags', () => {
        const html = '<p>This is a paragraph with no links</p>';
        const urls = extractUrls(html, undefined);
        expect(urls).toEqual([]);
      });

      it('should handle malformed HTML gracefully', () => {
        const html = '<a href="https://example.com">Unclosed tag';
        const urls = extractUrls(html, undefined);
        expect(urls).toEqual(['https://example.com']);
      });

      it('should skip anchor tags with invalid schemes', () => {
        const html = '<a href="javascript:alert(1)">Bad</a><a href="https://example.com">Good</a>';
        const urls = extractUrls(html, undefined);
        expect(urls).toEqual(['https://example.com']);
      });

      it('should handle URLs at start of text', () => {
        const text = 'https://example.com is the site';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['https://example.com']);
      });

      it('should handle URLs at end of text', () => {
        const text = 'Visit our site at https://example.com';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['https://example.com']);
      });

      it('should handle URLs with trailing punctuation', () => {
        const text = 'Visit https://example.com.';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['https://example.com']);
      });

      it('should handle URLs in parentheses', () => {
        const text = 'Visit (https://example.com) for info';
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['https://example.com']);
      });
    });

    describe('Mixed HTML and text content', () => {
      it('should extract URLs from both HTML and text', () => {
        const html = '<a href="https://html.example.com">HTML Link</a>';
        const text = 'Also visit https://text.example.com';
        const urls = extractUrls(html, text);
        expect(urls).toEqual(['https://html.example.com', 'https://text.example.com']);
      });

      it('should combine URLs from complex HTML and text', () => {
        const html = `
          <div>
            <a href="https://first.com">First</a>
            <p>Some text</p>
            <a href="https://second.com">Second</a>
          </div>
        `;
        const text = 'Visit https://third.com or https://fourth.com for more';
        const urls = extractUrls(html, text);
        expect(urls).toEqual(['https://first.com', 'https://second.com', 'https://third.com', 'https://fourth.com']);
      });
    });

    describe('Real-world email examples', () => {
      it('should extract verification link from typical verification email', () => {
        const html = `
          <html>
            <body>
              <p>Please verify your email by clicking the link below:</p>
              <a href="https://myapp.com/verify?token=abc123xyz">Verify Email</a>
            </body>
          </html>
        `;
        const text = 'Please verify your email: https://myapp.com/verify?token=abc123xyz';
        const urls = extractUrls(html, text);
        expect(urls).toEqual(['https://myapp.com/verify?token=abc123xyz']);
      });

      it('should extract multiple links from newsletter', () => {
        const html = `
          <html>
            <body>
              <a href="https://news.example.com/article1">Article 1</a>
              <a href="https://news.example.com/article2">Article 2</a>
              <a href="https://news.example.com/unsubscribe">Unsubscribe</a>
            </body>
          </html>
        `;
        const urls = extractUrls(html, undefined);
        expect(urls).toEqual([
          'https://news.example.com/article1',
          'https://news.example.com/article2',
          'https://news.example.com/unsubscribe',
        ]);
      });

      it('should extract password reset link', () => {
        const text = `
          You requested a password reset. Click the link below to reset your password:
          https://accounts.example.com/reset-password?token=xyz789&expires=1234567890

          This link expires in 1 hour.
        `;
        const urls = extractUrls(undefined, text);
        expect(urls).toEqual(['https://accounts.example.com/reset-password?token=xyz789&expires=1234567890']);
      });
    });
  });
});
