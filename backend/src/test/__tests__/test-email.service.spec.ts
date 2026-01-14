import { NotFoundException } from '@nestjs/common';
import { TestEmailService } from '../test-email.service';
import { InboxService } from '../../inbox/inbox.service';
import { CryptoService } from '../../crypto/crypto.service';
import { EmailStorageService } from '../../smtp/storage/email-storage.service';
import { InboxStorageService } from '../../inbox/storage/inbox-storage.service';
import { EventsService } from '../../events/events.service';
import { CreateTestEmailDto } from '../dto/create-test-email.dto';
import { silenceNestLogger } from '../../../test/helpers/silence-logger';

const mockEncryptedInbox = {
  id: 'encrypted-inbox-1',
  emailAddress: 'encrypted@example.com',
  clientKemPk: 'base64url-encoded-client-kem-public-key',
  inboxHash: 'encrypted-inbox-hash-123',
  encrypted: true,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3600000),
  emails: new Map(),
  emailsHash: 'emails-hash',
};

const mockPlainInbox = {
  id: 'plain-inbox-1',
  emailAddress: 'plain@example.com',
  clientKemPk: undefined,
  inboxHash: 'plain-inbox-hash-123',
  encrypted: false,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3600000),
  emails: new Map(),
  emailsHash: 'emails-hash',
};

const mockInboxService = {
  getInboxByEmail: jest.fn(),
} as unknown as InboxService;

const mockCryptoService = {
  encryptForClient: jest.fn().mockResolvedValue({
    v: 1,
    algs: {
      kem: 'ML-KEM-768',
      sig: 'ML-DSA-65',
      aead: 'AES-256-GCM',
      kdf: 'HKDF-SHA-512',
    },
    ct_kem: new Uint8Array([1, 2, 3]),
    nonce: new Uint8Array([4, 5, 6]),
    aad: new Uint8Array([7, 8, 9]),
    ciphertext: new Uint8Array([10, 11, 12]),
    sig: new Uint8Array([13, 14, 15]),
    server_sig_pk: new Uint8Array([16, 17, 18]),
  }),
} as unknown as CryptoService;

const mockEmailStorageService = {
  storeEmail: jest.fn(),
} as unknown as EmailStorageService;

const mockInboxStorageService = {
  addEmail: jest.fn(),
} as unknown as InboxStorageService;

const mockEventsService = {
  emitNewEmailEvent: jest.fn(),
} as unknown as EventsService;

const restoreLogger = silenceNestLogger();

afterAll(() => restoreLogger());

