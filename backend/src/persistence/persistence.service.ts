/**
 * Persistence Service
 *
 * Handles persistence of inbox metadata and webhooks to disk.
 * Provides startup restoration from persisted data.
 *
 * IMPORTANT: Emails are NOT persisted - only inbox metadata and webhook configurations.
 */

import { Injectable, Logger, Inject, OnModuleInit, forwardRef } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';

import { PERSISTENCE_CONFIG, PERSISTENCE_SCHEMA_VERSION } from './persistence.constants';
import type {
  PersistenceConfig,
  PersistedInbox,
  PersistedInboxWebhook,
  PersistedGlobalWebhook,
} from './persistence.interfaces';
import {
  atomicWriteJson,
  removeDirectory,
  removeFile,
  ensureDirectory,
  listSubdirectories,
  listJsonFiles,
  validateInboxHashForPath,
  validateWebhookIdForPath,
  getInboxPath,
  getInboxFilePath,
  getInboxWebhooksPath,
  getInboxWebhookFilePath,
  getGlobalWebhooksPath,
  getGlobalWebhookFilePath,
} from './persistence.utils';
import { PersistencePolicy } from '../config/config.constants';
import { InboxStorageService } from '../inbox/storage/inbox-storage.service';
import { WebhookStorageService } from '../webhook/storage/webhook-storage.service';
import type { Inbox } from '../inbox/interfaces';
import type { Webhook, WebhookStats } from '../webhook/interfaces/webhook.interface';

/**
 * PersistenceService manages disk persistence for inboxes and webhooks.
 *
 * Key responsibilities:
 * - Persist/remove inbox metadata to disk
 * - Persist/remove webhook configurations to disk
 * - Restore persisted data on startup
 * - Resolve persistence policy for inbox creation
 *
 * Directory structure:
 * ```
 * {path}/
 * ├── global-webhooks/
 * │   └── {webhookId}.json
 * └── inboxes/
 *     └── {inboxHash}/
 *         ├── inbox.json
 *         └── webhooks/
 *             └── {webhookId}.json
 * ```
 */
@Injectable()
export class PersistenceService implements OnModuleInit {
  private readonly logger = new Logger(PersistenceService.name);

  /** Track which inboxes are currently persisted (for fast lookup) */
  private persistedInboxHashes = new Set<string>();

  constructor(
    @Inject(PERSISTENCE_CONFIG) private readonly config: PersistenceConfig,
    @Inject(forwardRef(() => InboxStorageService))
    private readonly inboxStorageService: InboxStorageService,
    @Inject(forwardRef(() => WebhookStorageService))
    private readonly webhookStorageService: WebhookStorageService,
  ) {}

  // ============================================
  // Lifecycle
  // ============================================

  /**
   * Restore persisted data on module initialization.
   */
  async onModuleInit(): Promise<void> {
    // Skip if persistence is disabled
    if (this.config.policy === PersistencePolicy.NEVER) {
      this.logger.log('Persistence disabled (policy: never)');
      return;
    }

    this.logger.log(`Persistence enabled (policy: ${this.config.policy}, path: ${this.config.path})`);

    // Ensure persistence directories exist
    await ensureDirectory(join(this.config.path, 'inboxes'));
    await ensureDirectory(join(this.config.path, 'global-webhooks'));

    // Restore inboxes and their webhooks
    await this.restorePersistedInboxes();

    // Restore global webhooks if enabled
    if (this.config.persistentGlobalWebhooks) {
      await this.restorePersistedGlobalWebhooks();
    }
  }

