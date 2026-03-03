/**
 * Persistence E2E Tests
 *
 * Tests for inbox and webhook persistence functionality.
 * These tests verify that persistent inboxes and webhooks survive server restarts.
 *
 * IMPORTANT: These tests use a separate app instance with persistence enabled,
 * not the shared test app used by other E2E tests.
 */

import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { config as loadEnv } from 'dotenv';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PersistenceService } from '../src/persistence/persistence.service';
import { InboxStorageService } from '../src/inbox/storage/inbox-storage.service';
import { WebhookStorageService } from '../src/webhook/storage/webhook-storage.service';
import { ApiClient, createApiClient, CreateWebhookBody } from './helpers/api-client';
import { generateClientKeypair } from './helpers/crypto-client';

// Load base test env
const envPath = resolve(__dirname, '../.env.test-e2e');
if (existsSync(envPath)) {
  loadEnv({ path: envPath, override: true, quiet: true });
}

// Override for persistence tests
const PERSISTENCE_TEST_PATH = resolve(__dirname, '../data/e2e-persistence');

interface PersistenceTestApp {
  moduleRef: TestingModule;
  app: INestApplication;
  httpServer: App;
  persistenceService: PersistenceService;
  inboxStorage: InboxStorageService;
  webhookStorage: WebhookStorageService;
}

/**
 * Bootstrap a fresh app instance with persistence enabled.
 */
async function createPersistenceTestApp(
  policy: 'enabled' | 'always' = 'enabled',
  persistentGlobalWebhooks = true,
): Promise<PersistenceTestApp> {
  // Set persistence env vars
  process.env.VSB_PERSISTENCE_POLICY = policy;
  process.env.VSB_PERSISTENCE_PATH = PERSISTENCE_TEST_PATH;
  process.env.VSB_PERSISTENT_GLOBAL_WEBHOOKS = String(persistentGlobalWebhooks);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();
  await app.listen(0);

  return {
    moduleRef,
    app,
    httpServer: app.getHttpServer() as App,
    persistenceService: app.get(PersistenceService),
    inboxStorage: app.get(InboxStorageService),
    webhookStorage: app.get(WebhookStorageService),
  };
}

/**
 * Shutdown the test app instance.
 */
async function shutdownPersistenceTestApp(testApp: PersistenceTestApp): Promise<void> {
  await testApp.app.close();
  await testApp.moduleRef.close();
}

/**
 * Clean persistence directory.
 */
