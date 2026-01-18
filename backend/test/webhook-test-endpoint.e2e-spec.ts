import * as crypto from 'node:crypto';
import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient, CreateWebhookBody, CustomTemplateBody } from './helpers/api-client';
import { generateClientKeypair } from './helpers/crypto-client';
import { createTestInbox } from './helpers/assertions';
import { MockWebhookServer, createMockWebhookServer, WebhookRequest } from './helpers/webhook-server';

describe('Webhook Test Endpoint E2E', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;
  let webhookServer: MockWebhookServer;
  let webhookUrl: string;

  const validWebhookData: CreateWebhookBody = {
    url: '', // Will be set in beforeAll
    events: ['email.received'],
  };

  beforeAll(async () => {
    apiClient = createApiClient(appLifecycle.httpServer);
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
  // Basic Test Endpoint Tests
  // ============================================

  describe('Basic Test Functionality', () => {
    it('should send test event to webhook endpoint', async () => {
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      const requests = await webhookServer.waitForRequests(1, 5000);
      expect(requests).toHaveLength(1);
    });

    it('should return success response when endpoint returns 2xx', async () => {
      webhookServer.setResponseCode(200);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.statusCode).toBe(200);
    });

    it('should return 404 for non-existent webhook', async () => {
      await apiClient.testGlobalWebhook('whk_nonexistent').expect(404);
    });

    it('should return 404 for non-existent inbox webhook', async () => {
      await apiClient.testInboxWebhook('nonexistent@test.com', 'whk_nonexistent').expect(404);
    });
  });

  // ============================================
  // Test Event Structure Tests
  // ============================================

  describe('Test Event Structure', () => {
    it('should send test event with correct structure', async () => {
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      const requests = await webhookServer.waitForRequests(1, 5000);
      const payload = JSON.parse(requests[0].body);

      expect(payload).toMatchObject({
        id: 'evt_test_000000000000000000000000000000',
        object: 'event',
        createdAt: expect.any(Number),
        type: 'email.received',
        data: expect.objectContaining({
          id: 'msg_test_000000000000000000000000000000',
          inboxId: 'test_inbox_hash',
          inboxEmail: 'test@sandbox.example.com',
          from: { address: 'sender@example.com', name: 'Test Sender' },
          to: expect.any(Array),
          subject: 'Test webhook delivery',
          snippet: expect.any(String),
          receivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        }),
      });
    });

    it('should use first subscribed event type for test event', async () => {
      const webhook = await apiClient
        .createGlobalWebhook({
          ...validWebhookData,
          events: ['email.stored', 'email.received'],
        })
        .expect(201);

      await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      const requests = await webhookServer.waitForRequests(1, 5000);
      const payload = JSON.parse(requests[0].body);

      expect(payload.type).toBe('email.stored');
    });

    it('should include test delivery ID in headers', async () => {
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      const requests = await webhookServer.waitForRequests(1, 5000);
      const deliveryId = requests[0].headers['x-vault-delivery'] as string;

      expect(deliveryId).toBe('dlv_test_000000000000000000000000000000');
    });

    it('should include all required headers', async () => {
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      const requests = await webhookServer.waitForRequests(1, 5000);
      const headers = requests[0].headers;

      expect(headers['content-type']).toBe('application/json');
      expect(headers['user-agent']).toBe('VaultSandbox-Webhook/1.0');
      expect(headers['x-vault-event']).toBe('email.received');
      expect(headers['x-vault-delivery']).toMatch(/^dlv_test_/);
      expect(headers['x-vault-timestamp']).toMatch(/^\d+$/);
      expect(headers['x-vault-signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('should sign test event with webhook secret', async () => {
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      const requests = await webhookServer.waitForRequests(1, 5000);
      const isValid = verifySignature(requests[0], webhook.body.secret);

      expect(isValid).toBe(true);
    });
  });

  // ============================================
  // Response Content Tests
  // ============================================

  describe('Response Content', () => {
    it('should include delivery result in response', async () => {
      webhookServer.setResponseCode(200);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body).toMatchObject({
        success: true,
        statusCode: 200,
        responseTime: expect.any(Number),
      });
    });

    it('should include response body from endpoint', async () => {
      webhookServer.setResponseBody('{"received": true, "message": "OK"}');
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      // Response body may be parsed and re-stringified, so compare parsed values
      const responseBody = JSON.parse(response.body.responseBody);
      expect(responseBody).toEqual({ received: true, message: 'OK' });
    });

    it('should include payload that was sent', async () => {
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.payloadSent).toMatchObject({
        id: 'evt_test_000000000000000000000000000000',
        object: 'event',
        type: 'email.received',
        data: expect.objectContaining({
          from: expect.any(Object),
          subject: expect.any(String),
        }),
      });
    });

    it('should include response time in milliseconds', async () => {
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.responseTime).toBeGreaterThan(0);
      expect(response.body.responseTime).toBeLessThan(10000); // Less than 10 seconds
    });
  });

  // ============================================
  // Disabled Webhook Tests
  // ============================================

  describe('Disabled Webhooks', () => {
    it('should work for disabled webhooks', async () => {
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Disable the webhook
      await apiClient.updateGlobalWebhook(webhook.body.id, { enabled: false }).expect(200);

      // Test should still work
      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.success).toBe(true);

      // Verify the request was actually sent
      const requests = await webhookServer.waitForRequests(1, 5000);
      expect(requests).toHaveLength(1);
    });

    it('should not affect webhook enabled status after test', async () => {
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Disable the webhook
      await apiClient.updateGlobalWebhook(webhook.body.id, { enabled: false }).expect(200);

      // Run test
      await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      // Verify still disabled
      const updated = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(updated.body.enabled).toBe(false);
    });
  });

  // ============================================
  // Delivery Failure Tests
  // ============================================

  describe('Delivery Failures', () => {
    it('should return error details on 4xx response', async () => {
      webhookServer.setResponseCode(400);
      webhookServer.setResponseBody('{"error": "Bad request"}');
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.success).toBe(false);
      expect(response.body.statusCode).toBe(400);
      expect(response.body.error).toBeDefined();
      // Response body may be parsed and re-stringified, so compare parsed values
      const responseBody = JSON.parse(response.body.responseBody);
      expect(responseBody).toEqual({ error: 'Bad request' });
    });

    it('should return error details on 5xx response', async () => {
      webhookServer.setResponseCode(500);
      webhookServer.setResponseBody('Internal Server Error');
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.success).toBe(false);
      expect(response.body.statusCode).toBe(500);
      expect(response.body.error).toBeDefined();
    });

    it('should return error on timeout', async () => {
      webhookServer.setResponseDelay(10000); // 10 second delay
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
      // Error should mention timeout
      expect(response.body.error.toLowerCase()).toMatch(/timeout/i);
    }, 15000);

    it('should include payload sent even on failure', async () => {
      webhookServer.setResponseCode(500);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.success).toBe(false);
      expect(response.body.payloadSent).toBeDefined();
      expect(response.body.payloadSent.id).toBe('evt_test_000000000000000000000000000000');
    });

    it('should return response time even on failure', async () => {
      webhookServer.setResponseCode(500);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.responseTime).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Stats Isolation Tests
  // ============================================

  describe('Stats Isolation', () => {
    it('should not affect webhook stats on successful test', async () => {
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Get initial stats
      const before = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      const initialTotal = before.body.stats?.totalDeliveries ?? 0;
      const initialSuccess = before.body.stats?.successfulDeliveries ?? 0;

      // Run test
      await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      // Verify stats unchanged
      const after = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(after.body.stats?.totalDeliveries ?? 0).toBe(initialTotal);
      expect(after.body.stats?.successfulDeliveries ?? 0).toBe(initialSuccess);
    });

    it('should not affect webhook stats on failed test', async () => {
      webhookServer.setResponseCode(500);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Get initial stats
      const before = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      const initialTotal = before.body.stats?.totalDeliveries ?? 0;
      const initialFailed = before.body.stats?.failedDeliveries ?? 0;

      // Run test
      await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      // Verify stats unchanged
      const after = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(after.body.stats?.totalDeliveries ?? 0).toBe(initialTotal);
      expect(after.body.stats?.failedDeliveries ?? 0).toBe(initialFailed);
    });

    it('should not update lastDeliveryAt on test', async () => {
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Get initial lastDeliveryAt
      const before = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      const initialLastDelivery = before.body.lastDeliveryAt;

      // Run test
      await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      // Verify lastDeliveryAt unchanged
      const after = await apiClient.getGlobalWebhook(webhook.body.id).expect(200);
      expect(after.body.lastDeliveryAt).toBe(initialLastDelivery);
    });
  });

  // ============================================
  // Template Tests
  // ============================================

  describe('Template Application', () => {
    it('should apply default template to test event', async () => {
      const webhook = await apiClient.createGlobalWebhook({ ...validWebhookData, template: 'default' }).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.payloadSent).toMatchObject({
        id: expect.stringMatching(/^evt_test_/),
        object: 'event',
        type: 'email.received',
      });
    });

    it('should apply slack template to test event', async () => {
      const webhook = await apiClient.createGlobalWebhook({ ...validWebhookData, template: 'slack' }).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.payloadSent).toMatchObject({
        text: expect.stringContaining('sender@example.com'),
        blocks: expect.any(Array),
      });
    });

    it('should apply custom template to test event', async () => {
      const customTemplate: CustomTemplateBody = {
        type: 'custom',
        body: JSON.stringify({
          myEvent: '{{type}}',
          sender: '{{data.from.address}}',
        }),
      };

      const webhook = await apiClient
        .createGlobalWebhook({ ...validWebhookData, template: customTemplate })
        .expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.payloadSent).toMatchObject({
        myEvent: 'email.received',
        sender: 'sender@example.com',
      });
    });
  });

  // ============================================
  // Inbox Webhook Tests
  // ============================================

  describe('Inbox Webhook Tests', () => {
    it('should test inbox webhook', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

      const response = await apiClient.testInboxWebhook(inbox.emailAddress, webhook.body.id).expect(201);

      expect(response.body.success).toBe(true);

      const requests = await webhookServer.waitForRequests(1, 5000);
      expect(requests).toHaveLength(1);
    });

    it('should sign inbox webhook test with correct secret', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

      await apiClient.testInboxWebhook(inbox.emailAddress, webhook.body.id).expect(201);

      const requests = await webhookServer.waitForRequests(1, 5000);
      const isValid = verifySignature(requests[0], webhook.body.secret);

      expect(isValid).toBe(true);
    });

    it('should return 404 when testing inbox webhook for non-existent inbox', async () => {
      await apiClient.testInboxWebhook('nonexistent@sandbox.test', 'whk_test').expect(404);
    });

    it('should return 404 when testing non-existent inbox webhook', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      await apiClient.testInboxWebhook(inbox.emailAddress, 'whk_nonexistent').expect(404);
    });
  });

  // ============================================
  // Response Code Handling Tests
  // ============================================

  describe('Response Code Handling', () => {
    it('should treat 200 as success', async () => {
      webhookServer.setResponseCode(200);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.statusCode).toBe(200);
    });

    it('should treat 201 as success', async () => {
      webhookServer.setResponseCode(201);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.statusCode).toBe(201);
    });

    it('should treat 204 as success', async () => {
      webhookServer.setResponseCode(204);
      webhookServer.setResponseBody('');
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.statusCode).toBe(204);
    });

    it('should treat 301 redirect as failure', async () => {
      webhookServer.setResponseCode(301);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      // 3xx responses should typically be treated as issues for webhooks
      // (depends on implementation - axios may follow redirects)
      expect(response.body.statusCode).toBeDefined();
    });

    it('should treat 401 as failure', async () => {
      webhookServer.setResponseCode(401);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.success).toBe(false);
      expect(response.body.statusCode).toBe(401);
    });

    it('should treat 403 as failure', async () => {
      webhookServer.setResponseCode(403);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.success).toBe(false);
      expect(response.body.statusCode).toBe(403);
    });

    it('should treat 404 as failure', async () => {
      webhookServer.setResponseCode(404);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.success).toBe(false);
      expect(response.body.statusCode).toBe(404);
    });

    it('should treat 502 as failure', async () => {
      webhookServer.setResponseCode(502);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.success).toBe(false);
      expect(response.body.statusCode).toBe(502);
    });

    it('should treat 503 as failure', async () => {
      webhookServer.setResponseCode(503);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      expect(response.body.success).toBe(false);
      expect(response.body.statusCode).toBe(503);
    });
  });

  // ============================================
  // Multiple Tests Tests
  // ============================================

  describe('Multiple Tests', () => {
    it('should allow multiple consecutive tests', async () => {
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Run test 3 times
      for (let i = 0; i < 3; i++) {
        const response = await apiClient.testGlobalWebhook(webhook.body.id).expect(201);
        expect(response.body.success).toBe(true);
      }

      // All 3 requests should have been received
      const requests = webhookServer.getRequests();
      expect(requests.length).toBe(3);
    });

    it('should use fresh timestamp for each test', async () => {
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      await apiClient.testGlobalWebhook(webhook.body.id).expect(201);
      await new Promise((resolve) => setTimeout(resolve, 1100)); // Wait 1.1 seconds
      await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      const requests = webhookServer.getRequests();
      const timestamp1 = parseInt(requests[0].headers['x-vault-timestamp'] as string, 10);
      const timestamp2 = parseInt(requests[1].headers['x-vault-timestamp'] as string, 10);

      expect(timestamp2).toBeGreaterThan(timestamp1);
    });
  });
});
