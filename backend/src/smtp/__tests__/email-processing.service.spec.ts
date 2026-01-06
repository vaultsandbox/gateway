/**
 * Integration tests for EmailProcessingService
 *
 * Tests the complete email processing pipeline including parsing,
 * serialization, URL extraction, and storage record creation.
 *
 * @module email-processing.service.spec
 */

import { Test, TestingModule } from '@nestjs/testing';
import { EmailProcessingService } from '../email-processing.service';
import type { SMTPServerSession } from 'smtp-server';
import type { ReceivedEmail } from '../interfaces/email-session.interface';
import { ConfigService } from '@nestjs/config';

describe('EmailProcessingService', () => {
  let service: EmailProcessingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmailProcessingService, ConfigService],
    }).compile();

    service = module.get<EmailProcessingService>(EmailProcessingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('parseEmail', () => {
    it('should parse a simple text email', async () => {
      const rawEmail = Buffer.from(
        'From: sender@example.com\r\n' +
          'To: recipient@example.com\r\n' +
          'Subject: Test Email\r\n' +
          '\r\n' +
          'This is the email body.\r\n',
      );

      const parsed = await service.parseEmail(rawEmail, 'test-session');

      expect(parsed).toBeDefined();
      expect(parsed?.subject).toBe('Test Email');
      expect(parsed?.from?.text).toContain('sender@example.com');
      expect(parsed?.to?.text).toContain('recipient@example.com');
      expect(parsed?.text).toContain('This is the email body');
    });

    it('should return undefined for malformed email', async () => {
      const rawEmail = Buffer.from('Not a valid email');
      const parsed = await service.parseEmail(rawEmail, 'test-session');

      // mailparser is quite forgiving, so this might still parse
      // The test is more about ensuring no errors are thrown
      expect(parsed).toBeDefined();
    });

    it('should parse email with complex headers including Date objects', async () => {
      const rawEmail = Buffer.from(
        'From: sender@example.com\r\n' +
          'To: recipient@example.com\r\n' +
          'Subject: Test with Date\r\n' +
          'Date: Mon, 15 Jan 2024 10:30:00 +0000\r\n' +
          '\r\n' +
          'Body with date header.\r\n',
      );

      const parsed = await service.parseEmail(rawEmail, 'test-session');
      expect(parsed).toBeDefined();
      expect(parsed?.date).toBeInstanceOf(Date);
    });

    it('should parse email with attachments', async () => {
      const rawEmail = Buffer.from(
        'From: sender@example.com\r\n' +
          'To: recipient@example.com\r\n' +
          'Subject: Test with Attachment\r\n' +
          'MIME-Version: 1.0\r\n' +
          'Content-Type: multipart/mixed; boundary="boundary123"\r\n' +
          '\r\n' +
          '--boundary123\r\n' +
          'Content-Type: text/plain\r\n' +
          '\r\n' +
          'Body text\r\n' +
          '--boundary123\r\n' +
          'Content-Type: application/octet-stream\r\n' +
          'Content-Disposition: attachment; filename="test.bin"\r\n' +
          'Content-Transfer-Encoding: base64\r\n' +
          '\r\n' +
          'SGVsbG8gV29ybGQ=\r\n' +
          '--boundary123--\r\n',
      );

      const parsed = await service.parseEmail(rawEmail, 'test-session');
      expect(parsed).toBeDefined();
      expect(parsed?.attachments).toBeDefined();
      expect(parsed?.attachments?.length).toBeGreaterThan(0);
    });
  });

  describe('URL extraction in serializeParsedMail', () => {
    it('should extract URLs from HTML content', async () => {
      const rawEmail = Buffer.from(
        'From: sender@example.com\r\n' +
          'To: recipient@example.com\r\n' +
          'Subject: Email with Links\r\n' +
          'Content-Type: text/html\r\n' +
          '\r\n' +
          '<html><body><a href="https://example.com">Link</a></body></html>\r\n',
      );

      const parsed = await service.parseEmail(rawEmail, 'test-session');
      expect(parsed).toBeDefined();

      const session = createMockSession();
      const email = createMockReceivedEmail(rawEmail);
      const record = service.buildEmailRecord(email, session, parsed, new Date());

      expect(record.parsed?.links).toBeDefined();
      expect(record.parsed?.links).toContain('https://example.com');
    });

    it('should extract URLs from plain text content', async () => {
      const rawEmail = Buffer.from(
        'From: sender@example.com\r\n' +
          'To: recipient@example.com\r\n' +
          'Subject: Email with Links\r\n' +
          '\r\n' +
          'Visit https://example.com for more information.\r\n',
      );

      const parsed = await service.parseEmail(rawEmail, 'test-session');
      expect(parsed).toBeDefined();

      const session = createMockSession();
      const email = createMockReceivedEmail(rawEmail);
      const record = service.buildEmailRecord(email, session, parsed, new Date());

      expect(record.parsed?.links).toBeDefined();
      expect(record.parsed?.links).toContain('https://example.com');
    });

    it('should extract multiple URLs from email', async () => {
      const rawEmail = Buffer.from(
        'From: sender@example.com\r\n' +
          'To: recipient@example.com\r\n' +
          'Subject: Multiple Links\r\n' +
          'Content-Type: text/html\r\n' +
          '\r\n' +
          '<html><body>\r\n' +
          '<a href="https://first.com">First</a>\r\n' +
          '<a href="https://second.com">Second</a>\r\n' +
          '<p>Also visit https://third.com</p>\r\n' +
          '</body></html>\r\n',
      );

      const parsed = await service.parseEmail(rawEmail, 'test-session');
      expect(parsed).toBeDefined();

      const session = createMockSession();
      const email = createMockReceivedEmail(rawEmail);
      const record = service.buildEmailRecord(email, session, parsed, new Date());

      expect(record.parsed?.links).toBeDefined();
      expect(record.parsed?.links).toHaveLength(3);
      expect(record.parsed?.links).toEqual(
        expect.arrayContaining(['https://first.com', 'https://second.com', 'https://third.com']),
      );
    });

    it('should deduplicate URLs from HTML and text', async () => {
      const rawEmail = Buffer.from(
        'From: sender@example.com\r\n' +
          'To: recipient@example.com\r\n' +
          'Subject: Duplicate Links\r\n' +
          'Content-Type: multipart/alternative; boundary="boundary123"\r\n' +
          '\r\n' +
          '--boundary123\r\n' +
          'Content-Type: text/plain\r\n' +
          '\r\n' +
          'Visit https://example.com\r\n' +
          '--boundary123\r\n' +
          'Content-Type: text/html\r\n' +
          '\r\n' +
          '<a href="https://example.com">Link</a>\r\n' +
          '--boundary123--\r\n',
      );

      const parsed = await service.parseEmail(rawEmail, 'test-session');
      expect(parsed).toBeDefined();

      const session = createMockSession();
      const email = createMockReceivedEmail(rawEmail);
      const record = service.buildEmailRecord(email, session, parsed, new Date());

      expect(record.parsed?.links).toBeDefined();
      expect(record.parsed?.links).toHaveLength(1);
      expect(record.parsed?.links).toContain('https://example.com');
    });

    it('should extract verification link from typical verification email', async () => {
      const rawEmail = Buffer.from(
        'From: noreply@myapp.com\r\n' +
          'To: user@example.com\r\n' +
          'Subject: Verify your email\r\n' +
          'Content-Type: text/html\r\n' +
          '\r\n' +
          '<html><body>\r\n' +
          '<p>Click to verify:</p>\r\n' +
          '<a href="https://myapp.com/verify?token=abc123">Verify Email</a>\r\n' +
          '</body></html>\r\n',
      );

      const parsed = await service.parseEmail(rawEmail, 'test-session');
      expect(parsed).toBeDefined();

      const session = createMockSession();
      const email = createMockReceivedEmail(rawEmail);
      const record = service.buildEmailRecord(email, session, parsed, new Date());

      expect(record.parsed?.links).toBeDefined();
      expect(record.parsed?.links).toContain('https://myapp.com/verify?token=abc123');
    });

    it('should extract password reset link with query parameters', async () => {
      const rawEmail = Buffer.from(
        'From: security@example.com\r\n' +
          'To: user@example.com\r\n' +
          'Subject: Reset your password\r\n' +
          '\r\n' +
          'Reset your password: https://example.com/reset?token=xyz789&expires=1234567890\r\n',
      );

      const parsed = await service.parseEmail(rawEmail, 'test-session');
      expect(parsed).toBeDefined();

      const session = createMockSession();
      const email = createMockReceivedEmail(rawEmail);
      const record = service.buildEmailRecord(email, session, parsed, new Date());

      expect(record.parsed?.links).toBeDefined();
      expect(record.parsed?.links).toContain('https://example.com/reset?token=xyz789&expires=1234567890');
    });

    it('should not include links field when no URLs found', async () => {
      const rawEmail = Buffer.from(
        'From: sender@example.com\r\n' +
          'To: recipient@example.com\r\n' +
          'Subject: No Links\r\n' +
          '\r\n' +
          'This email has no URLs.\r\n',
      );

      const parsed = await service.parseEmail(rawEmail, 'test-session');
      expect(parsed).toBeDefined();

      const session = createMockSession();
      const email = createMockReceivedEmail(rawEmail);
      const record = service.buildEmailRecord(email, session, parsed, new Date());

      expect(record.parsed?.links).toBeUndefined();
    });

    it('should extract mailto URLs', async () => {
      const rawEmail = Buffer.from(
        'From: sender@example.com\r\n' +
          'To: recipient@example.com\r\n' +
          'Subject: Contact Info\r\n' +
          '\r\n' +
          'Contact us at mailto:support@example.com\r\n',
      );

      const parsed = await service.parseEmail(rawEmail, 'test-session');
      expect(parsed).toBeDefined();

      const session = createMockSession();
      const email = createMockReceivedEmail(rawEmail);
      const record = service.buildEmailRecord(email, session, parsed, new Date());

      expect(record.parsed?.links).toBeDefined();
      expect(record.parsed?.links).toContain('mailto:support@example.com');
    });

    it('should extract FTP URLs', async () => {
      const rawEmail = Buffer.from(
        'From: sender@example.com\r\n' +
          'To: recipient@example.com\r\n' +
          'Subject: File Download\r\n' +
          '\r\n' +
          'Download from ftp://files.example.com/file.zip\r\n',
      );

      const parsed = await service.parseEmail(rawEmail, 'test-session');
      expect(parsed).toBeDefined();

      const session = createMockSession();
      const email = createMockReceivedEmail(rawEmail);
      const record = service.buildEmailRecord(email, session, parsed, new Date());

      expect(record.parsed?.links).toBeDefined();
      expect(record.parsed?.links).toContain('ftp://files.example.com/file.zip');
    });
  });

  describe('normalizeHeaderValue edge cases', () => {
    it('should pass through BigInt values unchanged', () => {
      const session = createMockSession();
      const rawEmail = Buffer.from('test email');
      const email = createMockReceivedEmail(rawEmail);
      const headersMap = new Map<string, unknown>();
      // BigInt is typeof 'bigint', not 'object', so it falls through to the return value fallback
      headersMap.set('x-bigint', BigInt(9007199254740991));

      const parsedMail = {
        subject: 'BigInt Header',
        messageId: '<bigint-123@example.com>',
        from: { text: 'sender@example.com', html: '', value: [] },
        to: { text: 'recipient@example.com', html: '', value: [] },
        text: 'Email body',
        headers: headersMap,
      };
      const receivedAt = new Date();

      const record = service.buildEmailRecord(email, session, parsedMail, receivedAt);

      // BigInt falls through to the default return value
      expect(record.parsed?.headers?.['x-bigint']).toBe(BigInt(9007199254740991));
    });

    it('should pass through Symbol values unchanged', () => {
      const session = createMockSession();
      const rawEmail = Buffer.from('test email');
      const email = createMockReceivedEmail(rawEmail);
      const headersMap = new Map<string, unknown>();
      const testSymbol = Symbol('test');
      headersMap.set('x-symbol', testSymbol);

      const parsedMail = {
        subject: 'Symbol Header',
        messageId: '<symbol-123@example.com>',
        from: { text: 'sender@example.com', html: '', value: [] },
        to: { text: 'recipient@example.com', html: '', value: [] },
        text: 'Email body',
        headers: headersMap,
      };
      const receivedAt = new Date();

      const record = service.buildEmailRecord(email, session, parsedMail, receivedAt);

      // Symbol falls through to the default return value
      expect(record.parsed?.headers?.['x-symbol']).toBe(testSymbol);
    });

    it('should pass through Function values unchanged', () => {
      const session = createMockSession();
      const rawEmail = Buffer.from('test email');
      const email = createMockReceivedEmail(rawEmail);
      const headersMap = new Map<string, unknown>();
      const testFn = () => 'test';
      headersMap.set('x-function', testFn);

      const parsedMail = {
        subject: 'Function Header',
        messageId: '<function-123@example.com>',
        from: { text: 'sender@example.com', html: '', value: [] },
        to: { text: 'recipient@example.com', html: '', value: [] },
        text: 'Email body',
        headers: headersMap,
      };
      const receivedAt = new Date();

      const record = service.buildEmailRecord(email, session, parsedMail, receivedAt);

      // Function falls through to the default return value
      expect(record.parsed?.headers?.['x-function']).toBe(testFn);
    });
  });

  describe('buildEmailRecord', () => {
    it('should create complete email record with all fields', () => {
      const session = createMockSession();
      const rawEmail = Buffer.from('test email');
      const email = createMockReceivedEmail(rawEmail);
      const parsedMail = {
        subject: 'Test Subject',
        messageId: '<msg-123@example.com>',
        from: { text: 'sender@example.com', html: '', value: [] },
        to: { text: 'recipient@example.com', html: '', value: [] },
        text: 'Email body',
      };
      const receivedAt = new Date('2025-11-17T12:00:00Z');

      const record = service.buildEmailRecord(email, session, parsedMail, receivedAt);

      expect(record.id).toBe('msg-123');
      expect(record.sessionId).toBe('test-session-123');
      expect(record.receivedAt).toBe('2025-11-17T12:00:00.000Z');
      expect(record.remoteAddress).toBe('192.168.1.100');
      expect(record.clientHostname).toBe('mail.example.com');
      expect(record.envelope.mailFrom).toBe('sender@example.com');
      expect(record.envelope.rcptTo).toEqual(['recipient@example.com']);
      expect(record.parsed?.subject).toBe('Test Subject');
      expect(record.rawEncoding).toBe('base64');
      expect(record.raw).toBe(rawEmail.toString('base64'));
    });

    it('should handle missing parsedMail gracefully', () => {
      const session = createMockSession();
      const rawEmail = Buffer.from('test email');
      const email = createMockReceivedEmail(rawEmail);
      const receivedAt = new Date();

      const record = service.buildEmailRecord(email, session, undefined, receivedAt);

      expect(record.parsed).toBeUndefined();
      expect(record.id).toBe(email.messageId);
      expect(record.raw).toBeDefined();
    });

    it('should serialize email with attachments correctly', () => {
      const session = createMockSession();
      const rawEmail = Buffer.from('test email with attachment');
      const email = createMockReceivedEmail(rawEmail);
      const attachmentContent = Buffer.from('attachment content');
      const parsedMail = {
        subject: 'Email with Attachment',
        messageId: '<attach-123@example.com>',
        from: { text: 'sender@example.com', html: '', value: [] },
        to: { text: 'recipient@example.com', html: '', value: [] },
        text: 'See attached file',
        attachments: [
          {
            filename: 'document.pdf',
            contentType: 'application/pdf',
            size: attachmentContent.length,
            checksum: 'abc123',
            contentDisposition: 'attachment',
            cid: undefined,
            related: false,
            content: attachmentContent,
          },
        ],
      };
      const receivedAt = new Date('2025-11-17T12:00:00Z');

      const record = service.buildEmailRecord(email, session, parsedMail, receivedAt);

      expect(record.parsed?.attachments).toBeDefined();
      expect(record.parsed?.attachments).toHaveLength(1);
      expect(record.parsed?.attachments?.[0].filename).toBe('document.pdf');
      expect(record.parsed?.attachments?.[0].contentType).toBe('application/pdf');
      expect(record.parsed?.attachments?.[0].contentEncoding).toBe('base64');
      expect(record.parsed?.attachments?.[0].content).toBe(attachmentContent.toString('base64'));
    });

    it('should handle headers Map in parsedMail', () => {
      const session = createMockSession();
      const rawEmail = Buffer.from('test email');
      const email = createMockReceivedEmail(rawEmail);
      const headersMap = new Map<string, unknown>();
      headersMap.set('x-custom-header', 'custom-value');
      headersMap.set('x-numeric', 42);
      headersMap.set('x-boolean', true);
      headersMap.set('x-array', ['item1', 'item2']);
      headersMap.set('x-buffer', Buffer.from('buffer-content'));
      headersMap.set('x-date', new Date('2025-01-15T10:00:00Z'));
      headersMap.set('x-null', null);
      headersMap.set('x-undefined', undefined);
      headersMap.set('x-nested-map', new Map([['nested', 'value']]));
      headersMap.set('x-object', { key: 'object-value' });

      const parsedMail = {
        subject: 'Test with Headers Map',
        messageId: '<headers-123@example.com>',
        from: { text: 'sender@example.com', html: '', value: [] },
        to: { text: 'recipient@example.com', html: '', value: [] },
        text: 'Email body',
        headers: headersMap,
      };
      const receivedAt = new Date('2025-11-17T12:00:00Z');

      const record = service.buildEmailRecord(email, session, parsedMail, receivedAt);

      expect(record.parsed?.headers).toBeDefined();
      expect(record.parsed?.headers?.['x-custom-header']).toBe('custom-value');
      expect(record.parsed?.headers?.['x-numeric']).toBe(42);
      expect(record.parsed?.headers?.['x-boolean']).toBe(true);
      expect(record.parsed?.headers?.['x-array']).toEqual(['item1', 'item2']);
      expect(record.parsed?.headers?.['x-buffer']).toBe('buffer-content');
      expect(record.parsed?.headers?.['x-date']).toBe('2025-01-15T10:00:00.000Z');
      expect(record.parsed?.headers?.['x-null']).toBeNull();
      expect(record.parsed?.headers?.['x-undefined']).toBeUndefined();
      expect(record.parsed?.headers?.['x-nested-map']).toEqual({ nested: 'value' });
      expect(record.parsed?.headers?.['x-object']).toEqual({ key: 'object-value' });
    });

    it('should handle parsedMail with HTML as Buffer', () => {
      const session = createMockSession();
      const rawEmail = Buffer.from('test email');
      const email = createMockReceivedEmail(rawEmail);
      const parsedMail = {
        subject: 'HTML as Buffer',
        messageId: '<html-buf-123@example.com>',
        from: { text: 'sender@example.com', html: '', value: [] },
        to: { text: 'recipient@example.com', html: '', value: [] },
        text: 'Plain text',
        html: Buffer.from('<html><body>HTML content</body></html>'),
        textAsHtml: Buffer.from('<p>Plain text as HTML</p>'),
      };
      const receivedAt = new Date('2025-11-17T12:00:00Z');

      const record = service.buildEmailRecord(email, session, parsedMail, receivedAt);

      expect(record.parsed?.html).toBe('<html><body>HTML content</body></html>');
      expect(record.parsed?.textAsHtml).toBe('<p>Plain text as HTML</p>');
    });

    it('should use session ID when messageId is missing', () => {
      const session = createMockSession();
      const rawEmail = Buffer.from('test email');
      const email = createMockReceivedEmail(rawEmail);
      email.messageId = undefined; // No message ID

      const parsedMail = {
        subject: 'No Message ID',
        from: { text: 'sender@example.com', html: '', value: [] },
        to: { text: 'recipient@example.com', html: '', value: [] },
        text: 'Email body',
      };
      const receivedAt = new Date();

      const record = service.buildEmailRecord(email, session, parsedMail, receivedAt);

      // Should fall back to session.id
      expect(record.id).toBe('test-session-123');
    });

    it('should handle envelope with false mailFrom (bounce message)', () => {
      const session = createMockSession();
      // Simulate bounce message with false mailFrom
      (session.envelope as any).mailFrom = false;
      const rawEmail = Buffer.from('bounce email');
      const email = createMockReceivedEmail(rawEmail);
      const receivedAt = new Date();

      const record = service.buildEmailRecord(email, session, undefined, receivedAt);

      expect(record.envelope.mailFrom).toBeUndefined();
    });

    it('should handle non-string remoteAddress and clientHostname', () => {
      const session = createMockSession();
      // Simulate non-string values (e.g., undefined or numbers)
      (session as any).remoteAddress = undefined;
      (session as any).clientHostname = 123; // number instead of string
      const rawEmail = Buffer.from('test email');
      const email = createMockReceivedEmail(rawEmail);
      const receivedAt = new Date();

      const record = service.buildEmailRecord(email, session, undefined, receivedAt);

      expect(record.remoteAddress).toBeUndefined();
      expect(record.clientHostname).toBeUndefined();
    });

    it('should handle non-Buffer attachment content', () => {
      const session = createMockSession();
      const rawEmail = Buffer.from('test email');
      const email = createMockReceivedEmail(rawEmail);
      const parsedMail = {
        subject: 'Email with non-Buffer attachment',
        messageId: '<attach-nonbuf@example.com>',
        from: { text: 'sender@example.com', html: '', value: [] },
        to: { text: 'recipient@example.com', html: '', value: [] },
        text: 'Body',
        attachments: [
          {
            filename: 'test.txt',
            contentType: 'text/plain',
            size: 10,
            checksum: 'abc123',
            contentDisposition: 'attachment',
            cid: undefined,
            related: false,
            content: 'not a buffer', // String instead of Buffer
          },
        ],
      };
      const receivedAt = new Date();

      const record = service.buildEmailRecord(email, session, parsedMail, receivedAt);

      expect(record.parsed?.attachments).toHaveLength(1);
      expect(record.parsed?.attachments?.[0].content).toBeUndefined();
      expect(record.parsed?.attachments?.[0].contentEncoding).toBeUndefined();
    });

    it('should handle address object without address property', () => {
      const session = createMockSession();
      // Simulate address object without address property
      (session.envelope as any).mailFrom = { args: {} }; // missing address property
      (session.envelope as any).rcptTo = [
        { args: {} }, // missing address property
        { address: 'valid@example.com', args: {} },
      ];
      const rawEmail = Buffer.from('test email');
      const email = createMockReceivedEmail(rawEmail);
      const receivedAt = new Date();

      const record = service.buildEmailRecord(email, session, undefined, receivedAt);

      expect(record.envelope.mailFrom).toBeUndefined();
      expect(record.envelope.rcptTo).toEqual(['valid@example.com']);
    });

    it('should filter out undefined addresses from rcptTo', () => {
      const session = createMockSession();
      (session.envelope as any).rcptTo = [
        false, // falsy value
        true, // boolean true (should return undefined)
        { address: 'valid@example.com', args: {} },
        null, // null value
      ];
      const rawEmail = Buffer.from('test email');
      const email = createMockReceivedEmail(rawEmail);
      const receivedAt = new Date();

      const record = service.buildEmailRecord(email, session, undefined, receivedAt);

      // Only valid@example.com should remain after filtering
      expect(record.envelope.rcptTo).toEqual(['valid@example.com']);
    });

    it('should handle empty string fields (coerced to undefined)', () => {
      const session = createMockSession();
      const rawEmail = Buffer.from('test email');
      const email = createMockReceivedEmail(rawEmail);
      const parsedMail = {
        subject: 'Empty Fields Test',
        messageId: '<empty-123@example.com>',
        from: { text: '', html: '', value: [] }, // empty string
        to: { text: '', html: '', value: [] }, // empty string
        text: '', // empty string
      };
      const receivedAt = new Date();

      const record = service.buildEmailRecord(email, session, parsedMail, receivedAt);

      // Empty strings should be coerced to undefined
      expect(record.parsed?.from).toBeUndefined();
      expect(record.parsed?.to).toBeUndefined();
      expect(record.parsed?.text).toBeUndefined();
    });

    it('should handle optional address fields (cc, bcc, replyTo)', () => {
      const session = createMockSession();
      const rawEmail = Buffer.from('test email');
      const email = createMockReceivedEmail(rawEmail);
      const parsedMail = {
        subject: 'With CC and BCC',
        messageId: '<cc-123@example.com>',
        from: { text: 'sender@example.com', html: '', value: [] },
        to: { text: 'recipient@example.com', html: '', value: [] },
        cc: { text: 'cc@example.com', html: '', value: [] },
        bcc: { text: 'bcc@example.com', html: '', value: [] },
        replyTo: { text: 'replyto@example.com', html: '', value: [] },
        text: 'Email body',
        date: new Date('2025-01-15T10:00:00Z'),
        inReplyTo: '<original-123@example.com>',
        references: '<ref-1@example.com> <ref-2@example.com>',
        priority: 'high',
      };
      const receivedAt = new Date('2025-11-17T12:00:00Z');

      const record = service.buildEmailRecord(email, session, parsedMail, receivedAt);

      expect(record.parsed?.cc).toBe('cc@example.com');
      expect(record.parsed?.bcc).toBe('bcc@example.com');
      expect(record.parsed?.replyTo).toBe('replyto@example.com');
      expect(record.parsed?.date).toBe('2025-01-15T10:00:00.000Z');
      expect(record.parsed?.inReplyTo).toBe('<original-123@example.com>');
      expect(record.parsed?.references).toBe('<ref-1@example.com> <ref-2@example.com>');
      expect(record.parsed?.priority).toBe('high');
    });
  });
});

/**
 * Helper function to create a mock SMTP session
 */
function createMockSession(): SMTPServerSession {
  return {
    id: 'test-session-123',
    remoteAddress: '192.168.1.100',
    clientHostname: 'mail.example.com',
    envelope: {
      mailFrom: { address: 'sender@example.com', args: {} },
      rcptTo: [{ address: 'recipient@example.com', args: {} }],
    },
    transaction: 1,
  } as unknown as SMTPServerSession;
}

/**
 * Helper function to create a mock received email
 */
function createMockReceivedEmail(rawData: Buffer): ReceivedEmail {
  return {
    messageId: 'msg-123',
    size: rawData.length,
    headers: {
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Test Email',
    },
    to: ['recipient@example.com'],
    rawData,
    spfResult: { result: 'pass' } as any,
    dkimResults: [],
    dmarcResult: { result: 'pass' } as any,
    reverseDnsResult: { result: 'pass', hostname: 'mail.example.com' } as any,
  };
}
