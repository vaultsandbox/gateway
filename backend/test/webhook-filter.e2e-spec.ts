import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient, CreateWebhookBody, FilterConfigBody } from './helpers/api-client';
import { createSmtpClient, SmtpTestClient } from './helpers/smtp-client';
import { generateClientKeypair } from './helpers/crypto-client';
import { createTestInbox } from './helpers/assertions';
import { MockWebhookServer, createMockWebhookServer } from './helpers/webhook-server';

describe('Webhook Filter E2E', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;
  let smtpClient: SmtpTestClient;
  let webhookServer: MockWebhookServer;
  let webhookUrl: string;

  beforeAll(async () => {
    apiClient = createApiClient(appLifecycle.httpServer);
    smtpClient = createSmtpClient({ port: appLifecycle.smtpPort });
    webhookServer = createMockWebhookServer();
    webhookUrl = await webhookServer.start();
  });

  afterAll(async () => {
    await webhookServer.stop();
  });

  beforeEach(() => {
    webhookServer.clearRequests();
    webhookServer.resetResponseSettings();
  });

  // Helper to create a webhook with filter and send an email
  async function setupWebhookWithFilterAndSendEmail(
    filter: FilterConfigBody,
    emailOptions: {
      subject?: string;
      text?: string;
      html?: string;
      from?: string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<{ inboxEmail: string; webhookId: string }> {
    const keypair = generateClientKeypair();
    const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

    const webhookData: CreateWebhookBody = {
      url: `${webhookUrl}/webhook`,
      events: ['email.received'],
      filter,
    };

    const webhookResponse = await apiClient.createGlobalWebhook(webhookData).expect(201);

    // Build custom headers
    const customHeaders = emailOptions.headers ?? {};
    const headerLines = Object.entries(customHeaders).map(([key, value]) => `${key}: ${value}`);

    // Determine content type and body
    const hasHtml = !!emailOptions.html;
    const text = emailOptions.text ?? 'Test email body';
    const html = emailOptions.html;

    let body: string;
    let contentTypeHeader: string;

    if (hasHtml) {
      // Multipart email with both text and HTML
      const boundary = `----=_Part_${Date.now()}`;
      contentTypeHeader = `multipart/alternative; boundary="${boundary}"`;
      body = [
        `--${boundary}`,
        'Content-Type: text/plain; charset="utf-8"',
        '',
        text,
        `--${boundary}`,
        'Content-Type: text/html; charset="utf-8"',
        '',
        html,
        `--${boundary}--`,
      ].join('\r\n');
    } else {
      contentTypeHeader = 'text/plain; charset="utf-8"';
      body = text;
    }

    const from = emailOptions.from ?? 'sender@vaultsandbox.test';
    const subject = emailOptions.subject ?? 'Test filter email';

    const rawEmail = [
      `From: ${from}`,
      `To: ${inbox.emailAddress}`,
      `Subject: ${subject}`,
      `Message-ID: <filter-test-${Date.now()}@vaultsandbox.test>`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      `Content-Type: ${contentTypeHeader}`,
      ...headerLines,
      '',
      body,
      '',
    ].join('\r\n');

    await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
      from,
      to: [inbox.emailAddress],
    });

    return {
      inboxEmail: inbox.emailAddress,
      webhookId: webhookResponse.body.id,
    };
  }

  // Helper to verify webhook was NOT called (wait a short time)
  async function expectNoWebhookDelivery(waitMs = 2000): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    expect(webhookServer.getRequests()).toHaveLength(0);
  }

  // ============================================
  // Filter Matching Tests - Subject Field
  // ============================================

  describe('Filter by subject field', () => {
    it('should match subject with equals operator', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'subject', operator: 'equals', value: 'Important Notice' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { subject: 'Important Notice' });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);

      const payload = JSON.parse(requests[0].body);
      expect(payload.data.subject).toBe('Important Notice');
    });

    it('should NOT match subject with equals when different', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'subject', operator: 'equals', value: 'Important Notice' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { subject: 'Different Subject' });

      await expectNoWebhookDelivery();
    });

    it('should match subject with contains operator', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'subject', operator: 'contains', value: 'urgent' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { subject: 'This is an urgent matter' });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should match subject with starts_with operator', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'subject', operator: 'starts_with', value: '[ALERT]' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { subject: '[ALERT] Server down' });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should NOT match subject with starts_with when not at start', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'subject', operator: 'starts_with', value: '[ALERT]' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { subject: 'Notice: [ALERT] Something' });

      await expectNoWebhookDelivery();
    });

    it('should match subject with ends_with operator', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'subject', operator: 'ends_with', value: '(ACTION REQUIRED)' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { subject: 'Please review (ACTION REQUIRED)' });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });
  });

  // ============================================
  // Filter Matching Tests - From Field
  // ============================================

  describe('Filter by from.address field', () => {
    it('should match from.address with equals operator', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'from.address', operator: 'equals', value: 'alerts@example.com' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { from: 'alerts@example.com' });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);

      const payload = JSON.parse(requests[0].body);
      expect(payload.data.from.address).toBe('alerts@example.com');
    });

    it('should NOT match from.address with equals when different', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'from.address', operator: 'equals', value: 'alerts@example.com' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { from: 'other@example.com' });

      await expectNoWebhookDelivery();
    });

    it('should match from.address with domain operator', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'from.address', operator: 'domain', value: 'example.com' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { from: 'user@example.com' });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should match from.address with domain operator including subdomain', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'from.address', operator: 'domain', value: 'example.com' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { from: 'user@sub.example.com' });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should NOT match from.address with domain when different domain', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'from.address', operator: 'domain', value: 'example.com' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { from: 'user@otherdomain.com' });

      await expectNoWebhookDelivery();
    });
  });

  // ============================================
  // Filter Matching Tests - To Field
  // ============================================

  describe('Filter by to.address field', () => {
    it('should match to.address with contains operator', async () => {
      // Note: to.address is the inbox address which is auto-generated
      // We test that the filter works by using contains on the domain
      const filter: FilterConfigBody = {
        rules: [{ field: 'to.address', operator: 'contains', value: '@' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, {});

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });
  });

  // ============================================
  // Filter Matching Tests - Body Field
  // ============================================

  describe('Filter by body.text field', () => {
    it('should match body.text with contains operator', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'body.text', operator: 'contains', value: 'secret code: ABC123' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, {
        text: 'Hello, your secret code: ABC123 is ready.',
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should NOT match body.text when content not present', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'body.text', operator: 'contains', value: 'secret code: ABC123' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, {
        text: 'Hello, this is a different message.',
      });

      await expectNoWebhookDelivery();
    });
  });

  // ============================================
  // Filter Matching Tests - Header Fields
  // ============================================

  describe('Filter by header.* fields', () => {
    it('should match custom header with equals operator', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'header.x-custom-header', operator: 'equals', value: 'special-value' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, {
        headers: { 'X-Custom-Header': 'special-value' },
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should match header with contains operator', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'header.x-github-event', operator: 'equals', value: 'push' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, {
        headers: { 'X-GitHub-Event': 'push' },
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should NOT match header when value different', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'header.x-priority', operator: 'equals', value: 'high' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, {
        headers: { 'X-Priority': 'low' },
      });

      await expectNoWebhookDelivery();
    });
  });

  // ============================================
  // Filter Matching Tests - Regex Operator
  // ============================================

  describe('Filter with regex operator', () => {
    it('should match subject with regex pattern', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'subject', operator: 'regex', value: '^\\[TICKET-\\d+\\]' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { subject: '[TICKET-12345] New issue created' });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should NOT match when regex does not match', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'subject', operator: 'regex', value: '^\\[TICKET-\\d+\\]' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { subject: 'Regular subject without ticket' });

      await expectNoWebhookDelivery();
    });

    it('should match from.address with regex for multiple domains', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'from.address', operator: 'regex', value: '@(alerts|notifications)\\.example\\.com$' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { from: 'system@alerts.example.com' });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should match body.text with regex pattern', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'body.text', operator: 'regex', value: 'order\\s+#\\d{6}' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, {
        text: 'Your order #123456 has been shipped.',
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });
  });

  // ============================================
  // Filter Matching Tests - Exists Operator
  // ============================================

  describe('Filter with exists operator', () => {
    it('should match when header exists', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'header.x-special-marker', operator: 'exists', value: '' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, {
        headers: { 'X-Special-Marker': 'any-value' },
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should NOT match when header does not exist', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'header.x-special-marker', operator: 'exists', value: '' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, {
        headers: { 'X-Other-Header': 'value' },
      });

      await expectNoWebhookDelivery();
    });

    it('should match when subject field exists', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'subject', operator: 'exists', value: '' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { subject: 'Any subject' });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });
  });

  // ============================================
  // Filter Modes Tests
  // ============================================

  describe('Filter modes', () => {
    it('should match with mode=all when ALL rules match (AND logic)', async () => {
      const filter: FilterConfigBody = {
        rules: [
          { field: 'subject', operator: 'contains', value: 'URGENT' },
          { field: 'from.address', operator: 'domain', value: 'example.com' },
        ],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, {
        subject: 'URGENT: Server Alert',
        from: 'alerts@example.com',
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should NOT match with mode=all when only some rules match', async () => {
      const filter: FilterConfigBody = {
        rules: [
          { field: 'subject', operator: 'contains', value: 'URGENT' },
          { field: 'from.address', operator: 'domain', value: 'example.com' },
        ],
        mode: 'all',
      };

      // Subject matches but domain doesn't
      await setupWebhookWithFilterAndSendEmail(filter, {
        subject: 'URGENT: Server Alert',
        from: 'alerts@otherdomain.com',
      });

      await expectNoWebhookDelivery();
    });

    it('should match with mode=any when ANY rule matches (OR logic)', async () => {
      const filter: FilterConfigBody = {
        rules: [
          { field: 'subject', operator: 'contains', value: 'URGENT' },
          { field: 'from.address', operator: 'domain', value: 'important.com' },
        ],
        mode: 'any',
      };

      // Only subject matches, but that's enough for 'any' mode
      await setupWebhookWithFilterAndSendEmail(filter, {
        subject: 'URGENT: Please review',
        from: 'user@otherdomain.com',
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should NOT match with mode=any when NO rules match', async () => {
      const filter: FilterConfigBody = {
        rules: [
          { field: 'subject', operator: 'contains', value: 'URGENT' },
          { field: 'from.address', operator: 'domain', value: 'important.com' },
        ],
        mode: 'any',
      };

      // Neither rule matches
      await setupWebhookWithFilterAndSendEmail(filter, {
        subject: 'Regular update',
        from: 'user@otherdomain.com',
      });

      await expectNoWebhookDelivery();
    });

    it('should match with mode=any when second rule matches', async () => {
      const filter: FilterConfigBody = {
        rules: [
          { field: 'subject', operator: 'contains', value: 'URGENT' },
          { field: 'from.address', operator: 'domain', value: 'important.com' },
        ],
        mode: 'any',
      };

      // Only domain matches
      await setupWebhookWithFilterAndSendEmail(filter, {
        subject: 'Regular update',
        from: 'user@important.com',
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });
  });

  // ============================================
  // Filter Behavior Tests
  // ============================================

  describe('Filter behavior', () => {
    it('should prevent delivery when filter does not match', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'subject', operator: 'equals', value: 'EXACT MATCH REQUIRED' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { subject: 'Different subject entirely' });

      await expectNoWebhookDelivery();
    });

    it('should allow delivery when no filter is configured', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create webhook WITHOUT filter
      await apiClient
        .createGlobalWebhook({
          url: `${webhookUrl}/webhook`,
          events: ['email.received'],
        })
        .expect(201);

      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Any subject',
        `Message-ID: <no-filter-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Any content',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should allow delivery when filter has empty rules array', async () => {
      const filter: FilterConfigBody = {
        rules: [],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { subject: 'Any subject' });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });
  });

  // ============================================
  // Case Sensitivity Tests
  // ============================================

  describe('Case sensitivity', () => {
    it('should match case-insensitively by default', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'subject', operator: 'contains', value: 'URGENT' }],
        mode: 'all',
      };

      // Email has lowercase "urgent"
      await setupWebhookWithFilterAndSendEmail(filter, { subject: 'This is urgent' });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should match case-sensitively when caseSensitive=true', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'subject', operator: 'contains', value: 'URGENT', caseSensitive: true }],
        mode: 'all',
      };

      // Email has uppercase "URGENT"
      await setupWebhookWithFilterAndSendEmail(filter, { subject: 'This is URGENT' });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should NOT match when case differs with caseSensitive=true', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'subject', operator: 'contains', value: 'URGENT', caseSensitive: true }],
        mode: 'all',
      };

      // Email has lowercase "urgent" but filter expects uppercase
      await setupWebhookWithFilterAndSendEmail(filter, { subject: 'This is urgent' });

      await expectNoWebhookDelivery();
    });

    it('should handle case-insensitive equals correctly', async () => {
      const filter: FilterConfigBody = {
        rules: [{ field: 'subject', operator: 'equals', value: 'Hello World', caseSensitive: false }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { subject: 'HELLO WORLD' });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should handle case-sensitive domain matching', async () => {
      // Domain matching should be case-insensitive even with caseSensitive flag
      // since email domains are case-insensitive by RFC
      const filter: FilterConfigBody = {
        rules: [{ field: 'from.address', operator: 'domain', value: 'EXAMPLE.COM' }],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, { from: 'user@example.com' });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });
  });

  // ============================================
  // Complex Filter Scenarios
  // ============================================

  describe('Complex filter scenarios', () => {
    it('should handle multiple rules with different operators', async () => {
      const filter: FilterConfigBody = {
        rules: [
          { field: 'subject', operator: 'starts_with', value: '[JIRA]' },
          { field: 'from.address', operator: 'domain', value: 'atlassian.net' },
          { field: 'body.text', operator: 'contains', value: 'assigned to you' },
        ],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, {
        subject: '[JIRA] PROJ-123 has been assigned to you',
        from: 'jira@atlassian.net',
        text: 'Issue PROJ-123 has been assigned to you. Please review.',
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should handle filter with header and body rules combined', async () => {
      const filter: FilterConfigBody = {
        rules: [
          { field: 'header.x-mailer', operator: 'contains', value: 'Postfix' },
          { field: 'body.text', operator: 'regex', value: 'confirmation\\s+code:\\s+\\d{6}' },
        ],
        mode: 'all',
      };

      await setupWebhookWithFilterAndSendEmail(filter, {
        text: 'Your confirmation code: 123456 is valid for 10 minutes.',
        headers: { 'X-Mailer': 'Postfix (Ubuntu)' },
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
    });

    it('should not deliver when one of many rules fails in all mode', async () => {
      const filter: FilterConfigBody = {
        rules: [
          { field: 'subject', operator: 'contains', value: 'Invoice' },
          { field: 'from.address', operator: 'domain', value: 'billing.example.com' },
          { field: 'header.x-priority', operator: 'equals', value: 'high' },
        ],
        mode: 'all',
      };

      // Missing the X-Priority header
      await setupWebhookWithFilterAndSendEmail(filter, {
        subject: 'Invoice #12345',
        from: 'noreply@billing.example.com',
        // No X-Priority header
      });

      await expectNoWebhookDelivery();
    });
  });

  // ============================================
  // Filtered vs Unfiltered Webhooks
  // ============================================

  describe('Filtered vs unfiltered webhooks', () => {
    it('should deliver to unfiltered webhook but not filtered one for non-matching email', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create filtered webhook
      await apiClient
        .createGlobalWebhook({
          url: `${webhookUrl}/filtered`,
          events: ['email.received'],
          filter: {
            rules: [{ field: 'subject', operator: 'contains', value: 'SPECIAL' }],
            mode: 'all',
          },
        })
        .expect(201);

      // Create unfiltered webhook
      await apiClient
        .createGlobalWebhook({
          url: `${webhookUrl}/unfiltered`,
          events: ['email.received'],
        })
        .expect(201);

      // Send email that doesn't match the filter
      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Regular email',
        `Message-ID: <mixed-filter-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Normal content',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      // Only unfiltered webhook should receive
      const requests = await webhookServer.waitForRequests(1, 10000);
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe('/unfiltered');

      // Wait to ensure filtered webhook doesn't fire
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(webhookServer.getRequests()).toHaveLength(1);
    });

    it('should deliver to both webhooks when email matches filter', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create filtered webhook
      await apiClient
        .createGlobalWebhook({
          url: `${webhookUrl}/filtered`,
          events: ['email.received'],
          filter: {
            rules: [{ field: 'subject', operator: 'contains', value: 'SPECIAL' }],
            mode: 'all',
          },
        })
        .expect(201);

      // Create unfiltered webhook
      await apiClient
        .createGlobalWebhook({
          url: `${webhookUrl}/unfiltered`,
          events: ['email.received'],
        })
        .expect(201);

      // Send email that DOES match the filter
      const rawEmail = [
        'From: sender@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: SPECIAL announcement',
        `Message-ID: <both-filter-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Special content',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'sender@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      // Both webhooks should receive
      const requests = await webhookServer.waitForRequests(2, 10000);
      expect(requests).toHaveLength(2);

      const urls = requests.map((r) => r.url);
      expect(urls).toContain('/filtered');
      expect(urls).toContain('/unfiltered');
    });
  });
});
