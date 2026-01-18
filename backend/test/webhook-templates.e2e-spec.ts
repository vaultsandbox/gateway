import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient, CreateWebhookBody, CustomTemplateBody } from './helpers/api-client';
import { createSmtpClient, SmtpTestClient } from './helpers/smtp-client';
import { generateClientKeypair } from './helpers/crypto-client';
import { createTestInbox } from './helpers/assertions';
import { MockWebhookServer, createMockWebhookServer } from './helpers/webhook-server';

describe('Webhook Templates E2E', () => {
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

  // Helper to create a webhook with a template and send an email
  async function setupWebhookWithTemplateAndSendEmail(
    template: string | CustomTemplateBody,
    emailOptions: { subject?: string; text?: string; from?: string } = {},
  ): Promise<{ inboxEmail: string; webhookId: string }> {
    const keypair = generateClientKeypair();
    const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

    const webhookData: CreateWebhookBody = {
      url: `${webhookUrl}/webhook`,
      events: ['email.received'],
      template,
    };

    const webhookResponse = await apiClient.createGlobalWebhook(webhookData).expect(201);

    // Build and send email
    const from = emailOptions.from ?? 'sender@vaultsandbox.test';
    const subject = emailOptions.subject ?? 'Test template email';
    const text = emailOptions.text ?? 'Test email body for template testing';

    const rawEmail = [
      `From: Sender Name <${from}>`,
      `To: ${inbox.emailAddress}`,
      `Subject: ${subject}`,
      `Message-ID: <template-test-${Date.now()}@vaultsandbox.test>`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      text,
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

  // ============================================
  // Built-in Templates Tests
  // ============================================

  describe('Built-in Templates', () => {
    describe('default template', () => {
      it('should send full event structure with default template', async () => {
        await setupWebhookWithTemplateAndSendEmail('default');

        const requests = await webhookServer.waitForRequests(1, 10000);
        const payload = JSON.parse(requests[0].body);

        // Default template should include full event structure
        expect(payload).toMatchObject({
          id: expect.stringMatching(/^evt_/),
          object: 'event',
          createdAt: expect.any(Number),
          type: 'email.received',
          data: expect.objectContaining({
            id: expect.any(String),
            inboxEmail: expect.stringMatching(/@/),
            from: expect.objectContaining({ address: expect.any(String) }),
            subject: expect.any(String),
          }),
        });
      });

      it('should send default template when no template specified', async () => {
        const keypair = generateClientKeypair();
        const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

        // Create webhook without template
        await apiClient
          .createGlobalWebhook({
            url: `${webhookUrl}/webhook`,
            events: ['email.received'],
          })
          .expect(201);

        const rawEmail = [
          'From: sender@vaultsandbox.test',
          `To: ${inbox.emailAddress}`,
          'Subject: No template test',
          `Message-ID: <no-template-${Date.now()}@vaultsandbox.test>`,
          `Date: ${new Date().toUTCString()}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset="utf-8"',
          '',
          'Testing default template behavior.',
          '',
        ].join('\r\n');

        await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
          from: 'sender@vaultsandbox.test',
          to: [inbox.emailAddress],
        });

        const requests = await webhookServer.waitForRequests(1, 10000);
        const payload = JSON.parse(requests[0].body);

        // Should have full event structure (same as default)
        expect(payload.id).toMatch(/^evt_/);
        expect(payload.object).toBe('event');
        expect(payload.type).toBe('email.received');
        expect(payload.data).toBeDefined();
      });
    });

    describe('slack template', () => {
      it('should produce valid Slack payload structure', async () => {
        await setupWebhookWithTemplateAndSendEmail('slack', {
          subject: 'Slack template test subject',
          from: 'slacktest@vaultsandbox.test',
        });

        const requests = await webhookServer.waitForRequests(1, 10000);
        const payload = JSON.parse(requests[0].body);

        // Slack format: text and blocks array
        expect(payload.text).toBeDefined();
        expect(payload.text).toContain('slacktest@vaultsandbox.test');
        expect(payload.blocks).toBeInstanceOf(Array);

        // Verify block structure
        const headerBlock = payload.blocks.find((b: { type: string }) => b.type === 'header');
        expect(headerBlock).toBeDefined();
        expect(headerBlock.text.type).toBe('plain_text');
        expect(headerBlock.text.text).toBe('New Email Received');

        // Verify section fields
        const sectionBlocks = payload.blocks.filter((b: { type: string }) => b.type === 'section');
        expect(sectionBlocks.length).toBeGreaterThan(0);

        // Check that subject is included
        const subjectSection = sectionBlocks.find((b: { text?: { text: string } }) =>
          b.text?.text?.includes('Slack template test subject'),
        );
        expect(subjectSection).toBeDefined();
      });

      it('should include from address in Slack payload', async () => {
        await setupWebhookWithTemplateAndSendEmail('slack', {
          from: 'john.doe@example.com',
        });

        const requests = await webhookServer.waitForRequests(1, 10000);
        const payload = JSON.parse(requests[0].body);

        expect(payload.text).toContain('john.doe@example.com');
      });
    });

    describe('discord template', () => {
      it('should produce valid Discord embed payload structure', async () => {
        await setupWebhookWithTemplateAndSendEmail('discord', {
          subject: 'Discord template test',
          from: 'discordtest@vaultsandbox.test',
        });

        const requests = await webhookServer.waitForRequests(1, 10000);
        const payload = JSON.parse(requests[0].body);

        // Discord format: content and embeds array
        expect(payload.content).toBeDefined();
        expect(payload.embeds).toBeInstanceOf(Array);
        expect(payload.embeds.length).toBe(1);

        const embed = payload.embeds[0];
        expect(embed.title).toBe('Discord template test');
        expect(embed.color).toBe(5814783);
        expect(embed.fields).toBeInstanceOf(Array);

        // Verify fields
        const fromField = embed.fields.find((f: { name: string }) => f.name === 'From');
        expect(fromField).toBeDefined();
        expect(fromField.value).toBe('discordtest@vaultsandbox.test');

        const toField = embed.fields.find((f: { name: string }) => f.name === 'To');
        expect(toField).toBeDefined();

        // Verify footer
        expect(embed.footer).toBeDefined();
        expect(embed.footer.text).toContain('VaultSandbox');
        expect(embed.footer.text).toContain('email.received');

        // Verify timestamp
        expect(embed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });
    });

    describe('teams template', () => {
      it('should produce valid Microsoft Teams MessageCard payload', async () => {
        await setupWebhookWithTemplateAndSendEmail('teams', {
          subject: 'Teams template test',
          from: 'teamstest@vaultsandbox.test',
        });

        const requests = await webhookServer.waitForRequests(1, 10000);
        const payload = JSON.parse(requests[0].body);

        // Teams MessageCard format
        expect(payload['@type']).toBe('MessageCard');
        expect(payload['@context']).toBe('http://schema.org/extensions');
        expect(payload.themeColor).toBe('0076D7');
        expect(payload.summary).toContain('teamstest@vaultsandbox.test');

        // Verify sections
        expect(payload.sections).toBeInstanceOf(Array);
        expect(payload.sections.length).toBe(1);

        const section = payload.sections[0];
        expect(section.activityTitle).toBe('New Email Received');
        expect(section.facts).toBeInstanceOf(Array);

        // Verify facts
        const fromFact = section.facts.find((f: { name: string }) => f.name === 'From');
        expect(fromFact).toBeDefined();
        expect(fromFact.value).toBe('teamstest@vaultsandbox.test');

        const subjectFact = section.facts.find((f: { name: string }) => f.name === 'Subject');
        expect(subjectFact).toBeDefined();
        expect(subjectFact.value).toBe('Teams template test');
      });
    });

    describe('simple template', () => {
      it('should produce minimal payload with key fields only', async () => {
        await setupWebhookWithTemplateAndSendEmail('simple', {
          subject: 'Simple template subject',
          from: 'simple@vaultsandbox.test',
          text: 'Preview text content here',
        });

        const requests = await webhookServer.waitForRequests(1, 10000);
        const payload = JSON.parse(requests[0].body);

        // Simple template: only from, to, subject, preview
        expect(payload.from).toBe('simple@vaultsandbox.test');
        expect(payload.to).toMatch(/@/);
        expect(payload.subject).toBe('Simple template subject');
        expect(payload.preview).toBeDefined();

        // Should NOT have full event structure
        expect(payload.id).toBeUndefined();
        expect(payload.object).toBeUndefined();
        expect(payload.type).toBeUndefined();
        expect(payload.data).toBeUndefined();
      });
    });

    describe('notification template', () => {
      it('should produce single text message payload', async () => {
        await setupWebhookWithTemplateAndSendEmail('notification', {
          subject: 'Notification subject',
          from: 'notify@vaultsandbox.test',
        });

        const requests = await webhookServer.waitForRequests(1, 10000);
        const payload = JSON.parse(requests[0].body);

        // Notification template: just a text field
        expect(payload.text).toBeDefined();
        expect(payload.text).toContain('notify@vaultsandbox.test');
        expect(payload.text).toContain('Notification subject');

        // Should be a simple object with just text
        expect(Object.keys(payload)).toEqual(['text']);
      });
    });

    describe('zapier template', () => {
      it('should produce automation-friendly flat payload structure', async () => {
        await setupWebhookWithTemplateAndSendEmail('zapier', {
          subject: 'Zapier automation test',
          from: 'zapier@vaultsandbox.test',
        });

        const requests = await webhookServer.waitForRequests(1, 10000);
        const payload = JSON.parse(requests[0].body);

        // Zapier template: flat structure for automation platforms
        expect(payload.event).toBe('email.received');
        expect(payload.email_id).toBeDefined();
        expect(payload.inbox).toMatch(/@/);
        expect(payload.from_address).toBe('zapier@vaultsandbox.test');
        expect(payload.from_name).toBeDefined();
        expect(payload.subject).toBe('Zapier automation test');
        expect(payload.preview).toBeDefined();
        expect(payload.received_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        // Should NOT have nested structures
        expect(payload.data).toBeUndefined();
        expect(payload.from).toBeUndefined();
      });
    });
  });

  // ============================================
  // Custom Templates Tests
  // ============================================

  describe('Custom Templates', () => {
    it('should apply custom body template with placeholders', async () => {
      const customTemplate: CustomTemplateBody = {
        type: 'custom',
        body: JSON.stringify({
          myEvent: '{{type}}',
          sender: '{{data.from.address}}',
          recipient: '{{data.inboxEmail}}',
          title: '{{data.subject}}',
        }),
      };

      await setupWebhookWithTemplateAndSendEmail(customTemplate, {
        subject: 'Custom template subject',
        from: 'custom@vaultsandbox.test',
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      const payload = JSON.parse(requests[0].body);

      expect(payload.myEvent).toBe('email.received');
      expect(payload.sender).toBe('custom@vaultsandbox.test');
      expect(payload.recipient).toMatch(/@/);
      expect(payload.title).toBe('Custom template subject');
    });

    it('should support nested placeholder paths', async () => {
      const customTemplate: CustomTemplateBody = {
        type: 'custom',
        body: JSON.stringify({
          fromAddress: '{{data.from.address}}',
          fromName: '{{data.from.name}}',
          eventId: '{{id}}',
          eventType: '{{type}}',
          timestamp: '{{timestamp}}',
        }),
      };

      await setupWebhookWithTemplateAndSendEmail(customTemplate, {
        from: 'nested@vaultsandbox.test',
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      const payload = JSON.parse(requests[0].body);

      expect(payload.fromAddress).toBe('nested@vaultsandbox.test');
      expect(payload.fromName).toBeDefined();
      expect(payload.eventId).toMatch(/^evt_/);
      expect(payload.eventType).toBe('email.received');
      expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should handle missing placeholder values gracefully (empty string)', async () => {
      const customTemplate: CustomTemplateBody = {
        type: 'custom',
        body: JSON.stringify({
          existing: '{{data.subject}}',
          missing: '{{data.nonexistent.field}}',
          deepMissing: '{{data.a.b.c.d}}',
        }),
      };

      await setupWebhookWithTemplateAndSendEmail(customTemplate, {
        subject: 'Existing value',
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      const payload = JSON.parse(requests[0].body);

      expect(payload.existing).toBe('Existing value');
      expect(payload.missing).toBe('');
      expect(payload.deepMissing).toBe('');
    });

    it('should escape special characters in values for valid JSON', async () => {
      const customTemplate: CustomTemplateBody = {
        type: 'custom',
        body: JSON.stringify({
          subject: '{{data.subject}}',
        }),
      };

      await setupWebhookWithTemplateAndSendEmail(customTemplate, {
        subject: 'Subject with "quotes" and \\backslash and\nnewline',
      });

      const requests = await webhookServer.waitForRequests(1, 10000);

      // Should produce valid JSON
      expect(() => JSON.parse(requests[0].body)).not.toThrow();
      const payload = JSON.parse(requests[0].body);

      expect(payload.subject).toContain('"quotes"');
      expect(payload.subject).toContain('\\backslash');
    });

    it('should reject invalid custom template (non-JSON structure)', async () => {
      const invalidTemplate: CustomTemplateBody = {
        type: 'custom',
        body: 'this is not valid JSON {{{',
      };

      const keypair = generateClientKeypair();
      await createTestInbox(apiClient, keypair.publicKeyB64);

      const response = await apiClient.createGlobalWebhook({
        url: `${webhookUrl}/webhook`,
        events: ['email.received'],
        template: invalidTemplate,
      });

      expect(response.status).toBe(400);
    });

    it('should reject template body exceeding size limit', async () => {
      const largeTemplate: CustomTemplateBody = {
        type: 'custom',
        body: '{"data": "' + 'x'.repeat(11000) + '"}',
      };

      const keypair = generateClientKeypair();
      await createTestInbox(apiClient, keypair.publicKeyB64);

      const response = await apiClient.createGlobalWebhook({
        url: `${webhookUrl}/webhook`,
        events: ['email.received'],
        template: largeTemplate,
      });

      expect(response.status).toBe(400);
    });

    it('should allow updating webhook with different template', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create with default template
      const webhook = await apiClient
        .createGlobalWebhook({
          url: `${webhookUrl}/webhook`,
          events: ['email.received'],
          template: 'default',
        })
        .expect(201);

      // Update to slack template
      await apiClient.updateGlobalWebhook(webhook.body.id, { template: 'slack' }).expect(200);

      // Send email and verify slack format
      const rawEmail = [
        'From: update@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Updated template test',
        `Message-ID: <update-template-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Testing template update.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'update@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      const payload = JSON.parse(requests[0].body);

      // Should be slack format now
      expect(payload.blocks).toBeInstanceOf(Array);
    });

    it('should allow removing template (reset to default)', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      // Create with slack template
      const webhook = await apiClient
        .createGlobalWebhook({
          url: `${webhookUrl}/webhook`,
          events: ['email.received'],
          template: 'slack',
        })
        .expect(201);

      // Remove template (set to null)
      await apiClient.updateGlobalWebhook(webhook.body.id, { template: null }).expect(200);

      // Send email and verify default format
      const rawEmail = [
        'From: remove@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Removed template test',
        `Message-ID: <remove-template-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Testing template removal.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'remove@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      const payload = JSON.parse(requests[0].body);

      // Should be default format now (has id, object, type, data)
      expect(payload.id).toMatch(/^evt_/);
      expect(payload.object).toBe('event');
      expect(payload.type).toBe('email.received');
    });
  });

  // ============================================
  // Templates Endpoint Tests
  // ============================================

  describe('Templates Endpoint', () => {
    it('should return all built-in templates from GET /webhooks/templates', async () => {
      const response = await apiClient.getWebhookTemplates().expect(200);

      expect(response.body.templates).toBeInstanceOf(Array);
      expect(response.body.templates.length).toBeGreaterThanOrEqual(7);

      const templateValues = response.body.templates.map((t: { value: string }) => t.value);
      expect(templateValues).toContain('default');
      expect(templateValues).toContain('slack');
      expect(templateValues).toContain('discord');
      expect(templateValues).toContain('teams');
      expect(templateValues).toContain('simple');
      expect(templateValues).toContain('notification');
      expect(templateValues).toContain('zapier');
    });

    it('should include labels for each template', async () => {
      const response = await apiClient.getWebhookTemplates().expect(200);

      for (const template of response.body.templates) {
        expect(template).toMatchObject({
          label: expect.any(String),
          value: expect.any(String),
        });
        expect(template.label.length).toBeGreaterThan(0);
      }
    });

    it('should return descriptive labels for templates', async () => {
      const response = await apiClient.getWebhookTemplates().expect(200);

      const templateMap = new Map(
        response.body.templates.map((t: { value: string; label: string }) => [t.value, t.label]),
      );

      // Verify some expected labels
      expect(templateMap.get('default')).toContain('Default');
      expect(templateMap.get('slack')).toContain('Slack');
      expect(templateMap.get('discord')).toContain('Discord');
      expect(templateMap.get('teams')).toContain('Teams');
    });
  });

  // ============================================
  // Template Error Handling Tests
  // ============================================

  describe('Template Error Handling', () => {
    it('should reject unknown built-in template name', async () => {
      const keypair = generateClientKeypair();
      await createTestInbox(apiClient, keypair.publicKeyB64);

      const response = await apiClient.createGlobalWebhook({
        url: `${webhookUrl}/webhook`,
        events: ['email.received'],
        template: 'nonexistent-template',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('nonexistent-template');
    });

    it('should reject custom template without body', async () => {
      const invalidTemplate = {
        type: 'custom',
        // body missing
      } as unknown as CustomTemplateBody;

      const keypair = generateClientKeypair();
      await createTestInbox(apiClient, keypair.publicKeyB64);

      const response = await apiClient.createGlobalWebhook({
        url: `${webhookUrl}/webhook`,
        events: ['email.received'],
        template: invalidTemplate,
      });

      expect(response.status).toBe(400);
    });
  });

  // ============================================
  // Template with Different Event Types Tests
  // ============================================

  describe('Templates with Different Event Types', () => {
    it('should apply template to email.stored events', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

      await apiClient
        .createGlobalWebhook({
          url: `${webhookUrl}/webhook`,
          events: ['email.stored'],
          template: 'simple',
        })
        .expect(201);

      const rawEmail = [
        'From: stored@vaultsandbox.test',
        `To: ${inbox.emailAddress}`,
        'Subject: Stored event template test',
        `Message-ID: <stored-template-${Date.now()}@vaultsandbox.test>`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'Testing template with stored event.',
        '',
      ].join('\r\n');

      await smtpClient.sendRawEmail(Buffer.from(rawEmail, 'utf-8'), {
        from: 'stored@vaultsandbox.test',
        to: [inbox.emailAddress],
      });

      const requests = await webhookServer.waitForRequests(1, 10000);
      const payload = JSON.parse(requests[0].body);

      // email.stored has different data structure, some fields may be empty
      expect(payload.to).toBeDefined();
    });
  });
});
