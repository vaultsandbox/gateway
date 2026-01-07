import { MailContentSanitizer } from './mail-content-sanitizer';
import { SanitizationLevel } from '../../services/settings-manager';

const inlineImg = '<img src="cid:12345" />';

describe('MailContentSanitizer', () => {
  describe('Inline image handling', () => {
    it('strips inline images when disabled', () => {
      const stripped = MailContentSanitizer.stripInlineImages(inlineImg);
      expect(stripped).toContain('Inline image hidden');
    });

    it('embeds inline images when enabled', () => {
      const attachments = [
        {
          contentId: '<12345>',
          contentDisposition: 'inline',
          contentType: 'image/png',
          content: 'ZmFrZUJhc2U2NA==',
          filename: 'file.png',
          size: 10,
        },
      ];
      const embedded = MailContentSanitizer.embedInlineImages(inlineImg, attachments);
      expect(embedded).toContain('src="data:image/png;base64,ZmFrZUJhc2U2NA=="');
    });

    it('returns html unchanged when attachments is empty', () => {
      const html = '<img src="cid:test" />';
      expect(MailContentSanitizer.embedInlineImages(html, [])).toBe(html);
    });

    it('returns html unchanged when attachments is undefined', () => {
      const html = '<img src="cid:test" />';
      expect(MailContentSanitizer.embedInlineImages(html, undefined as never)).toBe(html);
    });

    it('preserves original src when CID is not found in attachments', () => {
      const html = '<img src="cid:unknown-cid" />';
      const attachments = [
        {
          contentId: '<other-cid>',
          contentDisposition: 'inline',
          contentType: 'image/png',
          content: 'ZmFrZQ==',
          filename: 'file.png',
          size: 10,
        },
      ];
      const result = MailContentSanitizer.embedInlineImages(html, attachments);
      expect(result).toBe('<img src="cid:unknown-cid" />');
    });
  });

  describe('Secure mode (dompurify)', () => {
    it('strips scripts in secure mode', () => {
      const html = '<div>safe<script>alert(1)</script></div>';
      const sanitized = MailContentSanitizer.applySanitization(html, SanitizationLevel.DomPurify, false);
      expect(sanitized).toBe('<div>safe</div>');
    });

    it('strips iframes in secure mode', () => {
      const html = '<div>safe<iframe src="https://evil.com"></iframe></div>';
      const sanitized = MailContentSanitizer.applySanitization(html, SanitizationLevel.DomPurify, false);
      expect(sanitized).toBe('<div>safe</div>');
    });

    it('strips forms in secure mode', () => {
      const html = '<div>safe<form action="/submit"><input name="data" /></form></div>';
      const sanitized = MailContentSanitizer.applySanitization(html, SanitizationLevel.DomPurify, false);
      expect(sanitized).toBe('<div>safe</div>');
    });

    it('removes javascript: URLs in secure mode', () => {
      const html = '<a href="javascript:alert(1)">Click</a>';
      const sanitized = MailContentSanitizer.applySanitization(html, SanitizationLevel.DomPurify, false);
      expect(sanitized).not.toContain('javascript:');
      expect(sanitized).toContain('Click');
    });

    it('blocks images when displayInlineImages is false', () => {
      const html = '<div>content<img src="https://tracker.com/pixel.gif" /></div>';
      const sanitized = MailContentSanitizer.applySanitization(html, SanitizationLevel.DomPurify, false);
      expect(sanitized).toBe('<div>content</div>');
    });

    it('allows images when displayInlineImages is true', () => {
      const html = '<div>content<img src="https://example.com/image.png" /></div>';
      const sanitized = MailContentSanitizer.applySanitization(html, SanitizationLevel.DomPurify, true);
      expect(sanitized).toContain('<img');
      expect(sanitized).toContain('https://example.com/image.png');
    });

    it('allows https URLs when images are enabled', () => {
      const html = '<a href="https://example.com">Link</a>';
      const sanitized = MailContentSanitizer.applySanitization(html, SanitizationLevel.DomPurify, true);
      expect(sanitized).toContain('https://example.com');
    });
  });

  describe('Trusted mode (none)', () => {
    it('allows iframes in trusted mode', () => {
      const html = '<div>content<iframe src="https://example.com"></iframe></div>';
      const sanitized = MailContentSanitizer.applySanitization(html, SanitizationLevel.None, true);
      expect(sanitized).toContain('<iframe');
    });

    it('allows forms in trusted mode', () => {
      const html = '<div><form action="/submit"><input name="data" /></form></div>';
      const sanitized = MailContentSanitizer.applySanitization(html, SanitizationLevel.None, true);
      expect(sanitized).toContain('<form');
    });
  });

  describe('Full sanitization flow', () => {
    it('processes inline handling and sanitization together', () => {
      const html = `<div>${inlineImg}<script>alert(1)</script></div>`;
      const result = MailContentSanitizer.sanitizeEmailHtml(html, {
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.DomPurify,
        attachments: [],
      });

      expect(result.processedHtml).toContain('Inline image hidden');
      expect(result.sanitizedHtml).not.toContain('<script>');
    });

    it('blocks srcset attribute when images are disabled', () => {
      const html = '<img src="img.jpg" srcset="img-2x.jpg 2x" />';
      const sanitized = MailContentSanitizer.applySanitization(html, SanitizationLevel.DomPurify, false);
      expect(sanitized).not.toContain('srcset');
      expect(sanitized).not.toContain('<img');
    });

    it('skips inline image processing in trusted mode (useIframe)', () => {
      const html = `<div>${inlineImg}</div>`;
      const result = MailContentSanitizer.sanitizeEmailHtml(html, {
        displayInlineImages: false,
        sanitizationLevel: SanitizationLevel.None,
        attachments: [],
      });

      expect(result.useIframe).toBe(true);
      expect(result.processedHtml).toContain('cid:12345');
      expect(result.sanitizedHtml).toContain('<style>');
    });

    it('embeds inline images in sanitizeEmailHtml when displayInlineImages is true', () => {
      const html = `<div>${inlineImg}</div>`;
      const attachments = [
        {
          contentId: '<12345>',
          contentDisposition: 'inline',
          contentType: 'image/png',
          content: 'ZmFrZUJhc2U2NA==',
          filename: 'file.png',
          size: 10,
        },
      ];
      const result = MailContentSanitizer.sanitizeEmailHtml(html, {
        displayInlineImages: true,
        sanitizationLevel: SanitizationLevel.DomPurify,
        attachments,
      });

      expect(result.processedHtml).toContain('data:image/png;base64,ZmFrZUJhc2U2NA==');
      expect(result.useIframe).toBe(false);
    });
  });
});
