import { Test, TestingModule } from '@nestjs/testing';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';

import { PersistenceService } from '../persistence.service';
import { PERSISTENCE_CONFIG, PERSISTENCE_SCHEMA_VERSION } from '../persistence.constants';
import type { PersistenceConfig, PersistedInbox, PersistedInboxWebhook, PersistedGlobalWebhook } from '../persistence.interface';
import { PersistencePolicy } from '../../config/config.constants';
import { InboxStorageService } from '../../inbox/storage/inbox-storage.service';
import { WebhookStorageService } from '../../webhook/storage/webhook-storage.service';
import type { Inbox } from '../../inbox/interfaces';
import type { Webhook } from '../../webhook/interfaces/webhook.interface';
import { silenceNestLogger } from '../../../test/helpers/silence-logger';

describe('PersistenceService', () => {
  let service: PersistenceService;
  let inboxStorageService: jest.Mocked<InboxStorageService>;
  let webhookStorageService: jest.Mocked<WebhookStorageService>;
  let testDir: string;
  const restoreLogger = silenceNestLogger();

  const createTestConfig = (overrides: Partial<PersistenceConfig> = {}): PersistenceConfig => ({
    policy: PersistencePolicy.ENABLED,
    path: testDir,
    persistentGlobalWebhooks: true,
    ...overrides,
  });

  const createTestInbox = (overrides: Partial<Inbox> = {}): Inbox => ({
    emailAddress: 'test@example.com',
    inboxHash: 'testhash123',
    encrypted: false,
    emailAuth: false,
    persistent: true,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    emails: new Map(),
    emailsHash: createHash('sha256').update('').digest('base64url'),
    ...overrides,
  });

  const createTestWebhook = (overrides: Partial<Webhook> = {}): Webhook => ({
    id: 'whk_test123',
    url: 'https://example.com/webhook',
    secret: 'test-secret',
    events: ['email.received'],
    enabled: true,
    scope: 'global',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    stats: {
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      consecutiveFailures: 0,
    },
    ...overrides,
  });

  const createPersistedInbox = (overrides: Partial<PersistedInbox> = {}): PersistedInbox => ({
    version: PERSISTENCE_SCHEMA_VERSION,
    emailAddress: 'test@example.com',
    inboxHash: 'testhash123',
    encrypted: false,
    emailAuth: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    expiresAt: '2030-01-01T00:00:00.000Z',
    ...overrides,
  });

  const createPersistedInboxWebhook = (overrides: Partial<PersistedInboxWebhook> = {}): PersistedInboxWebhook => ({
    version: PERSISTENCE_SCHEMA_VERSION,
    id: 'whk_inbox1',
    url: 'https://example.com/inbox-webhook',
    events: ['email.received'],
    scope: 'inbox',
    inboxHash: 'testhash123',
    inboxEmail: 'test@example.com',
    enabled: true,
    secret: 'inbox-secret',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

  const createPersistedGlobalWebhook = (overrides: Partial<PersistedGlobalWebhook> = {}): PersistedGlobalWebhook => ({
    version: PERSISTENCE_SCHEMA_VERSION,
    id: 'whk_global1',
    url: 'https://example.com/global-webhook',
    events: ['email.received'],
    scope: 'global',
    enabled: true,
    secret: 'global-secret',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

  afterAll(() => restoreLogger());

  beforeEach(async () => {
    testDir = join(tmpdir(), `persistence-test-${randomBytes(8).toString('hex')}`);
    mkdirSync(testDir, { recursive: true });

    const mockInboxStorageService = {
      restoreInbox: jest.fn(),
    };

    const mockWebhookStorageService = {
      createInboxWebhook: jest.fn(),
      createGlobalWebhook: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersistenceService,
        { provide: PERSISTENCE_CONFIG, useValue: createTestConfig() },
        { provide: InboxStorageService, useValue: mockInboxStorageService },
        { provide: WebhookStorageService, useValue: mockWebhookStorageService },
      ],
    }).compile();

    service = module.get<PersistenceService>(PersistenceService);
    inboxStorageService = module.get(InboxStorageService);
    webhookStorageService = module.get(WebhookStorageService);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('onModuleInit', () => {
    it('should skip initialization when policy is NEVER', async () => {
      const module = await Test.createTestingModule({
        providers: [
          PersistenceService,
          { provide: PERSISTENCE_CONFIG, useValue: createTestConfig({ policy: PersistencePolicy.NEVER }) },
          { provide: InboxStorageService, useValue: { restoreInbox: jest.fn() } },
          { provide: WebhookStorageService, useValue: { createInboxWebhook: jest.fn(), createGlobalWebhook: jest.fn() } },
        ],
      }).compile();

      const svc = module.get<PersistenceService>(PersistenceService);
      await svc.onModuleInit();

      expect(existsSync(join(testDir, 'inboxes'))).toBe(false);
    });

    it('should create persistence directories when enabled', async () => {
      await service.onModuleInit();

      expect(existsSync(join(testDir, 'inboxes'))).toBe(true);
      expect(existsSync(join(testDir, 'global-webhooks'))).toBe(true);
    });

    it('should restore persisted inboxes and webhooks', async () => {
      // Create fresh module with fresh mocks and directory
      const freshDir = join(tmpdir(), `restore-test-${randomBytes(4).toString('hex')}`);
      const inboxHash = 'restorehash';
      const inboxDir = join(freshDir, 'inboxes', inboxHash);
      const webhooksDir = join(inboxDir, 'webhooks');
      mkdirSync(webhooksDir, { recursive: true });

      const persistedInbox = createPersistedInbox({ inboxHash });
      writeFileSync(join(inboxDir, 'inbox.json'), JSON.stringify(persistedInbox));

      const persistedWebhook = createPersistedInboxWebhook({ inboxHash });
      writeFileSync(join(webhooksDir, `${persistedWebhook.id}.json`), JSON.stringify(persistedWebhook));

      const mockInbox = { restoreInbox: jest.fn() };
      const mockWebhook = { createInboxWebhook: jest.fn(), createGlobalWebhook: jest.fn() };

      const module = await Test.createTestingModule({
        providers: [
          PersistenceService,
          { provide: PERSISTENCE_CONFIG, useValue: createTestConfig({ path: freshDir }) },
          { provide: InboxStorageService, useValue: mockInbox },
          { provide: WebhookStorageService, useValue: mockWebhook },
        ],
      }).compile();

      const svc = module.get<PersistenceService>(PersistenceService);
      await svc.onModuleInit();

      expect(mockInbox.restoreInbox).toHaveBeenCalled();
      expect(mockWebhook.createInboxWebhook).toHaveBeenCalled();

      rmSync(freshDir, { recursive: true, force: true });
    });

    it('should restore global webhooks when enabled', async () => {
      // Create fresh module with fresh mocks and directory
      const freshDir = join(tmpdir(), `global-wh-test-${randomBytes(4).toString('hex')}`);
      const globalDir = join(freshDir, 'global-webhooks');
      mkdirSync(globalDir, { recursive: true });
      mkdirSync(join(freshDir, 'inboxes'), { recursive: true });

      const persistedWebhook = createPersistedGlobalWebhook();
      writeFileSync(join(globalDir, `${persistedWebhook.id}.json`), JSON.stringify(persistedWebhook));

      const mockInbox = { restoreInbox: jest.fn() };
      const mockWebhook = { createInboxWebhook: jest.fn(), createGlobalWebhook: jest.fn() };

      const module = await Test.createTestingModule({
        providers: [
          PersistenceService,
          { provide: PERSISTENCE_CONFIG, useValue: createTestConfig({ path: freshDir }) },
          { provide: InboxStorageService, useValue: mockInbox },
          { provide: WebhookStorageService, useValue: mockWebhook },
        ],
      }).compile();

      const svc = module.get<PersistenceService>(PersistenceService);
      await svc.onModuleInit();

      expect(mockWebhook.createGlobalWebhook).toHaveBeenCalled();

      rmSync(freshDir, { recursive: true, force: true });
    });

    it('should skip global webhooks when disabled', async () => {
      const module = await Test.createTestingModule({
        providers: [
          PersistenceService,
          { provide: PERSISTENCE_CONFIG, useValue: createTestConfig({ persistentGlobalWebhooks: false }) },
          { provide: InboxStorageService, useValue: { restoreInbox: jest.fn() } },
          { provide: WebhookStorageService, useValue: { createInboxWebhook: jest.fn(), createGlobalWebhook: jest.fn() } },
        ],
      }).compile();

      const globalDir = join(testDir, 'global-webhooks');
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(join(globalDir, 'whk_test.json'), JSON.stringify(createPersistedGlobalWebhook()));

      const svc = module.get<PersistenceService>(PersistenceService);
      const wss = module.get<WebhookStorageService>(WebhookStorageService);
      await svc.onModuleInit();

      expect(wss.createGlobalWebhook).not.toHaveBeenCalled();
    });

    it('should remove expired inboxes during restore', async () => {
      const freshDir = join(tmpdir(), `expired-test-${randomBytes(4).toString('hex')}`);
      const inboxHash = 'expiredhash';
      const inboxDir = join(freshDir, 'inboxes', inboxHash);
      mkdirSync(inboxDir, { recursive: true });

      const expiredInbox = createPersistedInbox({
        inboxHash,
        expiresAt: '2020-01-01T00:00:00.000Z',
      });
      writeFileSync(join(inboxDir, 'inbox.json'), JSON.stringify(expiredInbox));

      const mockInbox = { restoreInbox: jest.fn() };
      const mockWebhook = { createInboxWebhook: jest.fn(), createGlobalWebhook: jest.fn() };

      const module = await Test.createTestingModule({
        providers: [
          PersistenceService,
          { provide: PERSISTENCE_CONFIG, useValue: createTestConfig({ path: freshDir }) },
          { provide: InboxStorageService, useValue: mockInbox },
          { provide: WebhookStorageService, useValue: mockWebhook },
        ],
      }).compile();

      const svc = module.get<PersistenceService>(PersistenceService);
      await svc.onModuleInit();

      expect(mockInbox.restoreInbox).not.toHaveBeenCalled();
      expect(existsSync(inboxDir)).toBe(false);

      rmSync(freshDir, { recursive: true, force: true });
    });

    it('should restore inbox with null expiresAt (never expires)', async () => {
      const freshDir = join(tmpdir(), `never-expires-${randomBytes(4).toString('hex')}`);
      const inboxHash = 'neverexpires';
      const inboxDir = join(freshDir, 'inboxes', inboxHash);
      mkdirSync(inboxDir, { recursive: true });

      const neverExpiresInbox = createPersistedInbox({
        inboxHash,
        expiresAt: null,
      });
      writeFileSync(join(inboxDir, 'inbox.json'), JSON.stringify(neverExpiresInbox));

      const mockInbox = { restoreInbox: jest.fn() };
      const mockWebhook = { createInboxWebhook: jest.fn(), createGlobalWebhook: jest.fn() };

      const module = await Test.createTestingModule({
        providers: [
          PersistenceService,
          { provide: PERSISTENCE_CONFIG, useValue: createTestConfig({ path: freshDir }) },
          { provide: InboxStorageService, useValue: mockInbox },
          { provide: WebhookStorageService, useValue: mockWebhook },
        ],
      }).compile();

      const svc = module.get<PersistenceService>(PersistenceService);
      await svc.onModuleInit();

      expect(mockInbox.restoreInbox).toHaveBeenCalled();

      rmSync(freshDir, { recursive: true, force: true });
    });
  });

  describe('persistInbox', () => {
    it('should write inbox to disk', async () => {
      const inbox = createTestInbox();

      await service.persistInbox(inbox);

      const filePath = join(testDir, 'inboxes', inbox.inboxHash, 'inbox.json');
      expect(existsSync(filePath)).toBe(true);

      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content.emailAddress).toBe(inbox.emailAddress);
      expect(content.version).toBe(PERSISTENCE_SCHEMA_VERSION);
    });

    it('should persist optional fields', async () => {
      const inbox = createTestInbox({
        clientKemPk: 'test-kem-pk',
        spamAnalysis: true,
        chaos: { dropRate: 0.1, delayMs: 100 },
      });

      await service.persistInbox(inbox);

      const filePath = join(testDir, 'inboxes', inbox.inboxHash, 'inbox.json');
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content.clientKemPk).toBe('test-kem-pk');
      expect(content.spamAnalysis).toBe(true);
      expect(content.chaos).toEqual({ dropRate: 0.1, delayMs: 100 });
    });

    it('should throw for invalid inbox hash', async () => {
      const inbox = createTestInbox({ inboxHash: '../invalid' });

      await expect(service.persistInbox(inbox)).rejects.toThrow('Invalid inbox hash');
    });

    it('should mark inbox as persisted', async () => {
      const inbox = createTestInbox();

      expect(service.isInboxPersisted(inbox.inboxHash)).toBe(false);

      await service.persistInbox(inbox);

      expect(service.isInboxPersisted(inbox.inboxHash)).toBe(true);
    });
  });

  describe('removePersistedInbox', () => {
    it('should remove inbox directory from disk', async () => {
      const inbox = createTestInbox();
      await service.persistInbox(inbox);

      await service.removePersistedInbox(inbox.inboxHash);

      const dirPath = join(testDir, 'inboxes', inbox.inboxHash);
      expect(existsSync(dirPath)).toBe(false);
    });

    it('should unmark inbox as persisted', async () => {
      const inbox = createTestInbox();
      await service.persistInbox(inbox);
      expect(service.isInboxPersisted(inbox.inboxHash)).toBe(true);

      await service.removePersistedInbox(inbox.inboxHash);

      expect(service.isInboxPersisted(inbox.inboxHash)).toBe(false);
    });

    it('should throw for invalid inbox hash', async () => {
      await expect(service.removePersistedInbox('../invalid')).rejects.toThrow('Invalid inbox hash');
    });
  });

  describe('loadPersistedInboxes', () => {
    it('should load all valid persisted inboxes', async () => {
      const inboxDir1 = join(testDir, 'inboxes', 'hash1');
      const inboxDir2 = join(testDir, 'inboxes', 'hash2');
      mkdirSync(inboxDir1, { recursive: true });
      mkdirSync(inboxDir2, { recursive: true });

      writeFileSync(join(inboxDir1, 'inbox.json'), JSON.stringify(createPersistedInbox({ inboxHash: 'hash1' })));
      writeFileSync(join(inboxDir2, 'inbox.json'), JSON.stringify(createPersistedInbox({ inboxHash: 'hash2' })));

      const result = await service.loadPersistedInboxes();

      expect(result).toHaveLength(2);
    });

    it('should skip invalid inbox directories', async () => {
      const validDir = join(testDir, 'inboxes', 'validhash');
      mkdirSync(validDir, { recursive: true });

      writeFileSync(join(validDir, 'inbox.json'), JSON.stringify(createPersistedInbox({ inboxHash: 'validhash' })));

      const result = await service.loadPersistedInboxes();

      expect(result).toHaveLength(1);
      expect(result[0].inboxHash).toBe('validhash');
    });

    it('should skip directory names with invalid characters', async () => {
      // Create a directory with a name containing invalid characters (space)
      const invalidDir = join(testDir, 'inboxes', 'has space');
      const validDir = join(testDir, 'inboxes', 'validhash2');
      mkdirSync(invalidDir, { recursive: true });
      mkdirSync(validDir, { recursive: true });

      // Even if the invalid dir has an inbox.json, it should be skipped
      writeFileSync(join(invalidDir, 'inbox.json'), JSON.stringify(createPersistedInbox({ inboxHash: 'has space' })));
      writeFileSync(join(validDir, 'inbox.json'), JSON.stringify(createPersistedInbox({ inboxHash: 'validhash2' })));

      const result = await service.loadPersistedInboxes();

      expect(result).toHaveLength(1);
      expect(result[0].inboxHash).toBe('validhash2');
    });

    it('should skip inboxes with wrong schema version', async () => {
      const inboxDir = join(testDir, 'inboxes', 'wrongversion');
      mkdirSync(inboxDir, { recursive: true });

      const inbox = createPersistedInbox({ inboxHash: 'wrongversion' });
      (inbox as any).version = 999;
      writeFileSync(join(inboxDir, 'inbox.json'), JSON.stringify(inbox));

      const result = await service.loadPersistedInboxes();

      expect(result).toHaveLength(0);
    });

    it('should skip directories without inbox.json', async () => {
      const inboxDir = join(testDir, 'inboxes', 'missingfile');
      mkdirSync(inboxDir, { recursive: true });

      const result = await service.loadPersistedInboxes();

      expect(result).toHaveLength(0);
    });

    it('should handle invalid JSON gracefully', async () => {
      const inboxDir = join(testDir, 'inboxes', 'badjson');
      mkdirSync(inboxDir, { recursive: true });
      writeFileSync(join(inboxDir, 'inbox.json'), 'not valid json');

      const result = await service.loadPersistedInboxes();

      expect(result).toHaveLength(0);
    });
  });

  describe('loadPersistedInboxWebhooks - additional', () => {
    it('should handle invalid JSON in webhook file gracefully', async () => {
      const inboxHash = 'badjsonwebhook';
      const webhooksDir = join(testDir, 'inboxes', inboxHash, 'webhooks');
      mkdirSync(webhooksDir, { recursive: true });

      writeFileSync(join(webhooksDir, 'whk_bad.json'), 'not valid json');

      const result = await service.loadPersistedInboxWebhooks(inboxHash);

      expect(result).toHaveLength(0);
    });
  });

  describe('persistInboxWebhook', () => {
    it('should write webhook to disk', async () => {
      const webhook = createTestWebhook({
        scope: 'inbox',
        inboxHash: 'webhookinbox',
        inboxEmail: 'test@example.com',
      });

      await service.persistInboxWebhook(webhook);

      const filePath = join(testDir, 'inboxes', 'webhookinbox', 'webhooks', `${webhook.id}.json`);
      expect(existsSync(filePath)).toBe(true);
    });

    it('should throw for missing inbox hash', async () => {
      const webhook = createTestWebhook({ scope: 'inbox', inboxHash: undefined });

      await expect(service.persistInboxWebhook(webhook)).rejects.toThrow('Invalid inbox hash');
    });

    it('should throw for invalid webhook ID', async () => {
      const webhook = createTestWebhook({
        scope: 'inbox',
        inboxHash: 'valid',
        id: 'invalid-id',
      });

      await expect(service.persistInboxWebhook(webhook)).rejects.toThrow('Invalid webhook ID');
    });

    it('should persist optional webhook fields', async () => {
      const webhook = createTestWebhook({
        scope: 'inbox',
        inboxHash: 'webhookinbox',
        previousSecret: 'old-secret',
        previousSecretExpiresAt: new Date('2024-06-01T00:00:00Z'),
        template: { body: '{{event}}' },
        filter: { senderDomains: ['example.com'] },
        description: 'Test webhook',
        updatedAt: new Date('2024-03-01T00:00:00Z'),
      });

      await service.persistInboxWebhook(webhook);

      const filePath = join(testDir, 'inboxes', 'webhookinbox', 'webhooks', `${webhook.id}.json`);
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content.previousSecret).toBe('old-secret');
      expect(content.template).toEqual({ body: '{{event}}' });
      expect(content.filter).toEqual({ senderDomains: ['example.com'] });
    });
  });

  describe('updatePersistedInboxWebhook', () => {
    it('should overwrite existing webhook file', async () => {
      const webhook = createTestWebhook({
        scope: 'inbox',
        inboxHash: 'updateinbox',
      });

      await service.persistInboxWebhook(webhook);
      webhook.enabled = false;
      await service.updatePersistedInboxWebhook(webhook);

      const filePath = join(testDir, 'inboxes', 'updateinbox', 'webhooks', `${webhook.id}.json`);
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content.enabled).toBe(false);
    });
  });

  describe('removePersistedInboxWebhook', () => {
    it('should remove webhook file from disk', async () => {
      const webhook = createTestWebhook({
        scope: 'inbox',
        inboxHash: 'removeinbox',
      });
      await service.persistInboxWebhook(webhook);

      await service.removePersistedInboxWebhook('removeinbox', webhook.id);

      const filePath = join(testDir, 'inboxes', 'removeinbox', 'webhooks', `${webhook.id}.json`);
      expect(existsSync(filePath)).toBe(false);
    });

    it('should throw for invalid inbox hash', async () => {
      await expect(service.removePersistedInboxWebhook('../invalid', 'whk_test')).rejects.toThrow('Invalid inbox hash');
    });

    it('should throw for invalid webhook ID', async () => {
      await expect(service.removePersistedInboxWebhook('valid', 'invalid')).rejects.toThrow('Invalid webhook ID');
    });
  });

  describe('loadPersistedInboxWebhooks', () => {
    it('should load all webhooks for an inbox', async () => {
      const inboxHash = 'loadwebhooks';
      const webhooksDir = join(testDir, 'inboxes', inboxHash, 'webhooks');
      mkdirSync(webhooksDir, { recursive: true });

      writeFileSync(join(webhooksDir, 'whk_1.json'), JSON.stringify(createPersistedInboxWebhook({ id: 'whk_1', inboxHash })));
      writeFileSync(join(webhooksDir, 'whk_2.json'), JSON.stringify(createPersistedInboxWebhook({ id: 'whk_2', inboxHash })));

      const result = await service.loadPersistedInboxWebhooks(inboxHash);

      expect(result).toHaveLength(2);
    });

    it('should return empty array for invalid inbox hash', async () => {
      const result = await service.loadPersistedInboxWebhooks('../invalid');

      expect(result).toEqual([]);
    });

    it('should skip webhooks with wrong schema version', async () => {
      const inboxHash = 'wrongversionwh';
      const webhooksDir = join(testDir, 'inboxes', inboxHash, 'webhooks');
      mkdirSync(webhooksDir, { recursive: true });

      const webhook = createPersistedInboxWebhook({ id: 'whk_bad', inboxHash });
      (webhook as any).version = 999;
      writeFileSync(join(webhooksDir, 'whk_bad.json'), JSON.stringify(webhook));

      const result = await service.loadPersistedInboxWebhooks(inboxHash);

      expect(result).toHaveLength(0);
    });

    it('should skip files with invalid webhook ID names', async () => {
      const inboxHash = 'invalidnames';
      const webhooksDir = join(testDir, 'inboxes', inboxHash, 'webhooks');
      mkdirSync(webhooksDir, { recursive: true });

      writeFileSync(join(webhooksDir, 'invalid.json'), JSON.stringify(createPersistedInboxWebhook()));
      writeFileSync(join(webhooksDir, 'whk_valid.json'), JSON.stringify(createPersistedInboxWebhook({ id: 'whk_valid', inboxHash })));

      const result = await service.loadPersistedInboxWebhooks(inboxHash);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('whk_valid');
    });
  });

  describe('Global Webhook Operations', () => {
    describe('isGlobalWebhookPersistenceEnabled', () => {
      it('should return config value', () => {
        expect(service.isGlobalWebhookPersistenceEnabled()).toBe(true);
      });
    });

    describe('persistGlobalWebhook', () => {
      it('should write webhook to disk', async () => {
        const webhook = createTestWebhook({ id: 'whk_global1' });

        await service.persistGlobalWebhook(webhook);

        const filePath = join(testDir, 'global-webhooks', 'whk_global1.json');
        expect(existsSync(filePath)).toBe(true);
      });

      it('should throw for invalid webhook ID', async () => {
        const webhook = createTestWebhook({ id: 'invalid' });

        await expect(service.persistGlobalWebhook(webhook)).rejects.toThrow('Invalid webhook ID');
      });
    });

    describe('updatePersistedGlobalWebhook', () => {
      it('should overwrite existing file', async () => {
        const webhook = createTestWebhook();
        await service.persistGlobalWebhook(webhook);
        webhook.enabled = false;

        await service.updatePersistedGlobalWebhook(webhook);

        const filePath = join(testDir, 'global-webhooks', `${webhook.id}.json`);
        const content = JSON.parse(readFileSync(filePath, 'utf-8'));
        expect(content.enabled).toBe(false);
      });
    });

    describe('removePersistedGlobalWebhook', () => {
      it('should remove webhook file', async () => {
        const webhook = createTestWebhook();
        await service.persistGlobalWebhook(webhook);

        await service.removePersistedGlobalWebhook(webhook.id);

        const filePath = join(testDir, 'global-webhooks', `${webhook.id}.json`);
        expect(existsSync(filePath)).toBe(false);
      });

      it('should throw for invalid webhook ID', async () => {
        await expect(service.removePersistedGlobalWebhook('invalid')).rejects.toThrow('Invalid webhook ID');
      });
    });

    describe('loadPersistedGlobalWebhooks', () => {
      it('should load all global webhooks', async () => {
        const globalDir = join(testDir, 'global-webhooks');
        mkdirSync(globalDir, { recursive: true });

        writeFileSync(join(globalDir, 'whk_1.json'), JSON.stringify(createPersistedGlobalWebhook({ id: 'whk_1' })));
        writeFileSync(join(globalDir, 'whk_2.json'), JSON.stringify(createPersistedGlobalWebhook({ id: 'whk_2' })));

        const result = await service.loadPersistedGlobalWebhooks();

        expect(result).toHaveLength(2);
      });

      it('should skip invalid webhook files', async () => {
        const globalDir = join(testDir, 'global-webhooks');
        mkdirSync(globalDir, { recursive: true });

        writeFileSync(join(globalDir, 'invalid.json'), JSON.stringify(createPersistedGlobalWebhook()));
        writeFileSync(join(globalDir, 'whk_valid.json'), JSON.stringify(createPersistedGlobalWebhook({ id: 'whk_valid' })));

        const result = await service.loadPersistedGlobalWebhooks();

        expect(result).toHaveLength(1);
      });

      it('should skip webhooks with wrong version', async () => {
        const globalDir = join(testDir, 'global-webhooks');
        mkdirSync(globalDir, { recursive: true });

        const webhook = createPersistedGlobalWebhook({ id: 'whk_bad' });
        (webhook as any).version = 999;
        writeFileSync(join(globalDir, 'whk_bad.json'), JSON.stringify(webhook));

        const result = await service.loadPersistedGlobalWebhooks();

        expect(result).toHaveLength(0);
      });

      it('should handle invalid JSON in global webhook file gracefully', async () => {
        const globalDir = join(testDir, 'global-webhooks');
        mkdirSync(globalDir, { recursive: true });

        writeFileSync(join(globalDir, 'whk_badjson.json'), 'not valid json');

        const result = await service.loadPersistedGlobalWebhooks();

        expect(result).toHaveLength(0);
      });
    });
  });

  describe('resolvePersistenceState', () => {
    const createServiceWithPolicy = async (policy: PersistencePolicy) => {
      const module = await Test.createTestingModule({
        providers: [
          PersistenceService,
          { provide: PERSISTENCE_CONFIG, useValue: createTestConfig({ policy }) },
          { provide: InboxStorageService, useValue: { restoreInbox: jest.fn() } },
          { provide: WebhookStorageService, useValue: { createInboxWebhook: jest.fn(), createGlobalWebhook: jest.fn() } },
        ],
      }).compile();
      return module.get<PersistenceService>(PersistenceService);
    };

    it('should return true for ALWAYS policy regardless of preference', async () => {
      const svc = await createServiceWithPolicy(PersistencePolicy.ALWAYS);

      expect(svc.resolvePersistenceState()).toBe(true);
      expect(svc.resolvePersistenceState('ephemeral')).toBe(true);
      expect(svc.resolvePersistenceState('persistent')).toBe(true);
    });

    it('should return false for NEVER policy regardless of preference', async () => {
      const svc = await createServiceWithPolicy(PersistencePolicy.NEVER);

      expect(svc.resolvePersistenceState()).toBe(false);
      expect(svc.resolvePersistenceState('ephemeral')).toBe(false);
      expect(svc.resolvePersistenceState('persistent')).toBe(false);
    });

    it('should default to persistent for ENABLED policy', async () => {
      const svc = await createServiceWithPolicy(PersistencePolicy.ENABLED);

      expect(svc.resolvePersistenceState()).toBe(true);
      expect(svc.resolvePersistenceState('persistent')).toBe(true);
      expect(svc.resolvePersistenceState('ephemeral')).toBe(false);
    });

    it('should default to ephemeral for DISABLED policy', async () => {
      const svc = await createServiceWithPolicy(PersistencePolicy.DISABLED);

      expect(svc.resolvePersistenceState()).toBe(false);
      expect(svc.resolvePersistenceState('ephemeral')).toBe(false);
      expect(svc.resolvePersistenceState('persistent')).toBe(true);
    });
  });

  describe('getPolicy', () => {
    it('should return the current persistence policy', () => {
      expect(service.getPolicy()).toBe(PersistencePolicy.ENABLED);
    });
  });

  describe('error handling during restoration', () => {
    it('should continue with other inboxes when one fails to restore', async () => {
      // Create fresh module with fresh mocks
      const freshDir = join(tmpdir(), `inbox-error-${randomBytes(4).toString('hex')}`);
      const inboxDir1 = join(freshDir, 'inboxes', 'good');
      const inboxDir2 = join(freshDir, 'inboxes', 'bad');
      mkdirSync(inboxDir1, { recursive: true });
      mkdirSync(inboxDir2, { recursive: true });

      writeFileSync(join(inboxDir1, 'inbox.json'), JSON.stringify(createPersistedInbox({ inboxHash: 'good' })));
      writeFileSync(join(inboxDir2, 'inbox.json'), JSON.stringify(createPersistedInbox({ inboxHash: 'bad' })));

      const mockInbox = {
        restoreInbox: jest.fn().mockImplementation((inbox) => {
          if (inbox.inboxHash === 'bad') {
            throw new Error('Restore failed');
          }
        }),
      };
      const mockWebhook = { createInboxWebhook: jest.fn(), createGlobalWebhook: jest.fn() };

      const module = await Test.createTestingModule({
        providers: [
          PersistenceService,
          { provide: PERSISTENCE_CONFIG, useValue: createTestConfig({ path: freshDir }) },
          { provide: InboxStorageService, useValue: mockInbox },
          { provide: WebhookStorageService, useValue: mockWebhook },
        ],
      }).compile();

      const svc = module.get<PersistenceService>(PersistenceService);
      await svc.onModuleInit();

      // Both inboxes should be attempted even if one fails
      expect(mockInbox.restoreInbox).toHaveBeenCalledTimes(2);

      rmSync(freshDir, { recursive: true, force: true });
    });

    it('should continue with other webhooks when one fails to restore', async () => {
      // Create fresh module with fresh mocks
      const freshTestDir = join(tmpdir(), `persistence-wh-error-${randomBytes(4).toString('hex')}`);
      mkdirSync(freshTestDir, { recursive: true });

      const inboxHash = 'webhookerror';
      const inboxDir = join(freshTestDir, 'inboxes', inboxHash);
      const webhooksDir = join(inboxDir, 'webhooks');
      mkdirSync(webhooksDir, { recursive: true });

      writeFileSync(join(inboxDir, 'inbox.json'), JSON.stringify(createPersistedInbox({ inboxHash })));
      writeFileSync(join(webhooksDir, 'whk_good.json'), JSON.stringify(createPersistedInboxWebhook({ id: 'whk_good', inboxHash })));
      writeFileSync(join(webhooksDir, 'whk_bad.json'), JSON.stringify(createPersistedInboxWebhook({ id: 'whk_bad', inboxHash })));

      const mockInbox = { restoreInbox: jest.fn() };
      const mockWebhook = {
        createInboxWebhook: jest.fn().mockImplementation((_, webhook) => {
          if (webhook.id === 'whk_bad') {
            throw new Error('Webhook restore failed');
          }
          return webhook;
        }),
        createGlobalWebhook: jest.fn(),
      };

      const module = await Test.createTestingModule({
        providers: [
          PersistenceService,
          { provide: PERSISTENCE_CONFIG, useValue: createTestConfig({ path: freshTestDir }) },
          { provide: InboxStorageService, useValue: mockInbox },
          { provide: WebhookStorageService, useValue: mockWebhook },
        ],
      }).compile();

      const svc = module.get<PersistenceService>(PersistenceService);
      await svc.onModuleInit();

      expect(mockWebhook.createInboxWebhook).toHaveBeenCalledTimes(2);

      rmSync(freshTestDir, { recursive: true, force: true });
    });

    it('should continue with other global webhooks when one fails', async () => {
      // Create fresh module with fresh mocks
      const freshTestDir = join(tmpdir(), `persistence-gw-error-${randomBytes(4).toString('hex')}`);
      mkdirSync(freshTestDir, { recursive: true });

      const globalDir = join(freshTestDir, 'global-webhooks');
      mkdirSync(globalDir, { recursive: true });

      writeFileSync(join(globalDir, 'whk_good.json'), JSON.stringify(createPersistedGlobalWebhook({ id: 'whk_good' })));
      writeFileSync(join(globalDir, 'whk_bad.json'), JSON.stringify(createPersistedGlobalWebhook({ id: 'whk_bad' })));

      const mockInbox = { restoreInbox: jest.fn() };
      const mockWebhook = {
        createInboxWebhook: jest.fn(),
        createGlobalWebhook: jest.fn().mockImplementation((webhook) => {
          if (webhook.id === 'whk_bad') {
            throw new Error('Global webhook restore failed');
          }
          return webhook;
        }),
      };

      const module = await Test.createTestingModule({
        providers: [
          PersistenceService,
          { provide: PERSISTENCE_CONFIG, useValue: createTestConfig({ path: freshTestDir }) },
          { provide: InboxStorageService, useValue: mockInbox },
          { provide: WebhookStorageService, useValue: mockWebhook },
        ],
      }).compile();

      const svc = module.get<PersistenceService>(PersistenceService);
      await svc.onModuleInit();

      expect(mockWebhook.createGlobalWebhook).toHaveBeenCalledTimes(2);

      rmSync(freshTestDir, { recursive: true, force: true });
    });
  });
});
