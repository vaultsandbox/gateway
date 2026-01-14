import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InboxService } from '../inbox/inbox.service';
import { CryptoService } from '../crypto/crypto.service';
import { EmailStorageService } from '../smtp/storage/email-storage.service';
import { InboxStorageService } from '../inbox/storage/inbox-storage.service';
import { EventsService } from '../events/events.service';
import { CreateTestEmailDto } from './dto/create-test-email.dto';
import { serializeEncryptedPayload } from '../crypto/serialization';
import type { EncryptedBodyPayload, AuthenticationResults } from '../smtp/interfaces/encrypted-body.interface';
import type { PlainStoredEmail } from '../inbox/interfaces';

type ParsedEmailPayload = Omit<EncryptedBodyPayload, 'rawEmail'>;

interface MetadataPayload {
  id: string;
  from: string;
  to: string;
  subject: string;
  receivedAt: string;
}

@Injectable()
export class TestEmailService {
  private readonly logger = new Logger(TestEmailService.name);

  /* c8 ignore next 6 */
  constructor(
    private readonly inboxService: InboxService,
    private readonly cryptoService: CryptoService,
    private readonly emailStorageService: EmailStorageService,
    private readonly inboxStorageService: InboxStorageService,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * Create a test email with controlled authentication results.
   *
   * @param dto - The test email parameters
   * @returns The created email ID
   * @throws NotFoundException if the inbox does not exist
   */
  async createTestEmail(dto: CreateTestEmailDto): Promise<{ emailId: string }> {
    // Normalize recipient address
    const recipientEmail = dto.to.toLowerCase();

    // Validate inbox exists
    const inbox = this.inboxService.getInboxByEmail(recipientEmail);
    if (!inbox) {
      throw new NotFoundException(`Inbox not found: ${recipientEmail}`);
    }

    // Apply defaults
    const from = dto.from || 'test@vaultsandbox.test';
    const subject = dto.subject || 'Test Email';
    const text = dto.text || 'Test email body';
    const html = dto.html || null;
    const receivedAt = new Date();
    const emailId = randomUUID();

    // Build auth results with controlled values
    const authResults = this.buildAuthResults(from, dto);

    // Build payloads
    const metadataPayload = this.buildMetadataPayload(emailId, from, recipientEmail, subject, receivedAt);
    const parsedPayload = this.buildParsedPayload(from, recipientEmail, subject, text, html, receivedAt, authResults);
    const rawPayload = this.buildRawEmail(from, recipientEmail, subject, text, html, receivedAt);

    if (inbox.encrypted && inbox.clientKemPk) {
      // Encrypted inbox: encrypt and store
      await this.storeEncryptedTestEmail(
        inbox.clientKemPk,
        recipientEmail,
        emailId,
        metadataPayload,
        parsedPayload,
        rawPayload,
      );

      // Emit SSE event with encrypted metadata
      this.emitEncryptedSseEvent(inbox.inboxHash, emailId, inbox.clientKemPk, metadataPayload);
    } else {
      // Plain inbox: store as binary Uint8Array
      this.storePlainTestEmail(recipientEmail, emailId, metadataPayload, parsedPayload, rawPayload);

      // Emit SSE event with plain metadata
      this.emitPlainSseEvent(inbox.inboxHash, emailId, metadataPayload);
    }

    this.logger.log(`Test email ${emailId} created for ${recipientEmail} (encrypted=${inbox.encrypted})`);

    return { emailId };
  }

  /**
   * Store encrypted test email.
   */
  private async storeEncryptedTestEmail(
    clientKemPk: string,
    recipientEmail: string,
    emailId: string,
    metadataPayload: MetadataPayload,
    parsedPayload: ParsedEmailPayload,
    rawPayload: string,
  ): Promise<void> {
    const metadataPlaintext = Buffer.from(JSON.stringify(metadataPayload), 'utf-8');
    const parsedPlaintext = Buffer.from(JSON.stringify(parsedPayload), 'utf-8');
    const rawPlaintext = Buffer.from(rawPayload, 'utf-8');

    const metadataAad = Buffer.from('vaultsandbox:metadata', 'utf-8');
    const parsedAad = Buffer.from('vaultsandbox:parsed', 'utf-8');
    const rawAad = Buffer.from('vaultsandbox:raw', 'utf-8');

    const encryptedMetadata = await this.cryptoService.encryptForClient(clientKemPk, metadataPlaintext, metadataAad);
    const encryptedParsed = await this.cryptoService.encryptForClient(clientKemPk, parsedPlaintext, parsedAad);
    const encryptedRaw = await this.cryptoService.encryptForClient(clientKemPk, rawPlaintext, rawAad);

    this.emailStorageService.storeEmail(recipientEmail, emailId, {
      encryptedMetadata,
      encryptedParsed,
      encryptedRaw,
    });
  }

  /**
   * Store plain test email.
   */
  private storePlainTestEmail(
    recipientEmail: string,
    emailId: string,
    metadataPayload: MetadataPayload,
    parsedPayload: ParsedEmailPayload,
    rawPayload: string,
  ): void {
    const plainEmail: PlainStoredEmail = {
      id: emailId,
      isRead: false,
      metadata: new Uint8Array(Buffer.from(JSON.stringify(metadataPayload))),
      parsed: new Uint8Array(Buffer.from(JSON.stringify(parsedPayload))),
      raw: new Uint8Array(Buffer.from(rawPayload)), // rawPayload is already base64
    };

    this.inboxStorageService.addEmail(recipientEmail, plainEmail);
  }

  /**
   * Emit SSE event for encrypted test email.
   */
  private emitEncryptedSseEvent(
    inboxHash: string,
    emailId: string,
    clientKemPk: string,
    metadataPayload: MetadataPayload,
  ): void {
    try {
      const metadataPlaintext = Buffer.from(JSON.stringify(metadataPayload), 'utf-8');
      const metadataAad = Buffer.from('vaultsandbox:metadata', 'utf-8');
      // Note: This is a synchronous call for SSE, we fire-and-forget
      void this.cryptoService
        .encryptForClient(clientKemPk, metadataPlaintext, metadataAad)
        .then((encryptedMetadata) => {
          this.eventsService.emitNewEmailEvent({
            inboxId: inboxHash,
            emailId,
            encryptedMetadata: serializeEncryptedPayload(encryptedMetadata),
          });
        });
      /* v8 ignore start - defensive: cryptoService.encryptForClient doesn't throw synchronously*/
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to emit SSE event for test email ${emailId}: ${message}`);
    }
    /* v8 ignore stop */
  }

  /**
   * Emit SSE event for plain test email.
   */
  private emitPlainSseEvent(inboxHash: string, emailId: string, metadataPayload: MetadataPayload): void {
    try {
      this.eventsService.emitNewEmailEvent({
        inboxId: inboxHash,
        emailId,
        metadata: Buffer.from(JSON.stringify(metadataPayload)).toString('base64'),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to emit SSE event for test email ${emailId}: ${message}`);
    }
  }

