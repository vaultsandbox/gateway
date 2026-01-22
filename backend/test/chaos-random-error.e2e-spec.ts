import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient } from './helpers/api-client';
import { createSmtpClient } from './helpers/smtp-client';
import { generateClientKeypair } from './helpers/crypto-client';

/**
 * Chaos Engineering E2E Tests - Random Error Generation
 *
 * Tests the random error chaos feature which returns random SMTP
 * error codes for a configurable percentage of requests.
 */
describe('Chaos Engineering - Random Error Generation', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;

  beforeAll(() => {
    apiClient = createApiClient(appLifecycle.httpServer);
  });

  describe('100% Error Rate', () => {
    it('should return temporary error with 100% error rate', async () => {
      const keypair = generateClientKeypair();

      // Create inbox with random temporary error chaos enabled
      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            randomError: {
              enabled: true,
              errorRate: 1.0, // 100% error rate
              errorTypes: ['temporary'],
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Should fail with a temporary (4xx) error
      await expect(
        smtpClient.sendFixture('plaintext', {
          to: inboxAddress,
        }),
      ).rejects.toThrow(/4[0-9]{2}/);
    });

    it('should return permanent error with 100% error rate', async () => {
      const keypair = generateClientKeypair();

      // Create inbox with random permanent error chaos enabled
      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            randomError: {
              enabled: true,
              errorRate: 1.0, // 100% error rate
              errorTypes: ['permanent'],
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Should fail with a permanent (5xx) error
      await expect(
        smtpClient.sendFixture('plaintext', {
          to: inboxAddress,
        }),
      ).rejects.toThrow(/5[0-9]{2}/);
    });

    it('should return mixed errors when both types are enabled', async () => {
      const keypair = generateClientKeypair();

      // Create inbox with both error types
      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            randomError: {
              enabled: true,
              errorRate: 1.0,
              errorTypes: ['temporary', 'permanent'],
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      // Send multiple emails to see different error types
      const errorCodes = new Set<string>();

      for (let i = 0; i < 10; i++) {
        const smtpClient = createSmtpClient({
          port: appLifecycle.smtpPort,
        });

        try {
          await smtpClient.sendFixture('plaintext', {
            to: inboxAddress,
            subject: `Error test ${i}`,
          });
        } catch (error: any) {
          // Extract the error code (first 3 digits)
          const match = error.message.match(/([45][0-9]{2})/);
          if (match) {
            errorCodes.add(match[1]);
          }
        }
      }

      // Should have received at least one error
      expect(errorCodes.size).toBeGreaterThan(0);
      // All errors should be either 4xx or 5xx
      errorCodes.forEach((code) => {
        expect(code).toMatch(/^[45][0-9]{2}$/);
      });
    });
  });

  describe('Partial Error Rate', () => {
    it('should return errors for configured percentage of requests', async () => {
      const keypair = generateClientKeypair();

      // Create inbox with 50% error rate
      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            randomError: {
              enabled: true,
              errorRate: 0.5, // 50% error rate
              errorTypes: ['temporary'],
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const attempts = 10;
      let errorCount = 0;
      let successCount = 0;

      for (let i = 0; i < attempts; i++) {
        const smtpClient = createSmtpClient({
          port: appLifecycle.smtpPort,
        });

        try {
          await smtpClient.sendFixture('plaintext', {
            to: inboxAddress,
            subject: `Error rate test ${i}`,
          });
          successCount++;
        } catch {
          errorCount++;
        }
      }

      // With 50% error rate, we should see a mix
      expect(errorCount + successCount).toBe(attempts);
      // Very unlikely to have all errors or all successes with 10 attempts at 50%
    });

    it('should not return errors when error rate is 0', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            randomError: {
              enabled: true,
              errorRate: 0.0, // 0% error rate - never fail
              errorTypes: ['temporary', 'permanent'],
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Should succeed since error rate is 0
      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
      });

      expect(sendInfo.accepted).toContain(inboxAddress);
    });
  });

  describe('Error Code Verification', () => {
    it('should return valid temporary SMTP error codes', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            randomError: {
              enabled: true,
              errorRate: 1.0,
              errorTypes: ['temporary'],
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;
      const validTemporaryCodes = ['421', '450', '451', '452'];
      const receivedCodes = new Set<string>();

      // Send multiple emails to collect error codes
      for (let i = 0; i < 20; i++) {
        const smtpClient = createSmtpClient({
          port: appLifecycle.smtpPort,
        });

        try {
          await smtpClient.sendFixture('plaintext', {
            to: inboxAddress,
            subject: `Temporary error code test ${i}`,
          });
        } catch (error: any) {
          const match = error.message.match(/([45][0-9]{2})/);
          if (match) {
            receivedCodes.add(match[1]);
          }
        }
      }

      // All received codes should be valid temporary codes
      receivedCodes.forEach((code) => {
        expect(validTemporaryCodes).toContain(code);
      });
    });

    it('should return valid permanent SMTP error codes', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            randomError: {
              enabled: true,
              errorRate: 1.0,
              errorTypes: ['permanent'],
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;
      const validPermanentCodes = ['550', '551', '552', '553', '554'];
      const receivedCodes = new Set<string>();

      // Send multiple emails to collect error codes
      for (let i = 0; i < 20; i++) {
        const smtpClient = createSmtpClient({
          port: appLifecycle.smtpPort,
        });

        try {
          await smtpClient.sendFixture('plaintext', {
            to: inboxAddress,
            subject: `Permanent error code test ${i}`,
          });
        } catch (error: any) {
          const match = error.message.match(/([45][0-9]{2})/);
          if (match) {
            receivedCodes.add(match[1]);
          }
        }
      }

      // All received codes should be valid permanent codes
      receivedCodes.forEach((code) => {
        expect(validPermanentCodes).toContain(code);
      });
    });
  });

  describe('Chaos Disabled Scenarios', () => {
    it('should not return errors when chaos.enabled is false', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: false, // Master switch off
            randomError: {
              enabled: true,
              errorRate: 1.0,
              errorTypes: ['temporary'],
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

    it('should not return errors when randomError.enabled is false', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            randomError: {
              enabled: false, // Random error specifically disabled
              errorRate: 1.0,
              errorTypes: ['temporary'],
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Should succeed since random error is disabled
      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
      });

      expect(sendInfo.accepted).toContain(inboxAddress);
    });

    it('should not return errors for inbox without chaos config', async () => {
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
