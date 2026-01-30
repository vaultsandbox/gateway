import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  atomicWriteJson,
  removeDirectory,
  ensureDirectory,
  directoryExists,
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
  removeFile,
} from '../persistence.utils';

describe('persistence.utils', () => {
  const testDir = join(tmpdir(), `persistence-utils-test-${randomBytes(8).toString('hex')}`);

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('atomicWriteJson', () => {
    it('should write JSON data to file', async () => {
      const filePath = join(testDir, 'atomic-write', 'test.json');
      const data = { foo: 'bar', num: 123 };

      await atomicWriteJson(filePath, data);

      const content = readFileSync(filePath, 'utf-8');
      expect(JSON.parse(content)).toEqual(data);
    });

    it('should create parent directories if they do not exist', async () => {
      const filePath = join(testDir, 'nested', 'deep', 'path', 'file.json');
      const data = { nested: true };

      await atomicWriteJson(filePath, data);

      expect(existsSync(filePath)).toBe(true);
    });

    it('should overwrite existing file', async () => {
      const filePath = join(testDir, 'overwrite.json');
      await atomicWriteJson(filePath, { version: 1 });
      await atomicWriteJson(filePath, { version: 2 });

      const content = readFileSync(filePath, 'utf-8');
      expect(JSON.parse(content)).toEqual({ version: 2 });
    });

    it('should format JSON with indentation', async () => {
      const filePath = join(testDir, 'formatted.json');
      const data = { key: 'value' };

      await atomicWriteJson(filePath, data);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('\n');
      expect(content).toContain('  ');
    });

  });

  describe('removeDirectory', () => {
    it('should remove a directory and its contents', async () => {
      const dirPath = join(testDir, 'to-remove');
      mkdirSync(dirPath, { recursive: true });
      writeFileSync(join(dirPath, 'file.txt'), 'content');

      await removeDirectory(dirPath);

      expect(existsSync(dirPath)).toBe(false);
    });

    it('should handle non-existent directory gracefully', async () => {
      const dirPath = join(testDir, 'does-not-exist');

      await expect(removeDirectory(dirPath)).resolves.toBeUndefined();
    });

    it('should remove nested directories', async () => {
      const dirPath = join(testDir, 'nested-remove');
      const nestedPath = join(dirPath, 'a', 'b', 'c');
      mkdirSync(nestedPath, { recursive: true });
      writeFileSync(join(nestedPath, 'deep.txt'), 'deep');

      await removeDirectory(dirPath);

      expect(existsSync(dirPath)).toBe(false);
    });

  });

  describe('ensureDirectory', () => {
    it('should create a directory if it does not exist', async () => {
      const dirPath = join(testDir, 'ensure-new');

      await ensureDirectory(dirPath);

      expect(existsSync(dirPath)).toBe(true);
    });

    it('should not fail if directory already exists', async () => {
      const dirPath = join(testDir, 'ensure-existing');
      mkdirSync(dirPath, { recursive: true });

      await expect(ensureDirectory(dirPath)).resolves.toBeUndefined();
    });

    it('should create nested directories', async () => {
      const dirPath = join(testDir, 'ensure', 'nested', 'path');

      await ensureDirectory(dirPath);

      expect(existsSync(dirPath)).toBe(true);
    });
  });

  describe('directoryExists', () => {
    it('should return true for existing directory', async () => {
      const dirPath = join(testDir, 'exists-dir');
      mkdirSync(dirPath, { recursive: true });

      const result = await directoryExists(dirPath);

      expect(result).toBe(true);
    });

    it('should return false for non-existent directory', async () => {
      const dirPath = join(testDir, 'not-exists');

      const result = await directoryExists(dirPath);

      expect(result).toBe(false);
    });

    it('should return true for a file (access check)', async () => {
      const filePath = join(testDir, 'file-exists.txt');
      writeFileSync(filePath, 'content');

      const result = await directoryExists(filePath);

      expect(result).toBe(true);
    });
  });

  describe('listSubdirectories', () => {
    it('should list all subdirectories', async () => {
      const parentDir = join(testDir, 'list-subdirs');
      mkdirSync(join(parentDir, 'dir1'), { recursive: true });
      mkdirSync(join(parentDir, 'dir2'), { recursive: true });
      writeFileSync(join(parentDir, 'file.txt'), 'not a dir');

      const result = await listSubdirectories(parentDir);

      expect(result).toContain('dir1');
      expect(result).toContain('dir2');
      expect(result).not.toContain('file.txt');
    });

    it('should return empty array for non-existent directory', async () => {
      const result = await listSubdirectories(join(testDir, 'no-such-dir'));

      expect(result).toEqual([]);
    });

    it('should exclude hidden directories (starting with dot)', async () => {
      const parentDir = join(testDir, 'list-hidden');
      mkdirSync(join(parentDir, '.hidden'), { recursive: true });
      mkdirSync(join(parentDir, 'visible'), { recursive: true });

      const result = await listSubdirectories(parentDir);

      expect(result).toContain('visible');
      expect(result).not.toContain('.hidden');
    });
  });

  describe('listJsonFiles', () => {
    it('should list all JSON files', async () => {
      const dirPath = join(testDir, 'list-json');
      mkdirSync(dirPath, { recursive: true });
      writeFileSync(join(dirPath, 'file1.json'), '{}');
      writeFileSync(join(dirPath, 'file2.json'), '{}');
      writeFileSync(join(dirPath, 'file.txt'), 'text');
      mkdirSync(join(dirPath, 'subdir'));

      const result = await listJsonFiles(dirPath);

      expect(result).toContain('file1.json');
      expect(result).toContain('file2.json');
      expect(result).not.toContain('file.txt');
      expect(result).not.toContain('subdir');
    });

    it('should return empty array for non-existent directory', async () => {
      const result = await listJsonFiles(join(testDir, 'no-json-dir'));

      expect(result).toEqual([]);
    });

    it('should return empty array for empty directory', async () => {
      const dirPath = join(testDir, 'empty-json-dir');
      mkdirSync(dirPath, { recursive: true });

      const result = await listJsonFiles(dirPath);

      expect(result).toEqual([]);
    });
  });

  describe('validateInboxHashForPath', () => {
    it('should accept valid Base64URL inbox hash', () => {
      expect(validateInboxHashForPath('abc123_-ABC')).toBe(true);
      expect(validateInboxHashForPath('ValidHash123')).toBe(true);
    });

    it('should reject empty string', () => {
      expect(validateInboxHashForPath('')).toBe(false);
    });

    it('should reject hash with path traversal attempts', () => {
      expect(validateInboxHashForPath('../etc')).toBe(false);
      expect(validateInboxHashForPath('foo/bar')).toBe(false);
      expect(validateInboxHashForPath('foo\\bar')).toBe(false);
    });

    it('should reject excessively long hash', () => {
      const longHash = 'a'.repeat(129);
      expect(validateInboxHashForPath(longHash)).toBe(false);
    });

    it('should accept hash at maximum length', () => {
      const maxHash = 'a'.repeat(128);
      expect(validateInboxHashForPath(maxHash)).toBe(true);
    });

    it('should reject hash with invalid characters', () => {
      expect(validateInboxHashForPath('hash with space')).toBe(false);
      expect(validateInboxHashForPath('hash@special')).toBe(false);
      expect(validateInboxHashForPath('hash.dot')).toBe(false);
    });
  });

  describe('validateWebhookIdForPath', () => {
    it('should accept valid webhook ID with whk_ prefix', () => {
      expect(validateWebhookIdForPath('whk_abc123')).toBe(true);
      expect(validateWebhookIdForPath('whk_TEST123')).toBe(true);
    });

    it('should reject empty string', () => {
      expect(validateWebhookIdForPath('')).toBe(false);
    });

    it('should reject ID without whk_ prefix', () => {
      expect(validateWebhookIdForPath('abc123')).toBe(false);
      expect(validateWebhookIdForPath('wbk_123')).toBe(false);
    });

    it('should reject excessively long ID', () => {
      const longId = 'whk_' + 'a'.repeat(61);
      expect(validateWebhookIdForPath(longId)).toBe(false);
    });

    it('should accept ID at maximum length', () => {
      const maxId = 'whk_' + 'a'.repeat(60);
      expect(validateWebhookIdForPath(maxId)).toBe(true);
    });

    it('should reject ID with special characters', () => {
      expect(validateWebhookIdForPath('whk_test-123')).toBe(false);
      expect(validateWebhookIdForPath('whk_test_123')).toBe(false);
      expect(validateWebhookIdForPath('whk_test.123')).toBe(false);
    });
  });

  describe('path builders', () => {
    const basePath = '/data/persistence';
    const inboxHash = 'abc123xyz';
    const webhookId = 'whk_webhook1';

    describe('getInboxPath', () => {
      it('should build correct inbox directory path', () => {
        const result = getInboxPath(basePath, inboxHash);
        expect(result).toBe('/data/persistence/inboxes/abc123xyz');
      });
    });

    describe('getInboxFilePath', () => {
      it('should build correct inbox.json path', () => {
        const result = getInboxFilePath(basePath, inboxHash);
        expect(result).toBe('/data/persistence/inboxes/abc123xyz/inbox.json');
      });
    });

    describe('getInboxWebhooksPath', () => {
      it('should build correct webhooks directory path', () => {
        const result = getInboxWebhooksPath(basePath, inboxHash);
        expect(result).toBe('/data/persistence/inboxes/abc123xyz/webhooks');
      });
    });

    describe('getInboxWebhookFilePath', () => {
      it('should build correct webhook file path', () => {
        const result = getInboxWebhookFilePath(basePath, inboxHash, webhookId);
        expect(result).toBe('/data/persistence/inboxes/abc123xyz/webhooks/whk_webhook1.json');
      });
    });

    describe('getGlobalWebhooksPath', () => {
      it('should build correct global webhooks directory path', () => {
        const result = getGlobalWebhooksPath(basePath);
        expect(result).toBe('/data/persistence/global-webhooks');
      });
    });

    describe('getGlobalWebhookFilePath', () => {
      it('should build correct global webhook file path', () => {
        const result = getGlobalWebhookFilePath(basePath, webhookId);
        expect(result).toBe('/data/persistence/global-webhooks/whk_webhook1.json');
      });
    });
  });

  describe('removeFile', () => {
    it('should remove an existing file', async () => {
      const filePath = join(testDir, 'to-remove.txt');
      writeFileSync(filePath, 'content');

      await removeFile(filePath);

      expect(existsSync(filePath)).toBe(false);
    });

    it('should handle non-existent file gracefully', async () => {
      const filePath = join(testDir, 'does-not-exist.txt');

      await expect(removeFile(filePath)).resolves.toBeUndefined();
    });
  });
});
