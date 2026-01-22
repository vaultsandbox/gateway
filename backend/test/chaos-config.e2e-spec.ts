import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient } from './helpers/api-client';
import { generateClientKeypair } from './helpers/crypto-client';
import { createTestInbox } from './helpers/assertions';

/**
 * Chaos Configuration REST Endpoints E2E Tests
 *
 * Tests the chaos configuration management endpoints:
 * - GET /api/inboxes/:emailAddress/chaos
 * - POST /api/inboxes/:emailAddress/chaos
 * - DELETE /api/inboxes/:emailAddress/chaos
 */
describe('Chaos Configuration REST Endpoints', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;

  beforeAll(() => {
    apiClient = createApiClient(appLifecycle.httpServer);
  });

  describe('GET /api/inboxes/:emailAddress/chaos', () => {
    it('should return default disabled config for inbox without chaos', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      const response = await apiClient.getChaosConfig(inbox.emailAddress).expect(200);

      expect(response.body).toEqual({ enabled: false });
    });

    it('should return chaos config for inbox created with chaos enabled', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            latency: {
              enabled: true,
              minDelayMs: 100,
              maxDelayMs: 200,
            },
          },
        })
        .expect(201);

      const chaosResponse = await apiClient.getChaosConfig(inboxResponse.body.emailAddress).expect(200);

      expect(chaosResponse.body.enabled).toBe(true);
      expect(chaosResponse.body.latency.enabled).toBe(true);
      expect(chaosResponse.body.latency.minDelayMs).toBe(100);
      expect(chaosResponse.body.latency.maxDelayMs).toBe(200);
    });

    it('should return 404 for non-existent inbox', async () => {
      await apiClient.getChaosConfig('nonexistent@vaultsandbox.test').expect(404);
    });
  });

  describe('POST /api/inboxes/:emailAddress/chaos', () => {
    it('should update chaos config for existing inbox', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Initially no chaos config
      const initialResponse = await apiClient.getChaosConfig(inbox.emailAddress).expect(200);
      expect(initialResponse.body.enabled).toBe(false);

      // Set chaos config
      const setResponse = await apiClient
        .setChaosConfig(inbox.emailAddress, {
          enabled: true,
          latency: {
            enabled: true,
            minDelayMs: 500,
            maxDelayMs: 1000,
            jitter: true,
            probability: 0.5,
          },
        })
        .expect(200);

      expect(setResponse.body.enabled).toBe(true);
      expect(setResponse.body.latency.enabled).toBe(true);
      expect(setResponse.body.latency.minDelayMs).toBe(500);

      // Verify config is persisted
      const verifyResponse = await apiClient.getChaosConfig(inbox.emailAddress).expect(200);
      expect(verifyResponse.body.enabled).toBe(true);
      expect(verifyResponse.body.latency.minDelayMs).toBe(500);
    });

    it('should enable multiple chaos features at once', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      const response = await apiClient
        .setChaosConfig(inbox.emailAddress, {
          enabled: true,
          latency: {
            enabled: true,
            minDelayMs: 100,
            maxDelayMs: 200,
          },
          randomError: {
            enabled: true,
            errorRate: 0.1,
            errorTypes: ['temporary'],
          },
        })
        .expect(200);

      expect(response.body.enabled).toBe(true);
      expect(response.body.latency.enabled).toBe(true);
      expect(response.body.randomError.enabled).toBe(true);
    });

    it('should disable chaos by setting enabled to false', async () => {
      const keypair = generateClientKeypair();

      // Create inbox with chaos enabled
      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            latency: { enabled: true, minDelayMs: 100, maxDelayMs: 200 },
          },
        })
        .expect(201);

      // Disable chaos via POST
      const response = await apiClient.setChaosConfig(inboxResponse.body.emailAddress, { enabled: false }).expect(200);

      expect(response.body.enabled).toBe(false);

      // Verify
      const verifyResponse = await apiClient.getChaosConfig(inboxResponse.body.emailAddress).expect(200);
      expect(verifyResponse.body.enabled).toBe(false);
    });

    it('should return 404 for non-existent inbox', async () => {
      await apiClient.setChaosConfig('nonexistent@vaultsandbox.test', { enabled: true }).expect(404);
    });
  });

  describe('DELETE /api/inboxes/:emailAddress/chaos', () => {
    it('should disable chaos for inbox with chaos enabled', async () => {
      const keypair = generateClientKeypair();

      // Create inbox with chaos enabled
      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            latency: {
              enabled: true,
              minDelayMs: 500,
              maxDelayMs: 1000,
            },
          },
        })
        .expect(201);

      // Verify chaos is enabled
      const beforeResponse = await apiClient.getChaosConfig(inboxResponse.body.emailAddress).expect(200);
      expect(beforeResponse.body.enabled).toBe(true);

      // Delete chaos config
      await apiClient.disableChaos(inboxResponse.body.emailAddress).expect(204);

      // Verify chaos is disabled
      const afterResponse = await apiClient.getChaosConfig(inboxResponse.body.emailAddress).expect(200);
      expect(afterResponse.body.enabled).toBe(false);
    });

    it('should be idempotent - succeed for inbox without chaos', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Inbox doesn't have chaos config, but delete should still succeed
      await apiClient.disableChaos(inbox.emailAddress).expect(204);

      // Verify still returns disabled
      const response = await apiClient.getChaosConfig(inbox.emailAddress).expect(200);
      expect(response.body.enabled).toBe(false);
    });

    it('should return 404 for non-existent inbox', async () => {
      await apiClient.disableChaos('nonexistent@vaultsandbox.test').expect(404);
    });
  });
});
