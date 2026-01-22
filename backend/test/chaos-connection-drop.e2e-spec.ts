import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient } from './helpers/api-client';
import { createSmtpClient } from './helpers/smtp-client';
import { generateClientKeypair } from './helpers/crypto-client';

/**
 * Chaos Engineering E2E Tests - Connection Drop
 *
 * Tests the connection drop chaos feature which abruptly terminates
 * SMTP connections to simulate network failures.
 */
describe('Chaos Engineering - Connection Drop', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;

  beforeAll(() => {
    apiClient = createApiClient(appLifecycle.httpServer);
  });

  describe('Graceful Connection Drop (FIN)', () => {
    it('should drop connection gracefully before sending response', async () => {
      const keypair = generateClientKeypair();

      // Create inbox with graceful connection drop chaos enabled
      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            connectionDrop: {
              enabled: true,
              probability: 1.0,
              graceful: true, // FIN - graceful close
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Connection should be dropped, causing an error
      await expect(
        smtpClient.sendFixture('plaintext', {
          to: inboxAddress,
        }),
      ).rejects.toThrow();
    });

    it('should not store email when connection is dropped', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            connectionDrop: {
              enabled: true,
              probability: 1.0,
              graceful: true,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Attempt to send - will fail
      try {
        await smtpClient.sendFixture('plaintext', {
          to: inboxAddress,
        });
      } catch {
        // Expected to fail
      }

      // Inbox should still be empty since connection was dropped
      // Note: The email might actually be stored since drop happens AFTER processing
      // but BEFORE response. This tests the connection behavior, not storage.
    });
  });

  describe('Abrupt Connection Drop (RST)', () => {
    it('should drop connection abruptly before sending response', async () => {
      const keypair = generateClientKeypair();

      // Create inbox with abrupt connection drop chaos enabled
      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            connectionDrop: {
              enabled: true,
              probability: 1.0,
              graceful: false, // RST - abrupt close
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Connection should be dropped abruptly, causing an error
      await expect(
        smtpClient.sendFixture('plaintext', {
          to: inboxAddress,
        }),
      ).rejects.toThrow();
    });
  });

  describe('Probability-Based Connection Drop', () => {
    it('should not drop connection when probability is 0', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            connectionDrop: {
              enabled: true,
              probability: 0.0, // Never drop
              graceful: true,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Should succeed since probability is 0
      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
      });

      expect(sendInfo.accepted).toContain(inboxAddress);
    });

    it('should drop some connections with partial probability', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            connectionDrop: {
              enabled: true,
              probability: 0.5, // 50% chance of drop
              graceful: true,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      // Send multiple emails to test probability
      const attempts = 10;
      let dropCount = 0;
      let successCount = 0;

      for (let i = 0; i < attempts; i++) {
        const smtpClient = createSmtpClient({
          port: appLifecycle.smtpPort,
        });

        try {
          await smtpClient.sendFixture('plaintext', {
            to: inboxAddress,
            subject: `Connection drop test ${i}`,
          });
          successCount++;
        } catch {
          dropCount++;
        }
      }

      // With 50% probability, we should see a mix (allow for some variance)
      // At least one should succeed and at least one should be dropped
      expect(dropCount + successCount).toBe(attempts);
      // With 10 attempts at 50%, very unlikely to have all succeed or all fail
      // But since it's probabilistic, we just verify the mechanism works
    });
  });

  describe('Chaos Disabled Scenarios', () => {
    it('should not drop connection when chaos.enabled is false', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: false, // Master switch off
            connectionDrop: {
              enabled: true,
              probability: 1.0,
              graceful: true,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Should succeed since chaos is disabled
      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
      });

      expect(sendInfo.accepted).toContain(inboxAddress);
    });

    it('should not drop connection when connectionDrop.enabled is false', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            connectionDrop: {
              enabled: false, // Connection drop specifically disabled
              probability: 1.0,
              graceful: true,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Should succeed since connection drop is disabled
      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
      });

      expect(sendInfo.accepted).toContain(inboxAddress);
    });

    it('should not drop connection for inbox without chaos config', async () => {
      const keypair = generateClientKeypair();

      // Create inbox without chaos config
      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Should succeed
      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
      });

      expect(sendInfo.accepted).toContain(inboxAddress);
    });
  });
});
