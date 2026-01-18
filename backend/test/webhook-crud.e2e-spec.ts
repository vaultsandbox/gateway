import { useTestAppLifecycle } from './helpers/test-app';
import { ApiClient, createApiClient, CreateWebhookBody } from './helpers/api-client';
import { generateClientKeypair } from './helpers/crypto-client';
import { createTestInbox } from './helpers/assertions';

describe('Webhook CRUD Operations', () => {
  const appLifecycle = useTestAppLifecycle();
  let apiClient: ApiClient;

  // Valid test webhook data - uses HTTP which is allowed in test environment
  const validWebhookData: CreateWebhookBody = {
    url: 'http://localhost:9999/webhook',
    events: ['email.received'],
  };

  beforeAll(() => {
    apiClient = createApiClient(appLifecycle.httpServer);
  });

  // ============================================
  // Global Webhook Tests
  // ============================================

  describe('Global Webhooks', () => {
    describe('Create', () => {
      it('should create global webhook with valid data', async () => {
        const response = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

        expect(response.body).toMatchObject({
          id: expect.stringMatching(/^whk_/),
          url: validWebhookData.url,
          events: validWebhookData.events,
          scope: 'global',
          enabled: true,
          secret: expect.stringMatching(/^whsec_/),
          createdAt: expect.any(String),
        });
        expect(response.body.stats).toEqual({
          totalDeliveries: 0,
          successfulDeliveries: 0,
          failedDeliveries: 0,
        });
      });

      it('should create global webhook with all optional fields', async () => {
        const webhookData: CreateWebhookBody = {
          url: 'http://localhost:9999/webhook',
          events: ['email.received', 'email.stored'],
          template: 'slack',
          filter: {
            mode: 'all',
            rules: [{ field: 'from.address', operator: 'contains', value: 'test' }],
          },
          description: 'Test webhook with all fields',
        };

        const response = await apiClient.createGlobalWebhook(webhookData).expect(201);

        expect(response.body).toMatchObject({
          url: webhookData.url,
          events: webhookData.events,
          template: 'slack',
          filter: expect.objectContaining({
            mode: 'all',
            rules: expect.arrayContaining([
              expect.objectContaining({
                field: 'from.address',
                operator: 'contains',
                value: 'test',
              }),
            ]),
          }),
          description: webhookData.description,
        });
      });

      it('should create global webhook with custom template', async () => {
        const webhookData: CreateWebhookBody = {
          url: 'http://localhost:9999/webhook',
          events: ['email.received'],
          template: {
            type: 'custom',
            body: '{"text": "Email from {{data.from.address}}"}',
            contentType: 'application/json',
          },
        };

        const response = await apiClient.createGlobalWebhook(webhookData).expect(201);

        expect(response.body.template).toEqual({
          type: 'custom',
          body: '{"text": "Email from {{data.from.address}}"}',
          contentType: 'application/json',
        });
      });

      it('should create global webhook with filter rules', async () => {
        const webhookData: CreateWebhookBody = {
          url: 'http://localhost:9999/webhook',
          events: ['email.received'],
          filter: {
            mode: 'any',
            rules: [
              { field: 'subject', operator: 'contains', value: 'urgent' },
              { field: 'from.address', operator: 'domain', value: 'example.com' },
            ],
            requireAuth: true,
          },
        };

        const response = await apiClient.createGlobalWebhook(webhookData).expect(201);

        expect(response.body.filter).toMatchObject({
          mode: 'any',
          requireAuth: true,
          rules: expect.arrayContaining([
            expect.objectContaining({ field: 'subject', operator: 'contains', value: 'urgent' }),
            expect.objectContaining({ field: 'from.address', operator: 'domain', value: 'example.com' }),
          ]),
        });
      });

      it('should fail to create with invalid event types', async () => {
        const response = await apiClient
          .createGlobalWebhook({
            url: 'http://localhost:9999/webhook',
            events: ['invalid.event' as any],
          })
          .expect(400);

        expect(response.body.message).toContain('Invalid event types');
      });

      it('should fail to create with empty events array', async () => {
        const response = await apiClient
          .createGlobalWebhook({
            url: 'http://localhost:9999/webhook',
            events: [],
          })
          .expect(400);

        expect(response.body.message).toBeDefined();
      });

      it('should allow duplicate webhook URLs', async () => {
        await apiClient.createGlobalWebhook(validWebhookData).expect(201);
        const response = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

        expect(response.body.url).toBe(validWebhookData.url);
      });

      it('should handle very long URLs correctly', async () => {
        const longPath = 'a'.repeat(1500);
        const response = await apiClient
          .createGlobalWebhook({
            url: `http://localhost:9999/${longPath}`,
            events: ['email.received'],
          })
          .expect(201);

        expect(response.body.url).toContain(longPath);
      });
    });

    describe('List', () => {
      it('should return empty list when no webhooks exist', async () => {
        const response = await apiClient.listGlobalWebhooks().expect(200);

        expect(response.body).toEqual({
          webhooks: [],
          total: 0,
        });
      });

      it('should list single webhook', async () => {
        await apiClient.createGlobalWebhook(validWebhookData).expect(201);

        const response = await apiClient.listGlobalWebhooks().expect(200);

        expect(response.body.total).toBe(1);
        expect(response.body.webhooks).toHaveLength(1);
        expect(response.body.webhooks[0].url).toBe(validWebhookData.url);
        // Secret should not be included in list
        expect(response.body.webhooks[0].secret).toBeUndefined();
      });

      it('should list multiple webhooks', async () => {
        await apiClient.createGlobalWebhook(validWebhookData).expect(201);
        await apiClient
          .createGlobalWebhook({
            url: 'http://localhost:9998/webhook',
            events: ['email.stored'],
          })
          .expect(201);

        const response = await apiClient.listGlobalWebhooks().expect(200);

        expect(response.body.total).toBe(2);
        expect(response.body.webhooks).toHaveLength(2);
      });
    });

    describe('Get', () => {
      it('should get single global webhook by ID', async () => {
        const created = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

        const response = await apiClient.getGlobalWebhook(created.body.id).expect(200);

        expect(response.body).toMatchObject({
          id: created.body.id,
          url: validWebhookData.url,
          events: validWebhookData.events,
          scope: 'global',
          enabled: true,
          // Secret should be included in detail view
          secret: expect.stringMatching(/^whsec_/),
        });
      });

      it('should return 404 for non-existent webhook', async () => {
        const response = await apiClient.getGlobalWebhook('whk_nonexistent').expect(404);

        expect(response.body.message).toContain('not found');
      });
    });

    describe('Update', () => {
      it('should update global webhook URL', async () => {
        const created = await apiClient.createGlobalWebhook(validWebhookData).expect(201);
        const newUrl = 'http://localhost:8888/updated';

        const response = await apiClient.updateGlobalWebhook(created.body.id, { url: newUrl }).expect(200);

        expect(response.body.url).toBe(newUrl);
        expect(response.body.updatedAt).toBeDefined();
      });

      it('should update global webhook events', async () => {
        const created = await apiClient.createGlobalWebhook(validWebhookData).expect(201);
        const newEvents = ['email.stored', 'email.deleted'];

        const response = await apiClient.updateGlobalWebhook(created.body.id, { events: newEvents }).expect(200);

        expect(response.body.events).toEqual(newEvents);
      });

      it('should update global webhook enabled status', async () => {
        const created = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

        const response = await apiClient.updateGlobalWebhook(created.body.id, { enabled: false }).expect(200);

        expect(response.body.enabled).toBe(false);
      });

      it('should update global webhook template', async () => {
        const created = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

        const response = await apiClient.updateGlobalWebhook(created.body.id, { template: 'discord' }).expect(200);

        expect(response.body.template).toBe('discord');
      });

      it('should update global webhook filter', async () => {
        const created = await apiClient.createGlobalWebhook(validWebhookData).expect(201);
        const newFilter = {
          mode: 'all' as const,
          rules: [{ field: 'subject', operator: 'starts_with', value: '[ALERT]' }],
        };

        const response = await apiClient.updateGlobalWebhook(created.body.id, { filter: newFilter }).expect(200);

        expect(response.body.filter).toMatchObject({
          mode: 'all',
          rules: expect.arrayContaining([
            expect.objectContaining({
              field: 'subject',
              operator: 'starts_with',
              value: '[ALERT]',
            }),
          ]),
        });
      });

      it('should update with partial data (only some fields)', async () => {
        const created = await apiClient
          .createGlobalWebhook({
            ...validWebhookData,
            description: 'Original description',
          })
          .expect(201);

        const response = await apiClient
          .updateGlobalWebhook(created.body.id, { description: 'Updated description' })
          .expect(200);

        // Description should be updated
        expect(response.body.description).toBe('Updated description');
        // URL should remain unchanged
        expect(response.body.url).toBe(validWebhookData.url);
      });

      it('should remove template by setting to null', async () => {
        const created = await apiClient
          .createGlobalWebhook({
            ...validWebhookData,
            template: 'slack',
          })
          .expect(201);

        expect(created.body.template).toBe('slack');

        const response = await apiClient.updateGlobalWebhook(created.body.id, { template: null }).expect(200);

        expect(response.body.template).toBeUndefined();
      });

      it('should remove filter by setting to null', async () => {
        const created = await apiClient
          .createGlobalWebhook({
            ...validWebhookData,
            filter: {
              mode: 'all',
              rules: [{ field: 'subject', operator: 'contains', value: 'test' }],
            },
          })
          .expect(201);

        expect(created.body.filter).toBeDefined();

        const response = await apiClient.updateGlobalWebhook(created.body.id, { filter: null }).expect(200);

        expect(response.body.filter).toBeUndefined();
      });

      it('should return 404 when updating non-existent webhook', async () => {
        await apiClient.updateGlobalWebhook('whk_nonexistent', { enabled: false }).expect(404);
      });
    });

    describe('Delete', () => {
      it('should delete global webhook', async () => {
        const created = await apiClient.createGlobalWebhook(validWebhookData).expect(201);

        await apiClient.deleteGlobalWebhook(created.body.id).expect(204);

        // Verify it's deleted
        await apiClient.getGlobalWebhook(created.body.id).expect(404);
      });

      it('should succeed when deleting non-existent webhook (idempotent)', async () => {
        // Should not throw error
        await apiClient.deleteGlobalWebhook('whk_nonexistent').expect(204);
      });
    });
  });

  // ============================================
  // Inbox Webhook Tests
  // ============================================

  describe('Inbox Webhooks', () => {
    describe('Create', () => {
      it('should create inbox webhook', async () => {
        const keypair = generateClientKeypair();
        const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

        const response = await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

        expect(response.body).toMatchObject({
          id: expect.stringMatching(/^whk_/),
          url: validWebhookData.url,
          events: validWebhookData.events,
          scope: 'inbox',
          inboxEmail: inbox.emailAddress,
          inboxHash: expect.any(String),
          enabled: true,
          secret: expect.stringMatching(/^whsec_/),
        });
      });

      it('should fail when inbox does not exist', async () => {
        const response = await apiClient
          .createInboxWebhook('nonexistent@vaultsandbox.test', validWebhookData)
          .expect(404);

        expect(response.body.message).toContain('not found');
      });
    });

    describe('List', () => {
      it('should list inbox webhooks', async () => {
        const keypair = generateClientKeypair();
        const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

        await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);
        await apiClient
          .createInboxWebhook(inbox.emailAddress, {
            url: 'http://localhost:9998/webhook2',
            events: ['email.stored'],
          })
          .expect(201);

        const response = await apiClient.listInboxWebhooks(inbox.emailAddress).expect(200);

        expect(response.body.total).toBe(2);
        expect(response.body.webhooks).toHaveLength(2);
      });

      it('should return empty list for inbox with no webhooks', async () => {
        const keypair = generateClientKeypair();
        const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

        const response = await apiClient.listInboxWebhooks(inbox.emailAddress).expect(200);

        expect(response.body).toEqual({
          webhooks: [],
          total: 0,
        });
      });

      it('should fail to list webhooks for non-existent inbox', async () => {
        await apiClient.listInboxWebhooks('nonexistent@vaultsandbox.test').expect(404);
      });
    });

    describe('Get', () => {
      it('should get single inbox webhook', async () => {
        const keypair = generateClientKeypair();
        const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
        const created = await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

        const response = await apiClient.getInboxWebhook(inbox.emailAddress, created.body.id).expect(200);

        expect(response.body).toMatchObject({
          id: created.body.id,
          url: validWebhookData.url,
          scope: 'inbox',
          inboxEmail: inbox.emailAddress,
        });
      });

      it('should return 404 for non-existent inbox webhook', async () => {
        const keypair = generateClientKeypair();
        const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);

        await apiClient.getInboxWebhook(inbox.emailAddress, 'whk_nonexistent').expect(404);
      });
    });

    describe('Update', () => {
      it('should update inbox webhook', async () => {
        const keypair = generateClientKeypair();
        const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
        const created = await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

        const response = await apiClient
          .updateInboxWebhook(inbox.emailAddress, created.body.id, {
            enabled: false,
            description: 'Updated inbox webhook',
          })
          .expect(200);

        expect(response.body.enabled).toBe(false);
        expect(response.body.description).toBe('Updated inbox webhook');
      });
    });

    describe('Delete', () => {
      it('should delete inbox webhook', async () => {
        const keypair = generateClientKeypair();
        const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
        const created = await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

        await apiClient.deleteInboxWebhook(inbox.emailAddress, created.body.id).expect(204);

        // Verify it's deleted
        await apiClient.getInboxWebhook(inbox.emailAddress, created.body.id).expect(404);
      });

      it('should succeed when deleting already deleted inbox webhook', async () => {
        const keypair = generateClientKeypair();
        const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
        const created = await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

        await apiClient.deleteInboxWebhook(inbox.emailAddress, created.body.id).expect(204);
        await apiClient.deleteInboxWebhook(inbox.emailAddress, created.body.id).expect(204);
      });
    });

    describe('Cascade Delete', () => {
      it('should delete webhooks when inbox is deleted', async () => {
        const keypair = generateClientKeypair();
        const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
        await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);
        await apiClient
          .createInboxWebhook(inbox.emailAddress, {
            url: 'http://localhost:9998/webhook2',
            events: ['email.stored'],
          })
          .expect(201);

        // Verify webhooks exist
        const beforeDelete = await apiClient.listInboxWebhooks(inbox.emailAddress).expect(200);
        expect(beforeDelete.body.total).toBe(2);

        // Delete the inbox
        await apiClient.deleteInbox(inbox.emailAddress).expect(204);

        // Inbox and webhooks are gone - listing should return 404
        await apiClient.listInboxWebhooks(inbox.emailAddress).expect(404);
      });
    });
  });

  // ============================================
  // Metrics & Templates Endpoints
  // ============================================

  describe('Metrics', () => {
    it('should return webhook metrics', async () => {
      // Create some webhooks
      await apiClient.createGlobalWebhook(validWebhookData).expect(201);
      await apiClient.createGlobalWebhook({ ...validWebhookData, url: 'http://localhost:9998/webhook2' }).expect(201);

      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

      const response = await apiClient.getWebhookMetrics().expect(200);

      expect(response.body).toMatchObject({
        webhooks: {
          global: 2,
          inbox: 1,
          enabled: 3,
          total: 3,
        },
        deliveries: {
          total: 0,
          successful: 0,
          failed: 0,
        },
      });
    });

    it('should return empty metrics when no webhooks exist', async () => {
      const response = await apiClient.getWebhookMetrics().expect(200);

      expect(response.body).toMatchObject({
        webhooks: {
          global: 0,
          inbox: 0,
          enabled: 0,
          total: 0,
        },
        deliveries: {
          total: 0,
          successful: 0,
          failed: 0,
        },
      });
    });
  });

  describe('Templates', () => {
    it('should return available webhook templates', async () => {
      const response = await apiClient.getWebhookTemplates().expect(200);

      expect(response.body.templates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 'default' }),
          expect.objectContaining({ value: 'slack' }),
          expect.objectContaining({ value: 'discord' }),
          expect.objectContaining({ value: 'teams' }),
        ]),
      );
    });

    it('should return templates with labels and values', async () => {
      const response = await apiClient.getWebhookTemplates().expect(200);

      for (const template of response.body.templates) {
        expect(template).toMatchObject({
          label: expect.any(String),
          value: expect.any(String),
        });
      }
    });
  });

  // ============================================
  // Secret Rotation
  // ============================================

  describe('Secret Rotation', () => {
    it('should rotate global webhook secret', async () => {
      const created = await apiClient.createGlobalWebhook(validWebhookData).expect(201);
      const originalSecret = created.body.secret;

      const response = await apiClient.rotateGlobalWebhookSecret(created.body.id).expect(201);

      expect(response.body).toMatchObject({
        id: created.body.id,
        secret: expect.stringMatching(/^whsec_/),
        previousSecretValidUntil: expect.any(String),
      });
      expect(response.body.secret).not.toBe(originalSecret);

      // Verify the webhook now has the new secret
      const updated = await apiClient.getGlobalWebhook(created.body.id).expect(200);
      expect(updated.body.secret).toBe(response.body.secret);
    });

    it('should rotate inbox webhook secret', async () => {
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      const created = await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);
      const originalSecret = created.body.secret;

      const response = await apiClient.rotateInboxWebhookSecret(inbox.emailAddress, created.body.id).expect(201);

      expect(response.body.secret).not.toBe(originalSecret);
      expect(response.body.previousSecretValidUntil).toBeDefined();
    });

    it('should return 404 when rotating secret for non-existent webhook', async () => {
      await apiClient.rotateGlobalWebhookSecret('whk_nonexistent').expect(404);
    });
  });

  // ============================================
  // Edge Cases & Validation
  // ============================================

  describe('Edge Cases', () => {
    it('should validate webhook ID format', async () => {
      // Invalid ID format should still work (return 404, not 400)
      await apiClient.getGlobalWebhook('invalid-id-format').expect(404);
    });

    it('should not include inbox webhooks in global list', async () => {
      // Create global webhook
      await apiClient.createGlobalWebhook(validWebhookData).expect(201);

      // Create inbox webhook
      const keypair = generateClientKeypair();
      const inbox = await createTestInbox(apiClient, keypair.publicKeyB64);
      await apiClient.createInboxWebhook(inbox.emailAddress, validWebhookData).expect(201);

      // Global list should only have 1
      const globalList = await apiClient.listGlobalWebhooks().expect(200);
      expect(globalList.body.total).toBe(1);

      // Inbox list should only have 1
      const inboxList = await apiClient.listInboxWebhooks(inbox.emailAddress).expect(200);
      expect(inboxList.body.total).toBe(1);
    });

    it('should reject unknown template name', async () => {
      const response = await apiClient
        .createGlobalWebhook({
          ...validWebhookData,
          template: 'unknown_template',
        })
        .expect(400);

      expect(response.body.message).toContain('Unknown template');
    });

    it('should reject invalid filter operator', async () => {
      const response = await apiClient
        .createGlobalWebhook({
          ...validWebhookData,
          filter: {
            mode: 'all',
            rules: [{ field: 'subject', operator: 'invalid_op' as any, value: 'test' }],
          },
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('should reject invalid filter field', async () => {
      const response = await apiClient
        .createGlobalWebhook({
          ...validWebhookData,
          filter: {
            mode: 'all',
            rules: [{ field: 'invalid.field', operator: 'contains', value: 'test' }],
          },
        })
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('should handle all valid event types', async () => {
      const allEvents = ['email.received', 'email.stored', 'email.deleted'];

      const response = await apiClient
        .createGlobalWebhook({
          url: 'http://localhost:9999/webhook',
          events: allEvents,
        })
        .expect(201);

      expect(response.body.events).toEqual(allEvents);
    });
  });

  // ============================================
  // API Key Validation
  // ============================================

  describe('API Key Validation', () => {
    it('should reject webhook creation with invalid API key', async () => {
      const invalidClient = createApiClient(appLifecycle.httpServer, { apiKey: 'invalid-key' });
      await invalidClient.createGlobalWebhook(validWebhookData).expect(401);
    });

    it('should reject webhook listing with invalid API key', async () => {
      const invalidClient = createApiClient(appLifecycle.httpServer, { apiKey: 'invalid-key' });
      await invalidClient.listGlobalWebhooks().expect(401);
    });
  });
});
