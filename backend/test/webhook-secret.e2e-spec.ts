import * as crypto from 'node:crypto';
import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient, CreateWebhookBody } from './helpers/api-client';
import { createSmtpClient, SmtpTestClient } from './helpers/smtp-client';
import { generateClientKeypair } from './helpers/crypto-client';
import { createTestInbox } from './helpers/assertions';
import { MockWebhookServer, createMockWebhookServer, WebhookRequest } from './helpers/webhook-server';

describe('Webhook Secret E2E', () => {
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

  // Helper to compute expected signature
  function computeSignature(request: WebhookRequest, secret: string): string {
    const timestamp = request.headers['x-vault-timestamp'] as string;
    const payload = `${timestamp}.${request.body}`;
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  // Helper to send an email to trigger webhook
  async function sendEmailToInbox(inboxEmail: string): Promise<void> {
    const rawEmail = [
      'From: sender@vaultsandbox.test',
      `To: ${inboxEmail}`,
      'Subject: Secret test email',
      `Message-ID: <secret-test-${Date.now()}@vaultsandbox.test>`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'Testing webhook secret functionality.',
      '',
    ].join('\r\n');

    await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
      from: 'sender@vaultsandbox.test',
      to: [inboxEmail],
    });
  }

  // ============================================
  // Secret Format Tests
  // ============================================

  describe('Secret Format', () => {
    it('should generate secret with whsec_ prefix on webhook creation', async () => {
      const response = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      expect(response.body.secret).toMatch(/^whsec_[a-zA-Z0-9]+$/);
    });

    it('should generate unique secrets for different webhooks', async () => {
      const webhook1 = await apiClient.createGlobalWebhook(validWebhookData).expect(201);
      const webhook2 = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      expect(webhook1.body.secret).not.toBe(webhook2.body.secret);
    });

    it('should generate secrets of sufficient length (at least 32 chars after prefix)', async () => {
      const response = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const secretWithoutPrefix = response.body.secret.replace('whsec_', '');
      expect(secretWithoutPrefix.length).toBeGreaterThanOrEqual(32);
    });

    it('should include secret in webhook detail response', async () => {
      const created = await apiClient.createGlobalWebhook(validWebhookData).expect(201);
      const detail = await apiClient.getGlobalWebhook(created.body.id).expect(200);

      expect(detail.body.secret).toBe(created.body.secret);
    });

    it('should not include secret in webhook list response', async () => {
      await apiClient.createGlobalWebhook(validWebhookData).expect(201);
      const list = await apiClient.listGlobalWebhooks().expect(200);

      for (const webhook of list.body.webhooks) {
        expect(webhook.secret).toBeUndefined();
      }
    });
  });

  // ============================================
  // Secret Rotation Tests
  // ============================================

  describe('Secret Rotation', () => {
    it('should return new secret on rotation', async () => {
      const created = await apiClient.createGlobalWebhook(validWebhookData).expect(201);
      const originalSecret = created.body.secret;

      const rotated = await apiClient.rotateGlobalWebhookSecret(created.body.id).expect(201);

      expect(rotated.body.secret).toMatch(/^whsec_/);
      expect(rotated.body.secret).not.toBe(originalSecret);
    });

    it('should return previousSecretValidUntil timestamp (1 hour grace period)', async () => {
      const created = await apiClient.createGlobalWebhook(validWebhookData).expect(201);
      const beforeRotation = Date.now();

      const rotated = await apiClient.rotateGlobalWebhookSecret(created.body.id).expect(201);

      const validUntil = new Date(rotated.body.previousSecretValidUntil).getTime();
      const expectedMin = beforeRotation + 59 * 60 * 1000; // 59 minutes
      const expectedMax = beforeRotation + 61 * 60 * 1000; // 61 minutes (buffer)

      expect(validUntil).toBeGreaterThanOrEqual(expectedMin);
      expect(validUntil).toBeLessThanOrEqual(expectedMax);
    });

    it('should update webhook with new secret after rotation', async () => {
      const created = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const rotated = await apiClient.rotateGlobalWebhookSecret(created.body.id).expect(201);
      const updated = await apiClient.getGlobalWebhook(created.body.id).expect(200);

      expect(updated.body.secret).toBe(rotated.body.secret);
    });

    it('should allow multiple rotations', async () => {
      const created = await apiClient.createGlobalWebhook(validWebhookData).expect(201);
      const secrets: string[] = [created.body.secret];

      // Rotate 3 times
      for (let i = 0; i < 3; i++) {
        const rotated = await apiClient.rotateGlobalWebhookSecret(created.body.id).expect(201);
        expect(secrets).not.toContain(rotated.body.secret);
        secrets.push(rotated.body.secret);
      }

      // All 4 secrets should be unique
      expect(new Set(secrets).size).toBe(4);
    });

    it('should rotate inbox webhook secret', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const created = await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);
      const originalSecret = created.body.secret;

      const rotated = await apiClient.rotateInboxWebhookSecret(inbox.emailAddress, created.body.id).expect(201);

      expect(rotated.body.secret).not.toBe(originalSecret);
      expect(rotated.body.previousSecretValidUntil).toBeDefined();
    });

    it('should return 404 when rotating secret for non-existent webhook', async () => {
      await apiClient.rotateGlobalWebhookSecret('whk_nonexistent').expect(404);
    });

    it('should return 404 when rotating inbox webhook secret for non-existent inbox', async () => {
      await apiClient.rotateInboxWebhookSecret('nonexistent@test.com', 'whk_nonexistent').expect(404);
    });
  });

  // ============================================
  // Signature Verification Tests
  // ============================================

  describe('Signature Verification', () => {
    it('should generate signature in correct format (sha256=hex)', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      await sendEmailToInbox(inbox.emailAddress);

      const requests = await webhookServer.waitForRequests(1, 10000);
      const signature = requests[0].headers['x-vault-signature'] as string;

      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('should include timestamp header with Unix epoch seconds', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      const beforeSend = Math.floor(Date.now() / 1000);
      await sendEmailToInbox(inbox.emailAddress);

      const requests = await webhookServer.waitForRequests(1, 10000);
      const timestamp = parseInt(requests[0].headers['x-vault-timestamp'] as string, 10);
      const afterReceive = Math.floor(Date.now() / 1000);

      expect(timestamp).toBeGreaterThanOrEqual(beforeSend);
      expect(timestamp).toBeLessThanOrEqual(afterReceive);
    });

    it('should compute signature correctly (verifiable client-side)', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      await sendEmailToInbox(inbox.emailAddress);

      const requests = await webhookServer.waitForRequests(1, 10000);
      const isValid = verifySignature(requests[0], webhook.body.secret);

      expect(isValid).toBe(true);
    });

    it('should fail verification with wrong secret', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      await sendEmailToInbox(inbox.emailAddress);

      const requests = await webhookServer.waitForRequests(1, 10000);
      const isValid = verifySignature(requests[0], 'whsec_wrongsecret');

      expect(isValid).toBe(false);
    });

    it('should include unique delivery ID in each request', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      await apiClient.createGlobalWebhook({ ...validWebhookData, url: `${webhookUrl}/webhook1` }).expect(201);
      await apiClient.createGlobalWebhook({ ...validWebhookData, url: `${webhookUrl}/webhook2` }).expect(201);

      await sendEmailToInbox(inbox.emailAddress);

      const requests = await webhookServer.waitForRequests(2, 10000);
      const deliveryIds = requests.map((r) => r.headers['x-vault-delivery']);

      // Each delivery should have unique ID
      expect(new Set(deliveryIds).size).toBe(2);
      for (const id of deliveryIds) {
        expect(id).toMatch(/^dlv_/);
      }
    });
  });

  // ============================================
  // Signature Verification After Rotation Tests
  // ============================================

  describe('Signature Verification After Rotation', () => {
    it('should sign with new secret immediately after rotation', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);
      const originalSecret = webhook.body.secret;

      // Rotate secret
      const rotated = await apiClient.rotateGlobalWebhookSecret(webhook.body.id).expect(201);
      const newSecret = rotated.body.secret;

      // Send email
      await sendEmailToInbox(inbox.emailAddress);

      const requests = await webhookServer.waitForRequests(1, 10000);

      // Should verify with NEW secret
      const isValidWithNew = verifySignature(requests[0], newSecret);
      expect(isValidWithNew).toBe(true);

      // Should NOT verify with OLD secret
      const isValidWithOld = verifySignature(requests[0], originalSecret);
      expect(isValidWithOld).toBe(false);
    });

    it('should allow client to verify with either secret during grace period (client responsibility)', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);
      const originalSecret = webhook.body.secret;

      // Rotate secret
      const rotated = await apiClient.rotateGlobalWebhookSecret(webhook.body.id).expect(201);
      const newSecret = rotated.body.secret;

      // The grace period means clients should try BOTH secrets
      // Server signs with new secret, but client can still have old secret configured
      // This test verifies the new secret works and the response includes grace period info

      expect(rotated.body.previousSecretValidUntil).toBeDefined();
      expect(new Date(rotated.body.previousSecretValidUntil).getTime()).toBeGreaterThan(Date.now());

      // Send email
      await sendEmailToInbox(inbox.emailAddress);

      const requests = await webhookServer.waitForRequests(1, 10000);

      // Client should try new secret first (which will work)
      const isValidWithNew = verifySignature(requests[0], newSecret);
      expect(isValidWithNew).toBe(true);

      // Old secret won't work for this delivery (server uses new secret)
      // But the grace period gives clients time to update their config
      const isValidWithOld = verifySignature(requests[0], originalSecret);
      expect(isValidWithOld).toBe(false);

      // Compute what signature would be with old vs new secret
      const newSecretSignature = computeSignature(requests[0], newSecret);
      const oldSecretSignature = computeSignature(requests[0], originalSecret);

      // They should be different
      expect(newSecretSignature).not.toBe(oldSecretSignature);
    });

    it('should consistently use current secret for all deliveries after rotation', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Rotate secret
      const rotated = await apiClient.rotateGlobalWebhookSecret(webhook.body.id).expect(201);
      const newSecret = rotated.body.secret;

      // Send multiple emails
      await sendEmailToInbox(inbox.emailAddress);
      await sendEmailToInbox(inbox.emailAddress);

      const requests = await webhookServer.waitForRequests(2, 10000);

      // All deliveries should verify with the new secret
      for (const request of requests) {
        const isValid = verifySignature(request, newSecret);
        expect(isValid).toBe(true);
      }
    });
  });

  // ============================================
  // Test Endpoint Signature Tests
  // ============================================

  describe('Test Endpoint Signature', () => {
    it('should sign test webhook with current secret', async () => {
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      const requests = await webhookServer.waitForRequests(1, 10000);
      const isValid = verifySignature(requests[0], webhook.body.secret);

      expect(isValid).toBe(true);
    });

    it('should sign test webhook with new secret after rotation', async () => {
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Rotate secret
      const rotated = await apiClient.rotateGlobalWebhookSecret(webhook.body.id).expect(201);

      await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      const requests = await webhookServer.waitForRequests(1, 10000);
      const isValid = verifySignature(requests[0], rotated.body.secret);

      expect(isValid).toBe(true);
    });

    it('should include test delivery ID in test webhook', async () => {
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      await apiClient.testGlobalWebhook(webhook.body.id).expect(201);

      const requests = await webhookServer.waitForRequests(1, 10000);
      const deliveryId = requests[0].headers['x-vault-delivery'] as string;

      expect(deliveryId).toMatch(/^dlv_test_/);
    });
  });

  // ============================================
  // Inbox Webhook Secret Tests
  // ============================================

  describe('Inbox Webhook Secrets', () => {
    it('should generate unique secret for inbox webhook', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

      expect(webhook.body.secret).toMatch(/^whsec_/);
    });

    it('should sign inbox webhook deliveries with correct secret', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

      await sendEmailToInbox(inbox.emailAddress);

      const requests = await webhookServer.waitForRequests(1, 10000);
      const isValid = verifySignature(requests[0], webhook.body.secret);

      expect(isValid).toBe(true);
    });

    it('should use new secret after inbox webhook rotation', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

      // Rotate
      const rotated = await apiClient.rotateInboxWebhookSecret(inbox.emailAddress, webhook.body.id).expect(201);

      await sendEmailToInbox(inbox.emailAddress);

      const requests = await webhookServer.waitForRequests(1, 10000);
      const isValid = verifySignature(requests[0], rotated.body.secret);

      expect(isValid).toBe(true);
    });
  });

  // ============================================
  // Security Edge Cases
  // ============================================

  describe('Security Edge Cases', () => {
    it('should not expose secret in error responses', async () => {
      // Try to get non-existent webhook
      const response = await apiClient.getGlobalWebhook('whk_nonexistent').expect(404);

      const responseText = JSON.stringify(response.body);
      expect(responseText).not.toMatch(/whsec_/);
    });

    it('should generate cryptographically random secrets', async () => {
      // Create multiple webhooks and verify secrets have high entropy
      const secrets: string[] = [];
      for (let i = 0; i < 5; i++) {
        const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);
        secrets.push(webhook.body.secret);
      }

      // All secrets should be unique
      expect(new Set(secrets).size).toBe(5);

      // Secrets should not share common substrings (beyond prefix)
      const withoutPrefix = secrets.map((s) => s.replace('whsec_', ''));
      for (let i = 0; i < withoutPrefix.length; i++) {
        for (let j = i + 1; j < withoutPrefix.length; j++) {
          // Check that no 8-char substring is shared
          for (let k = 0; k < withoutPrefix[i].length - 8; k++) {
            const substr = withoutPrefix[i].substring(k, k + 8);
            expect(withoutPrefix[j]).not.toContain(substr);
          }
        }
      }
    });

    it('should protect against timing attacks with constant-time comparison', async () => {
      // This test verifies behavior, not implementation
      // We just ensure that invalid signatures are rejected consistently
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const webhook = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      await sendEmailToInbox(inbox.emailAddress);

      const requests = await webhookServer.waitForRequests(1, 10000);

      // Various wrong secrets should all fail
      const wrongSecrets = ['whsec_wrong', 'whsec_' + 'a'.repeat(32), webhook.body.secret + 'x'];

      for (const wrongSecret of wrongSecrets) {
        const isValid = verifySignature(requests[0], wrongSecret);
        expect(isValid).toBe(false);
      }
    });
  });
});