  /**
   * Build authentication results with controlled values from the DTO.
   */
  private buildAuthResults(from: string, dto: CreateTestEmailDto): AuthenticationResults {
    const domain = this.extractDomain(from);

    const spfResult = dto.auth?.spf ?? 'pass';
    const dkimResult = dto.auth?.dkim ?? 'pass';
    const dmarcResult = dto.auth?.dmarc ?? 'pass';
    const reverseDnsResult = dto.auth?.reverseDns ?? 'pass';

    return {
      spf: {
        result: spfResult,
        domain,
        details: `spf=${spfResult} (test email)`,
      },
      dkim: [
        {
          domain,
          result: dkimResult,
          selector: 'test',
          signature: `dkim=${dkimResult} (test email)`,
        },
      ],
      dmarc: {
        result: dmarcResult,
        policy: 'none',
        domain,
        aligned: true,
      },
      reverseDns: {
        result: reverseDnsResult,
        hostname: reverseDnsResult === 'pass' ? 'test.vaultsandbox.local' : '',
        ip: '127.0.0.1',
      },
    };
  }

  /**
   * Build metadata payload for email list display.
   */
  private buildMetadataPayload(
    emailId: string,
    from: string,
    to: string,
    subject: string,
    receivedAt: Date,
  ): MetadataPayload {
    return {
      id: emailId,
      from,
      to,
      subject,
      receivedAt: receivedAt.toISOString(),
    };
  }

