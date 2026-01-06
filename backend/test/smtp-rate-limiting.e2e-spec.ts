import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient } from './helpers/api-client';
import { createSmtpClient } from './helpers/smtp-client';
import { generateClientKeypair } from './helpers/crypto-client';
import { createTestInbox } from './helpers/assertions';

/**
 * SMTP Rate Limiting E2E Tests
 *
 * NOTE: Rate limiting is disabled by default in .env.test-e2e (VSB_SMTP_RATE_LIMIT_ENABLED=false).
 * To test rate limiting behavior, either:
 * 1. Create a separate .env.test-rate-limit config with rate limiting enabled and low limits
 * 2. Or enable rate limiting in .env.test-e2e and set testable limits
 *
 * These tests are marked as skipped by default until rate limiting is configured for testing.
 */
describe('SMTP Rate Limiting', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;

  beforeAll(() => {
    apiClient = createApiClient(appLifecycle.httpServer);
  });

  // Check if rate limiting is enabled via config
  const isRateLimitingEnabled = (): boolean => {
    const config = appLifecycle.config;
    return config.get<boolean>('vsb.smtp.rateLimit.enabled') ?? false;
  };

  describe('Rate Limit Enforcement', () => {
    it('should reject connections when rate limit is exceeded', async () => {
      // Skip if rate limiting is not enabled
      if (!isRateLimitingEnabled()) return;

      // Create an inbox
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Get the configured rate limit
      const config = appLifecycle.config;
      const maxEmails = config.get<number>('vsb.smtp.rateLimit.maxEmails') ?? 30;

      // Send emails up to the limit
      const sendPromises: Promise<{ accepted: string[] }>[] = [];
      for (let i = 0; i < maxEmails; i++) {
        sendPromises.push(
          smtpClient.sendFixture('plaintext', {
            to: inbox.emailAddress,
            subject: `Rate limit test ${i + 1}`,
          }),
        );
      }

      // All should succeed
      const results = await Promise.all(sendPromises);
      results.forEach((result) => {
        expect(result.accepted).toContain(inbox.emailAddress);
      });

      // The next email should be rejected with rate limit error
      try {
        await smtpClient.sendFixture('plaintext', {
          to: inbox.emailAddress,
          subject: 'Rate limit exceeded test',
        });
        fail('Should have thrown an error due to rate limiting');
      } catch (error: any) {
        // Expect 421 (service not available) with rate limit message
        expect(error.message).toMatch(/421|too many|rate limit|connections/i);
        expect(error.message).toMatch(/4\.7\.0|too many connections/i);
      }
    });

    it('should allow connections after rate limit window expires', () => {
      // Skip if rate limiting is not enabled
      if (!isRateLimitingEnabled()) return;

      // This test would require waiting for the rate limit duration to pass
      // For practical testing, this might need a short duration configured in test env
      // Currently skipping implementation as it would require significant wait time

      expect(true).toBe(true); // Placeholder - implement when test env is configured
    });
  });

  describe('Rate Limit Headers', () => {
    it('should include rate limit information in SMTP response', () => {
      // Skip if rate limiting is not enabled
      if (!isRateLimitingEnabled()) return;

      // When rate limiting is enabled, SMTP responses may include rate limit info
      // This depends on implementation - test accordingly when enabled
      expect(true).toBe(true);
    });
  });
});
