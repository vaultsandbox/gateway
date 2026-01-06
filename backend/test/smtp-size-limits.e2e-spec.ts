import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient } from './helpers/api-client';
import { createSmtpClient } from './helpers/smtp-client';
import { generateClientKeypair } from './helpers/crypto-client';
import { createTestInbox } from './helpers/assertions';

describe('SMTP Size Limits', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;

  beforeAll(() => {
    apiClient = createApiClient(appLifecycle.httpServer);
  });

  describe('Oversized Message Rejection', () => {
    it('should reject email exceeding VSB_SMTP_MAX_MESSAGE_SIZE (10MB)', async () => {
      // Create an inbox so hard mode doesn't interfere
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Default max message size is 10MB (10485760 bytes)
      // Send a message slightly over that limit (~11MB)
      const oversizeBytes = 11 * 1024 * 1024;

      await expect(
        smtpClient.sendFixture('oversized', {
          to: inbox.emailAddress,
          approxSizeBytes: oversizeBytes,
        }),
      ).rejects.toThrow();

      try {
        await smtpClient.sendFixture('oversized', {
          to: inbox.emailAddress,
          approxSizeBytes: oversizeBytes,
        });
        fail('Should have thrown an error');
      } catch (error: any) {
        // SMTP server should reject with 552 (message exceeds fixed maximum message size)
        // or 552 5.3.4 (message too big for system)
        expect(error.message).toMatch(/552|message.*size|too.*big/i);
      }
    });

    it('should accept email within size limits', async () => {
      // Create an inbox
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Send a small oversized fixture (under the limit)
      const sendInfo = await smtpClient.sendFixture('oversized', {
        to: inbox.emailAddress,
        approxSizeBytes: 100_000, // 100KB - well under 10MB limit
      });

      expect(sendInfo.accepted).toContain(inbox.emailAddress);
    });
  });
});
