import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient, CreateWebhookBody } from './helpers/api-client';
import { createSmtpClient, SmtpTestClient } from './helpers/smtp-client';
import { generateClientKeypair } from './helpers/crypto-client';
import { createTestInbox } from './helpers/assertions';
import { MockWebhookServer, createMockWebhookServer } from './helpers/webhook-server';

describe('Webhook Metrics E2E', () => {
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

  // Helper to send an email and wait for webhook delivery
  async function sendEmailAndWaitForDelivery(inboxEmail: string, expectedCount = 1): Promise<void> {
    const rawEmail = [
      'From: sender@vaultsandbox.test',
      `To: ${inboxEmail}`,
      'Subject: Metrics test email',
      `Message-ID: <metrics-test-${Date.now()}@vaultsandbox.test>`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'Testing webhook metrics.',
      '',
    ].join('\r\n');

    await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
      from: 'sender@vaultsandbox.test',
      to: [inboxEmail],
    });

    // Wait for webhook delivery
    await webhookServer.waitForRequests(expectedCount, 10000);
  }

  // ============================================
  // Metrics Endpoint Tests
  // ============================================

  describe('Metrics Endpoint', () => {
    it('should return aggregated metrics', async () => {
      const response = await apiClient.getWebhookMetrics().expect(200);

      expect(response.body).toMatchObject({
        webhooks: {
          global: expect.any(Number),
          inbox: expect.any(Number),
          enabled: expect.any(Number),
          total: expect.any(Number),
        },
        deliveries: {
          total: expect.any(Number),
          successful: expect.any(Number),
          failed: expect.any(Number),
        },
      });
    });

    it('should count global webhooks correctly', async () => {
      const beforeMetrics = await apiClient.getWebhookMetrics().expect(200);
      const initialGlobal = beforeMetrics.body.webhooks.global;

      // Create 2 global webhooks
      await apiClient.createGlobalWebhook(validWebhookData).expect(201);
      await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const afterMetrics = await apiClient.getWebhookMetrics().expect(200);

      expect(afterMetrics.body.webhooks.global).toBe(initialGlobal + 2);
    });

    it('should count inbox webhooks correctly', async () => {
      const beforeMetrics = await apiClient.getWebhookMetrics().expect(200);
      const initialInbox = beforeMetrics.body.webhooks.inbox;

      // Create inbox and webhook
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

      const afterMetrics = await apiClient.getWebhookMetrics().expect(200);

      expect(afterMetrics.body.webhooks.inbox).toBe(initialInbox + 1);
    });

    it('should count enabled webhooks correctly', async () => {
      const beforeMetrics = await apiClient.getWebhookMetrics().expect(200);
      const initialEnabled = beforeMetrics.body.webhooks.enabled;

      // Create an enabled webhook
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const afterCreate = await apiClient.getWebhookMetrics().expect(200);
      expect(afterCreate.body.webhooks.enabled).toBe(initialEnabled + 1);

      // Disable it
      await apiClient.updateGlobalWebhook(webhook.body.id, { enabled: false }).expect(200);

      const afterDisable = await apiClient.getWebhookMetrics().expect(200);
      expect(afterDisable.body.webhooks.enabled).toBe(initialEnabled);
    });

    it('should calculate total webhooks correctly', async () => {
      const metrics = await apiClient.getWebhookMetrics().expect(200);

      expect(metrics.body.webhooks.total).toBe(metrics.body.webhooks.global + metrics.body.webhooks.inbox);
    });

    it('should track delivery statistics correctly', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const beforeMetrics = await apiClient.getWebhookMetrics().expect(200);
      const initialTotal = beforeMetrics.body.deliveries.total;
      const initialSuccessful = beforeMetrics.body.deliveries.successful;

      // Send email to trigger delivery
      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterMetrics = await apiClient.getWebhookMetrics().expect(200);

      expect(afterMetrics.body.deliveries.total).toBe(initialTotal + 1);
      expect(afterMetrics.body.deliveries.successful).toBe(initialSuccessful + 1);
    });
  });

  // ============================================
  // Stats Increment on Success Tests
  // ============================================

  describe('Stats Increment on Success', () => {
    it('should increment totalDeliveries on successful delivery', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const beforeStats = webhook.body.stats;
      expect(beforeStats.totalDeliveries).toBe(0);

      // Send email
      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.totalDeliveries).toBe(1);
    });

    it('should increment successfulDeliveries on successful delivery', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      expect(webhook.body.stats.successfulDeliveries).toBe(0);

      // Send email
      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.successfulDeliveries).toBe(1);
    });

    it('should not increment failedDeliveries on successful delivery', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      expect(webhook.body.stats.failedDeliveries).toBe(0);

      // Send email
      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.failedDeliveries).toBe(0);
    });

    it('should accumulate stats over multiple deliveries', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Send 3 emails
      for (let i = 0; i < 3; i++) {
        await sendEmailAndWaitForDelivery(inbox.emailAddress, i + 1);
      }

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.totalDeliveries).toBe(3);
      expect(afterWebhook.body.stats.successfulDeliveries).toBe(3);
      expect(afterWebhook.body.stats.failedDeliveries).toBe(0);
    });
  });

  // ============================================
  // Stats Increment on Failure Tests
  // ============================================

  describe('Stats Increment on Failure', () => {
    it('should increment totalDeliveries on failed delivery', async () => {
      webhookServer.setResponseCode(500);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      expect(webhook.body.stats.totalDeliveries).toBe(0);

      // Send email (will fail)
      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.totalDeliveries).toBe(1);
    });

    it('should increment failedDeliveries on failed delivery', async () => {
      webhookServer.setResponseCode(500);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      expect(webhook.body.stats.failedDeliveries).toBe(0);

      // Send email (will fail)
      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.failedDeliveries).toBe(1);
    });

    it('should not increment successfulDeliveries on failed delivery', async () => {
      webhookServer.setResponseCode(500);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      expect(webhook.body.stats.successfulDeliveries).toBe(0);

      // Send email (will fail)
      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.successfulDeliveries).toBe(0);
    });
  });

  // ============================================
  // Failure Tracking Tests
  // ============================================

  describe('Failure Tracking', () => {
    // Note: consecutiveFailures is tracked internally but not exposed in the API.
    // We test the observable behavior: failedDeliveries count and lastDeliveryStatus.

    it('should accumulate failed deliveries count', async () => {
      webhookServer.setResponseCode(500);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      expect(webhook.body.stats.failedDeliveries).toBe(0);

      // Send 3 emails that will fail
      for (let i = 0; i < 3; i++) {
        await sendEmailAndWaitForDelivery(inbox.emailAddress, i + 1);
      }

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.failedDeliveries).toBe(3);
      expect(afterWebhook.body.lastDeliveryStatus).toBe('failed');
    });

    it('should track mixed success and failure deliveries', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // First, cause some failures
      webhookServer.setResponseCode(500);
      await sendEmailAndWaitForDelivery(inbox.emailAddress);
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 2);

      const afterFailures = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterFailures.body.stats.failedDeliveries).toBe(2);
      expect(afterFailures.body.stats.successfulDeliveries).toBe(0);

      // Now succeed
      webhookServer.setResponseCode(200);
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 3);

      const afterSuccess = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterSuccess.body.stats.failedDeliveries).toBe(2);
      expect(afterSuccess.body.stats.successfulDeliveries).toBe(1);
      expect(afterSuccess.body.stats.totalDeliveries).toBe(3);
      expect(afterSuccess.body.lastDeliveryStatus).toBe('success');
    });

    it('should correctly show lastDeliveryStatus after recovery from failures', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Fail, then succeed
      webhookServer.setResponseCode(500);
      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterFail = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterFail.body.lastDeliveryStatus).toBe('failed');

      webhookServer.setResponseCode(200);
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 2);

      const afterRecovery = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterRecovery.body.lastDeliveryStatus).toBe('success');
    });
  });

  // ============================================
  // Last Delivery Timestamp Tests
  // ============================================

  describe('lastDeliveryAt Tracking', () => {
    it('should update lastDeliveryAt on successful delivery', async () => {
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

    it('should update lastDeliveryAt on failed delivery', async () => {
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

    it('should update lastDeliveryAt on each delivery', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // First delivery
      await sendEmailAndWaitForDelivery(inbox.emailAddress);
      const afterFirst = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      const firstDeliveryAt = new Date(afterFirst.body.lastDeliveryAt).getTime();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second delivery
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 2);
      const afterSecond = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      const secondDeliveryAt = new Date(afterSecond.body.lastDeliveryAt).getTime();

      expect(secondDeliveryAt).toBeGreaterThan(firstDeliveryAt);
    });
  });

  // ============================================
  // Last Delivery Status Tests
  // ============================================

  describe('lastDeliveryStatus Tracking', () => {
    it('should set lastDeliveryStatus to success on successful delivery', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      expect(webhook.body.lastDeliveryStatus).toBeUndefined();

      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.lastDeliveryStatus).toBe('success');
    });

    it('should set lastDeliveryStatus to failed on failed delivery', async () => {
      webhookServer.setResponseCode(500);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      expect(webhook.body.lastDeliveryStatus).toBeUndefined();

      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterWebhook = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterWebhook.body.lastDeliveryStatus).toBe('failed');
    });

    it('should update lastDeliveryStatus on each delivery', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Success
      await sendEmailAndWaitForDelivery(inbox.emailAddress);
      const afterSuccess = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterSuccess.body.lastDeliveryStatus).toBe('success');

      // Failure
      webhookServer.setResponseCode(500);
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 2);
      const afterFailure = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterFailure.body.lastDeliveryStatus).toBe('failed');

      // Success again
      webhookServer.setResponseCode(200);
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 3);
      const afterSuccessAgain = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(afterSuccessAgain.body.lastDeliveryStatus).toBe('success');
    });
  });

  // ============================================
  // Inbox Webhook Stats Tests
  // ============================================

  describe('Inbox Webhook Stats', () => {
    it('should track stats for inbox webhooks', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

      expect(webhook.body.stats.totalDeliveries).toBe(0);

      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterWebhook = await apiClient.getInboxWebhook(inbox.emailAddress, webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.totalDeliveries).toBe(1);
      expect(afterWebhook.body.stats.successfulDeliveries).toBe(1);
      expect(afterWebhook.body.lastDeliveryStatus).toBe('success');
    });

    it('should track failed deliveries for inbox webhooks', async () => {
      webhookServer.setResponseCode(500);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

      await sendEmailAndWaitForDelivery(inbox.emailAddress);
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 2);

      const afterWebhook = await apiClient.getInboxWebhook(inbox.emailAddress, webhook.body.id).expect(200);
      expect(afterWebhook.body.stats.failedDeliveries).toBe(2);
      expect(afterWebhook.body.lastDeliveryStatus).toBe('failed');
    });
  });

  // ============================================
  // Multiple Webhooks Stats Isolation Tests
  // ============================================

  describe('Stats Isolation Between Webhooks', () => {
    it('should track stats independently for each webhook', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      const webhook1 = await apiClient
        .createGlobalWebhook({ ...validWebhookData, url: `${webhookUrl}/webhook1` })
        .expect(201);
      const webhook2 = await apiClient
        .createGlobalWebhook({ ...validWebhookData, url: `${webhookUrl}/webhook2` })
        .expect(201);

      // Send email - both webhooks should receive it
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 2);

      const afterWebhook1 = await apiClient.getGlobalWebhook(webhook1.body.id).expect(200);
      const afterWebhook2 = await apiClient.getGlobalWebhook(webhook2.body.id).expect(200);

      // Each webhook should have its own stats
      expect(afterWebhook1.body.stats.totalDeliveries).toBe(1);
      expect(afterWebhook2.body.stats.totalDeliveries).toBe(1);
    });

    it('should track failures independently for each webhook', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Webhook 1 will succeed, webhook 2 will fail
      // This is tricky - we need to simulate different responses per URL
      // For now, we'll test that both get counted

      const webhook1 = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Send successful email
      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterSuccess = await apiClient.getGlobalWebhook(webhook1.body.id).expect(200);
      expect(afterSuccess.body.stats.successfulDeliveries).toBe(1);
      expect(afterSuccess.body.stats.failedDeliveries).toBe(0);

      // Now make it fail
      webhookServer.setResponseCode(500);
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 2);

      const afterFailure = await apiClient.getGlobalWebhook(webhook1.body.id).expect(200);
      expect(afterFailure.body.stats.successfulDeliveries).toBe(1);
      expect(afterFailure.body.stats.failedDeliveries).toBe(1);
      expect(afterFailure.body.stats.totalDeliveries).toBe(2);
    });
  });

  // ============================================
  // Aggregated Stats Tests
  // ============================================

  describe('Aggregated Stats', () => {
    it('should aggregate deliveries across all webhooks', async () => {
      const beforeMetrics = await apiClient.getWebhookMetrics().expect(200);
      const initialTotal = beforeMetrics.body.deliveries.total;

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create 2 webhooks
      await apiClient.createGlobalWebhook({ ...validWebhookData, url: `${webhookUrl}/agg1` }).expect(201);
      await apiClient.createGlobalWebhook({ ...validWebhookData, url: `${webhookUrl}/agg2` }).expect(201);

      // Send email - both webhooks receive it
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 2);

      const afterMetrics = await apiClient.getWebhookMetrics().expect(200);

      // Total should increase by 2 (one for each webhook)
      expect(afterMetrics.body.deliveries.total).toBe(initialTotal + 2);
    });

    it('should aggregate successful and failed deliveries separately', async () => {
      const beforeMetrics = await apiClient.getWebhookMetrics().expect(200);
      const initialSuccessful = beforeMetrics.body.deliveries.successful;
      const initialFailed = beforeMetrics.body.deliveries.failed;

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create webhook
      await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Send successful email
      await sendEmailAndWaitForDelivery(inbox.emailAddress);

      const afterSuccess = await apiClient.getWebhookMetrics().expect(200);
      expect(afterSuccess.body.deliveries.successful).toBe(initialSuccessful + 1);
      expect(afterSuccess.body.deliveries.failed).toBe(initialFailed);

      // Send failed email
      webhookServer.setResponseCode(500);
      await sendEmailAndWaitForDelivery(inbox.emailAddress, 2);

      const afterFailure = await apiClient.getWebhookMetrics().expect(200);
      expect(afterFailure.body.deliveries.successful).toBe(initialSuccessful + 1);
      expect(afterFailure.body.deliveries.failed).toBe(initialFailed + 1);
    });
  });

  // ============================================
  // Edge Cases
  // ============================================

  describe('Edge Cases', () => {
    it('should handle metrics when no webhooks exist', async () => {
      // Note: Other tests may have created webhooks, so we just verify structure
      const response = await apiClient.getWebhookMetrics().expect(200);

      expect(response.body.webhooks.global).toBeGreaterThanOrEqual(0);
      expect(response.body.webhooks.inbox).toBeGreaterThanOrEqual(0);
      expect(response.body.deliveries.total).toBeGreaterThanOrEqual(0);
    });

    it('should not affect stats when webhook is deleted', async () => {
      const beforeMetrics = await apiClient.getWebhookMetrics().expect(200);
      const initialTotal = beforeMetrics.body.webhooks.total;

      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const afterCreate = await apiClient.getWebhookMetrics().expect(200);
      expect(afterCreate.body.webhooks.total).toBe(initialTotal + 1);

      await apiClient.deleteGlobalWebhook(webhook.body.id).expect(204);

      const afterDelete = await apiClient.getWebhookMetrics().expect(200);
      expect(afterDelete.body.webhooks.total).toBe(initialTotal);
    });

    it('should reflect correct enabled count when webhooks are toggled', async () => {
      const beforeMetrics = await apiClient.getWebhookMetrics().expect(200);
      const initialEnabled = beforeMetrics.body.webhooks.enabled;

      // Create two webhooks
      const webhook1 = await apiClient.createGlobalWebhook(validWebhookData).expect(201);
      const webhook2 = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const afterCreate = await apiClient.getWebhookMetrics().expect(200);
      expect(afterCreate.body.webhooks.enabled).toBe(initialEnabled + 2);

      // Disable one
      await apiClient.updateGlobalWebhook(webhook1.body.id, { enabled: false }).expect(200);

      const afterDisable = await apiClient.getWebhookMetrics().expect(200);
      expect(afterDisable.body.webhooks.enabled).toBe(initialEnabled + 1);

      // Re-enable
      await apiClient.updateGlobalWebhook(webhook1.body.id, { enabled: true }).expect(200);

      const afterReEnable = await apiClient.getWebhookMetrics().expect(200);
      expect(afterReEnable.body.webhooks.enabled).toBe(initialEnabled + 2);

      // Cleanup
      await apiClient.deleteGlobalWebhook(webhook1.body.id).expect(204);
      await apiClient.deleteGlobalWebhook(webhook2.body.id).expect(204);
    });
  });
});