  /**
   * Build parsed email payload with all content and authentication results.
   */
  private buildParsedPayload(
    from: string,
    to: string,
    subject: string,
    text: string,
    html: string | null,
    receivedAt: Date,
    authResults: AuthenticationResults,
  ): ParsedEmailPayload {
    const messageId = `<${randomUUID()}@test.vaultsandbox.local>`;

    return {
      html,
      text,
      textAsHtml: html ? null : `<p>${this.escapeHtml(text)}</p>`,
      headers: {
        from,
        to,
        subject,
        date: receivedAt.toUTCString(),
        'message-id': messageId,
        'content-type': html ? 'multipart/alternative' : 'text/plain; charset=utf-8',
      },
      subject,
      messageId,
      date: receivedAt.toISOString(),
      from,
      to,
      attachments: [],
      authResults,
    };
  }

  /**
   * Build a minimal RFC 5322 raw email.
   */
  private buildRawEmail(
    from: string,
    to: string,
    subject: string,
    text: string,
    html: string | null,
    receivedAt: Date,
  ): string {
    const messageId = `<${randomUUID()}@test.vaultsandbox.local>`;
    const dateStr = receivedAt.toUTCString();
    const boundary = `----=_TestBoundary_${randomUUID().replace(/-/g, '')}`;

    let rawEmail = '';
    rawEmail += `From: ${from}\r\n`;
    rawEmail += `To: ${to}\r\n`;
    rawEmail += `Subject: ${subject}\r\n`;
    rawEmail += `Date: ${dateStr}\r\n`;
    rawEmail += `Message-ID: ${messageId}\r\n`;
    rawEmail += `MIME-Version: 1.0\r\n`;

    if (html) {
      // Multipart email with both text and HTML
      rawEmail += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n`;
      rawEmail += `\r\n`;
      rawEmail += `--${boundary}\r\n`;
      rawEmail += `Content-Type: text/plain; charset=utf-8\r\n`;
      rawEmail += `Content-Transfer-Encoding: 7bit\r\n`;
      rawEmail += `\r\n`;
      rawEmail += `${text}\r\n`;
      rawEmail += `--${boundary}\r\n`;
      rawEmail += `Content-Type: text/html; charset=utf-8\r\n`;
      rawEmail += `Content-Transfer-Encoding: 7bit\r\n`;
      rawEmail += `\r\n`;
      rawEmail += `${html}\r\n`;
      rawEmail += `--${boundary}--\r\n`;
    } else {
      // Plain text email
      rawEmail += `Content-Type: text/plain; charset=utf-8\r\n`;
      rawEmail += `Content-Transfer-Encoding: 7bit\r\n`;
      rawEmail += `\r\n`;
      rawEmail += `${text}\r\n`;
    }

    // Base64 encode for JSON safety (matches smtp-handler behavior)
    return Buffer.from(rawEmail).toString('base64');
  }

  /**
   * Extract domain from email address.
   */
  private extractDomain(email: string): string {
    const parts = email.split('@');
    /* c8 ignore next */
    return parts.length > 1 ? parts[1] : 'unknown';
  }

  /**
   * Simple HTML escaping for text content.
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