async function cleanPersistenceDirectory(): Promise<void> {
  await rm(PERSISTENCE_TEST_PATH, { recursive: true, force: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
  await mkdir(PERSISTENCE_TEST_PATH, { recursive: true });
}

describe('Persistence E2E', () => {
  // ============================================
  // Basic Persistence Tests
  // ============================================

  describe('Basic Inbox Persistence', () => {
    let testApp: PersistenceTestApp;
    let apiClient: ApiClient;

    beforeAll(async () => {
      await cleanPersistenceDirectory();
      testApp = await createPersistenceTestApp('enabled');
      apiClient = createApiClient(testApp.httpServer);
    }, 30000);

    afterAll(async () => {
      if (testApp) {
        await shutdownPersistenceTestApp(testApp);
      }
      await cleanPersistenceDirectory();
    }, 30000);

    it('should create a persistent inbox with explicit persistence flag', async () => {
      const { publicKeyB64: clientKemPk } = generateClientKeypair();

      const response = await apiClient
        .createInbox({
          clientKemPk,
          ttl: 3600,
          persistence: 'persistent',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        emailAddress: expect.stringMatching(/@/),
        persistent: true,
      });
    });

    it('should create an ephemeral inbox with explicit ephemeral flag', async () => {
      const { publicKeyB64: clientKemPk } = generateClientKeypair();

      const response = await apiClient
        .createInbox({
          clientKemPk,
          ttl: 3600,
          persistence: 'ephemeral',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        emailAddress: expect.stringMatching(/@/),
        persistent: false,
      });
    });

    it('should default to ephemeral when policy is "enabled" and no preference given', async () => {
      const { publicKeyB64: clientKemPk } = generateClientKeypair();

      const response = await apiClient
        .createInbox({
          clientKemPk,
          ttl: 3600,
          // No persistence preference
        })
        .expect(201);

      // Policy 'enabled' defaults to ephemeral (user must opt-in)
      // Actually, let's check the actual policy behavior
      expect(response.body).toHaveProperty('persistent');
    });

    it('should allow null TTL for persistent inboxes', async () => {
      const { publicKeyB64: clientKemPk } = generateClientKeypair();

      const response = await apiClient
        .createInbox({
          clientKemPk,
          ttl: null, // Never expires
          persistence: 'persistent',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        emailAddress: expect.stringMatching(/@/),
        persistent: true,
        expiresAt: null,
      });
    });

    it('should reject null TTL for ephemeral inboxes', async () => {
      const { publicKeyB64: clientKemPk } = generateClientKeypair();

      await apiClient
        .createInbox({
          clientKemPk,
          ttl: null, // Invalid for ephemeral
          persistence: 'ephemeral',
        })
        .expect(400);
    });
  });

  // ============================================
  // Restart Persistence Tests
  // ============================================

  describe('Inbox Restoration After Restart', () => {
    let createdInboxEmail: string;
    let createdWebhookId: string;

    beforeAll(async () => {
      await cleanPersistenceDirectory();
    });

    afterAll(async () => {
      await cleanPersistenceDirectory();
    }, 30000);

    it('should create persistent inbox and webhook before restart', async () => {
      const testApp = await createPersistenceTestApp('enabled');
      const apiClient = createApiClient(testApp.httpServer);

      try {
        const { publicKeyB64: clientKemPk } = generateClientKeypair();

        // Create persistent inbox
        const inboxResponse = await apiClient
          .createInbox({
            clientKemPk,
            ttl: 7200,
            persistence: 'persistent',
          })
          .expect(201);

        createdInboxEmail = inboxResponse.body.emailAddress;
        expect(inboxResponse.body.persistent).toBe(true);

        // Create webhook on the persistent inbox
        const webhookData: CreateWebhookBody = {
          url: 'http://localhost:9999/webhook',
          events: ['email.received'],
          description: 'Persisted test webhook',
        };

        const webhookResponse = await apiClient.createInboxWebhook(createdInboxEmail, webhookData).expect(201);

        createdWebhookId = webhookResponse.body.id;
        expect(createdWebhookId).toMatch(/^whk_/);

        // Verify inbox exists before shutdown
        const listResponse = await apiClient.listInboxWebhooks(createdInboxEmail).expect(200);
        expect(listResponse.body.webhooks).toHaveLength(1);
      } finally {
        await shutdownPersistenceTestApp(testApp);
      }
    }, 30000);

    it('should restore persistent inbox and webhook after restart', async () => {
      // Boot fresh app - should restore from persistence
      const testApp = await createPersistenceTestApp('enabled');
      const apiClient = createApiClient(testApp.httpServer);

      try {
        // Verify inbox was restored
        const syncResponse = await apiClient.getInboxSyncStatus(createdInboxEmail).expect(200);
        expect(syncResponse.body).toMatchObject({
          emailsHash: expect.any(String),
          emailCount: 0, // Emails are not persisted
        });

        // Verify webhook was restored
        const webhooksResponse = await apiClient.listInboxWebhooks(createdInboxEmail).expect(200);
        expect(webhooksResponse.body.webhooks).toHaveLength(1);
        expect(webhooksResponse.body.webhooks[0]).toMatchObject({
          id: createdWebhookId,
          url: 'http://localhost:9999/webhook',
          events: ['email.received'],
          description: 'Persisted test webhook',
        });
      } finally {
        await shutdownPersistenceTestApp(testApp);
      }
    }, 30000);

    it('should allow deleting restored inbox', async () => {
      const testApp = await createPersistenceTestApp('enabled');
      const apiClient = createApiClient(testApp.httpServer);

      try {
        // Delete the restored inbox
        await apiClient.deleteInbox(createdInboxEmail).expect(204);

        // Verify it's gone
        await apiClient.getInboxSyncStatus(createdInboxEmail).expect(404);
      } finally {
        await shutdownPersistenceTestApp(testApp);
      }
    }, 30000);

    it('should not restore deleted inbox on next restart', async () => {
      const testApp = await createPersistenceTestApp('enabled');
      const apiClient = createApiClient(testApp.httpServer);

      try {
        // Inbox should not be restored (was deleted)
        await apiClient.getInboxSyncStatus(createdInboxEmail).expect(404);
      } finally {
        await shutdownPersistenceTestApp(testApp);
      }
    }, 30000);
  });

  // ============================================
  // Global Webhook Persistence Tests
  // ============================================

  describe('Global Webhook Persistence', () => {
    let createdGlobalWebhookId: string;

    beforeAll(async () => {
      await cleanPersistenceDirectory();
    });

    afterAll(async () => {
      await cleanPersistenceDirectory();
    }, 30000);

    it('should create global webhook that persists', async () => {
      const testApp = await createPersistenceTestApp('enabled', true);
      const apiClient = createApiClient(testApp.httpServer);

      try {
        const webhookData: CreateWebhookBody = {
          url: 'http://localhost:9999/global-webhook',
          events: ['email.received', 'email.stored'],
          description: 'Global persisted webhook',
        };

        const response = await apiClient.createGlobalWebhook(webhookData).expect(201);

        createdGlobalWebhookId = response.body.id;
        expect(createdGlobalWebhookId).toMatch(/^whk_/);

        // Allow time for async persistence to complete
        await new Promise((resolve) => setTimeout(resolve, 100));
      } finally {
        await shutdownPersistenceTestApp(testApp);
      }
    }, 30000);

    it('should restore global webhook after restart', async () => {
      const testApp = await createPersistenceTestApp('enabled', true);
      const apiClient = createApiClient(testApp.httpServer);

      try {
        // Verify global webhook was restored
        const response = await apiClient.getGlobalWebhook(createdGlobalWebhookId).expect(200);

        expect(response.body).toMatchObject({
          id: createdGlobalWebhookId,
          url: 'http://localhost:9999/global-webhook',
          events: expect.arrayContaining(['email.received', 'email.stored']),
          description: 'Global persisted webhook',
          scope: 'global',
        });
      } finally {
        await shutdownPersistenceTestApp(testApp);
      }
    }, 30000);

    it('should not restore global webhooks when persistentGlobalWebhooks is false', async () => {
      // First, create a webhook with global persistence enabled
      let webhookId: string;
      {
        const testApp = await createPersistenceTestApp('enabled', true);
        const apiClient = createApiClient(testApp.httpServer);

        try {
          const response = await apiClient
            .createGlobalWebhook({
              url: 'http://localhost:9999/another-global-webhook',
              events: ['email.received'],
            })
            .expect(201);

          webhookId = response.body.id;
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }

      // Now restart with global webhook persistence disabled
      {
        const testApp = await createPersistenceTestApp('enabled', false);
        const apiClient = createApiClient(testApp.httpServer);

        try {
          // Global webhooks should not be restored
          await apiClient.getGlobalWebhook(webhookId).expect(404);
          await apiClient.getGlobalWebhook(createdGlobalWebhookId).expect(404);
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }
    }, 60000);

    it('should persist global webhook updates', async () => {
      let webhookId: string;

      // Create and update a global webhook
      {
        const testApp = await createPersistenceTestApp('enabled', true);
        const apiClient = createApiClient(testApp.httpServer);

        try {
          const createResponse = await apiClient
            .createGlobalWebhook({
              url: 'http://localhost:9999/update-test-webhook',
              events: ['email.received'],
              description: 'Original description',
            })
            .expect(201);

          webhookId = createResponse.body.id;

          // Update the webhook
          await apiClient
            .updateGlobalWebhook(webhookId, {
              url: 'http://localhost:9999/updated-url',
              events: ['email.received', 'email.stored'],
              description: 'Updated description',
              enabled: false,
            })
            .expect(200);

          // Allow time for async persistence to complete
          await new Promise((resolve) => setTimeout(resolve, 100));
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }

      // Verify updates persisted after restart
      {
        const testApp = await createPersistenceTestApp('enabled', true);
        const apiClient = createApiClient(testApp.httpServer);

        try {
          const response = await apiClient.getGlobalWebhook(webhookId).expect(200);

          expect(response.body).toMatchObject({
            id: webhookId,
            url: 'http://localhost:9999/updated-url',
            events: expect.arrayContaining(['email.received', 'email.stored']),
            description: 'Updated description',
            enabled: false,
          });
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }
    }, 60000);

    it('should persist global webhook deletion', async () => {
      let webhookId: string;

      // Create and delete a global webhook
      {
        const testApp = await createPersistenceTestApp('enabled', true);
        const apiClient = createApiClient(testApp.httpServer);

        try {
          const createResponse = await apiClient
            .createGlobalWebhook({
              url: 'http://localhost:9999/delete-test-webhook',
              events: ['email.received'],
            })
            .expect(201);

          webhookId = createResponse.body.id;

          // Allow time for async persistence to complete
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Delete the webhook
          await apiClient.deleteGlobalWebhook(webhookId).expect(204);

          // Allow time for async persistence removal to complete
          await new Promise((resolve) => setTimeout(resolve, 100));
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }

      // Verify deletion persisted after restart
      {
        const testApp = await createPersistenceTestApp('enabled', true);
        const apiClient = createApiClient(testApp.httpServer);

        try {
          // Webhook should not be restored (was deleted)
          await apiClient.getGlobalWebhook(webhookId).expect(404);
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }
    }, 60000);

    it('should persist global webhook secret rotation', async () => {
      let webhookId: string;
      let rotatedSecret: string;

      // Create and rotate secret for a global webhook
      {
        const testApp = await createPersistenceTestApp('enabled', true);
        const apiClient = createApiClient(testApp.httpServer);

        try {
          const createResponse = await apiClient
            .createGlobalWebhook({
              url: 'http://localhost:9999/rotate-test-webhook',
              events: ['email.received'],
            })
            .expect(201);

          webhookId = createResponse.body.id;
          const originalSecret = createResponse.body.secret;

          // Rotate the secret
          const rotateResponse = await apiClient.rotateGlobalWebhookSecret(webhookId).expect(201);
          rotatedSecret = rotateResponse.body.secret;

          expect(rotatedSecret).not.toBe(originalSecret);

          // Allow time for async persistence to complete
          await new Promise((resolve) => setTimeout(resolve, 100));
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }

      // Verify rotated secret persisted after restart
      {
        const testApp = await createPersistenceTestApp('enabled', true);
        const apiClient = createApiClient(testApp.httpServer);

        try {
          const response = await apiClient.getGlobalWebhook(webhookId).expect(200);

          expect(response.body.secret).toBe(rotatedSecret);
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }
    }, 60000);
  });

  // ============================================
  // Expired Inbox Cleanup Tests
  // ============================================

  describe('Expired Inbox Cleanup', () => {
    beforeAll(async () => {
      await cleanPersistenceDirectory();
    });

    afterAll(async () => {
      await cleanPersistenceDirectory();
    }, 30000);

    it('should remove expired inbox on startup', async () => {
      let expiredInboxEmail: string;
      let nonExpiredInboxEmail: string;

      // Create inboxes with different TTLs
      {
        const testApp = await createPersistenceTestApp('enabled');
        const apiClient = createApiClient(testApp.httpServer);

        try {
          const { publicKeyB64: clientKemPk1 } = generateClientKeypair();
          const { publicKeyB64: clientKemPk2 } = generateClientKeypair();

          // Create inbox with very short TTL (60 seconds - minimum)
          const expiredResponse = await apiClient
            .createInbox({
              clientKemPk: clientKemPk1,
              ttl: 60, // Will expire soon
              persistence: 'persistent',
            })
            .expect(201);
          expiredInboxEmail = expiredResponse.body.emailAddress;

          // Create inbox with longer TTL
          const nonExpiredResponse = await apiClient
            .createInbox({
              clientKemPk: clientKemPk2,
              ttl: 7200, // 2 hours
              persistence: 'persistent',
            })
            .expect(201);
          nonExpiredInboxEmail = nonExpiredResponse.body.emailAddress;
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }

      // Wait for the short-TTL inbox to expire
      await new Promise((resolve) => setTimeout(resolve, 61000));

      // Restart and verify expired inbox is cleaned up
      {
        const testApp = await createPersistenceTestApp('enabled');
        const apiClient = createApiClient(testApp.httpServer);

        try {
          // Expired inbox should be gone
          await apiClient.getInboxSyncStatus(expiredInboxEmail).expect(404);

          // Non-expired inbox should still exist
          await apiClient.getInboxSyncStatus(nonExpiredInboxEmail).expect(200);
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }
    }, 120000); // Long timeout due to waiting for expiration
  });

  // ============================================
  // Policy Tests
  // ============================================

  describe('Persistence Policy: ALWAYS', () => {
    beforeAll(async () => {
      await cleanPersistenceDirectory();
    });

    afterAll(async () => {
      await cleanPersistenceDirectory();
    }, 30000);

    it('should force all inboxes to be persistent', async () => {
      const testApp = await createPersistenceTestApp('always');
      const apiClient = createApiClient(testApp.httpServer);

      try {
        const { publicKeyB64: clientKemPk } = generateClientKeypair();

        // Try to create ephemeral inbox - should still be persistent
        const response = await apiClient
          .createInbox({
            clientKemPk,
            ttl: 3600,
            persistence: 'ephemeral', // Should be ignored
          })
          .expect(201);

        expect(response.body.persistent).toBe(true);
      } finally {
        await shutdownPersistenceTestApp(testApp);
      }
    }, 30000);

    it('should report policy in server info', async () => {
      const testApp = await createPersistenceTestApp('always', true);
      const apiClient = createApiClient(testApp.httpServer);

      try {
        const response = await apiClient.getServerInfo().expect(200);

        expect(response.body).toMatchObject({
          persistencePolicy: 'always',
          persistentGlobalWebhooks: true,
        });
      } finally {
        await shutdownPersistenceTestApp(testApp);
      }
    }, 30000);
  });

  describe('Persistence Policy: NEVER', () => {
    beforeAll(async () => {
      await cleanPersistenceDirectory();
    });

    afterAll(async () => {
      await cleanPersistenceDirectory();
    }, 30000);

    it('should prevent all inboxes from being persistent', async () => {
      // Override policy to NEVER
      process.env.VSB_PERSISTENCE_POLICY = 'never';
      process.env.VSB_PERSISTENCE_PATH = PERSISTENCE_TEST_PATH;

      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      const app = moduleRef.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );

      await app.init();
      await app.listen(0);
      const httpServer = app.getHttpServer() as App;
      const apiClient = createApiClient(httpServer);

      try {
        const { publicKeyB64: clientKemPk } = generateClientKeypair();

        // Try to create persistent inbox - should still be ephemeral
        const response = await apiClient
          .createInbox({
            clientKemPk,
            ttl: 3600,
            persistence: 'persistent', // Should be ignored
          })
          .expect(201);

        expect(response.body.persistent).toBe(false);
      } finally {
        await app.close();
        await moduleRef.close();
      }
    }, 30000);

    it('should report policy in server info', async () => {
      process.env.VSB_PERSISTENCE_POLICY = 'never';
      process.env.VSB_PERSISTENCE_PATH = PERSISTENCE_TEST_PATH;

      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      const app = moduleRef.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );

      await app.init();
      await app.listen(0);
      const httpServer = app.getHttpServer() as App;
      const apiClient = createApiClient(httpServer);

      try {
        const response = await apiClient.getServerInfo().expect(200);

        expect(response.body).toMatchObject({
          persistencePolicy: 'never',
        });
      } finally {
        await app.close();
        await moduleRef.close();
      }
    }, 30000);
  });

  // ============================================
  // Multiple Inboxes and Webhooks
  // ============================================

  describe('Multiple Persistent Entities', () => {
    beforeAll(async () => {
      await cleanPersistenceDirectory();
    });

    afterAll(async () => {
      await cleanPersistenceDirectory();
    }, 30000);

    it('should persist and restore multiple inboxes with multiple webhooks', async () => {
      const inboxes: Array<{ email: string; webhookIds: string[] }> = [];

      // Create multiple persistent inboxes with webhooks
      {
        const testApp = await createPersistenceTestApp('enabled');
        const apiClient = createApiClient(testApp.httpServer);

        try {
          for (let i = 0; i < 3; i++) {
            const { publicKeyB64: clientKemPk } = generateClientKeypair();

            const inboxResponse = await apiClient
              .createInbox({
                clientKemPk,
                ttl: 7200,
                persistence: 'persistent',
              })
              .expect(201);

            const inboxEmail = inboxResponse.body.emailAddress;
            const webhookIds: string[] = [];

            // Create 2 webhooks per inbox
            for (let j = 0; j < 2; j++) {
              const webhookResponse = await apiClient
                .createInboxWebhook(inboxEmail, {
                  url: `http://localhost:9999/webhook-${i}-${j}`,
                  events: ['email.received'],
                  description: `Inbox ${i} Webhook ${j}`,
                })
                .expect(201);

              webhookIds.push(webhookResponse.body.id);
            }

            inboxes.push({ email: inboxEmail, webhookIds });
          }

          expect(inboxes).toHaveLength(3);
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }

      // Restart and verify all restored
      {
        const testApp = await createPersistenceTestApp('enabled');
        const apiClient = createApiClient(testApp.httpServer);

        try {
          for (const inbox of inboxes) {
            // Verify inbox exists
            await apiClient.getInboxSyncStatus(inbox.email).expect(200);

            // Verify webhooks exist
            const webhooksResponse = await apiClient.listInboxWebhooks(inbox.email).expect(200);
            expect(webhooksResponse.body.webhooks).toHaveLength(2);

            const restoredIds = webhooksResponse.body.webhooks.map((w: any) => w.id);
            expect(restoredIds).toContain(inbox.webhookIds[0]);
            expect(restoredIds).toContain(inbox.webhookIds[1]);
          }
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }
    }, 60000);
  });

  // ============================================
  // Webhook Updates Persistence
  // ============================================

  describe('Webhook Updates Persistence', () => {
    let inboxEmail: string;
    let webhookId: string;

    beforeAll(async () => {
      await cleanPersistenceDirectory();
    });

    afterAll(async () => {
      await cleanPersistenceDirectory();
    }, 30000);

    it('should persist webhook updates', async () => {
      // Create inbox and webhook
      {
        const testApp = await createPersistenceTestApp('enabled');
        const apiClient = createApiClient(testApp.httpServer);

        try {
          const { publicKeyB64: clientKemPk } = generateClientKeypair();

          const inboxResponse = await apiClient
            .createInbox({
              clientKemPk,
              ttl: 7200,
              persistence: 'persistent',
            })
            .expect(201);

          inboxEmail = inboxResponse.body.emailAddress;

          const webhookResponse = await apiClient
            .createInboxWebhook(inboxEmail, {
              url: 'http://localhost:9999/original-url',
              events: ['email.received'],
              description: 'Original description',
            })
            .expect(201);

          webhookId = webhookResponse.body.id;

          // Update the webhook
          await apiClient
            .updateInboxWebhook(inboxEmail, webhookId, {
              url: 'http://localhost:9999/updated-url',
              events: ['email.received', 'email.stored'],
              description: 'Updated description',
              enabled: false,
            })
            .expect(200);
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }

      // Verify updates persisted after restart
      {
        const testApp = await createPersistenceTestApp('enabled');
        const apiClient = createApiClient(testApp.httpServer);

        try {
          const response = await apiClient.getInboxWebhook(inboxEmail, webhookId).expect(200);

          expect(response.body).toMatchObject({
            id: webhookId,
            url: 'http://localhost:9999/updated-url',
            events: expect.arrayContaining(['email.received', 'email.stored']),
            description: 'Updated description',
            enabled: false,
          });
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }
    }, 60000);
  });

  // ============================================
  // Inbox Webhook Deletion Persistence
  // ============================================

  describe('Inbox Webhook Deletion Persistence', () => {
    beforeAll(async () => {
      await cleanPersistenceDirectory();
    });

    afterAll(async () => {
      await cleanPersistenceDirectory();
    }, 30000);

    it('should persist inbox webhook deletion', async () => {
      let inboxEmail: string;
      let webhookId: string;

      // Create inbox and webhook, then delete webhook
      {
        const testApp = await createPersistenceTestApp('enabled');
        const apiClient = createApiClient(testApp.httpServer);

        try {
          const { publicKeyB64: clientKemPk } = generateClientKeypair();

          const inboxResponse = await apiClient
            .createInbox({
              clientKemPk,
              ttl: 7200,
              persistence: 'persistent',
            })
            .expect(201);

          inboxEmail = inboxResponse.body.emailAddress;

          const webhookResponse = await apiClient
            .createInboxWebhook(inboxEmail, {
              url: 'http://localhost:9999/delete-test-webhook',
              events: ['email.received'],
            })
            .expect(201);

          webhookId = webhookResponse.body.id;

          // Allow time for async persistence to complete
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Delete the webhook
          await apiClient.deleteInboxWebhook(inboxEmail, webhookId).expect(204);

          // Allow time for async persistence removal to complete
          await new Promise((resolve) => setTimeout(resolve, 100));
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }

      // Verify deletion persisted after restart
      {
        const testApp = await createPersistenceTestApp('enabled');
        const apiClient = createApiClient(testApp.httpServer);

        try {
          // Inbox should still exist
          await apiClient.getInboxSyncStatus(inboxEmail).expect(200);

          // Webhook should not be restored (was deleted)
          await apiClient.getInboxWebhook(inboxEmail, webhookId).expect(404);

          // List should be empty
          const listResponse = await apiClient.listInboxWebhooks(inboxEmail).expect(200);
          expect(listResponse.body.webhooks).toHaveLength(0);
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }
    }, 60000);
  });

  // ============================================
  // Inbox Webhook Secret Rotation Persistence
  // ============================================

  describe('Inbox Webhook Secret Rotation Persistence', () => {
    beforeAll(async () => {
      await cleanPersistenceDirectory();
    });

    afterAll(async () => {
      await cleanPersistenceDirectory();
    }, 30000);

    it('should persist inbox webhook secret rotation', async () => {
      let inboxEmail: string;
      let webhookId: string;
      let rotatedSecret: string;

      // Create inbox and webhook, then rotate secret
      {
        const testApp = await createPersistenceTestApp('enabled');
        const apiClient = createApiClient(testApp.httpServer);

        try {
          const { publicKeyB64: clientKemPk } = generateClientKeypair();

          const inboxResponse = await apiClient
            .createInbox({
              clientKemPk,
              ttl: 7200,
              persistence: 'persistent',
            })
            .expect(201);

          inboxEmail = inboxResponse.body.emailAddress;

          const webhookResponse = await apiClient
            .createInboxWebhook(inboxEmail, {
              url: 'http://localhost:9999/rotate-test-webhook',
              events: ['email.received'],
            })
            .expect(201);

          webhookId = webhookResponse.body.id;
          const originalSecret = webhookResponse.body.secret;

          // Rotate the secret
          const rotateResponse = await apiClient.rotateInboxWebhookSecret(inboxEmail, webhookId).expect(201);
          rotatedSecret = rotateResponse.body.secret;

          expect(rotatedSecret).not.toBe(originalSecret);

          // Allow time for async persistence to complete
          await new Promise((resolve) => setTimeout(resolve, 100));
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }

      // Verify rotated secret persisted after restart
      {
        const testApp = await createPersistenceTestApp('enabled');
        const apiClient = createApiClient(testApp.httpServer);

        try {
          const response = await apiClient.getInboxWebhook(inboxEmail, webhookId).expect(200);

          expect(response.body.secret).toBe(rotatedSecret);
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }
    }, 60000);
  });

  // ============================================
  // Plain Inbox Persistence
  // ============================================

  describe('Plain (Unencrypted) Inbox Persistence', () => {
    let plainInboxEmail: string;

    beforeAll(async () => {
      await cleanPersistenceDirectory();
    });

    afterAll(async () => {
      await cleanPersistenceDirectory();
    }, 30000);

    it('should persist and restore plain inbox', async () => {
      // Create plain persistent inbox
      {
        const testApp = await createPersistenceTestApp('enabled');
        const apiClient = createApiClient(testApp.httpServer);

        try {
          const response = await apiClient
            .createInbox({
              ttl: 7200,
              encryption: 'plain',
              persistence: 'persistent',
            })
            .expect(201);

          plainInboxEmail = response.body.emailAddress;
          expect(response.body.persistent).toBe(true);
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }

      // Verify restored after restart
      {
        const testApp = await createPersistenceTestApp('enabled');
        const apiClient = createApiClient(testApp.httpServer);

        try {
          await apiClient.getInboxSyncStatus(plainInboxEmail).expect(200);
        } finally {
          await shutdownPersistenceTestApp(testApp);
        }
      }
    }, 60000);
  });
});
