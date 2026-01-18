import * as crypto from 'node:crypto';
import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient, CreateWebhookBody } from './helpers/api-client';
import { createSmtpClient, SmtpTestClient } from './helpers/smtp-client';
import { generateClientKeypair } from './helpers/crypto-client';
import { createTestInbox, pollForEmails } from './helpers/assertions';
import { MockWebhookServer, createMockWebhookServer, WebhookRequest } from './helpers/webhook-server';

describe('Webhook Delivery E2E', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;
  let smtpClient: SmtpTestClient;
  let webhookServer: MockWebhookServer;
  let webhookUrl: string;

  beforeAll(async () => {
    apiClient = createApiClient(appLifecycle.httpServer);
    smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
    webhookServer = createMockWebhookServer();
    webhookUrl = await webhookServer.start();
  });

  afterAll(async () => {
    await webhookServer.stop();
  });

  beforeEach(() => {
    webhookServer.clearRequests();
    webhookServer.resetResponseSettings();
  });

  // Helper to create a webhook and send an email
  async function setupWebhookAndSendEmail(
    webhookData: Partial<CreateWebhookBody> = {},
    emailOptions: { subject?: string; text?: string; from?: string } = {},
  ): Promise<{ inboxEmail: string; webhookId: string; webhookSecret: string }> {
    const keypair = generateClientKeypair();
    const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

    const fullWebhookData: CreateWebhookBody = {
      url: `${webhookUrl}/webhook`,
      events: ['email.received'],
      ...webhookData,
    };

    const webhookResponse = await apiClient.createGlobalWebhook(fullWebhookData).expect(201);

    // Build and send email
    const from = emailOptions.from ?? 'sender@vaultsandbox.test';
    const subject = emailOptions.subject ?? 'Test webhook delivery';
    const text = emailOptions.text ?? 'Test email body for webhook delivery';

    const rawEmail = [
      `From: ${from}`,
      `To: ${inbox.emailAddress}`,
      `Subject: ${subject}`,
      `Message-ID: <webhook-test-${Date.now()}@vaultsandbox.test>`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      text,
      '',
    ].join('\r\n');

    await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
      from,
      to: [inbox.emailAddress],
    });

    return {
      inboxEmail: inbox.emailAddress,
      webhookId: webhookResponse.body.id,
      webhookSecret: webhookResponse.body.secret,
    };
  }

  // Helper to verify HMAC signature
  function verifySignature(request: WebhookRequest, secret: string): boolean {
    const signatureHeader = request.headers['x-vault-signature'] as string;
    const timestamp = request.headers['x-vault-timestamp'] as string;

    if (!signatureHeader || !timestamp) {
      return false;
    }

    const expectedSignature = signatureHeader.replace('sha256=', '');
    const payload = `${timestamp}.${request.body}`;
    const computedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    return computedSignature === expectedSignature;
  }

  // ============================================
  // Basic Delivery Tests
  // ============================================

  describe('Basic Delivery', () => {
    it('should fire webhook on email.received event', async () => {
      await setupWebhookAndSendEmail({ events: ['email.received'] });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);

      const payload = JSON.parse(requests[0].body);
      expect(payload.type).toBe('email.received');
      expect(payload.object).toBe('event');
    });

    it('should fire webhook on email.stored event', async () => {
      await setupWebhookAndSendEmail({ events: ['email.stored'] });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);

      const payload = JSON.parse(requests[0].body);
      expect(payload.type).toBe('email.stored');
    });

    it('should fire webhook on email.deleted event', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create webhook for email.deleted event
      await apiClient
        .createGlobalWebhook({
          url: `${webhookUrl}/webhook`,
          events: ['email.deleted'],
        })
        .expect(201);

      // Send email via SMTP
      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Email to be deleted',
        `Message-ID: <delete-test-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'This email will be deleted.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      // Wait for email to arrive
      const emails = await pollForEmails(apiClient, inbox.emailAddress);
      expect(emails).toHaveLength(1);

      // Delete the email
      await apiClient.deleteEmail(inbox.emailAddress, emails[0].id).expect(204);

      // Wait for webhook
      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);

      const payload = JSON.parse(requests[0].body);
      expect(payload.type).toBe('email.deleted');
      expect(payload.data.reason).toBe('manual');
    });

    it('should send correct payload structure', async () => {
      await setupWebhookAndSendEmail({ events: ['email.received'] });

      const requests = await webhookServer.waitForRequests(1, 10000);
      const payload = JSON.parse(requests[0].body);

      // Verify event envelope
      expect(payload).toMatchObject({
        id: expect.stringMatching(/^evt_/),
        object: 'event',
        createdAt: expect.any(Number),
        type: 'email.received',
        data: expect.any(Object),
      });

      // Verify data structure
      expect(payload.data).toMatchObject({
        id: expect.any(String),
        inboxId: expect.any(String),
        inboxEmail: expect.stringMatching(/@/),
        from: expect.objectContaining({ address: expect.any(String) }),
        to: expect.any(Array),
        subject: expect.any(String),
        snippet: expect.any(String),
        receivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    });

    it('should send correct headers (User-Agent, X-Vault-* headers)', async () => {
      await setupWebhookAndSendEmail();

      const requests = await webhookServer.waitForRequests(1, 10000);
      const headers = requests[0].headers;

      // Check required headers
      expect(headers['user-agent']).toBe('VaultSandbox-Webhook/1.0');
      expect(headers['content-type']).toBe('application/json');
      expect(headers['x-vault-event']).toBe('email.received');
      expect(headers['x-vault-delivery']).toMatch(/^dlv_/);
      expect(headers['x-vault-timestamp']).toMatch(/^\d+$/);
      expect(headers['x-vault-signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('should send valid and verifiable HMAC signature', async () => {
      const { webhookSecret } = await setupWebhookAndSendEmail();

      const requests = await webhookServer.waitForRequests(1, 10000);
      const isValid = verifySignature(requests[0], webhookSecret);

      expect(isValid).toBe(true);
    });
  });

  // ============================================
  // Multiple Webhooks Tests
  // ============================================

  describe('Multiple Webhooks', () => {
    it('should deliver to multiple global webhooks for the same event', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create multiple webhooks
      await apiClient.createGlobalWebhook({ url: `${webhookUrl}/webhook1`, events: ['email.received'] }).expect(201);
      await apiClient.createGlobalWebhook({ url: `${webhookUrl}/webhook2`, events: ['email.received'] }).expect(201);
      await apiClient.createGlobalWebhook({ url: `${webhookUrl}/webhook3`, events: ['email.received'] }).expect(201);

      // Send email
      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Multi-webhook test',
        `Message-ID: <multi-webhook-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Testing multiple webhooks.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      // All three webhooks should receive the event
      const requests = await webhookServer.waitForRequests(3, 10000);
      expect(requests).toHaveLength(3);

      // Verify all received the same event type
      const urls = requests.map((r) => r.url);
      expect(urls).toContain('/webhook1');
      expect(urls).toContain('/webhook2');
      expect(urls).toContain('/webhook3');
    });

    it('should only deliver to inbox webhook for its own inbox', async () => {
      const keypair1 = generateClientKeypair();
      const keypair2 = generateClientKeypair();
      const inbox1 = await createTestInbox(apiClient, keypair1.publicKeyB64);
      const inbox2 = await createTestInbox(apiClient, keypair2.publicKeyB64);

      // Create inbox-specific webhook for inbox1
      await apiClient
        .createInboxWebhook(inbox1.emailAddress, { url: `${webhookUrl}/inbox1`, events: ['email.received'] })
        .expect(201);

      // Create inbox-specific webhook for inbox2
      await apiClient
        .createInboxWebhook(inbox2.emailAddress, { url: `${webhookUrl}/inbox2`, events: ['email.received'] })
        .expect(201);

      // Send email to inbox1 only
      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox1.emailAddress}`,
        'Subject: Inbox-specific webhook test',
        `Message-ID: <inbox-webhook-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Testing inbox-specific webhook.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox1.emailAddress],
      });

      // Only inbox1 webhook should receive the event
      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe('/inbox1');

      // Wait a bit more to ensure inbox2 webhook doesn't fire
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(webhookServer.getRequests()).toHaveLength(1);
    });

    it('should deliver to both global and inbox webhooks for the same email', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create global webhook
      await apiClient.createGlobalWebhook({ url: `${webhookUrl}/global`, events: ['email.received'] }).expect(201);

      // Create inbox-specific webhook
      await apiClient
        .createInboxWebhook(inbox.emailAddress, { url: `${webhookUrl}/inbox`, events: ['email.received'] })
        .expect(201);

      // Send email
      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Global + inbox webhook test',
        `Message-ID: <global-inbox-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Testing global and inbox webhooks together.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      // Both webhooks should receive the event
      const requests = await webhookServer.waitForRequests(2, 10000);
      expect(requests).toHaveLength(2);

      const urls = requests.map((r) => r.url);
      expect(urls).toContain('/global');
      expect(urls).toContain('/inbox');
    });

    it('should not fire disabled webhooks', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create enabled webhook
      await apiClient.createGlobalWebhook({ url: `${webhookUrl}/enabled`, events: ['email.received'] }).expect(201);

      // Create webhook and then disable it
      const disabledWebhook = await apiClient
        .createGlobalWebhook({ url: `${webhookUrl}/disabled`, events: ['email.received'] })
        .expect(201);
      await apiClient.updateGlobalWebhook(disabledWebhook.body.id, { enabled: false }).expect(200);

      // Send email
      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Disabled webhook test',
        `Message-ID: <disabled-webhook-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Testing disabled webhook behavior.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      // Only enabled webhook should receive the event
      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe('/enabled');

      // Wait a bit more to ensure disabled webhook doesn't fire
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(webhookServer.getRequests()).toHaveLength(1);
    });
  });

  // ============================================
  // Payload Content Tests
  // ============================================

  describe('Payload Content', () => {
    it('should correctly map email metadata (from, to, subject)', async () => {
      const from = 'john.doe@vaultsandbox.test';
      const subject = 'Test subject for metadata mapping';

      await setupWebhookAndSendEmail({}, { from, subject });

      const requests = await webhookServer.waitForRequests(1, 10000);
      const payload = JSON.parse(requests[0].body);

      expect(payload.data.from.address).toBe(from);
      expect(payload.data.subject).toBe(subject);
      expect(payload.data.to).toBeInstanceOf(Array);
      expect(payload.data.to.length).toBeGreaterThan(0);
    });

    it('should normalize headers to lowercase keys', async () => {
      await setupWebhookAndSendEmail();

      const requests = await webhookServer.waitForRequests(1, 10000);
      const payload = JSON.parse(requests[0].body);

      // Headers should have lowercase keys
      if (payload.data.headers) {
        const headerKeys = Object.keys(payload.data.headers);
        for (const key of headerKeys) {
          expect(key).toBe(key.toLowerCase());
        }
      }
    });

    it('should send attachments as metadata only (no content)', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create webhook
      await apiClient.createGlobalWebhook({ url: `${webhookUrl}/webhook`, events: ['email.received'] }).expect(201);

      // Send email with attachment using the fixture
      await smtpClient.sendFixture('htmlWithAttachment', { to: inbox.emailAddress });

      const requests = await webhookServer.waitForRequests(1, 10000);
      const payload = JSON.parse(requests[0].body);

      // Verify attachments contain metadata only
      expect(payload.data.attachments).toBeInstanceOf(Array);
      if (payload.data.attachments.length > 0) {
        const attachment = payload.data.attachments[0];
        expect(attachment).toMatchObject({
          filename: expect.any(String),
          contentType: expect.any(String),
          size: expect.any(Number),
        });
        // Should NOT contain actual content
        expect(attachment.content).toBeUndefined();
        expect(attachment.data).toBeUndefined();
      }
    });

    it('should create text snippet (first 200 characters)', async () => {
      const longText = 'A'.repeat(300);

      await setupWebhookAndSendEmail({}, { text: longText });

      const requests = await webhookServer.waitForRequests(1, 10000);
      const payload = JSON.parse(requests[0].body);

      // Snippet should be max 200 chars (possibly with "..." if truncated)
      expect(payload.data.snippet).toBeDefined();
      expect(payload.data.snippet.length).toBeLessThanOrEqual(203); // 200 + "..."
    });

    it('should include text body when available', async () => {
      const text = 'This is the test email body content';

      await setupWebhookAndSendEmail({}, { text });

      const requests = await webhookServer.waitForRequests(1, 10000);
      const payload = JSON.parse(requests[0].body);

      expect(payload.data.textBody).toBeDefined();
      expect(payload.data.textBody).toContain(text);
    });

    it('should include receivedAt timestamp in ISO format', async () => {
      await setupWebhookAndSendEmail();

      const requests = await webhookServer.waitForRequests(1, 10000);
      const payload = JSON.parse(requests[0].body);

      expect(payload.data.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should include inbox information', async () => {
      await setupWebhookAndSendEmail();

      const requests = await webhookServer.waitForRequests(1, 10000);
      const payload = JSON.parse(requests[0].body);

      expect(payload.data.inboxId).toBeDefined();
      expect(payload.data.inboxEmail).toMatch(/@/);
    });
  });

  // ============================================
  // Event Types Tests
  // ============================================

  describe('Event Types', () => {
    it('should only fire for subscribed event types', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create webhook that only listens to email.stored (not email.received)
      await apiClient.createGlobalWebhook({ url: `${webhookUrl}/stored-only`, events: ['email.stored'] }).expect(201);

      // Create webhook that only listens to email.received
      await apiClient
        .createGlobalWebhook({ url: `${webhookUrl}/received-only`, events: ['email.received'] })
        .expect(201);

      // Send email
      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Event type filter test',
        `Message-ID: <event-filter-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Testing event type filtering.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      // Both webhooks should fire (one for received, one for stored)
      const requests = await webhookServer.waitForRequests(2, 10000);
      expect(requests).toHaveLength(2);

      const receivedRequest = requests.find((r) => r.url === '/received-only');
      const storedRequest = requests.find((r) => r.url === '/stored-only');

      expect(receivedRequest).toBeDefined();
      expect(storedRequest).toBeDefined();

      const receivedPayload = JSON.parse(receivedRequest!.body);
      const storedPayload = JSON.parse(storedRequest!.body);

      expect(receivedPayload.type).toBe('email.received');
      expect(storedPayload.type).toBe('email.stored');
    });

    it('should fire for multiple subscribed event types', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create webhook that listens to both email.received and email.stored
      await apiClient
        .createGlobalWebhook({ url: `${webhookUrl}/both`, events: ['email.received', 'email.stored'] })
        .expect(201);

      // Send email
      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Multiple event types test',
        `Message-ID: <multi-events-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Testing multiple event types.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      // Same webhook should receive both events
      const requests = await webhookServer.waitForRequests(2, 10000);
      expect(requests).toHaveLength(2);

      const eventTypes = requests.map((r) => JSON.parse(r.body).type);
      expect(eventTypes).toContain('email.received');
      expect(eventTypes).toContain('email.stored');
    });
  });

  // ============================================
  // Signature Verification Tests
  // ============================================

  describe('Signature Verification', () => {
    it('should generate signature in correct format (sha256=...)', async () => {
      await setupWebhookAndSendEmail();

      const requests = await webhookServer.waitForRequests(1, 10000);
      const signature = requests[0].headers['x-vault-signature'] as string;

      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('should include timestamp header with recent value', async () => {
      const beforeSend = Math.floor(Date.now() / 1000);
      await setupWebhookAndSendEmail();

      const requests = await webhookServer.waitForRequests(1, 10000);
      const timestamp = parseInt(requests[0].headers['x-vault-timestamp'] as string, 10);
      const afterReceive = Math.floor(Date.now() / 1000);

      // Timestamp should be between before send and after receive
      expect(timestamp).toBeGreaterThanOrEqual(beforeSend);
      expect(timestamp).toBeLessThanOrEqual(afterReceive);
    });

    it('should compute signature correctly (verifiable client-side)', async () => {
      const { webhookSecret } = await setupWebhookAndSendEmail();

      const requests = await webhookServer.waitForRequests(1, 10000);
      const request = requests[0];

      const timestamp = request.headers['x-vault-timestamp'] as string;
      const signatureHeader = request.headers['x-vault-signature'] as string;
      const expectedSignature = signatureHeader.replace('sha256=', '');

      // Recompute signature
      const payload = `${timestamp}.${request.body}`;
      const computedSignature = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');

      expect(computedSignature).toBe(expectedSignature);
    });

    it('should include unique delivery ID in each request', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create two webhooks
      await apiClient.createGlobalWebhook({ url: `${webhookUrl}/webhook1`, events: ['email.received'] }).expect(201);
      await apiClient.createGlobalWebhook({ url: `${webhookUrl}/webhook2`, events: ['email.received'] }).expect(201);

      // Send email
      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Delivery ID test',
        `Message-ID: <delivery-id-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Testing delivery IDs.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      const requests = await webhookServer.waitForRequests(2, 10000);

      // Each delivery should have a unique ID
      const deliveryIds = requests.map((r) => r.headers['x-vault-delivery']);
      expect(new Set(deliveryIds).size).toBe(2);

      // All delivery IDs should have correct format
      for (const id of deliveryIds) {
        expect(id).toMatch(/^dlv_/);
      }
    });
  });

  // ============================================
  // email.stored Event Tests
  // ============================================

  describe('email.stored Event', () => {
    it('should include minimal data in email.stored payload', async () => {
      await setupWebhookAndSendEmail({ events: ['email.stored'] });

      const requests = await webhookServer.waitForRequests(1, 10000);
      const payload = JSON.parse(requests[0].body);

      expect(payload.type).toBe('email.stored');
      expect(payload.data).toMatchObject({
        id: expect.any(String),
        inboxId: expect.any(String),
        inboxEmail: expect.stringMatching(/@/),
        storedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });

      // email.stored should NOT include full email content
      expect(payload.data.from).toBeUndefined();
      expect(payload.data.subject).toBeUndefined();
      expect(payload.data.textBody).toBeUndefined();
    });
  });

  // ============================================
  // email.deleted Event Tests
  // ============================================

  describe('email.deleted Event', () => {
    it('should include deletion reason in email.deleted payload', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create webhook for email.deleted event
      await apiClient.createGlobalWebhook({ url: `${webhookUrl}/webhook`, events: ['email.deleted'] }).expect(201);

      // Send email
      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Email to delete',
        `Message-ID: <to-delete-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'This email will be deleted.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      // Wait for email
      const emails = await pollForEmails(apiClient, inbox.emailAddress);

      // Delete the email
      await apiClient.deleteEmail(inbox.emailAddress, emails[0].id).expect(204);

      // Verify webhook payload
      const requests = await webhookServer.waitForRequests(1, 10000);
      const payload = JSON.parse(requests[0].body);

      expect(payload.type).toBe('email.deleted');
      expect(payload.data).toMatchObject({
        id: emails[0].id,
        inboxId: expect.any(String),
        inboxEmail: inbox.emailAddress,
        reason: 'manual',
        deletedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    });
  });
});
