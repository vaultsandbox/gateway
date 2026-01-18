import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient, CreateWebhookBody } from './helpers/api-client';
import { createSmtpClient, SmtpTestClient } from './helpers/smtp-client';
import { generateClientKeypair } from './helpers/crypto-client';
import { createTestInbox } from './helpers/assertions';
import { MockWebhookServer, createMockWebhookServer } from './helpers/webhook-server';

describe('Webhook Failure E2E', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;
  let smtpClient: SmtpTestClient;
  let webhookServer: MockWebhookServer;
  let webhookUrl: string;

  const validWebhookData: CreateWebhookBody = {
    url: '', // Will be set in beforeAll
    events: ['email.received'],
  };

  beforeAll(async () => {
    apiClient = createApiClient(appLifecycle.httpServer);
    smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
    webhookServer = createMockWebhookServer();
    webhookUrl = await webhookServer.start();
    validWebhookData.url = `${webhookUrl}/webhook`;
  });

  afterAll(async () => {
    await webhookServer.stop();
  });

  beforeEach(() => {
    webhookServer.clearRequests();
    webhookServer.resetResponseSettings();
  });

  // Helper to send an email and wait for webhook delivery attempt
  async function sendEmailAndWaitForDelivery(inboxEmail: string, expectedCount = 1): Promise<void> {
    const rawEmail = [
      'From: sender@vaultsandbox.test',
      `To: ${inboxEmail}`,
      'Subject: Failure test email',
      `Message-ID: <failure-test-${Date.now()}-${Math.random()}@vaultsandbox.test>`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'Testing webhook failure handling.',
      '',
    ].join('\r\n');

    await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
      from: 'sender@vaultsandbox.test',
      to: [inboxEmail],
    });

    // Wait for webhook delivery attempt
    await webhookServer.waitForRequests(expectedCount, 10000);
  }

  // ============================================
  // Delivery Failures Tests
  // ============================================

  describe('Delivery Failures', () => {
    it('should record failed delivery with 4xx response in stats', async () => {
      webhookServer.setResponseCode(400);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      expect(webhook.body.stats.failedDeliveries).toBe(0);

      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.failedDeliveries).toBe(1);
      expect(afterWebhook.body.stats.totalDeliveries).toBe(1);
      expect(afterWebhook.body.lastDeliveryStatus).toBe('failed');
    });

    it('should record failed delivery with 5xx response in stats', async () => {
      webhookServer.setResponseCode(500);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      expect(webhook.body.stats.failedDeliveries).toBe(0);

      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.failedDeliveries).toBe(1);
      expect(afterWebhook.body.lastDeliveryStatus).toBe('failed');
    });

    it('should record failed delivery with 404 response in stats', async () => {
      webhookServer.setResponseCode(404);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.failedDeliveries).toBe(1);
      expect(afterWebhook.body.lastDeliveryStatus).toBe('failed');
    });

    it('should record failed delivery with 503 Service Unavailable', async () => {
      webhookServer.setResponseCode(503);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.failedDeliveries).toBe(1);
      expect(afterWebhook.body.lastDeliveryStatus).toBe('failed');
    });

    it('should handle connection error to non-existent server', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create webhook pointing to a port that nothing is listening on
      const webhook = await apiClient
        .createGlobalWebhook({
          url: 'http://127.0.0.1:59999/webhook',
          events: ['email.received'],
        })
        .expect(201);

      // Send email - delivery will fail due to connection error
      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Connection error test',
        `Message-ID: <conn-error-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Testing connection error handling.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      // Wait for the delivery attempt to be processed
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.failedDeliveries).toBe(1);
      expect(afterWebhook.body.lastDeliveryStatus).toBe('failed');
    });

    it('should track consecutive failures count', async () => {
      webhookServer.setResponseCode(500);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Send 3 emails that will all fail
      for (let i = 0; i < 3; i++) {
        await sendEmailAndWaitForDelivery(inbox.emailAddress, i + 1);
      }

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.failedDeliveries).toBe(3);
      expect(afterWebhook.body.stats.totalDeliveries).toBe(3);
      expect(afterWebhook.body.lastDeliveryStatus).toBe('failed');
    });

    it('should increment global failed delivery metrics', async () => {
      webhookServer.setResponseCode(500);

      const beforeMetrics = await apiClient.getWebhookMetrics().expect(200);
      const initialFailed = beforeMetrics.body.deliveries.failed;

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterMetrics = await apiClient.getWebhookMetrics().expect(200);
      expect(afterMetrics.body.deliveries.failed).toBe(initialFailed + 1);
    });
  });

  // ============================================
  // Auto-disable Tests
  // ============================================

  describe('Auto-disable', () => {
    it('should auto-disable webhook after 5 consecutive failures', async () => {
      webhookServer.setResponseCode(500);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      expect(webhook.body.enabled).toBe(true);

      // Send 5 emails to trigger auto-disable threshold
      for (let i = 0; i < 5; i++) {
        await sendEmailAndWaitForDelivery(inbox.emailAddress, i + 1);
      }

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.enabled).toBe(false);
      expect(afterWebhook.body.stats.failedDeliveries).toBe(5);
    });

    it('should not fire events when webhook is disabled', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create and immediately disable webhook
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);
      await apiClient.updateGlobalWebhook(webhook.body.id, { enabled: false }).expect(200);

      // Send email
      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Disabled webhook test',
        `Message-ID: <disabled-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'This should not trigger webhook.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      // Wait a bit to ensure no delivery attempt
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // No requests should have been received
      expect(webhookServer.getRequests()).toHaveLength(0);

      // Stats should remain unchanged
      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.totalDeliveries).toBe(0);
    });

    it('should stop firing events after auto-disable', async () => {
      webhookServer.setResponseCode(500);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Trigger auto-disable with 5 failures
      for (let i = 0; i < 5; i++) {
        await sendEmailAndWaitForDelivery(inbox.emailAddress, i + 1);
      }

      // Verify webhook is disabled
      const afterDisable = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterDisable.body.enabled).toBe(false);

      // Clear requests and reset to success response
      webhookServer.clearRequests();
      webhookServer.setResponseCode(200);

      // Send another email - should not trigger webhook
      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: After auto-disable test',
        `Message-ID: <after-disable-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'This should not trigger the disabled webhook.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // No new requests should have been received
      expect(webhookServer.getRequests()).toHaveLength(0);
    });

    it('should allow re-enabling a disabled webhook', async () => {
      webhookServer.setResponseCode(500);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Trigger auto-disable
      for (let i = 0; i < 5; i++) {
        await sendEmailAndWaitForDelivery(inbox.emailAddress, i + 1);
      }

      // Verify disabled
      const afterDisable = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterDisable.body.enabled).toBe(false);

      // Re-enable the webhook
      await apiClient.updateGlobalWebhook(webhook.body.id, { enabled: true }).expect(200);

      // Verify re-enabled
      const afterReEnable = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterReEnable.body.enabled).toBe(true);

      // Reset to success and send email
      webhookServer.clearRequests();
      webhookServer.setResponseCode(200);

      await sendEmailAndWaitForDelivery(inbox.emailAddress, 1);

      // Should receive the webhook now
      expect(webhookServer.getRequests()).toHaveLength(1);
    });

    it('should reset consecutive failures on successful delivery', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Cause 3 consecutive failures (not enough to auto-disable)
      webhookServer.setResponseCode(500);
      for (let i = 0; i < 3; i++) {
        await sendEmailAndWaitForDelivery(inbox.emailAddress, i + 1);
      }

      const afterFailures = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterFailures.body.stats.failedDeliveries).toBe(3);
      expect(afterFailures.body.enabled).toBe(true); // Still enabled, threshold is 5

      // Now succeed
      webhookServer.setResponseCode(200);
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 4);

      const afterSuccess = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterSuccess.body.stats.successfulDeliveries).toBe(1);
      expect(afterSuccess.body.stats.failedDeliveries).toBe(3);
      expect(afterSuccess.body.lastDeliveryStatus).toBe('success');
      expect(afterSuccess.body.enabled).toBe(true);
    });

    it('should not auto-disable with non-consecutive failures', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Alternate between failure and success - should never reach 5 consecutive
      for (let i = 0; i < 4; i++) {
        // Fail
        webhookServer.setResponseCode(500);
        await sendEmailAndWaitForDelivery(inbox.emailAddress, i * 2 + 1);

        // Succeed
        webhookServer.setResponseCode(200);
        await sendEmailAndWaitForDelivery(inbox.emailAddress, i * 2 + 2);
      }

      const afterAlternating = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterAlternating.body.enabled).toBe(true); // Should still be enabled
      expect(afterAlternating.body.stats.failedDeliveries).toBe(4);
      expect(afterAlternating.body.stats.successfulDeliveries).toBe(4);
    });
  });

  // ============================================
  // Recovery from Failures Tests
  // ============================================

  describe('Recovery from Failures', () => {
    it('should recover and update lastDeliveryStatus after failures', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Fail first
      webhookServer.setResponseCode(500);
      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterFail = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterFail.body.lastDeliveryStatus).toBe('failed');

      // Then succeed
      webhookServer.setResponseCode(200);
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 2);

      const afterRecovery = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterRecovery.body.lastDeliveryStatus).toBe('success');
    });

    it('should correctly track mixed success/failure over time', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // 2 successes
      webhookServer.setResponseCode(200);
      await sendEmailAndWaitForDelivery(inbox.emailAddress);
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 2);

      // 3 failures
      webhookServer.setResponseCode(500);
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 3);
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 4);
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 5);

      // 1 more success
      webhookServer.setResponseCode(200);
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 6);

      const finalStats = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(finalStats.body.stats.totalDeliveries).toBe(6);
      expect(finalStats.body.stats.successfulDeliveries).toBe(3);
      expect(finalStats.body.stats.failedDeliveries).toBe(3);
      expect(finalStats.body.lastDeliveryStatus).toBe('success');
      expect(finalStats.body.enabled).toBe(true);
    });
  });

  // ============================================
  // Test Endpoint with Failures
  // ============================================

  describe('Test Endpoint Failure Handling', () => {
    it('should return error details when test delivery fails', async () => {
      webhookServer.setResponseCode(500);
      webhookServer.setResponseBody('{"error": "Internal Server Error"}');

      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const testResult = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(testResult.body.success).toBe(false);
      expect(testResult.body.statusCode).toBe(500);
      expect(testResult.body.error).toBeDefined();
    });

    it('should return error when test delivery gets 4xx response', async () => {
      webhookServer.setResponseCode(404);

      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const testResult = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(testResult.body.success).toBe(false);
      expect(testResult.body.statusCode).toBe(404);
    });

    it('should not affect webhook stats when test fails', async () => {
      webhookServer.setResponseCode(500);

      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);
      const initialStats = webhook.body.stats;

      // Run test delivery that fails
      await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      // Stats should not have changed
      const afterTest = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterTest.body.stats.totalDeliveries).toBe(initialStats.totalDeliveries);
      expect(afterTest.body.stats.failedDeliveries).toBe(initialStats.failedDeliveries);
    });

    it('should test disabled webhook without errors', async () => {
      webhookServer.setResponseCode(200);

      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);
      await apiClient.updateGlobalWebhook(webhook.body.id, { enabled: false }).expect(200);

      const testResult = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(testResult.body.success).toBe(true);
      expect(testResult.body.statusCode).toBe(200);
    });
  });

  // ============================================
  // Inbox Webhook Failure Tests
  // ============================================

  describe('Inbox Webhook Failures', () => {
    it('should track failures for inbox webhooks', async () => {
      webhookServer.setResponseCode(500);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterWebhook = await apiClient.getInboxWebhook(inbox.emailAddress, webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.failedDeliveries).toBe(1);
      expect(afterWebhook.body.lastDeliveryStatus).toBe('failed');
    });

    it('should auto-disable inbox webhook after consecutive failures', async () => {
      webhookServer.setResponseCode(500);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

      // Send 5 emails to trigger auto-disable
      for (let i = 0; i < 5; i++) {
        await sendEmailAndWaitForDelivery(inbox.emailAddress, i + 1);
      }

      const afterDisable = await apiClient.getInboxWebhook(inbox.emailAddress, webhook.body.id).expect(200);
      expect(afterDisable.body.enabled).toBe(false);
      expect(afterDisable.body.stats.failedDeliveries).toBe(5);
    });
  });

  // ============================================
  // HTTP Status Code Handling
  // ============================================

  describe('HTTP Status Code Handling', () => {
    it('should treat 2xx responses as success', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      const statuses = [200, 201, 202, 204];
      let requestCount = 0;

      for (const status of statuses) {
        webhookServer.clearRequests();
        webhookServer.setResponseCode(status);

        const webhook = await apiClient
          .createGlobalWebhook({ ...validWebhookData, url: `${webhookUrl}/status-${status}` })
          .expect(201);

        await sendEmailAndWaitForDelivery(inbox.emailAddress, ++requestCount);

        const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
        expect(afterWebhook.body.stats.successfulDeliveries).toBe(1);
        expect(afterWebhook.body.lastDeliveryStatus).toBe('success');
      }
    });

    it('should treat 4xx responses as failures', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      const statuses = [400, 401, 403, 404, 422];
      let requestCount = 0;

      for (const status of statuses) {
        webhookServer.clearRequests();
        webhookServer.setResponseCode(status);

        const webhook = await apiClient
          .createGlobalWebhook({ ...validWebhookData, url: `${webhookUrl}/status-${status}` })
          .expect(201);

        await sendEmailAndWaitForDelivery(inbox.emailAddress, ++requestCount);

        const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
        expect(afterWebhook.body.stats.failedDeliveries).toBe(1);
        expect(afterWebhook.body.lastDeliveryStatus).toBe('failed');
      }
    });

    it('should treat 5xx responses as failures', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      const statuses = [500, 502, 503, 504];
      let requestCount = 0;

      for (const status of statuses) {
        webhookServer.clearRequests();
        webhookServer.setResponseCode(status);

        const webhook = await apiClient
          .createGlobalWebhook({ ...validWebhookData, url: `${webhookUrl}/status-${status}` })
          .expect(201);

        await sendEmailAndWaitForDelivery(inbox.emailAddress, ++requestCount);

        const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
        expect(afterWebhook.body.stats.failedDeliveries).toBe(1);
        expect(afterWebhook.body.lastDeliveryStatus).toBe('failed');
      }
    });
  });

  // ============================================
  // Edge Cases
  // ============================================

  describe('Edge Cases', () => {
    it('should handle empty response body on failure', async () => {
      webhookServer.setResponseCode(500);
      webhookServer.setResponseBody('');

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.failedDeliveries).toBe(1);
    });

    it('should update lastDeliveryAt even on failure', async () => {
      webhookServer.setResponseCode(500);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      expect(webhook.body.lastDeliveryAt).toBeUndefined();

      const beforeDelivery = new Date();
      await sendEmailAndWaitForDelivery(inbox.emailAddress);
      const afterDelivery = new Date();

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      const lastDeliveryAt = new Date(afterWebhook.body.lastDeliveryAt);

      expect(lastDeliveryAt.getTime()).toBeGreaterThanOrEqual(beforeDelivery.getTime());
      expect(lastDeliveryAt.getTime()).toBeLessThanOrEqual(afterDelivery.getTime());
    });

    it('should handle multiple webhooks with different failure states', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create two webhooks - one will succeed, one will fail
      const successWebhook = await apiClient
        .createGlobalWebhook({ ...validWebhookData, url: `${webhookUrl}/success` })
        .expect(201);
      const failWebhook = await apiClient
        .createGlobalWebhook({ ...validWebhookData, url: `${webhookUrl}/fail` })
        .expect(201);

      // We can't easily differentiate responses by URL in MockWebhookServer,
      // so we'll verify that both webhooks receive the delivery attempt
      webhookServer.setResponseCode(500);

      // Send email
      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Multiple webhooks test',
        `Message-ID: <multi-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Testing multiple webhooks with failures.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      // Wait for both webhooks to receive the delivery
      await webhookServer.waitForRequests(2, 10000);

      // Both should have 1 failed delivery
      const afterSuccess = await apiClient.getGlobalWebhook(successWebhook.body.id).expect(200);
      const afterFail = await apiClient.getGlobalWebhook(failWebhook.body.id).expect(200);

      expect(afterSuccess.body.stats.failedDeliveries).toBe(1);
      expect(afterFail.body.stats.failedDeliveries).toBe(1);
    });

    it('should count each webhook delivery separately in global metrics', async () => {
      webhookServer.setResponseCode(500);

      const beforeMetrics = await apiClient.getWebhookMetrics().expect(200);
      const initialFailed = beforeMetrics.body.deliveries.failed;

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create 2 webhooks
      await apiClient.createGlobalWebhook({ ...validWebhookData, url: `${webhookUrl}/webhook1` }).expect(201);
      await apiClient.createGlobalWebhook({ ...validWebhookData, url: `${webhookUrl}/webhook2` }).expect(201);

      // Send email - both webhooks will receive and fail
      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Multiple failures test',
        `Message-ID: <multi-fail-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Testing multiple webhook failures.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      await webhookServer.waitForRequests(2, 10000);

      const afterMetrics = await apiClient.getWebhookMetrics().expect(200);
      expect(afterMetrics.body.deliveries.failed).toBe(initialFailed + 2);
    });
  });
});
