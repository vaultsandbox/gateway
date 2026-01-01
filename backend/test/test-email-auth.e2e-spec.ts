import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient } from './helpers/api-client';
import { generateClientKeypair, decryptParsed } from './helpers/crypto-client';
import {
  expectEncryptedPayload,
  expectAuthResults,
  expectAuthResultValues,
  createTestInbox,
  pollForEmails,
} from './helpers/assertions';

describe('Test Email API - Auth Results (E2E)', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;

  beforeAll(() => {
    apiClient = createApiClient(appLifecycle.httpServer);
  });

  describe('POST /api/test/emails', () => {
    it('should create a test email with default auth results (all pass)', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create test email with defaults
      const response = await apiClient
        .createTestEmail({
          to: inbox.emailAddress,
        })
        .expect(201);

      expect(response.body.emailId).toBeDefined();

      // Retrieve and decrypt email
      const emails = await pollForEmails(apiClient, inbox.emailAddress);
      expect(emails).toHaveLength(1);

      const emailResponse = await apiClient.getEmail(inbox.emailAddress, emails[0].id).expect(200);
      expectEncryptedPayload(emailResponse.body.encryptedParsed);

      const parsed = await decryptParsed(emailResponse.body.encryptedParsed, keypair.secretKey);
      expectAuthResults(parsed.authResults);
      expectAuthResultValues(parsed.authResults, {
        spf: 'pass',
        dkim: 'pass',
        dmarc: 'pass',
        reverseDnsVerified: true,
      });
    });

    it('should create a test email with custom subject and body', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      await apiClient
        .createTestEmail({
          to: inbox.emailAddress,
          from: 'custom@example.com',
          subject: 'Custom Subject',
          text: 'Custom text body',
          html: '<p>Custom HTML body</p>',
        })
        .expect(201);

      const emails = await pollForEmails(apiClient, inbox.emailAddress);
      const emailResponse = await apiClient.getEmail(inbox.emailAddress, emails[0].id).expect(200);
      const parsed = await decryptParsed(emailResponse.body.encryptedParsed, keypair.secretKey);

      expect(parsed.subject).toBe('Custom Subject');
      expect(parsed.text).toBe('Custom text body');
      expect(parsed.html).toBe('<p>Custom HTML body</p>');
      expect(parsed.from).toBe('custom@example.com');
    });

    it('should return 404 for non-existent inbox', async () => {
      await apiClient
        .createTestEmail({
          to: 'nonexistent@vaultsandbox.test',
        })
        .expect(404);
    });

    it('should return 401 without API key', async () => {
      const invalidClient = createApiClient(appLifecycle.httpServer, { apiKey: 'invalid-key' });
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      await invalidClient
        .createTestEmail({
          to: inbox.emailAddress,
        })
        .expect(401);
    });
  });

  describe('SPF Result Variations', () => {
    const spfResults = ['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror'] as const;

    spfResults.forEach((spfResult) => {
      it(`should create email with SPF=${spfResult}`, async () => {
        const keypair = generateClientKeypair();
        const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

        await apiClient
          .createTestEmail({
            to: inbox.emailAddress,
            auth: { spf: spfResult },
          })
          .expect(201);

        const emails = await pollForEmails(apiClient, inbox.emailAddress);
        const emailResponse = await apiClient.getEmail(inbox.emailAddress, emails[0].id).expect(200);
        const parsed = await decryptParsed(emailResponse.body.encryptedParsed, keypair.secretKey);

        expectAuthResultValues(parsed.authResults, { spf: spfResult });
      });
    });
  });

  describe('DKIM Result Variations', () => {
    const dkimResults = ['pass', 'fail', 'none'] as const;

    dkimResults.forEach((dkimResult) => {
      it(`should create email with DKIM=${dkimResult}`, async () => {
        const keypair = generateClientKeypair();
        const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

        await apiClient
          .createTestEmail({
            to: inbox.emailAddress,
            auth: { dkim: dkimResult },
          })
          .expect(201);

        const emails = await pollForEmails(apiClient, inbox.emailAddress);
        const emailResponse = await apiClient.getEmail(inbox.emailAddress, emails[0].id).expect(200);
        const parsed = await decryptParsed(emailResponse.body.encryptedParsed, keypair.secretKey);

        expectAuthResultValues(parsed.authResults, { dkim: dkimResult });
      });
    });
  });

  describe('DMARC Result Variations', () => {
    const dmarcResults = ['pass', 'fail', 'none'] as const;

    dmarcResults.forEach((dmarcResult) => {
      it(`should create email with DMARC=${dmarcResult}`, async () => {
        const keypair = generateClientKeypair();
        const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

        await apiClient
          .createTestEmail({
            to: inbox.emailAddress,
            auth: { dmarc: dmarcResult },
          })
          .expect(201);

        const emails = await pollForEmails(apiClient, inbox.emailAddress);
        const emailResponse = await apiClient.getEmail(inbox.emailAddress, emails[0].id).expect(200);
        const parsed = await decryptParsed(emailResponse.body.encryptedParsed, keypair.secretKey);

        expectAuthResultValues(parsed.authResults, { dmarc: dmarcResult });
      });
    });
  });

  describe('ReverseDNS Result Variations', () => {
    it('should create email with reverseDns=true (verified)', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      await apiClient
        .createTestEmail({
          to: inbox.emailAddress,
          auth: { reverseDns: true },
        })
        .expect(201);

      const emails = await pollForEmails(apiClient, inbox.emailAddress);
      const emailResponse = await apiClient.getEmail(inbox.emailAddress, emails[0].id).expect(200);
      const parsed = await decryptParsed(emailResponse.body.encryptedParsed, keypair.secretKey);

      expectAuthResultValues(parsed.authResults, { reverseDnsVerified: true });
      expect(parsed.authResults.reverseDns?.hostname).toBe('test.vaultsandbox.local');
      expect(parsed.authResults.reverseDns?.ip).toBe('127.0.0.1');
    });

    it('should create email with reverseDns=false (not verified)', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      await apiClient
        .createTestEmail({
          to: inbox.emailAddress,
          auth: { reverseDns: false },
        })
        .expect(201);

      const emails = await pollForEmails(apiClient, inbox.emailAddress);
      const emailResponse = await apiClient.getEmail(inbox.emailAddress, emails[0].id).expect(200);
      const parsed = await decryptParsed(emailResponse.body.encryptedParsed, keypair.secretKey);

      expectAuthResultValues(parsed.authResults, { reverseDnsVerified: false });
    });
  });

  describe('Combined Auth Result Scenarios', () => {
    it('should create email with all auth failing', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      await apiClient
        .createTestEmail({
          to: inbox.emailAddress,
          auth: {
            spf: 'fail',
            dkim: 'fail',
            dmarc: 'fail',
            reverseDns: false,
          },
        })
        .expect(201);

      const emails = await pollForEmails(apiClient, inbox.emailAddress);
      const emailResponse = await apiClient.getEmail(inbox.emailAddress, emails[0].id).expect(200);
      const parsed = await decryptParsed(emailResponse.body.encryptedParsed, keypair.secretKey);

      expectAuthResultValues(parsed.authResults, {
        spf: 'fail',
        dkim: 'fail',
        dmarc: 'fail',
        reverseDnsVerified: false,
      });
    });

    it('should create email with mixed auth results (SPF softfail, DKIM pass, DMARC fail)', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      await apiClient
        .createTestEmail({
          to: inbox.emailAddress,
          auth: {
            spf: 'softfail',
            dkim: 'pass',
            dmarc: 'fail',
            reverseDns: true,
          },
        })
        .expect(201);

      const emails = await pollForEmails(apiClient, inbox.emailAddress);
      const emailResponse = await apiClient.getEmail(inbox.emailAddress, emails[0].id).expect(200);
      const parsed = await decryptParsed(emailResponse.body.encryptedParsed, keypair.secretKey);

      expectAuthResultValues(parsed.authResults, {
        spf: 'softfail',
        dkim: 'pass',
        dmarc: 'fail',
        reverseDnsVerified: true,
      });
    });

    it('should create email with auth results set to none', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      await apiClient
        .createTestEmail({
          to: inbox.emailAddress,
          auth: {
            spf: 'none',
            dkim: 'none',
            dmarc: 'none',
          },
        })
        .expect(201);

      const emails = await pollForEmails(apiClient, inbox.emailAddress);
      const emailResponse = await apiClient.getEmail(inbox.emailAddress, emails[0].id).expect(200);
      const parsed = await decryptParsed(emailResponse.body.encryptedParsed, keypair.secretKey);

      expectAuthResultValues(parsed.authResults, {
        spf: 'none',
        dkim: 'none',
        dmarc: 'none',
      });
    });
  });

  describe('Auth Result Domain Extraction', () => {
    it('should extract domain from sender address for auth results', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      await apiClient
        .createTestEmail({
          to: inbox.emailAddress,
          from: 'sender@customdomain.com',
        })
        .expect(201);

      const emails = await pollForEmails(apiClient, inbox.emailAddress);
      const emailResponse = await apiClient.getEmail(inbox.emailAddress, emails[0].id).expect(200);
      const parsed = await decryptParsed(emailResponse.body.encryptedParsed, keypair.secretKey);

      expect(parsed.authResults.spf?.domain).toBe('customdomain.com');
      expect(parsed.authResults.dkim?.[0].domain).toBe('customdomain.com');
      expect(parsed.authResults.dmarc?.domain).toBe('customdomain.com');
    });
  });
});
