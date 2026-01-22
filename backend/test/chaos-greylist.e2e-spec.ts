import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient } from './helpers/api-client';
import { createSmtpClient } from './helpers/smtp-client';
import { generateClientKeypair } from './helpers/crypto-client';

/**
 * Chaos Engineering E2E Tests - Greylisting Simulation
 *
 * Tests the greylisting chaos feature which rejects first attempt(s)
 * with temporary error and accepts on retry.
 */
describe('Chaos Engineering - Greylisting', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;

  beforeAll(() => {
    apiClient = createApiClient(appLifecycle.httpServer);
  });

  describe('Basic Greylisting Behavior', () => {
    it('should reject first attempt and accept second attempt', async () => {
      const keypair = generateClientKeypair();

      // Create inbox with greylist chaos enabled (maxAttempts=2)
      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            greylist: {
              enabled: true,
              maxAttempts: 2,
              retryWindowMs: 300000,
              trackBy: 'ip_sender',
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      // First attempt should be rejected with 4xx error
      const smtpClient1 = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      await expect(
        smtpClient1.sendFixture('plaintext', {
          to: inboxAddress,
        }),
      ).rejects.toThrow(/451.*[Gg]reylist/);

      // Second attempt should succeed
      const smtpClient2 = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const sendInfo = await smtpClient2.sendFixture('plaintext', {
        to: inboxAddress,
      });

      expect(sendInfo.accepted).toContain(inboxAddress);
    });

    it('should require 3 attempts when maxAttempts is 3', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            greylist: {
              enabled: true,
              maxAttempts: 3,
              retryWindowMs: 300000,
              trackBy: 'ip_sender',
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      // First two attempts should be rejected
      for (let i = 1; i <= 2; i++) {
        const smtpClient = createSmtpClient({
          port: appLifecycle.smtpPort,
        });

        await expect(
          smtpClient.sendFixture('plaintext', {
            to: inboxAddress,
            subject: `Attempt ${i}`,
          }),
        ).rejects.toThrow(/451.*[Gg]reylist/);
      }

      // Third attempt should succeed
      const smtpClient3 = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const sendInfo = await smtpClient3.sendFixture('plaintext', {
        to: inboxAddress,
        subject: 'Attempt 3',
      });

      expect(sendInfo.accepted).toContain(inboxAddress);
    });

    it('should accept immediately when maxAttempts is 1', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            greylist: {
              enabled: true,
              maxAttempts: 1, // Accept on first attempt
              retryWindowMs: 300000,
              trackBy: 'ip_sender',
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      // First attempt should succeed
      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
      });

      expect(sendInfo.accepted).toContain(inboxAddress);
    });
  });

  describe('Tracking Modes', () => {
    it('should track by IP only', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            greylist: {
              enabled: true,
              maxAttempts: 2,
              retryWindowMs: 300000,
              trackBy: 'ip',
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      // First attempt with sender1 - should be rejected
      const smtpClient1 = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      await expect(
        smtpClient1.sendFixture('plaintext', {
          to: inboxAddress,
          from: 'sender1@example.com',
        }),
      ).rejects.toThrow(/451.*[Gg]reylist/);

      // Second attempt with sender2 (same IP) - should succeed
      // because tracking is by IP only
      const smtpClient2 = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const sendInfo = await smtpClient2.sendFixture('plaintext', {
        to: inboxAddress,
        from: 'sender2@example.com',
      });

      expect(sendInfo.accepted).toContain(inboxAddress);
    });

    it('should track by sender only', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            greylist: {
              enabled: true,
              maxAttempts: 2,
              retryWindowMs: 300000,
              trackBy: 'sender',
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;
      const senderEmail = 'sender-track-test@example.com';

      // First attempt - should be rejected
      const smtpClient1 = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      await expect(
        smtpClient1.sendFixture('plaintext', {
          to: inboxAddress,
          from: senderEmail,
        }),
      ).rejects.toThrow(/451.*[Gg]reylist/);

      // Second attempt (same sender) - should succeed
      const smtpClient2 = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const sendInfo = await smtpClient2.sendFixture('plaintext', {
        to: inboxAddress,
        from: senderEmail,
      });

      expect(sendInfo.accepted).toContain(inboxAddress);
    });

    it('should track by IP+sender combination', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            greylist: {
              enabled: true,
              maxAttempts: 2,
              retryWindowMs: 300000,
              trackBy: 'ip_sender',
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;
      const senderEmail = 'sender-combo-test@example.com';

      // First attempt - should be rejected
      const smtpClient1 = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      await expect(
        smtpClient1.sendFixture('plaintext', {
          to: inboxAddress,
          from: senderEmail,
        }),
      ).rejects.toThrow(/451.*[Gg]reylist/);

      // Different sender (same IP) - should also be rejected (new combo)
      const smtpClient2 = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      await expect(
        smtpClient2.sendFixture('plaintext', {
          to: inboxAddress,
          from: 'different-sender@example.com',
        }),
      ).rejects.toThrow(/451.*[Gg]reylist/);

      // Original sender second attempt - should succeed
      const smtpClient3 = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const sendInfo = await smtpClient3.sendFixture('plaintext', {
        to: inboxAddress,
        from: senderEmail,
      });

      expect(sendInfo.accepted).toContain(inboxAddress);
    });
  });

  describe('State Reset After Success', () => {
    it('should reject again after successful delivery', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            greylist: {
              enabled: true,
              maxAttempts: 2,
              retryWindowMs: 300000,
              trackBy: 'ip_sender',
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;
      const senderEmail = 'sender-reset-test@example.com';

      // First round: reject then accept
      const smtpClient1 = createSmtpClient({ port: appLifecycle.smtpPort });
      await expect(smtpClient1.sendFixture('plaintext', { to: inboxAddress, from: senderEmail })).rejects.toThrow(
        /451/,
      );

      const smtpClient2 = createSmtpClient({ port: appLifecycle.smtpPort });
      const sendInfo1 = await smtpClient2.sendFixture('plaintext', {
        to: inboxAddress,
        from: senderEmail,
      });
      expect(sendInfo1.accepted).toContain(inboxAddress);

      // Second round: state should be cleared, so reject again
      const smtpClient3 = createSmtpClient({ port: appLifecycle.smtpPort });
      await expect(smtpClient3.sendFixture('plaintext', { to: inboxAddress, from: senderEmail })).rejects.toThrow(
        /451/,
      );

      // Then accept on second attempt
      const smtpClient4 = createSmtpClient({ port: appLifecycle.smtpPort });
      const sendInfo2 = await smtpClient4.sendFixture('plaintext', {
        to: inboxAddress,
        from: senderEmail,
      });
      expect(sendInfo2.accepted).toContain(inboxAddress);
    });
  });

  describe('Chaos Disabled Scenarios', () => {
    it('should not greylist when chaos.enabled is false', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: false, // Master switch off
            greylist: {
              enabled: true,
              maxAttempts: 2,
              retryWindowMs: 300000,
              trackBy: 'ip_sender',
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      // First attempt should succeed (chaos disabled)
      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
      });

      expect(sendInfo.accepted).toContain(inboxAddress);
    });

    it('should not greylist when greylist.enabled is false', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            greylist: {
              enabled: false, // Greylist specifically disabled
              maxAttempts: 2,
              retryWindowMs: 300000,
              trackBy: 'ip_sender',
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      // First attempt should succeed
      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
      });

      expect(sendInfo.accepted).toContain(inboxAddress);
    });

    it('should not greylist when no chaos config', async () => {
      const keypair = generateClientKeypair();

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

      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
      });

      expect(sendInfo.accepted).toContain(inboxAddress);
    });
  });

  describe('Email Storage After Greylist Pass', () => {
    it('should store email after passing greylist', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            greylist: {
              enabled: true,
              maxAttempts: 2,
              retryWindowMs: 300000,
              trackBy: 'ip_sender',
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      // First attempt - rejected
      const smtpClient1 = createSmtpClient({ port: appLifecycle.smtpPort });
      await expect(smtpClient1.sendFixture('plaintext', { to: inboxAddress })).rejects.toThrow(/451/);

      // Second attempt - accepted
      const smtpClient2 = createSmtpClient({ port: appLifecycle.smtpPort });
      await smtpClient2.sendFixture('plaintext', {
        to: inboxAddress,
        subject: 'Greylist passed email',
      });

      // Verify email was stored
      const emailsResponse = await apiClient.listInboxEmails(inboxAddress).expect(200);
      expect(emailsResponse.body).toHaveLength(1);
    });
  });
});
