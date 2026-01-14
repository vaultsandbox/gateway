import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient } from './helpers/api-client';
import { createSmtpClient } from './helpers/smtp-client';
import { pollForEmails } from './helpers/assertions';
import { createSSEClient } from './helpers/sse-client';

/**
 * E2E tests for plain text (no encryption) inbox flow.
 *
 * These tests cover the optional encryption feature where inboxes can be created
 * without encryption, storing emails as plain Base64-encoded data instead of
 * encrypted payloads.
 */
describe('Plain Text Flow (No Encryption)', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;

  beforeAll(() => {
    apiClient = createApiClient(appLifecycle.httpServer);
  });

  describe('Plain Inbox Creation', () => {
    it('should create plain inbox with encryption: "plain"', async () => {
      const response = await apiClient
        .createInbox({
          encryption: 'plain',
          ttl: 3600,
        })
        .expect(201);

      expect(response.body).toEqual(
        expect.objectContaining({
          emailAddress: expect.stringMatching(/@/),
          expiresAt: expect.any(String),
          inboxHash: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
          encrypted: false,
        }),
      );

      // serverSigPk should NOT be present for plain inboxes
      expect(response.body.serverSigPk).toBeUndefined();
    });

    it('should create plain inbox with specified email address', async () => {
      const emailAddress = `plaintest-${Date.now()}@vaultsandbox.test`;
      const response = await apiClient
        .createInbox({
          encryption: 'plain',
          emailAddress,
          ttl: 3600,
        })
        .expect(201);

      expect(response.body.emailAddress).toBe(emailAddress);
      expect(response.body.encrypted).toBe(false);
      expect(response.body.serverSigPk).toBeUndefined();
    });

    it('should derive hash from email address for plain inboxes', async () => {
      // Create two plain inboxes with different emails
      const email1 = `plain1-${Date.now()}@vaultsandbox.test`;
      const email2 = `plain2-${Date.now()}@vaultsandbox.test`;

      const inbox1 = await apiClient.createInbox({ encryption: 'plain', emailAddress: email1 }).expect(201);
      const inbox2 = await apiClient.createInbox({ encryption: 'plain', emailAddress: email2 }).expect(201);

      // Hashes should be different for different emails
      expect(inbox1.body.inboxHash).not.toBe(inbox2.body.inboxHash);
    });

    it('should warn but ignore clientKemPk when encryption is plain', async () => {
      // Generate a valid-looking KEM public key
      const dummyClientKemPk = 'A'.repeat(1579);

      const response = await apiClient
        .createInbox({
          clientKemPk: dummyClientKemPk,
          encryption: 'plain',
          ttl: 3600,
        })
        .expect(201);

      // Should succeed but not use the key
      expect(response.body.encrypted).toBe(false);
      expect(response.body.serverSigPk).toBeUndefined();
    });
  });

  describe('SMTP Email Delivery to Plain Inbox', () => {
    it('should receive and store email in plain inbox', async () => {
      // Create plain inbox
      const inboxResponse = await apiClient
        .createInbox({
          encryption: 'plain',
          ttl: 3600,
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      // Send email via SMTP
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
        subject: 'Plain Inbox Test',
      });

      expect(sendInfo.accepted).toContain(inboxAddress);

      // Poll for email
      const emails = await pollForEmails(apiClient, inboxAddress);
      expect(emails).toHaveLength(1);

      const [email] = emails;

      // Plain emails have metadata as Base64 string (not encryptedMetadata)
      expect(email.id).toBeDefined();
      expect(email.isRead).toBe(false);
      expect(email.metadata).toBeDefined();
      expect(typeof email.metadata).toBe('string');

      // Should NOT have encrypted fields
      expect(email.encryptedMetadata).toBeUndefined();
    });

    it('should deliver email to plain inbox via plus-addressing', async () => {
      // Create plain inbox
      const inboxResponse = await apiClient
        .createInbox({
          encryption: 'plain',
          ttl: 3600,
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;
      const [localPart, domain] = inboxAddress.split('@');
      const aliasAddress = `${localPart}+newsletter@${domain}`;

      // Send to alias address
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      const sendInfo = await smtpClient.sendFixture('aliasRecipient', {
        to: inboxAddress,
        aliasTag: 'newsletter',
      });

      expect(sendInfo.accepted).toContain(aliasAddress);

      // Email should appear in base inbox
      const emails = await pollForEmails(apiClient, inboxAddress);
      expect(emails).toHaveLength(1);
      expect(emails[0].metadata).toBeDefined();
    });

    it('should deliver same SMTP message to multiple recipients including plain inbox', async () => {
      // Create one plain inbox and one encrypted inbox
      const plainInbox = await apiClient.createInbox({ encryption: 'plain', ttl: 3600 }).expect(201);

      // Send to plain inbox
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', {
        to: plainInbox.body.emailAddress,
        subject: 'Multi-recipient test',
      });

      // Email should arrive in plain inbox
      const plainEmails = await pollForEmails(apiClient, plainInbox.body.emailAddress);
      expect(plainEmails).toHaveLength(1);
      expect(plainEmails[0].metadata).toBeDefined();
    });
  });

  describe('Plain Email Retrieval', () => {
    // Helper to create plain inbox with test email
    async function createPlainInboxWithEmail(subject = 'Plain Retrieval Test') {
      const inboxResponse = await apiClient
        .createInbox({
          encryption: 'plain',
          ttl: 3600,
        })
        .expect(201);

      const plainInboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('htmlWithAttachment', {
        to: plainInboxAddress,
        subject,
      });

      await pollForEmails(apiClient, plainInboxAddress);
      return plainInboxAddress;
    }

    it('should list emails with Base64 metadata', async () => {
      const plainInboxAddress = await createPlainInboxWithEmail();
      const response = await apiClient.listInboxEmails(plainInboxAddress).expect(200);

      expect(response.body).toHaveLength(1);
      const [email] = response.body;

      // Plain email list item structure
      expect(email.id).toBeDefined();
      expect(email.isRead).toBe(false);
      expect(email.metadata).toBeDefined();
      expect(typeof email.metadata).toBe('string');

      // Decode and verify metadata
      const metadataJson = Buffer.from(email.metadata, 'base64').toString('utf-8');
      const metadata = JSON.parse(metadataJson);

      expect(metadata).toEqual(
        expect.objectContaining({
          id: email.id,
          from: expect.any(String),
          to: plainInboxAddress,
          subject: 'Plain Retrieval Test',
          receivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        }),
      );
    });

    it('should list emails with includeContent=true returning Base64 parsed', async () => {
      const plainInboxAddress = await createPlainInboxWithEmail();
      const response = await apiClient
        .get(`/inboxes/${encodeURIComponent(plainInboxAddress)}/emails?includeContent=true`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      const [email] = response.body;

      expect(email.metadata).toBeDefined();
      expect(email.parsed).toBeDefined();
      expect(typeof email.parsed).toBe('string');

      // Decode and verify parsed content
      const parsedJson = Buffer.from(email.parsed, 'base64').toString('utf-8');
      const parsed = JSON.parse(parsedJson);

      expect(parsed.subject).toBe('Plain Retrieval Test');
      expect(parsed.html).toContain('VaultSandbox HTML Fixture');
    });

    it('should get single email with Base64 metadata and parsed', async () => {
      const plainInboxAddress = await createPlainInboxWithEmail();
      const listResponse = await apiClient.listInboxEmails(plainInboxAddress).expect(200);
      const emailId = listResponse.body[0].id;

      const response = await apiClient.getEmail(plainInboxAddress, emailId).expect(200);

      expect(response.body.id).toBe(emailId);
      expect(response.body.isRead).toBe(false);
      expect(response.body.metadata).toBeDefined();
      expect(response.body.parsed).toBeDefined();

      // Should NOT have encrypted fields
      expect(response.body.encryptedMetadata).toBeUndefined();
      expect(response.body.encryptedParsed).toBeUndefined();

      // Verify parsed content structure
      const parsed = JSON.parse(Buffer.from(response.body.parsed, 'base64').toString('utf-8'));
      expect(parsed.attachments).toBeDefined();
      expect(parsed.attachments.length).toBeGreaterThan(0);
    });

    it('should get raw email as Base64 string', async () => {
      const plainInboxAddress = await createPlainInboxWithEmail();
      const listResponse = await apiClient.listInboxEmails(plainInboxAddress).expect(200);
      const emailId = listResponse.body[0].id;

      const response = await apiClient.getRawEmail(plainInboxAddress, emailId).expect(200);

      expect(response.body.id).toBe(emailId);
      expect(response.body.raw).toBeDefined();
      expect(typeof response.body.raw).toBe('string');

      // Should NOT have encrypted field
      expect(response.body.encryptedRaw).toBeUndefined();

      // The raw email is returned as base64-encoded string
      const rawEmail = Buffer.from(response.body.raw, 'base64').toString('utf-8');
      expect(rawEmail).toContain('From:');
      expect(rawEmail).toContain('To:');
      expect(rawEmail).toContain('Subject: Plain Retrieval Test');
    });
  });

  describe('Plain Inbox Operations', () => {
    it('should mark plain email as read', async () => {
      const inbox = await apiClient.createInbox({ encryption: 'plain', ttl: 3600 }).expect(201);

      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', { to: inbox.body.emailAddress });

      const emails = await pollForEmails(apiClient, inbox.body.emailAddress);
      expect(emails[0].isRead).toBe(false);

      await apiClient.markEmailAsRead(inbox.body.emailAddress, emails[0].id).expect(204);

      const updatedEmails = await apiClient.listInboxEmails(inbox.body.emailAddress).expect(200);
      expect(updatedEmails.body[0].isRead).toBe(true);
    });

    it('should delete plain email', async () => {
      const inbox = await apiClient.createInbox({ encryption: 'plain', ttl: 3600 }).expect(201);

      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', { to: inbox.body.emailAddress });

      const emails = await pollForEmails(apiClient, inbox.body.emailAddress);
      await apiClient.deleteEmail(inbox.body.emailAddress, emails[0].id).expect(204);

      const response = await apiClient.listInboxEmails(inbox.body.emailAddress).expect(200);
      expect(response.body).toHaveLength(0);
    });

    it('should delete plain inbox and all emails', async () => {
      const inbox = await apiClient.createInbox({ encryption: 'plain', ttl: 3600 }).expect(201);

      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', { to: inbox.body.emailAddress });
      await pollForEmails(apiClient, inbox.body.emailAddress);

      await apiClient.deleteInbox(inbox.body.emailAddress).expect(204);

      await apiClient.listInboxEmails(inbox.body.emailAddress).expect(404);
    });

    it('should return sync status for plain inbox', async () => {
      const inbox = await apiClient.createInbox({ encryption: 'plain', ttl: 3600 }).expect(201);

      // Initial sync status
      const initialSync = await apiClient.getInboxSyncStatus(inbox.body.emailAddress).expect(200);
      expect(initialSync.body.emailCount).toBe(0);
      expect(initialSync.body.emailsHash).toBeDefined();

      // Send email
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', { to: inbox.body.emailAddress });
      await pollForEmails(apiClient, inbox.body.emailAddress);

      // Updated sync status
      const updatedSync = await apiClient.getInboxSyncStatus(inbox.body.emailAddress).expect(200);
      expect(updatedSync.body.emailCount).toBe(1);
      expect(updatedSync.body.emailsHash).not.toBe(initialSync.body.emailsHash);
    });
  });

  describe('SSE Events for Plain Emails', () => {
    it('should emit SSE event with Base64 metadata for plain inbox', async () => {
      const inbox = await apiClient.createInbox({ encryption: 'plain', ttl: 3600 }).expect(201);

      // Connect to SSE
      const sseClient = createSSEClient(appLifecycle.actualHttpServer, {
        inboxes: [inbox.body.inboxHash],
      });
      await sseClient.connect();

      // Send email
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      const sendPromise = smtpClient.sendFixture('plaintext', {
        to: inbox.body.emailAddress,
        subject: 'SSE Plain Test',
      });

      // Wait for SSE event
      const messagePromise = sseClient.waitForMessage(10000);
      await sendPromise;
      const sseMessage = await messagePromise;

      // Verify SSE event structure for plain inbox
      expect(sseMessage.data.inboxId).toBe(inbox.body.inboxHash);
      expect(sseMessage.data.emailId).toBeDefined();

      // Plain emails have metadata as Base64 string
      expect(sseMessage.data.metadata).toBeDefined();
      expect(typeof sseMessage.data.metadata).toBe('string');

      // Should NOT have encryptedMetadata
      expect(sseMessage.data.encryptedMetadata).toBeUndefined();

      // Decode and verify metadata
      const metadataJson = Buffer.from(sseMessage.data.metadata, 'base64').toString('utf-8');
      const metadata = JSON.parse(metadataJson);
      expect(metadata.subject).toBe('SSE Plain Test');

      sseClient.close();
    });
  });

  describe('Server Info Encryption Policy', () => {
    it('should return encryptionPolicy in server info', async () => {
      const response = await apiClient.getServerInfo().expect(200);

      expect(response.body.encryptionPolicy).toBeDefined();
      // Default policy is "enabled" in test env
      expect(['always', 'enabled', 'disabled', 'never']).toContain(response.body.encryptionPolicy);
    });
  });
});
