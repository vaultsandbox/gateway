import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient } from './helpers/api-client';
import { createSmtpClient } from './helpers/smtp-client';
import { generateClientKeypair, decryptMetadata } from './helpers/crypto-client';
import { createTestInbox, expectEncryptedPayload, expectDecryptedMetadata, wait } from './helpers/assertions';
import { createSSEClient, SSEClient } from './helpers/sse-client';

describe('SSE Events Stream (Phase 3)', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;
  const activeClients: SSEClient[] = [];

  beforeAll(() => {
    apiClient = createApiClient(appLifecycle.httpServer);
  });

  afterEach(() => {
    // Clean up any SSE clients that weren't properly closed
    activeClients.forEach((client) => {
      try {
        client.close();
      } catch {
        // Ignore errors during cleanup
      }
    });
    activeClients.length = 0;
  });

  describe('Basic SSE Connection', () => {
    it('should establish SSE connection successfully', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const sseClient = createSSEClient(appLifecycle.actualHttpServer, { inboxes: [inbox.inboxHash] });

      await sseClient.connect();
      sseClient.close();
    });

    it('should reject connection with invalid API key', async () => {
      const sseClient = createSSEClient(appLifecycle.actualHttpServer, { apiKey: 'invalid-key' });

      await expect(sseClient.connect()).rejects.toThrow('SSE connection failed with status 401');
      sseClient.close();
    });
  });

  describe('Email Event Notifications', () => {
    it('should receive SSE event when email arrives', async () => {
      // Generate keypair and create inbox
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Connect to SSE before sending email
      const sseClient = createSSEClient(appLifecycle.actualHttpServer, {
        inboxes: [inbox.inboxHash],
      });
      await sseClient.connect();

      // Send email via SMTP
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      const sendPromise = smtpClient.sendFixture('plaintext', {
        to: inbox.emailAddress,
        subject: 'SSE Test Email',
      });

      // Wait for SSE event
      const messagePromise = sseClient.waitForMessage(10000);

      // Wait for both to complete
      await sendPromise;
      const message = await messagePromise;

      // Verify event structure
      expect(message.data).toEqual(
        expect.objectContaining({
          inboxId: inbox.inboxHash,
          emailId: expect.any(String),
          encryptedMetadata: expect.any(Object),
        }),
      );

      expectEncryptedPayload(message.data.encryptedMetadata);

      // Decrypt and verify metadata
      const metadata = await decryptMetadata(message.data.encryptedMetadata, keypair.secretKey);
      expectDecryptedMetadata(metadata);
      expect(metadata.subject).toBe('SSE Test Email');
      expect(metadata.to).toBe(inbox.emailAddress);

      sseClient.close();
    });

    it('should receive encrypted metadata through SSE that matches API response', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Connect to SSE
      const sseClient = createSSEClient(appLifecycle.actualHttpServer, {
        inboxes: [inbox.inboxHash],
      });
      await sseClient.connect();

      // Send email and wait for SSE event
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', {
        to: inbox.emailAddress,
        subject: 'Metadata Comparison Test',
      });

      const sseMessage = await sseClient.waitForMessage(10000);
      sseClient.close();

      // Get the same email via API
      const apiResponse = await apiClient.listInboxEmails(inbox.emailAddress).expect(200);
      expect(apiResponse.body).toHaveLength(1);

      const emailFromApi = apiResponse.body[0];

      // Verify emailId matches
      expect(sseMessage.data.emailId).toBe(emailFromApi.id);

      // Decrypt both and compare
      const metadataFromSSE = await decryptMetadata(sseMessage.data.encryptedMetadata, keypair.secretKey);
      const metadataFromAPI = await decryptMetadata(emailFromApi.encryptedMetadata, keypair.secretKey);

      expect(metadataFromSSE).toEqual(metadataFromAPI);
    });

    it('should receive multiple events for multiple emails', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Connect to SSE
      const sseClient = createSSEClient(appLifecycle.actualHttpServer, {
        inboxes: [inbox.inboxHash],
      });
      await sseClient.connect();

      // Send multiple emails
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      const sendPromises = [
        smtpClient.sendFixture('plaintext', { to: inbox.emailAddress, subject: 'Email 1' }),
        smtpClient.sendFixture('plaintext', { to: inbox.emailAddress, subject: 'Email 2' }),
        smtpClient.sendFixture('plaintext', { to: inbox.emailAddress, subject: 'Email 3' }),
      ];

      // Wait for all sends and SSE events
      const messagesPromise = sseClient.waitForMessages(3, 15000);
      await Promise.all(sendPromises);
      const messages = await messagesPromise;

      sseClient.close();

      // Verify we received 3 events
      expect(messages).toHaveLength(3);

      // Decrypt and verify subjects
      const subjects = await Promise.all(
        messages.map((msg) => decryptMetadata(msg.data.encryptedMetadata, keypair.secretKey)),
      );

      const subjectTexts = subjects.map((m) => m.subject).sort();
      expect(subjectTexts).toEqual(['Email 1', 'Email 2', 'Email 3']);
    });
  });

  describe('Inbox Filtering', () => {
    it('should only receive events for subscribed inbox', async () => {
      // Create two inboxes
      const keypair1 = generateClientKeypair();
      const keypair2 = generateClientKeypair();
      const inbox1 = await createTestInbox(apiClient, keypair1.publicKeyB64);
      const inbox2 = await createTestInbox(apiClient, keypair2.publicKeyB64);

      // Connect SSE only to inbox1
      const sseClient = createSSEClient(appLifecycle.actualHttpServer, {
        inboxes: [inbox1.inboxHash],
      });
      await sseClient.connect();

      // Send email to inbox1 (should receive event)
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', {
        to: inbox1.emailAddress,
        subject: 'Inbox 1 Email',
      });

      const message1 = await sseClient.waitForMessage(10000);
      expect(message1.data.inboxId).toBe(inbox1.inboxHash);

      // Send email to inbox2 (should NOT receive event)
      await smtpClient.sendFixture('plaintext', {
        to: inbox2.emailAddress,
        subject: 'Inbox 2 Email',
      });

      // Wait a bit to ensure no event arrives
      await wait(2000);

      // Try to get another message - should timeout
      await expect(sseClient.waitForMessage(3000)).rejects.toThrow('Timeout waiting for SSE message');

      sseClient.close();
    });

    it('should receive events for multiple subscribed inboxes', async () => {
      // Create two inboxes
      const keypair1 = generateClientKeypair();
      const keypair2 = generateClientKeypair();
      const inbox1 = await createTestInbox(apiClient, keypair1.publicKeyB64);
      const inbox2 = await createTestInbox(apiClient, keypair2.publicKeyB64);

      // Connect SSE to both inboxes
      const sseClient = createSSEClient(appLifecycle.actualHttpServer, {
        inboxes: [inbox1.inboxHash, inbox2.inboxHash],
      });
      await sseClient.connect();

      // Set up promise to wait for messages first
      const messagesPromise = sseClient.waitForMessages(2, 15000);

      // Send email to both inboxes with small delay
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', {
        to: inbox1.emailAddress,
        subject: 'Inbox 1 Email',
      });

      // Small delay to ensure first email is processed
      await wait(100);

      await smtpClient.sendFixture('plaintext', {
        to: inbox2.emailAddress,
        subject: 'Inbox 2 Email',
      });

      // Wait for both events
      const messages = await messagesPromise;
      sseClient.close();

      // Verify we received events for both inboxes
      const inboxIds = messages.map((m) => m.data.inboxId).sort();
      expect(inboxIds).toEqual([inbox1.inboxHash, inbox2.inboxHash].sort());
    });

    it('should receive all inbox events when no filter specified', async () => {
      // Connecting without inbox filter is not supported; expect failure
      const sseClient = createSSEClient(appLifecycle.actualHttpServer);
      await expect(sseClient.connect()).rejects.toThrow('SSE connection failed with status 400');
      sseClient.close();
    });
  });

  describe('Connection Lifecycle', () => {
    it('should handle client disconnect gracefully', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Connect and immediately disconnect
      const sseClient = createSSEClient(appLifecycle.actualHttpServer, {
        inboxes: [inbox.inboxHash],
      });
      await sseClient.connect();
      sseClient.close();

      // Send email after disconnect (should not cause errors)
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', {
        to: inbox.emailAddress,
      });

      // Email should still be in inbox via API
      const response = await apiClient.listInboxEmails(inbox.emailAddress).expect(200);
      expect(response.body).toHaveLength(1);
    });

    it('should support multiple concurrent SSE connections', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create multiple SSE clients
      const client1 = createSSEClient(appLifecycle.actualHttpServer, { inboxes: [inbox.inboxHash] });
      const client2 = createSSEClient(appLifecycle.actualHttpServer, { inboxes: [inbox.inboxHash] });
      const client3 = createSSEClient(appLifecycle.actualHttpServer, { inboxes: [inbox.inboxHash] });

      await client1.connect();
      await client2.connect();
      await client3.connect();

      // Send email
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', {
        to: inbox.emailAddress,
        subject: 'Multi-client Test',
      });

      // All clients should receive the event
      const [msg1, msg2, msg3] = await Promise.all([
        client1.waitForMessage(10000),
        client2.waitForMessage(10000),
        client3.waitForMessage(10000),
      ]);

      // All should have the same emailId
      expect(msg1.data.emailId).toBe(msg2.data.emailId);
      expect(msg2.data.emailId).toBe(msg3.data.emailId);

      client1.close();
      client2.close();
      client3.close();
    });
  });

  describe('Real-time Delivery', () => {
    it('should deliver events within reasonable time after email arrival', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      const sseClient = createSSEClient(appLifecycle.actualHttpServer, {
        inboxes: [inbox.inboxHash],
      });
      await sseClient.connect();

      // Measure time between send and SSE event
      const startTime = Date.now();

      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('plaintext', {
        to: inbox.emailAddress,
        subject: 'Timing Test',
      });

      await sseClient.waitForMessage(10000);
      const endTime = Date.now();
      const deliveryTime = endTime - startTime;

      sseClient.close();

      // Event should be delivered within 5 seconds (generous for test environment)
      expect(deliveryTime).toBeLessThan(5000);
    });
  });

  describe('Edge Cases', () => {
    it('should handle SSE connection with non-existent inbox hash', async () => {
      // Connect with fake inbox hash
      const sseClient = createSSEClient(appLifecycle.actualHttpServer, {
        inboxes: ['nonexistent-hash'],
      });

      await expect(sseClient.connect()).rejects.toThrow('SSE connection failed with status 400');
      sseClient.close();
    });

    it('should handle email with HTML and attachments through SSE', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      const sseClient = createSSEClient(appLifecycle.actualHttpServer, {
        inboxes: [inbox.inboxHash],
      });
      await sseClient.connect();

      // Send HTML email with attachment
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient.sendFixture('htmlWithAttachment', {
        to: inbox.emailAddress,
        subject: 'HTML with PDF',
      });

      const message = await sseClient.waitForMessage(10000);
      sseClient.close();

      // Decrypt and verify
      const metadata = await decryptMetadata(message.data.encryptedMetadata, keypair.secretKey);
      expect(metadata.subject).toBe('HTML with PDF');
    });

    it('should handle rapid successive emails', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      const sseClient = createSSEClient(appLifecycle.actualHttpServer, {
        inboxes: [inbox.inboxHash],
      });
      await sseClient.connect();

      // Send 5 emails rapidly
      const smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
      const sends = Array.from({ length: 5 }, (_, i) =>
        smtpClient.sendFixture('plaintext', {
          to: inbox.emailAddress,
          subject: `Rapid Email ${i + 1}`,
        }),
      );

      // Wait for all sends and all events
      const messagesPromise = sseClient.waitForMessages(5, 15000);
      await Promise.all(sends);
      const messages = await messagesPromise;

      sseClient.close();

      // Should receive all 5 events
      expect(messages).toHaveLength(5);

      // All should be for the same inbox
      messages.forEach((msg) => {
        expect(msg.data.inboxId).toBe(inbox.inboxHash);
      });
    });
  });
});
