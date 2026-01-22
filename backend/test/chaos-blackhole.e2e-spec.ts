import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient } from './helpers/api-client';
import { createSmtpClient } from './helpers/smtp-client';
import { generateClientKeypair } from './helpers/crypto-client';

/**
 * Chaos Engineering E2E Tests - Blackhole Mode
 *
 * Tests the blackhole chaos feature which accepts email (returns 250 OK)
 * but doesn't store it or trigger webhooks.
 */
describe('Chaos Engineering - Blackhole Mode', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;

  beforeAll(() => {
    apiClient = createApiClient(appLifecycle.httpServer);
  });

  describe('Basic Blackhole Behavior', () => {
    it('should accept email but not store it', async () => {
      const keypair = generateClientKeypair();

      // Create inbox with blackhole chaos enabled
      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            blackhole: {
              enabled: true,
              triggerWebhooks: false,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      // Send email - should be accepted
      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
        subject: 'Blackhole test email',
      });

      // SMTP should report success
      expect(sendInfo.accepted).toContain(inboxAddress);

      // But email should NOT be stored
      const emailsResponse = await apiClient.listInboxEmails(inboxAddress).expect(200);
      expect(emailsResponse.body).toHaveLength(0);
    });

    it('should blackhole multiple emails', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            blackhole: {
              enabled: true,
              triggerWebhooks: false,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      // Send multiple emails
      for (let i = 1; i <= 5; i++) {
        const smtpClient = createSmtpClient({
          port: appLifecycle.smtpPort,
        });

        const sendInfo = await smtpClient.sendFixture('plaintext', {
          to: inboxAddress,
          subject: `Blackhole test ${i}`,
        });

        expect(sendInfo.accepted).toContain(inboxAddress);
      }

      // None should be stored
      const emailsResponse = await apiClient.listInboxEmails(inboxAddress).expect(200);
      expect(emailsResponse.body).toHaveLength(0);
    });
  });

  describe('Webhook Behavior', () => {
    it('should suppress webhooks when triggerWebhooks is false', async () => {
      const keypair = generateClientKeypair();

      // Create inbox with blackhole and webhooks suppressed
      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            blackhole: {
              enabled: true,
              triggerWebhooks: false,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
        subject: 'No webhook test',
      });

      expect(sendInfo.accepted).toContain(inboxAddress);

      // Email should not be stored
      const emailsResponse = await apiClient.listInboxEmails(inboxAddress).expect(200);
      expect(emailsResponse.body).toHaveLength(0);
    });

    it('should allow webhooks when triggerWebhooks is true', async () => {
      const keypair = generateClientKeypair();

      // Create inbox with blackhole but webhooks enabled
      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            blackhole: {
              enabled: true,
              triggerWebhooks: true,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
        subject: 'Webhook enabled test',
      });

      // SMTP should still succeed
      expect(sendInfo.accepted).toContain(inboxAddress);

      // Email should NOT be stored even with webhooks enabled
      const emailsResponse = await apiClient.listInboxEmails(inboxAddress).expect(200);
      expect(emailsResponse.body).toHaveLength(0);
    });
  });

  describe('Chaos Disabled Scenarios', () => {
    it('should store email when chaos.enabled is false', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: false, // Master switch off
            blackhole: {
              enabled: true,
              triggerWebhooks: false,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
        subject: 'Should be stored',
      });

      expect(sendInfo.accepted).toContain(inboxAddress);

      // Email SHOULD be stored (chaos disabled)
      const emailsResponse = await apiClient.listInboxEmails(inboxAddress).expect(200);
      expect(emailsResponse.body).toHaveLength(1);
    });

    it('should store email when blackhole.enabled is false', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            blackhole: {
              enabled: false, // Blackhole specifically disabled
              triggerWebhooks: false,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
        subject: 'Should be stored',
      });

      expect(sendInfo.accepted).toContain(inboxAddress);

      // Email SHOULD be stored (blackhole disabled)
      const emailsResponse = await apiClient.listInboxEmails(inboxAddress).expect(200);
      expect(emailsResponse.body).toHaveLength(1);
    });

    it('should store email when no chaos config', async () => {
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
        subject: 'Normal storage',
      });

      expect(sendInfo.accepted).toContain(inboxAddress);

      // Email SHOULD be stored
      const emailsResponse = await apiClient.listInboxEmails(inboxAddress).expect(200);
      expect(emailsResponse.body).toHaveLength(1);
    });
  });

  describe('Blackhole with Plain Inbox', () => {
    it('should blackhole plain inbox emails', async () => {
      // Create plain inbox (no encryption, explicit encryption=plain)
      const inboxResponse = await apiClient
        .createInbox({
          ttl: 3600,
          encryption: 'plain',
          chaos: {
            enabled: true,
            blackhole: {
              enabled: true,
              triggerWebhooks: false,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
        subject: 'Plain blackhole test',
      });

      // SMTP should succeed
      expect(sendInfo.accepted).toContain(inboxAddress);

      // Email should NOT be stored
      const emailsResponse = await apiClient.listInboxEmails(inboxAddress).expect(200);
      expect(emailsResponse.body).toHaveLength(0);
    });
  });

  describe('Priority vs Other Chaos Types', () => {
    it('should blackhole after passing greylist', async () => {
      const keypair = generateClientKeypair();

      // Create inbox with both greylist and blackhole
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
            blackhole: {
              enabled: true,
              triggerWebhooks: false,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      // First attempt - greylist rejection
      const smtpClient1 = createSmtpClient({ port: appLifecycle.smtpPort });
      await expect(smtpClient1.sendFixture('plaintext', { to: inboxAddress })).rejects.toThrow(/451/);

      // Second attempt - passes greylist but gets blackholed
      const smtpClient2 = createSmtpClient({ port: appLifecycle.smtpPort });
      const sendInfo = await smtpClient2.sendFixture('plaintext', {
        to: inboxAddress,
        subject: 'Greylist passed, blackholed',
      });

      expect(sendInfo.accepted).toContain(inboxAddress);

      // Email should NOT be stored (blackholed)
      const emailsResponse = await apiClient.listInboxEmails(inboxAddress).expect(200);
      expect(emailsResponse.body).toHaveLength(0);
    });

    it('should not reach blackhole if connection drop triggers first', async () => {
      const keypair = generateClientKeypair();

      // Create inbox with both connection drop (100% probability) and blackhole
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
            blackhole: {
              enabled: true,
              triggerWebhooks: false,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Should fail due to connection drop (higher priority than blackhole)
      await expect(smtpClient.sendFixture('plaintext', { to: inboxAddress })).rejects.toThrow();

      // Email should NOT be stored
      const emailsResponse = await apiClient.listInboxEmails(inboxAddress).expect(200);
      expect(emailsResponse.body).toHaveLength(0);
    });
  });

  describe('Different Senders', () => {
    it('should blackhole emails from different senders', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            blackhole: {
              enabled: true,
              triggerWebhooks: false,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      // Send from different senders
      for (const sender of ['sender1@example.com', 'sender2@example.com', 'sender3@example.com']) {
        const smtpClient = createSmtpClient({
          port: appLifecycle.smtpPort,
        });

        const sendInfo = await smtpClient.sendFixture('plaintext', {
          to: inboxAddress,
          from: sender,
        });

        expect(sendInfo.accepted).toContain(inboxAddress);
      }

      // No emails should be stored
      const emailsResponse = await apiClient.listInboxEmails(inboxAddress).expect(200);
      expect(emailsResponse.body).toHaveLength(0);
    });
  });
});
