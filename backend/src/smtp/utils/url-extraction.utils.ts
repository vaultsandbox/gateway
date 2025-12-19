/**
 * URL extraction utilities for email content
 *
 * Extracts URLs from both HTML and plain text email content,
 * supporting common URL schemes and handling edge cases.
 *
 * @module url-extraction
 */

/**
 * Maximum URL length to process (defense-in-depth against ReDoS and memory abuse)
 * RFC 2616 suggests 2048 is a reasonable limit; most browsers support up to 2083
 */
const MAX_URL_LENGTH = 2048;

/**
 * Regular expression pattern for matching URLs in plain text
 *
 * Matches URLs with the following schemes:
 * - http://
 * - https://
 * - ftp://
 * - mailto:
 *
 * Handles:
 * - Query parameters (?key=value)
 * - URL fragments (#anchor)
 * - Encoded characters (%20)
 * - Ports (:8080)
 * - Authentication (user:pass@)
 */
const URL_REGEX = /\b(https?:\/\/|ftp:\/\/|mailto:)([^\s<>"{}|\\^`[\]]+)/gi;

/**
 * Regular expression pattern for extracting href attributes from HTML anchor tags
 *
 * Matches:
 * - <a href="...">
 * - <a href='...'>
 * - <a href=...> (unquoted)
 *
 * Captures the URL from the href attribute value.
 */
const HTML_HREF_REGEX = /<a\s+[^>]*href=["']?([^"'\s>]+)["']?[^>]*>/gi;

/**
 * Extracts URLs from email HTML and plain text content
 *
 * This function performs URL extraction in the following order:
 * 1. Extract URLs from HTML <a href="..."> tags
 * 2. Extract URLs from plain text using regex pattern
 * 3. Combine and deduplicate URLs while preserving order of first occurrence
 *
 * Supported URL schemes:
 * - http:// and https://
 * - ftp://
 * - mailto:
 *
 * Edge cases handled:
 * - Malformed URLs are included as-is (validation happens elsewhere)
 * - Encoded characters (%20, etc.) are preserved
 * - Duplicate URLs are removed (case-sensitive comparison)
 * - Empty or undefined inputs are handled gracefully
 * - Trailing punctuation (commas, periods, parentheses) is stripped from plain text URLs
 * - URLs exceeding 2048 characters are skipped (defense-in-depth)
 *
 * @param html - HTML email content (optional)
 * @param text - Plain text email content (optional)
 * @returns Array of unique URLs in order of first occurrence, or empty array if no URLs found
 *
 * @example
 * ```typescript
 * const html = '<a href="https://example.com">Link</a>';
 * const text = 'Visit https://example.org for more info';
 * const urls = extractUrls(html, text);
 * // Returns: ['https://example.com', 'https://example.org']
 * ```
 */
export function extractUrls(html?: string, text?: string): string[] {
  const urls = new Set<string>();

  // Extract URLs from HTML anchor tags
  if (html) {
    let match: RegExpExecArray | null;
    // Reset regex state
    HTML_HREF_REGEX.lastIndex = 0;

    while ((match = HTML_HREF_REGEX.exec(html)) !== null) {
      const url = match[1];
      if (url && url.length <= MAX_URL_LENGTH && isValidUrlScheme(url)) {
        urls.add(url);
      }
    }
  }

  // Extract URLs from plain text
  if (text) {
    let match: RegExpExecArray | null;
    // Reset regex state
    URL_REGEX.lastIndex = 0;

    while ((match = URL_REGEX.exec(text)) !== null) {
      // Combine scheme and rest of URL
      let url = match[1] + match[2];
      if (url && url.length <= MAX_URL_LENGTH) {
        // Strip trailing punctuation commonly used in sentences
        url = stripTrailingPunctuation(url);
        urls.add(url);
      }
    }
  }

  // Convert Set to Array to preserve insertion order
  return Array.from(urls);
}

/**
 * Strips trailing punctuation from URLs that are commonly used in text
 *
 * Removes trailing:
 * - Commas (,)
 * - Periods (.) - but preserves if it's part of a file extension
 * - Semicolons (;)
 * - Exclamation marks (!)
 * - Question marks (?) - but preserves if it's part of query string
 * - Unmatched closing parentheses
 *
 * @param url - URL to clean
 * @returns URL with trailing punctuation removed
 */
function stripTrailingPunctuation(url: string): string {
  let cleaned = url;

  // Strip trailing commas, periods, semicolons, and exclamation marks
  // Keep stripping until no more trailing punctuation is found
  while (/[,;!]$/.test(cleaned)) {
    cleaned = cleaned.slice(0, -1);
  }

  // Strip trailing periods, but only if not preceded by a path character
  // This preserves URLs like "example.com/file.pdf" while removing "example.com."
  while (/\.$/.test(cleaned) && !/\/[^/.]+\.$/.test(cleaned)) {
    cleaned = cleaned.slice(0, -1);
  }

  // Strip unmatched closing parentheses
  // Count opening and closing parentheses
  const openParens = (cleaned.match(/\(/g) || []).length;
  let closeParens = (cleaned.match(/\)/g) || []).length;

  // Remove trailing closing parens if there are more closing than opening
  while (/\)$/.test(cleaned) && closeParens > openParens) {
    cleaned = cleaned.slice(0, -1);
    closeParens--;
  }

  return cleaned;
}

/**
 * Checks if a URL starts with a valid scheme
 *
 * Valid schemes:
 * - http://
 * - https://
 * - ftp://
 * - mailto:
 *
 * @param url - URL to validate
 * @returns true if URL starts with a supported scheme, false otherwise
 */
function isValidUrlScheme(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return (
    lowerUrl.startsWith('http://') ||
    lowerUrl.startsWith('https://') ||
    lowerUrl.startsWith('ftp://') ||
    lowerUrl.startsWith('mailto:')
  );
}