  /**
   * Restore all persisted inboxes and their webhooks from disk.
   */
  private async restorePersistedInboxes(): Promise<void> {
    const persistedInboxes = await this.loadPersistedInboxes();
    this.logger.log(`Found ${persistedInboxes.length} persisted inboxes`);

    const now = new Date();
    let restored = 0;
    let expired = 0;

    for (const persistedInbox of persistedInboxes) {
      try {
        // Check if inbox has expired
        if (persistedInbox.expiresAt) {
          const expiresAt = new Date(persistedInbox.expiresAt);
          if (expiresAt < now) {
            this.logger.log(
              `Inbox ${persistedInbox.emailAddress} expired at ${persistedInbox.expiresAt}, removing`,
            );
            await this.removePersistedInbox(persistedInbox.inboxHash);
            expired++;
            continue;
          }
        }

        // Hydrate and restore inbox
        const inbox = this.hydrateInbox(persistedInbox);
        this.inboxStorageService.restoreInbox(inbox);
        this.persistedInboxHashes.add(inbox.inboxHash);

        // Load and restore webhooks for this inbox
        const webhooks = await this.loadPersistedInboxWebhooks(persistedInbox.inboxHash);
        for (const persistedWebhook of webhooks) {
          try {
            const webhook = this.hydrateInboxWebhook(persistedWebhook);
            this.webhookStorageService.createInboxWebhook(inbox.inboxHash, webhook);
          } catch (error) {
            this.logger.error(
              `Failed to restore webhook ${persistedWebhook.id} for inbox ${persistedInbox.inboxHash}: ${(error as Error).message}`,
            );
          }
        }

        this.logger.log(
          `Restored inbox ${persistedInbox.emailAddress} with ${webhooks.length} webhooks`,
        );
        restored++;
      } catch (error) {
        this.logger.error(
          `Failed to restore inbox ${persistedInbox.inboxHash}: ${(error as Error).message}`,
        );
        // Continue with other inboxes
      }
    }

    this.logger.log(
      `Persistence startup: ${restored} inboxes restored, ${expired} expired and removed`,
    );
  }