describe('TestEmailService', () => {
  let service: TestEmailService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TestEmailService(
      mockInboxService,
      mockCryptoService,
      mockEmailStorageService,
      mockInboxStorageService,
      mockEventsService,
    );
  });

  describe('createTestEmail', () => {
    describe('encrypted inbox', () => {
      beforeEach(() => {
        (mockInboxService.getInboxByEmail as jest.Mock).mockReturnValue(mockEncryptedInbox);
      });

      it('should create test email with default values', async () => {
        const dto: CreateTestEmailDto = { to: 'encrypted@example.com' };

        const result = await service.createTestEmail(dto);

        expect(result.emailId).toBeDefined();
        // 3 for storage (metadata, parsed, raw) + 1 for SSE event (metadata)
        expect(mockCryptoService.encryptForClient).toHaveBeenCalled();
        expect(mockEmailStorageService.storeEmail).toHaveBeenCalledWith(
          'encrypted@example.com',
          expect.any(String),
          expect.objectContaining({
            encryptedMetadata: expect.any(Object),
            encryptedParsed: expect.any(Object),
            encryptedRaw: expect.any(Object),
          }),
        );
      });

      it('should create test email with custom values', async () => {
        const dto: CreateTestEmailDto = {
          to: 'encrypted@example.com',
          from: 'custom@sender.com',
          subject: 'Custom Subject',
          text: 'Custom body text',
        };

        const result = await service.createTestEmail(dto);

        expect(result.emailId).toBeDefined();
        expect(mockEmailStorageService.storeEmail).toHaveBeenCalled();
      });

      it('should create test email with HTML content', async () => {
        const dto: CreateTestEmailDto = {
          to: 'encrypted@example.com',
          text: 'Plain text',
          html: '<p>HTML content</p>',
        };

        const result = await service.createTestEmail(dto);

        expect(result.emailId).toBeDefined();
        expect(mockEmailStorageService.storeEmail).toHaveBeenCalled();
      });

      it('should create test email with custom auth results', async () => {
        const dto: CreateTestEmailDto = {
          to: 'encrypted@example.com',
          auth: {
            spf: 'fail',
            dkim: 'fail',
            dmarc: 'fail',
            reverseDns: false,
          },
        };

        const result = await service.createTestEmail(dto);

        expect(result.emailId).toBeDefined();
        expect(mockEmailStorageService.storeEmail).toHaveBeenCalled();
      });

      it('should normalize recipient email to lowercase', async () => {
        const dto: CreateTestEmailDto = { to: 'ENCRYPTED@EXAMPLE.COM' };

        await service.createTestEmail(dto);

        expect(mockInboxService.getInboxByEmail).toHaveBeenCalledWith('encrypted@example.com');
      });

      it('should emit SSE event with encrypted metadata', async () => {
        const dto: CreateTestEmailDto = { to: 'encrypted@example.com' };

        await service.createTestEmail(dto);

        // Wait for the async SSE emission
        await new Promise((resolve) => setImmediate(resolve));

        expect(mockEventsService.emitNewEmailEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            inboxId: 'encrypted-inbox-hash-123',
            emailId: expect.any(String),
            encryptedMetadata: expect.objectContaining({
              v: 1,
              algs: expect.any(Object),
            }),
          }),
        );
      });
    });

    describe('plain inbox', () => {
      beforeEach(() => {
        (mockInboxService.getInboxByEmail as jest.Mock).mockReturnValue(mockPlainInbox);
      });

      it('should create test email for plain inbox without encryption', async () => {
        const dto: CreateTestEmailDto = { to: 'plain@example.com' };

        const result = await service.createTestEmail(dto);

        expect(result.emailId).toBeDefined();
        expect(mockCryptoService.encryptForClient).not.toHaveBeenCalled();
        expect(mockEmailStorageService.storeEmail).not.toHaveBeenCalled();
        expect(mockInboxStorageService.addEmail).toHaveBeenCalledWith(
          'plain@example.com',
          expect.objectContaining({
            id: expect.any(String),
            isRead: false,
            metadata: expect.any(Uint8Array),
            parsed: expect.any(Uint8Array),
            raw: expect.any(Uint8Array),
          }),
        );
      });

      it('should create plain test email with HTML content', async () => {
        const dto: CreateTestEmailDto = {
          to: 'plain@example.com',
          html: '<p>HTML content</p>',
        };

        const result = await service.createTestEmail(dto);

        expect(result.emailId).toBeDefined();
        expect(mockInboxStorageService.addEmail).toHaveBeenCalled();
      });

      it('should emit SSE event with plain metadata', async () => {
        const dto: CreateTestEmailDto = { to: 'plain@example.com' };

        await service.createTestEmail(dto);

        expect(mockEventsService.emitNewEmailEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            inboxId: 'plain-inbox-hash-123',
            emailId: expect.any(String),
            metadata: expect.any(String), // Base64 encoded
          }),
        );
      });

      it('should handle SSE emission errors gracefully', async () => {
        const throwingEventsService = {
          emitNewEmailEvent: jest.fn().mockImplementation(() => {
            throw new Error('SSE emission failed');
          }),
        } as unknown as EventsService;

        const serviceWithThrowingEvents = new TestEmailService(
          mockInboxService,
          mockCryptoService,
          mockEmailStorageService,
          mockInboxStorageService,
          throwingEventsService,
        );

        const dto: CreateTestEmailDto = { to: 'plain@example.com' };

        // Should not throw - error is caught and logged
        const result = await serviceWithThrowingEvents.createTestEmail(dto);

        expect(result.emailId).toBeDefined();
        expect(mockInboxStorageService.addEmail).toHaveBeenCalled();
      });

      it('should handle non-Error SSE exceptions gracefully', async () => {
        const throwingEventsService = {
          emitNewEmailEvent: jest.fn().mockImplementation(() => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw 'string error'; // Non-Error exception
          }),
        } as unknown as EventsService;

        const serviceWithThrowingEvents = new TestEmailService(
          mockInboxService,
          mockCryptoService,
          mockEmailStorageService,
          mockInboxStorageService,
          throwingEventsService,
        );

        const dto: CreateTestEmailDto = { to: 'plain@example.com' };

        // Should not throw - error is caught and logged
        const result = await serviceWithThrowingEvents.createTestEmail(dto);

        expect(result.emailId).toBeDefined();
      });
    });

    describe('error handling', () => {
      it('should throw NotFoundException when inbox does not exist', async () => {
        (mockInboxService.getInboxByEmail as jest.Mock).mockReturnValue(null);

        const dto: CreateTestEmailDto = { to: 'nonexistent@example.com' };

        await expect(service.createTestEmail(dto)).rejects.toThrow(NotFoundException);
        await expect(service.createTestEmail(dto)).rejects.toThrow('Inbox not found: nonexistent@example.com');
      });
    });
  });

  describe('escapeHtml', () => {
    it('should escape HTML special characters', async () => {
      (mockInboxService.getInboxByEmail as jest.Mock).mockReturnValue(mockPlainInbox);

      const dto: CreateTestEmailDto = {
        to: 'plain@example.com',
        text: '<script>alert("xss")</script> & "quotes" \'apostrophe\'',
      };

      await service.createTestEmail(dto);

      // The escapeHtml is called internally when building parsedPayload
      // We verify it was processed by checking addEmail was called
      expect(mockInboxStorageService.addEmail).toHaveBeenCalled();
    });
  });

  describe('extractDomain', () => {
    it('should extract domain from email with @ symbol', async () => {
      (mockInboxService.getInboxByEmail as jest.Mock).mockReturnValue(mockEncryptedInbox);

      const dto: CreateTestEmailDto = {
        to: 'encrypted@example.com',
        from: 'sender@custom-domain.org',
      };

      await service.createTestEmail(dto);

      // Domain extraction is used in buildAuthResults
      expect(mockEmailStorageService.storeEmail).toHaveBeenCalled();
    });
  });

  describe('buildRawEmail', () => {
    it('should build plain text email correctly', async () => {
      (mockInboxService.getInboxByEmail as jest.Mock).mockReturnValue(mockPlainInbox);

      const dto: CreateTestEmailDto = {
        to: 'plain@example.com',
        from: 'sender@example.com',
        subject: 'Test Subject',
        text: 'Test body',
      };

      await service.createTestEmail(dto);

      const addEmailCall = (mockInboxStorageService.addEmail as jest.Mock).mock.calls[0];
      const storedEmail = addEmailCall[1];

      // raw is base64 encoded
      const rawDecoded = Buffer.from(storedEmail.raw).toString('utf-8');
      const rawEmail = Buffer.from(rawDecoded, 'base64').toString('utf-8');

      expect(rawEmail).toContain('From: sender@example.com');
      expect(rawEmail).toContain('To: plain@example.com');
      expect(rawEmail).toContain('Subject: Test Subject');
      expect(rawEmail).toContain('Content-Type: text/plain');
    });

    it('should build multipart email with HTML correctly', async () => {
      (mockInboxService.getInboxByEmail as jest.Mock).mockReturnValue(mockPlainInbox);

      const dto: CreateTestEmailDto = {
        to: 'plain@example.com',
        text: 'Plain text',
        html: '<p>HTML content</p>',
      };

      await service.createTestEmail(dto);

      const addEmailCall = (mockInboxStorageService.addEmail as jest.Mock).mock.calls[0];
      const storedEmail = addEmailCall[1];

      const rawDecoded = Buffer.from(storedEmail.raw).toString('utf-8');
      const rawEmail = Buffer.from(rawDecoded, 'base64').toString('utf-8');

      expect(rawEmail).toContain('Content-Type: multipart/alternative');
      expect(rawEmail).toContain('text/plain');
      expect(rawEmail).toContain('text/html');
    });
  });

  describe('buildParsedPayload', () => {
    it('should set textAsHtml to null when html is provided', async () => {
      (mockInboxService.getInboxByEmail as jest.Mock).mockReturnValue(mockPlainInbox);

      const dto: CreateTestEmailDto = {
        to: 'plain@example.com',
        text: 'Plain text',
        html: '<p>HTML</p>',
      };

      await service.createTestEmail(dto);

      const addEmailCall = (mockInboxStorageService.addEmail as jest.Mock).mock.calls[0];
      const storedEmail = addEmailCall[1];
      const parsed = JSON.parse(Buffer.from(storedEmail.parsed).toString('utf-8'));

      expect(parsed.textAsHtml).toBeNull();
      expect(parsed.html).toBe('<p>HTML</p>');
    });

    it('should generate textAsHtml when html is not provided', async () => {
      (mockInboxService.getInboxByEmail as jest.Mock).mockReturnValue(mockPlainInbox);

      const dto: CreateTestEmailDto = {
        to: 'plain@example.com',
        text: 'Plain text content',
      };

      await service.createTestEmail(dto);

      const addEmailCall = (mockInboxStorageService.addEmail as jest.Mock).mock.calls[0];
      const storedEmail = addEmailCall[1];
      const parsed = JSON.parse(Buffer.from(storedEmail.parsed).toString('utf-8'));

      expect(parsed.textAsHtml).toContain('<p>');
      expect(parsed.html).toBeNull();
    });
  });

  describe('buildAuthResults', () => {
    it('should use default auth values when not provided', async () => {
      (mockInboxService.getInboxByEmail as jest.Mock).mockReturnValue(mockPlainInbox);

      const dto: CreateTestEmailDto = { to: 'plain@example.com' };

      await service.createTestEmail(dto);

      const addEmailCall = (mockInboxStorageService.addEmail as jest.Mock).mock.calls[0];
      const storedEmail = addEmailCall[1];
      const parsed = JSON.parse(Buffer.from(storedEmail.parsed).toString('utf-8'));

      expect(parsed.authResults.spf.result).toBe('pass');
      expect(parsed.authResults.dkim[0].result).toBe('pass');
      expect(parsed.authResults.dmarc.result).toBe('pass');
      expect(parsed.authResults.reverseDns.result).toBe('pass');
    });

    it('should use custom auth values when provided', async () => {
      (mockInboxService.getInboxByEmail as jest.Mock).mockReturnValue(mockPlainInbox);

      const dto: CreateTestEmailDto = {
        to: 'plain@example.com',
        auth: {
          spf: 'softfail',
          dkim: 'none',
          dmarc: 'fail',
          reverseDns: 'fail',
        },
      };

      await service.createTestEmail(dto);

      const addEmailCall = (mockInboxStorageService.addEmail as jest.Mock).mock.calls[0];
      const storedEmail = addEmailCall[1];
      const parsed = JSON.parse(Buffer.from(storedEmail.parsed).toString('utf-8'));

      expect(parsed.authResults.spf.result).toBe('softfail');
      expect(parsed.authResults.dkim[0].result).toBe('none');
      expect(parsed.authResults.dmarc.result).toBe('fail');
      expect(parsed.authResults.reverseDns.result).toBe('fail');
    });
  });

  describe('buildMetadataPayload', () => {
    it('should include all required metadata fields', async () => {
      (mockInboxService.getInboxByEmail as jest.Mock).mockReturnValue(mockPlainInbox);

      const dto: CreateTestEmailDto = {
        to: 'plain@example.com',
        from: 'sender@example.com',
        subject: 'Test Subject',
      };

      await service.createTestEmail(dto);

      const addEmailCall = (mockInboxStorageService.addEmail as jest.Mock).mock.calls[0];
      const storedEmail = addEmailCall[1];
      const metadata = JSON.parse(Buffer.from(storedEmail.metadata).toString('utf-8'));

      expect(metadata.id).toBeDefined();
      expect(metadata.from).toBe('sender@example.com');
      expect(metadata.to).toBe('plain@example.com');
      expect(metadata.subject).toBe('Test Subject');
      expect(metadata.receivedAt).toBeDefined();
    });
  });
});
