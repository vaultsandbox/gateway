import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient } from './helpers/api-client';
import { createSmtpClient } from './helpers/smtp-client';
import { generateClientKeypair, decryptParsed } from './helpers/crypto-client';
import {
  expectEncryptedPayload,
  expectInboxResponse,
  pollForEmails,
  expectEmptyInbox,
  createTestInbox,
} from './helpers/assertions';

describe('SMTP ⇆ API flow (Phase 1)', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;

  beforeAll(() => {
    apiClient = createApiClient(appLifecycle.httpServer);
  });

  it('creates inbox, accepts SMTP mail, and exposes the email via API', async () => {
    // Generate client keypair for encryption
    const keypair = generateClientKeypair();

    const inboxResponse = await apiClient
      .createInbox({
        clientKemPk: keypair.publicKeyB64,
        ttl: 3600,
      })
      .expect(201);

    expectInboxResponse(inboxResponse.body);

    const inboxAddress: string = inboxResponse.body.emailAddress;
    const smtpClient = createSmtpClient({
      port: appLifecycle.smtpPort,
    });

    const sendInfo = await smtpClient.sendFixture('plaintext', {
      to: inboxAddress,
    });

    expect(sendInfo.accepted).toContain(inboxAddress);

    const emails = await pollForEmails(apiClient, inboxAddress);
    expect(emails).toHaveLength(1);

    const [email] = emails;
    expect(email).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        isRead: false,
      }),
    );
    expectEncryptedPayload(email.encryptedMetadata);

    const emailResponse = await apiClient.getEmail(inboxAddress, email.id).expect(200);
    expect(emailResponse.body.id).toBe(email.id);
    expectEncryptedPayload(emailResponse.body.encryptedMetadata);
    expectEncryptedPayload(emailResponse.body.encryptedParsed);

    await apiClient.deleteEmail(inboxAddress, email.id).expect(204);

    await expectEmptyInbox(apiClient, inboxAddress);
  });

  it('delivers the same SMTP message to all recipients without loss', async () => {
    const keypair1 = generateClientKeypair();
    const keypair2 = generateClientKeypair();

    const inbox1 = await apiClient.createInbox({ clientKemPk: keypair1.publicKeyB64, ttl: 3600 }).expect(201);
    const inbox2 = await apiClient.createInbox({ clientKemPk: keypair2.publicKeyB64, ttl: 3600 }).expect(201);

    const smtpClient = createSmtpClient({
      port: appLifecycle.smtpPort,
    });

    const rawEmail = [
      'From: Multi Recipient <multi@vaultsandbox.test>',
      `To: ${inbox1.body.emailAddress}, ${inbox2.body.emailAddress}`,
      'Subject: Multi recipient delivery test',
      `Message-ID: <multi-${Date.now()}@vaultsandbox.test>`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'Hello to both inboxes.',
      '',
    ].join('\r\n');

    const sendInfo = await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
      from: 'multi@vaultsandbox.test',
      to: [inbox1.body.emailAddress, inbox2.body.emailAddress],
    });

    expect(sendInfo.accepted).toEqual(expect.arrayContaining([inbox1.body.emailAddress, inbox2.body.emailAddress]));

    const [inbox1Emails, inbox2Emails] = await Promise.all([
      pollForEmails(apiClient, inbox1.body.emailAddress),
      pollForEmails(apiClient, inbox2.body.emailAddress),
    ]);

    expect(inbox1Emails).toHaveLength(1);
    expect(inbox2Emails).toHaveLength(1);
  });

  it('delivers email via plus-addressing (alias) to base inbox', async () => {
    // Create inbox for the base address
    const keypair = generateClientKeypair();
    const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

    // Extract the base local part for alias construction
    const [localPart, domain] = inbox.emailAddress.split('@');
    const aliasAddress = `${localPart}+newsletter@${domain}`;

    const smtpClient = createSmtpClient({
      port: appLifecycle.smtpPort,
    });

    // Send email to the alias address (user+tag@domain)
    const sendInfo = await smtpClient.sendFixture('aliasRecipient', {
      to: inbox.emailAddress,
      aliasTag: 'newsletter',
    });

    // The alias address should be accepted
    expect(sendInfo.accepted).toContain(aliasAddress);

    // Email should be delivered to the base inbox
    const emails = await pollForEmails(apiClient, inbox.emailAddress);
    expect(emails).toHaveLength(1);
  });

  it('delivers HTML email with attachment and verifies parsed content', async () => {
    // Generate client keypair for decryption
    const keypair = generateClientKeypair();
    const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

    const smtpClient = createSmtpClient({
      port: appLifecycle.smtpPort,
    });

    // Send HTML email with attachment
    const sendInfo = await smtpClient.sendFixture('htmlWithAttachment', {
      to: inbox.emailAddress,
    });

    expect(sendInfo.accepted).toContain(inbox.emailAddress);

    // Retrieve email via API
    const emails = await pollForEmails(apiClient, inbox.emailAddress);
    expect(emails).toHaveLength(1);

    const [email] = emails;
    const emailResponse = await apiClient.getEmail(inbox.emailAddress, email.id).expect(200);

    expectEncryptedPayload(emailResponse.body.encryptedParsed);

    // Decrypt and verify the parsed content contains attachment info
    const parsed = await decryptParsed(emailResponse.body.encryptedParsed, keypair.secretKey);

    // Verify HTML content is present
    expect(parsed.html).toContain('VaultSandbox HTML Fixture');

    // Verify attachment is present
    expect(parsed.attachments).toBeDefined();
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]).toEqual(
      expect.objectContaining({
        filename: 'security-report.pdf',
        contentType: expect.stringContaining('application/pdf'),
      }),
    );
  });

  it('deduplicates same recipient listed multiple times in RCPT TO', async () => {
    // Create one inbox
    const keypair = generateClientKeypair();
    const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

    const smtpClient = createSmtpClient({
      port: appLifecycle.smtpPort,
    });

    // Build raw email with same recipient listed twice
    const rawEmail = [
      'From: Duplicate Test <duplicate@vaultsandbox.test>',
      `To: ${inbox.emailAddress}, ${inbox.emailAddress}`,
      'Subject: Duplicate recipient deduplication test',
      `Message-ID: <dedup-${Date.now()}@vaultsandbox.test>`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'This email was sent to the same recipient twice.',
      '',
    ].join('\r\n');

    // Send with duplicate recipients in envelope
    const sendInfo = await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
      from: 'duplicate@vaultsandbox.test',
      to: [inbox.emailAddress, inbox.emailAddress],
    });

    // Both should be accepted (deduplication happens server-side)
    expect(sendInfo.accepted).toContain(inbox.emailAddress);

    // Wait for processing
    const emails = await pollForEmails(apiClient, inbox.emailAddress);

    // Should only store ONE email (not duplicated)
    expect(emails).toHaveLength(1);
  });

  it('extracts URLs from HTML email body', async () => {
    // Generate client keypair for decryption
    const keypair = generateClientKeypair();
    const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

    const smtpClient = createSmtpClient({
      port: appLifecycle.smtpPort,
    });

    // Send email containing URLs
    const sendInfo = await smtpClient.sendFixture('htmlWithUrls', {
      to: inbox.emailAddress,
    });

    expect(sendInfo.accepted).toContain(inbox.emailAddress);

    // Retrieve email via API
    const emails = await pollForEmails(apiClient, inbox.emailAddress);
    expect(emails).toHaveLength(1);

    const [email] = emails;
    const emailResponse = await apiClient.getEmail(inbox.emailAddress, email.id).expect(200);

    // Decrypt the parsed content
    const parsed = await decryptParsed(emailResponse.body.encryptedParsed, keypair.secretKey);

    // Verify links array contains extracted URLs
    expect(parsed.links).toBeDefined();
    expect(Array.isArray(parsed.links)).toBe(true);
    expect(parsed.links.length).toBeGreaterThan(0);

    // Check that expected URLs are extracted
    expect(parsed.links).toEqual(
      expect.arrayContaining([
        expect.stringContaining('example.com/link1'),
        expect.stringContaining('example.org/link2'),
      ]),
    );
  });
});