  /**
   * Restore all persisted global webhooks from disk.
   */
  private async restorePersistedGlobalWebhooks(): Promise<void> {
    const globalWebhooks = await this.loadPersistedGlobalWebhooks();
    let restored = 0;

    for (const persistedWebhook of globalWebhooks) {
      try {
        const webhook = this.hydrateGlobalWebhook(persistedWebhook);
        this.webhookStorageService.createGlobalWebhook(webhook);
        restored++;
      } catch (error) {
        this.logger.error(
          `Failed to restore global webhook ${persistedWebhook.id}: ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(`Restored ${restored} global webhooks`);
  }

  // ============================================
  // Inbox Operations
  // ============================================

  /**
   * Persist an inbox to disk.
   *
   * @param inbox - Inbox to persist
   */
  async persistInbox(inbox: Inbox): Promise<void> {
    if (!validateInboxHashForPath(inbox.inboxHash)) {
      throw new Error(`Invalid inbox hash for persistence: ${inbox.inboxHash}`);
    }

    const persisted: PersistedInbox = {
      version: PERSISTENCE_SCHEMA_VERSION,
      emailAddress: inbox.emailAddress,
      inboxHash: inbox.inboxHash,
      clientKemPk: inbox.clientKemPk,
      encrypted: inbox.encrypted,
      emailAuth: inbox.emailAuth,
      spamAnalysis: inbox.spamAnalysis,
      chaos: inbox.chaos,
      createdAt: inbox.createdAt.toISOString(),
      expiresAt: inbox.expiresAt?.toISOString() ?? null,
    };

    const filePath = getInboxFilePath(this.config.path, inbox.inboxHash);
    await atomicWriteJson(filePath, persisted);
    this.persistedInboxHashes.add(inbox.inboxHash);

    this.logger.debug(`Persisted inbox ${inbox.emailAddress} to ${filePath}`);
  }

  /**
   * Remove a persisted inbox and all its webhooks from disk.
   *
   * @param inboxHash - Inbox hash to remove
   */
  async removePersistedInbox(inboxHash: string): Promise<void> {
    if (!validateInboxHashForPath(inboxHash)) {
      throw new Error(`Invalid inbox hash for persistence: ${inboxHash}`);
    }

    const dirPath = getInboxPath(this.config.path, inboxHash);
    await removeDirectory(dirPath);
    this.persistedInboxHashes.delete(inboxHash);

    this.logger.debug(`Removed persisted inbox ${inboxHash}`);
  }

  /**
   * Load all persisted inboxes from disk.
   *
   * @returns Array of persisted inbox data
   */
  async loadPersistedInboxes(): Promise<PersistedInbox[]> {
    const inboxesPath = join(this.config.path, 'inboxes');
    const inboxDirs = await listSubdirectories(inboxesPath);
    const inboxes: PersistedInbox[] = [];

    for (const inboxHash of inboxDirs) {
      if (!validateInboxHashForPath(inboxHash)) {
        this.logger.warn(`Skipping invalid inbox directory name: ${inboxHash}`);
        continue;
      }

      const inboxFilePath = getInboxFilePath(this.config.path, inboxHash);
      try {
        const content = await readFile(inboxFilePath, 'utf-8');
        const inbox = JSON.parse(content) as PersistedInbox;

        // Validate version
        if (inbox.version !== PERSISTENCE_SCHEMA_VERSION) {
          this.logger.warn(
            `Unknown inbox version ${inbox.version} in ${inboxFilePath}, expected ${PERSISTENCE_SCHEMA_VERSION}`,
          );
          continue;
        }

        inboxes.push(inbox);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          // Directory exists but inbox.json is missing
          this.logger.warn(`Missing inbox.json in ${inboxHash}, skipping`);
        } else {
          this.logger.warn(
            `Failed to load inbox from ${inboxFilePath}: ${(error as Error).message}`,
          );
        }
      }
    }

    return inboxes;
  }

  /**
   * Check if an inbox is currently persisted.
   *
   * @param inboxHash - Inbox hash to check
   * @returns true if inbox is persisted
   */
  isInboxPersisted(inboxHash: string): boolean {
    return this.persistedInboxHashes.has(inboxHash);
  }

  // ============================================
  // Inbox Webhook Operations
  // ============================================

  /**
   * Persist an inbox webhook to disk.
   *
   * @param webhook - Webhook to persist (must have inboxHash set)
   */
  async persistInboxWebhook(webhook: Webhook): Promise<void> {
    if (!webhook.inboxHash || !validateInboxHashForPath(webhook.inboxHash)) {
      throw new Error(`Invalid inbox hash for webhook persistence: ${webhook.inboxHash}`);
    }
    if (!validateWebhookIdForPath(webhook.id)) {
      throw new Error(`Invalid webhook ID for persistence: ${webhook.id}`);
    }

    const persisted: PersistedInboxWebhook = {
      version: PERSISTENCE_SCHEMA_VERSION,
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      scope: 'inbox',
      inboxHash: webhook.inboxHash,
      inboxEmail: webhook.inboxEmail ?? '',
      enabled: webhook.enabled,
      secret: webhook.secret,
      previousSecret: webhook.previousSecret,
      previousSecretExpiresAt: webhook.previousSecretExpiresAt?.toISOString(),
      template: webhook.template,
      filter: webhook.filter,
      description: webhook.description,
      createdAt: webhook.createdAt.toISOString(),
      updatedAt: webhook.updatedAt?.toISOString(),
    };

    const filePath = getInboxWebhookFilePath(this.config.path, webhook.inboxHash, webhook.id);
    await atomicWriteJson(filePath, persisted);

    this.logger.debug(`Persisted inbox webhook ${webhook.id} to ${filePath}`);
  }

  /**
   * Update a persisted inbox webhook on disk.
   * This is the same as persistInboxWebhook - just overwrites the file.
   *
   * @param webhook - Webhook to update
   */
  async updatePersistedInboxWebhook(webhook: Webhook): Promise<void> {
    await this.persistInboxWebhook(webhook);
  }

  /**
   * Remove a persisted inbox webhook from disk.
   *
   * @param inboxHash - Inbox hash
   * @param webhookId - Webhook ID to remove
   */
  async removePersistedInboxWebhook(inboxHash: string, webhookId: string): Promise<void> {
    if (!validateInboxHashForPath(inboxHash)) {
      throw new Error(`Invalid inbox hash for webhook removal: ${inboxHash}`);
    }
    if (!validateWebhookIdForPath(webhookId)) {
      throw new Error(`Invalid webhook ID for removal: ${webhookId}`);
    }

    const filePath = getInboxWebhookFilePath(this.config.path, inboxHash, webhookId);
    await removeFile(filePath);

    this.logger.debug(`Removed persisted inbox webhook ${webhookId}`);
  }

  /**
   * Load all persisted webhooks for a specific inbox.
   *
   * @param inboxHash - Inbox hash to load webhooks for
   * @returns Array of persisted webhook data
   */
  async loadPersistedInboxWebhooks(inboxHash: string): Promise<PersistedInboxWebhook[]> {
    if (!validateInboxHashForPath(inboxHash)) {
      return [];
    }

    const webhooksPath = getInboxWebhooksPath(this.config.path, inboxHash);
    const webhookFiles = await listJsonFiles(webhooksPath);
    const webhooks: PersistedInboxWebhook[] = [];

    for (const fileName of webhookFiles) {
      const webhookId = fileName.replace('.json', '');
      if (!validateWebhookIdForPath(webhookId)) {
        this.logger.warn(`Skipping invalid webhook file name: ${fileName}`);
        continue;
      }

      const filePath = join(webhooksPath, fileName);
      try {
        const content = await readFile(filePath, 'utf-8');
        const webhook = JSON.parse(content) as PersistedInboxWebhook;

        // Validate version
        if (webhook.version !== PERSISTENCE_SCHEMA_VERSION) {
          this.logger.warn(
            `Unknown webhook version ${webhook.version} in ${filePath}, expected ${PERSISTENCE_SCHEMA_VERSION}`,
          );
          continue;
        }

        webhooks.push(webhook);
      } catch (error) {
        this.logger.warn(`Failed to load webhook from ${filePath}: ${(error as Error).message}`);
      }
    }

    return webhooks;
  }

  // ============================================
  // Global Webhook Operations
  // ============================================

  /**
   * Check if global webhook persistence is enabled.
   *
   * @returns true if global webhooks should be persisted
   */
  isGlobalWebhookPersistenceEnabled(): boolean {
    return this.config.persistentGlobalWebhooks;
  }

  /**
   * Persist a global webhook to disk.
   *
   * @param webhook - Global webhook to persist
   */
  async persistGlobalWebhook(webhook: Webhook): Promise<void> {
    if (!validateWebhookIdForPath(webhook.id)) {
      throw new Error(`Invalid webhook ID for persistence: ${webhook.id}`);
    }

    const persisted: PersistedGlobalWebhook = {
      version: PERSISTENCE_SCHEMA_VERSION,
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      scope: 'global',
      enabled: webhook.enabled,
      secret: webhook.secret,
      previousSecret: webhook.previousSecret,
      previousSecretExpiresAt: webhook.previousSecretExpiresAt?.toISOString(),
      template: webhook.template,
      filter: webhook.filter,
      description: webhook.description,
      createdAt: webhook.createdAt.toISOString(),
      updatedAt: webhook.updatedAt?.toISOString(),
    };

    const filePath = getGlobalWebhookFilePath(this.config.path, webhook.id);
    await atomicWriteJson(filePath, persisted);

    this.logger.debug(`Persisted global webhook ${webhook.id} to ${filePath}`);
  }

  /**
   * Update a persisted global webhook on disk.
   * This is the same as persistGlobalWebhook - just overwrites the file.
   *
   * @param webhook - Webhook to update
   */
  async updatePersistedGlobalWebhook(webhook: Webhook): Promise<void> {
    await this.persistGlobalWebhook(webhook);
  }

  /**
   * Remove a persisted global webhook from disk.
   *
   * @param webhookId - Webhook ID to remove
   */
  async removePersistedGlobalWebhook(webhookId: string): Promise<void> {
    if (!validateWebhookIdForPath(webhookId)) {
      throw new Error(`Invalid webhook ID for removal: ${webhookId}`);
    }

    const filePath = getGlobalWebhookFilePath(this.config.path, webhookId);
    await removeFile(filePath);

    this.logger.debug(`Removed persisted global webhook ${webhookId}`);
  }

  /**
   * Load all persisted global webhooks from disk.
   *
   * @returns Array of persisted global webhook data
   */
  async loadPersistedGlobalWebhooks(): Promise<PersistedGlobalWebhook[]> {
    const globalPath = getGlobalWebhooksPath(this.config.path);
    const webhookFiles = await listJsonFiles(globalPath);
    const webhooks: PersistedGlobalWebhook[] = [];

    for (const fileName of webhookFiles) {
      const webhookId = fileName.replace('.json', '');
      if (!validateWebhookIdForPath(webhookId)) {
        this.logger.warn(`Skipping invalid global webhook file name: ${fileName}`);
        continue;
      }

      const filePath = join(globalPath, fileName);
      try {
        const content = await readFile(filePath, 'utf-8');
        const webhook = JSON.parse(content) as PersistedGlobalWebhook;

        // Validate version
        if (webhook.version !== PERSISTENCE_SCHEMA_VERSION) {
          this.logger.warn(
            `Unknown global webhook version ${webhook.version} in ${filePath}, expected ${PERSISTENCE_SCHEMA_VERSION}`,
          );
          continue;
        }

        webhooks.push(webhook);
      } catch (error) {
        this.logger.warn(
          `Failed to load global webhook from ${filePath}: ${(error as Error).message}`,
        );
      }
    }

    return webhooks;
  }

  // ============================================
  // Policy Resolution
  // ============================================

  /**
   * Resolve the persistence state for an inbox based on policy and user preference.
   *
   * @param preference - User's requested persistence preference ('persistent' | 'ephemeral' | undefined)
   * @returns true if the inbox should be persisted
   */
  resolvePersistenceState(preference?: 'persistent' | 'ephemeral'): boolean {
    switch (this.config.policy) {
      case PersistencePolicy.ALWAYS:
        // All inboxes persistent, user preference ignored
        return true;

      case PersistencePolicy.NEVER:
        // No persistence allowed, user preference ignored
        return false;

      case PersistencePolicy.ENABLED:
        // Persistent by default, user can opt out
        return preference !== 'ephemeral';

      case PersistencePolicy.DISABLED:
        // Ephemeral by default, user can opt in
        return preference === 'persistent';

      default:
        // Defensive fallback
        return false;
    }
  }

  /**
   * Get the current persistence policy.
   *
   * @returns Current persistence policy
   */
  getPolicy(): PersistencePolicy {
    return this.config.policy;
  }

  // ============================================
  // Hydration Functions
  // ============================================

  /**
   * Convert a persisted inbox to an in-memory Inbox object.
   *
   * @param persisted - Persisted inbox data
   * @returns Hydrated Inbox object
   */
  private hydrateInbox(persisted: PersistedInbox): Inbox {
    return {
      emailAddress: persisted.emailAddress,
      inboxHash: persisted.inboxHash,
      clientKemPk: persisted.clientKemPk,
      encrypted: persisted.encrypted,
      emailAuth: persisted.emailAuth,
      spamAnalysis: persisted.spamAnalysis,
      chaos: persisted.chaos,
      persistent: true,
      createdAt: new Date(persisted.createdAt),
      expiresAt: persisted.expiresAt ? new Date(persisted.expiresAt) : null,
      emails: new Map(),
      emailsHash: this.calculateEmptyEmailsHash(),
    };
  }

  /**
   * Convert a persisted inbox webhook to an in-memory Webhook object.
   *
   * @param persisted - Persisted webhook data
   * @returns Hydrated Webhook object
   */
  private hydrateInboxWebhook(persisted: PersistedInboxWebhook): Webhook {
    return {
      id: persisted.id,
      url: persisted.url,
      events: persisted.events,
      scope: 'inbox',
      inboxHash: persisted.inboxHash,
      inboxEmail: persisted.inboxEmail,
      enabled: persisted.enabled,
      secret: persisted.secret,
      previousSecret: persisted.previousSecret,
      previousSecretExpiresAt: persisted.previousSecretExpiresAt
        ? new Date(persisted.previousSecretExpiresAt)
        : undefined,
      template: persisted.template,
      filter: persisted.filter,
      description: persisted.description,
      createdAt: new Date(persisted.createdAt),
      updatedAt: persisted.updatedAt ? new Date(persisted.updatedAt) : undefined,
      // Reset stats on startup - stats are not persisted
      stats: this.createEmptyStats(),
    };
  }

  /**
   * Convert a persisted global webhook to an in-memory Webhook object.
   *
   * @param persisted - Persisted webhook data
   * @returns Hydrated Webhook object
   */
  private hydrateGlobalWebhook(persisted: PersistedGlobalWebhook): Webhook {
    return {
      id: persisted.id,
      url: persisted.url,
      events: persisted.events,
      scope: 'global',
      enabled: persisted.enabled,
      secret: persisted.secret,
      previousSecret: persisted.previousSecret,
      previousSecretExpiresAt: persisted.previousSecretExpiresAt
        ? new Date(persisted.previousSecretExpiresAt)
        : undefined,
      template: persisted.template,
      filter: persisted.filter,
      description: persisted.description,
      createdAt: new Date(persisted.createdAt),
      updatedAt: persisted.updatedAt ? new Date(persisted.updatedAt) : undefined,
      // Reset stats on startup - stats are not persisted
      stats: this.createEmptyStats(),
    };
  }

  /**
   * Calculate the emailsHash for an empty inbox.
   * This matches the hash calculation in InboxStorageService for consistency.
   *
   * @returns Hash for empty email list
   */
  private calculateEmptyEmailsHash(): string {
    // Empty list joined = empty string
    return createHash('sha256').update('').digest('base64url');
  }

  /**
   * Create empty webhook stats for hydration.
   *
   * @returns Empty stats object
   */
  private createEmptyStats(): WebhookStats {
    return {
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      consecutiveFailures: 0,
    };
  }
}
