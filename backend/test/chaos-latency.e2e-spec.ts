import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient } from './helpers/api-client';
import { createSmtpClient } from './helpers/smtp-client';
import { generateClientKeypair } from './helpers/crypto-client';
import { pollForEmails } from './helpers/assertions';

/**
 * Chaos Engineering E2E Tests - Latency Injection
 *
 * Tests the latency injection chaos feature which adds configurable
 * delays to SMTP responses before returning 250 OK.
 */
describe('Chaos Engineering - Latency Injection', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;

  beforeAll(() => {
    apiClient = createApiClient(appLifecycle.httpServer);
  });

  describe('Basic Latency Injection', () => {
    it('should inject latency when chaos latency is enabled with 100% probability', async () => {
      const keypair = generateClientKeypair();

      // Create inbox with latency chaos enabled
      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            latency: {
              enabled: true,
              minDelayMs: 1000,
              maxDelayMs: 2000,
              jitter: true,
              probability: 1.0,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Measure time to send email
      const startTime = Date.now();
      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
      });
      const elapsed = Date.now() - startTime;

      // Email should be accepted
      expect(sendInfo.accepted).toContain(inboxAddress);

      // Elapsed time should include the injected delay (at least minDelayMs)
      expect(elapsed).toBeGreaterThanOrEqual(1000);
    });

    it('should apply delay within configured range when jitter is enabled', async () => {
      const keypair = generateClientKeypair();

      // Create inbox with jitter enabled (default behavior)
      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            latency: {
              enabled: true,
              minDelayMs: 800,
              maxDelayMs: 1500,
              jitter: true,
              probability: 1.0,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const startTime = Date.now();
      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
      });
      const elapsed = Date.now() - startTime;

      expect(sendInfo.accepted).toContain(inboxAddress);
      // With jitter=true, delay should be between minDelayMs and maxDelayMs
      expect(elapsed).toBeGreaterThanOrEqual(800);
      expect(elapsed).toBeLessThanOrEqual(2500); // Allow overhead for system variability
    });

    it('should still deliver email successfully with latency', async () => {
      const keypair = generateClientKeypair();

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
              jitter: true,
              probability: 1.0,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
        subject: 'Latency test email',
      });

      // Verify email was actually delivered
      const emails = await pollForEmails(apiClient, inboxAddress, 10_000, 1);
      expect(emails).toHaveLength(1);
    });
  });

  describe('Probability-Based Latency', () => {
    it('should not inject latency when probability is 0', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            latency: {
              enabled: true,
              minDelayMs: 5000, // Large delay that would be noticeable
              maxDelayMs: 5000,
              jitter: false,
              probability: 0.0, // Never apply
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const startTime = Date.now();
      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
      });
      const elapsed = Date.now() - startTime;

      expect(sendInfo.accepted).toContain(inboxAddress);
      // Should complete quickly without the 5 second delay
      expect(elapsed).toBeLessThan(3000);
    });
  });

  describe('Chaos Disabled Scenarios', () => {
    it('should not inject latency when chaos.enabled is false', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: false, // Master switch off
            latency: {
              enabled: true,
              minDelayMs: 5000,
              maxDelayMs: 5000,
              jitter: false,
              probability: 1.0,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const startTime = Date.now();
      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
      });
      const elapsed = Date.now() - startTime;

      expect(sendInfo.accepted).toContain(inboxAddress);
      // Should complete quickly without delay
      expect(elapsed).toBeLessThan(3000);
    });

    it('should not inject latency when latency.enabled is false', async () => {
      const keypair = generateClientKeypair();

      const inboxResponse = await apiClient
        .createInbox({
          clientKemPk: keypair.publicKeyB64,
          ttl: 3600,
          chaos: {
            enabled: true,
            latency: {
              enabled: false, // Latency specifically disabled
              minDelayMs: 5000,
              maxDelayMs: 5000,
              jitter: false,
              probability: 1.0,
            },
          },
        })
        .expect(201);

      const inboxAddress = inboxResponse.body.emailAddress;

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const startTime = Date.now();
      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
      });
      const elapsed = Date.now() - startTime;

      expect(sendInfo.accepted).toContain(inboxAddress);
      // Should complete quickly without delay
      expect(elapsed).toBeLessThan(3000);
    });

    it('should not inject latency for inbox without chaos config', async () => {
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

      const startTime = Date.now();
      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inboxAddress,
      });
      const elapsed = Date.now() - startTime;

      expect(sendInfo.accepted).toContain(inboxAddress);
      // Should complete quickly
      expect(elapsed).toBeLessThan(3000);
    });
  });
});
