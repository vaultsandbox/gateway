import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient } from './helpers/api-client';
import { createSmtpClient } from './helpers/smtp-client';
import { generateClientKeypair, decryptMetadata, decryptParsed, decryptRaw } from './helpers/crypto-client';
import {
  expectEncryptedPayload,
  expectServerInfo,
  expectInboxSyncStatus,
  expectDecryptedMetadata,
  expectDecryptedParsed,
  pollForEmails,
  createTestInbox,
  expectEmptyInbox,
} from './helpers/assertions';
import { createSSEClient } from './helpers/sse-client';

describe('Inbox Endpoints & Decryption (Phase 2)', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;

  beforeAll(() => {
    apiClient = createApiClient(appLifecycle.httpServer);
  });

  describe('Server Info & API Key Validation', () => {
    it('should validate API key with check-key endpoint', async () => {
      const response = await apiClient.checkApiKey().expect(200);
      expect(response.body).toEqual({ ok: true });
    });

    it('should return server cryptographic information', async () => {
      const response = await apiClient.getServerInfo().expect(200);
      expectServerInfo(response.body);
    });

    it('should return consistent server public key across requests', async () => {
      const response1 = await apiClient.getServerInfo().expect(200);
      const response2 = await apiClient.getServerInfo().expect(200);

      expect(response1.body.serverSigPk).toBe(response2.body.serverSigPk);
      expect(response1.body.serverSigPk).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe('Email Decryption & Content Verification', () => {
    it('should decrypt email metadata and verify content', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Send email via SMTP
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', {
        to: inbox.emailAddress,
        subject: 'Test Decryption Subject',
      });

      // Poll for email
      const emails = await pollForEmails(apiClient, inbox.emailAddress);
      expect(emails).toHaveLength(1);

      const [email] = emails;
      expectEncryptedPayload(email.encryptedMetadata);

      // Decrypt metadata
      const metadata = await decryptMetadata(email.encryptedMetadata, keypair.secretKey);
      expectDecryptedMetadata(metadata);

      // Verify decrypted content
      expect(metadata.subject).toBe('Test Decryption Subject');
      expect(metadata.to).toBe(inbox.emailAddress);
      expect(metadata.from).toMatch(/@/);
    });

    it('should decrypt parsed email body and verify structure', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Send email
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', { to: inbox.emailAddress });

      // Get full email
      const emails = await pollForEmails(apiClient, inbox.emailAddress);
      const emailResponse = await apiClient.getEmail(inbox.emailAddress, emails[0].id).expect(200);

      expectEncryptedPayload(emailResponse.body.encryptedMetadata);
      expectEncryptedPayload(emailResponse.body.encryptedParsed);

      // Decrypt parsed content
      const parsed = await decryptParsed(emailResponse.body.encryptedParsed, keypair.secretKey);
      expectDecryptedParsed(parsed);

      // Verify parsed content has expected fields
      expect(parsed.text).toBeDefined();
      expect(parsed.text).toContain('VaultSandbox');
    });

    it('should decrypt and verify raw email content', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Send email
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', {
        to: inbox.emailAddress,
        subject: 'Raw Email Test',
      });

      // Get raw email
      const emails = await pollForEmails(apiClient, inbox.emailAddress);
      const rawResponse = await apiClient.getRawEmail(inbox.emailAddress, emails[0].id).expect(200);

      expectEncryptedPayload(rawResponse.body.encryptedRaw);

      // Decrypt raw content
      const rawEmail = await decryptRaw(rawResponse.body.encryptedRaw, keypair.secretKey);

      // Verify raw email contains RFC822 headers
      expect(rawEmail).toContain('From:');
      expect(rawEmail).toContain('To:');
      expect(rawEmail).toContain('Subject: Raw Email Test');
      expect(rawEmail).toContain('MIME-Version: 1.0');
    });

    it('should verify server signature matches across encrypted payloads', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Get server info
      const serverInfo = await apiClient.getServerInfo().expect(200);
      const expectedServerSigPk = serverInfo.body.serverSigPk;

      // Send and retrieve email
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', { to: inbox.emailAddress });

      const emails = await pollForEmails(apiClient, inbox.emailAddress);
      const emailResponse = await apiClient.getEmail(inbox.emailAddress, emails[0].id).expect(200);

      // Verify all encrypted payloads have the same server signature public key
      expect(emailResponse.body.encryptedMetadata.server_sig_pk).toBe(expectedServerSigPk);
      expect(emailResponse.body.encryptedParsed.server_sig_pk).toBe(expectedServerSigPk);
    });
  });

  describe('HTML + Attachment Email Parsing', () => {
    it('should handle multipart email with HTML and attachment', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Send HTML + attachment email
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('htmlWithAttachment', {
        to: inbox.emailAddress,
        subject: 'HTML with PDF',
      });

      // Retrieve and decrypt
      const emails = await pollForEmails(apiClient, inbox.emailAddress);
      const emailResponse = await apiClient.getEmail(inbox.emailAddress, emails[0].id).expect(200);

      const metadata = await decryptMetadata(emailResponse.body.encryptedMetadata, keypair.secretKey);
      const parsed = await decryptParsed(emailResponse.body.encryptedParsed, keypair.secretKey);

      // Verify metadata
      expect(metadata.subject).toBe('HTML with PDF');

      // Verify parsed content has HTML and attachment
      expect(parsed.html).toBeDefined();
      expect(parsed.html).toContain('VaultSandbox HTML Fixture');
      expect(parsed.attachments).toBeDefined();
      expect(parsed.attachments.length).toBeGreaterThan(0);
      expect(parsed.attachments[0].filename).toContain('security-report.pdf');
      expect(parsed.attachments[0].contentType).toContain('application/pdf');
    });
  });

  describe('Inbox Sync Status', () => {
    it('should return inbox sync status with email count', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Initial sync status (empty)
      const initialSync = await apiClient.getInboxSyncStatus(inbox.emailAddress).expect(200);
      expectInboxSyncStatus(initialSync.body);
      expect(initialSync.body.emailCount).toBe(0);

      // Send email
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', { to: inbox.emailAddress });
      await pollForEmails(apiClient, inbox.emailAddress);

      // Sync status after email
      const afterEmailSync = await apiClient.getInboxSyncStatus(inbox.emailAddress).expect(200);
      expectInboxSyncStatus(afterEmailSync.body);
      expect(afterEmailSync.body.emailCount).toBe(1);

      // Hash should be different
      expect(afterEmailSync.body.emailsHash).not.toBe(initialSync.body.emailsHash);
    });

    it('should update sync hash when email is deleted', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Send email
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', { to: inbox.emailAddress });
      const emails = await pollForEmails(apiClient, inbox.emailAddress);

      const beforeDeleteSync = await apiClient.getInboxSyncStatus(inbox.emailAddress).expect(200);

      // Delete email
      await apiClient.deleteEmail(inbox.emailAddress, emails[0].id).expect(204);

      const afterDeleteSync = await apiClient.getInboxSyncStatus(inbox.emailAddress).expect(200);
      expect(afterDeleteSync.body.emailCount).toBe(0);
      expect(afterDeleteSync.body.emailsHash).not.toBe(beforeDeleteSync.body.emailsHash);
    });

    it('should detect sync hash change via SSE when new email arrives', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Send first email
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', {
        to: inbox.emailAddress,
        subject: 'First Email',
      });
      await pollForEmails(apiClient, inbox.emailAddress);

      // Get initial sync status and hash
      const initialSync = await apiClient.getInboxSyncStatus(inbox.emailAddress).expect(200);
      expectInboxSyncStatus(initialSync.body);
      expect(initialSync.body.emailCount).toBe(1);
      const initialHash = initialSync.body.emailsHash;

      // Connect to SSE before sending second email
      const sseClient = createSSEClient(appLifecycle.actualHttpServer, {
        inboxes: [inbox.inboxHash],
      });
      await sseClient.connect();

      // Send second email
      const sendPromise = smtpClient.sendFixture('plaintext', {
        to: inbox.emailAddress,
        subject: 'Second Email',
      });

      // Wait for SSE event indicating new email arrived
      const messagePromise = sseClient.waitForMessage(10000);
      await sendPromise;
      const sseMessage = await messagePromise;

      // Verify SSE event
      expect(sseMessage.data.inboxId).toBe(inbox.inboxHash);
      expect(sseMessage.data.emailId).toBeDefined();
      expectEncryptedPayload(sseMessage.data.encryptedMetadata);

      // Get updated sync status after SSE notification
      const updatedSync = await apiClient.getInboxSyncStatus(inbox.emailAddress).expect(200);
      expectInboxSyncStatus(updatedSync.body);
      expect(updatedSync.body.emailCount).toBe(2);

      // Verify sync hash changed
      expect(updatedSync.body.emailsHash).not.toBe(initialHash);
      expect(updatedSync.body.emailsHash).toBeDefined();

      sseClient.close();
    });
  });

  describe('Mark Email as Read', () => {
    it('should mark email as read and persist the state', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Send email
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', { to: inbox.emailAddress });
      const emails = await pollForEmails(apiClient, inbox.emailAddress);

      // Initially unread
      expect(emails[0].isRead).toBe(false);

      // Mark as read
      await apiClient.markEmailAsRead(inbox.emailAddress, emails[0].id).expect(204);

      // Verify it's marked as read
      const updatedEmails = await apiClient.listInboxEmails(inbox.emailAddress).expect(200);
      expect(updatedEmails.body[0].isRead).toBe(true);
    });
  });

  describe('Delete Inbox', () => {
    it('should delete inbox and all associated emails', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Send multiple emails
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', { to: inbox.emailAddress });
      await smtpClient.sendFixture('plaintext', { to: inbox.emailAddress });
      await pollForEmails(apiClient, inbox.emailAddress, 10_000, 2);

      // Verify emails exist
      const emailsBefore = await apiClient.listInboxEmails(inbox.emailAddress).expect(200);
      expect(emailsBefore.body.length).toBe(2);

      // Delete inbox
      await apiClient.deleteInbox(inbox.emailAddress).expect(204);

      // Verify inbox is gone
      await apiClient.listInboxEmails(inbox.emailAddress).expect(404);
    });

    it('should succeed when deleting non-existent inbox (idempotent)', async () => {
      // Current behavior: returns 204 even if already deleted
      await apiClient.deleteInbox('nonexistent@vaultsandbox.test').expect(204);
    });
  });

  describe('Clear All Inboxes', () => {
    it('should clear all inboxes and return count', async () => {
      const keypair1 = generateClientKeypair();
      const keypair2 = generateClientKeypair();

      const inbox1 = await createTestInbox(apiClient, keypair1.publicKeyB64);
      const inbox2 = await createTestInbox(apiClient, keypair2.publicKeyB64);

      // Send emails to both inboxes
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', { to: inbox1.emailAddress });
      await smtpClient.sendFixture('plaintext', { to: inbox2.emailAddress });

      // Clear all
      const response = await apiClient.clearAllInboxes().expect(200);
      expect(response.body.deleted).toBe(2);

      // Verify both inboxes are gone
      await apiClient.listInboxEmails(inbox1.emailAddress).expect(404);
      await apiClient.listInboxEmails(inbox2.emailAddress).expect(404);
    });
  });

  describe('Email Deletion', () => {
    it('should delete single email and keep inbox', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Send two emails
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', { to: inbox.emailAddress, subject: 'Email 1' });
      await smtpClient.sendFixture('plaintext', { to: inbox.emailAddress, subject: 'Email 2' });
      const emails = await pollForEmails(apiClient, inbox.emailAddress, 10_000, 2);

      expect(emails.length).toBe(2);

      // Delete first email
      await apiClient.deleteEmail(inbox.emailAddress, emails[0].id).expect(204);

      // Verify only one email remains
      const remainingEmails = await apiClient.listInboxEmails(inbox.emailAddress).expect(200);
      expect(remainingEmails.body.length).toBe(1);
      expect(remainingEmails.body[0].id).toBe(emails[1].id);

      // Verify inbox still exists
      const syncStatus = await apiClient.getInboxSyncStatus(inbox.emailAddress).expect(200);
      expect(syncStatus.body.emailCount).toBe(1);
    });

    it('should return 404 when deleting already deleted email', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Send email
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', { to: inbox.emailAddress });
      const emails = await pollForEmails(apiClient, inbox.emailAddress);

      // Delete email
      await apiClient.deleteEmail(inbox.emailAddress, emails[0].id).expect(204);

      // Verify inbox is empty
      await expectEmptyInbox(apiClient, inbox.emailAddress);

      // Try to delete again - current behavior returns 404
      await apiClient.deleteEmail(inbox.emailAddress, emails[0].id).expect(404);
    });
  });

  describe('Inbox Aliasing', () => {
    it('should accept email sent to inbox alias and normalize to base address', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Extract base address parts
      const [localPart, domain] = inbox.emailAddress.split('@');

      // Send to alias
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('aliasRecipient', {
        to: inbox.emailAddress,
        aliasTag: 'newsletter',
      });

      // Email should appear in base inbox
      const emails = await pollForEmails(apiClient, inbox.emailAddress);
      expect(emails.length).toBe(1);

      // Decrypt and verify
      const metadata = await decryptMetadata(emails[0].encryptedMetadata, keypair.secretKey);
      expect(metadata.to).toContain(`${localPart}+newsletter@${domain}`);
    });

    it('should accept email sent to inbox alias and normalize to base address created with alias', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64, 3600, 'test1234+abcd@vaultsandbox.test');

      // Extract base address parts
      const [localPart, domain] = inbox.emailAddress.split('@');

      // Send to alias
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('aliasRecipient', {
        to: inbox.emailAddress,
        aliasTag: 'abcd',
      });

      // Email should appear in base inbox
      const emails = await pollForEmails(apiClient, inbox.emailAddress);
      expect(emails.length).toBe(1);

      // Decrypt and verify
      const metadata = await decryptMetadata(emails[0].encryptedMetadata, keypair.secretKey);
      expect(metadata.to).toContain(`${localPart}+abcd@${domain}`);
    });

    it('should deliver alias-tagged email and direct email to same inbox with correct recipient info', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const [localPart, domain] = inbox.emailAddress.split('@');
      const aliasTag = 'alias1';
      const aliasAddress = `${localPart}+${aliasTag}@${domain}`;
      const aliasSubject = `Alias delivery ${Date.now()}`;
      const baseSubject = `Base delivery ${Date.now()}`;

      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });

      // Send email directly to the alias address
      await smtpClient.sendFixture('aliasRecipient', {
        to: inbox.emailAddress,
        aliasTag,
        subject: aliasSubject,
      });

      const aliasEmails = await pollForEmails(apiClient, inbox.emailAddress);
      expect(aliasEmails.length).toBe(1);

      const [aliasEmail] = aliasEmails;
      const aliasMetadata = await decryptMetadata(aliasEmail.encryptedMetadata, keypair.secretKey);
      expect(aliasMetadata.subject).toBe(aliasSubject);
      expect(aliasMetadata.to).toBe(aliasAddress);

      // Send another email to the base address without aliasing
      await smtpClient.sendFixture('plaintext', {
        to: inbox.emailAddress,
        subject: baseSubject,
      });

      const allEmails = await pollForEmails(apiClient, inbox.emailAddress, 10_000, 2);
      expect(allEmails.length).toBe(2);

      const baseEmail = allEmails.find((email) => email.id !== aliasEmail.id);
      expect(baseEmail).toBeDefined();
      if (!baseEmail) {
        throw new Error('Expected base email to exist');
      }

      const baseMetadata = await decryptMetadata(baseEmail.encryptedMetadata, keypair.secretKey);
      expect(baseMetadata.subject).toBe(baseSubject);
      expect(baseMetadata.to).toBe(inbox.emailAddress);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent inbox', async () => {
      await apiClient.listInboxEmails('nonexistent@vaultsandbox.test').expect(404);
    });

    it('should return 404 for non-existent email', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      await apiClient.getEmail(inbox.emailAddress, 'non-existent-uuid').expect(404);
    });

    it('should return 404 for non-existent inbox sync status', async () => {
      await apiClient.getInboxSyncStatus('nonexistent@vaultsandbox.test').expect(404);
    });

    it('should reject invalid API key', async () => {
      const invalidClient = createApiClient(appLifecycle.httpServer, { apiKey: 'invalid-key' });
      await invalidClient.checkApiKey().expect(401);
    });

    it('should reject duplicate inbox creation with same KEM public key (409 Conflict)', async () => {
      const keypair = generateClientKeypair();

      // Create first inbox with keypair
      const inbox1 = await createTestInbox(apiClient, keypair.publicKeyB64);
      expect(inbox1.emailAddress).toBeDefined();

      // Try to create second inbox with the same KEM public key
      const response = await apiClient.createInbox({ clientKemPk: keypair.publicKeyB64 }).expect(409);

      // Verify error message
      expect(response.body.message).toContain('same client KEM public key already exists');
      expect(response.body.statusCode).toBe(409);
    });
  });
});
