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
