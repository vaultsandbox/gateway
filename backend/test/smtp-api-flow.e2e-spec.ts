import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient } from './helpers/api-client';
import { createSmtpClient } from './helpers/smtp-client';
import { generateClientKeypair } from './helpers/crypto-client';
import { expectEncryptedPayload, expectInboxResponse, pollForEmails, expectEmptyInbox } from './helpers/assertions';

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
});
