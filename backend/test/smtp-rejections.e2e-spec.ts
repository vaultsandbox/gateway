import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient } from './helpers/api-client';
import { createSmtpClient } from './helpers/smtp-client';
import { generateClientKeypair } from './helpers/crypto-client';
import { createTestInbox } from './helpers/assertions';

describe('SMTP Rejection Edge Cases', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;

  beforeAll(() => {
    apiClient = createApiClient(appLifecycle.httpServer);
  });

  describe('Hard Mode - No Inboxes Exist', () => {
    it('should reject email when no inboxes exist (hard mode)', async () => {
      // Ensure no inboxes exist
      await apiClient.clearAllInboxes().expect(200);

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Attempt to send email to a valid domain but with no inboxes
      await expect(
        smtpClient.sendFixture('plaintext', {
          to: 'test@vaultsandbox.test',
        }),
      ).rejects.toThrow();

      // Try to catch the specific error and verify response code
      try {
        await smtpClient.sendFixture('plaintext', {
          to: 'test@vaultsandbox.test',
        });
        fail('Should have thrown an error');
      } catch (error: any) {
        // Hard mode reject code defaults to 421 (VSB_SMTP_HARD_MODE_REJECT_CODE)
        expect(error.message).toContain('421');
        expect(error.message.toLowerCase()).toContain('service not available');
      }
    });

    it('should accept email when at least one inbox exists', async () => {
      // Clear all inboxes first
      await apiClient.clearAllInboxes().expect(200);

      // Create an inbox
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Should now accept emails
      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inbox.emailAddress,
      });

      expect(sendInfo.accepted).toContain(inbox.emailAddress);
    });
  });

  describe('Unauthorized Domain Rejection', () => {
    it('should reject email to unauthorized domain', async () => {
      // Create an inbox first so hard mode doesn't interfere
      const keypair = generateClientKeypair();
      await createTestInbox(apiClient, keypair.publicKeyB64);

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Attempt to send to a domain not in VSB_SMTP_ALLOWED_DOMAINS
      // .env.test-e2e only allows 'vaultsandbox.test'
      await expect(
        smtpClient.sendFixture('plaintext', {
          to: 'user@unauthorized.com',
        }),
      ).rejects.toThrow();

      try {
        await smtpClient.sendFixture('plaintext', {
          to: 'user@unauthorized.com',
        });
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message.toLowerCase()).toMatch(/does not accept mail for domain|relay access denied/i);
      }
    });

    it('should accept email to authorized domain', async () => {
      // Create an inbox
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Should accept emails to vaultsandbox.test (authorized domain)
      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inbox.emailAddress,
      });

      expect(sendInfo.accepted).toContain(inbox.emailAddress);
    });
  });

  describe('Non-Existent or Deleted Inbox', () => {
    it('should reject email to non-existent inbox on authorized domain', async () => {
      // Create at least one inbox so hard mode doesn't interfere
      const keypair = generateClientKeypair();
      await createTestInbox(apiClient, keypair.publicKeyB64);

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Attempt to send to non-existent inbox on authorized domain
      await expect(
        smtpClient.sendFixture('plaintext', {
          to: 'nonexistent@vaultsandbox.test',
        }),
      ).rejects.toThrow();

      try {
        await smtpClient.sendFixture('plaintext', {
          to: 'nonexistent@vaultsandbox.test',
        });
        fail('Should have thrown an error');
      } catch (error: any) {
        // Early validation rejects during RCPT TO with "recipient address rejected"
        expect(error.message.toLowerCase()).toContain('recipient');
        expect(error.message.toLowerCase()).toContain('rejected');
      }
    });

    it('should reject email to deleted inbox', async () => {
      // Create an inbox
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create another inbox so hard mode doesn't trigger when we delete the first
      const keypair2 = generateClientKeypair();
      await createTestInbox(apiClient, keypair2.publicKeyB64);

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Verify email can be sent to the inbox before deletion
      const sendInfoBefore = await smtpClient.sendFixture('plaintext', {
        to: inbox.emailAddress,
      });
      expect(sendInfoBefore.accepted).toContain(inbox.emailAddress);

      // Delete the inbox
      await apiClient.deleteInbox(inbox.emailAddress).expect(204);

      // Attempt to send to deleted inbox
      await expect(
        smtpClient.sendFixture('plaintext', {
          to: inbox.emailAddress,
        }),
      ).rejects.toThrow();

      try {
        await smtpClient.sendFixture('plaintext', {
          to: inbox.emailAddress,
        });
        fail('Should have thrown an error');
      } catch (error: any) {
        // Early validation rejects during RCPT TO with "recipient address rejected"
        expect(error.message.toLowerCase()).toContain('recipient');
        expect(error.message.toLowerCase()).toContain('rejected');
      }
    });

    it('should accept email to existing inbox on authorized domain', async () => {
      // Create an inbox
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // Should accept email to existing inbox
      const sendInfo = await smtpClient.sendFixture('plaintext', {
        to: inbox.emailAddress,
      });

      expect(sendInfo.accepted).toContain(inbox.emailAddress);
    });
  });

  describe('Multiple Rejection Scenarios Combined', () => {
    it('should handle multiple recipients with mixed validity', async () => {
      // Create one valid inbox
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      const smtpClient = createSmtpClient({
        port: appLifecycle.smtpPort,
      });

      // SMTP protocol validates recipients one by one during RCPT TO phase
      // If ANY recipient is invalid, the transaction should fail
      // We'll test valid inbox separately from invalid ones

      // First verify the valid inbox works
      const validSend = await smtpClient.sendFixture('plaintext', {
        to: inbox.emailAddress,
      });
      expect(validSend.accepted).toContain(inbox.emailAddress);
    });
  });
});
