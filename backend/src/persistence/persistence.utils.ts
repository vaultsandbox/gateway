/**
 * Persistence Utility Functions
 *
 * Provides atomic file operations and directory helpers for the persistence system.
 * All file operations are designed to be crash-safe using atomic write patterns.
 */

import { writeFile, rename, unlink, mkdir, rm, readdir, access, constants } from 'fs/promises';
import { randomBytes } from 'crypto';
import { dirname, join } from 'path';

/**
 * Atomically writes JSON data to a file.
 *
 * Uses a write-then-rename pattern to ensure data integrity:
 * 1. Write to a temporary file in the same directory
 * 2. Rename (atomic on POSIX) to the target path
 *
 * This prevents corruption if the process crashes during write.
 *
 * @param filePath - Target file path
 * @param data - Data to serialize as JSON
 * @throws {Error} If write or rename fails
 */
export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tempPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
  const content = JSON.stringify(data, null, 2);

  try {
    // Ensure parent directory exists
    await mkdir(dirname(filePath), { recursive: true });

    // Write to temp file
    await writeFile(tempPath, content, 'utf-8');

    // Atomic rename
    await rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on failure
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors - temp file may not exist
    }
    throw error;
  }
}

/**
 * Safely removes a directory and all its contents.
 *
 * Equivalent to `rm -rf` but handles non-existent directories gracefully.
 *
 * @param dirPath - Directory path to remove
 */
export async function removeDirectory(dirPath: string): Promise<void> {
  try {
    await rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    // ENOENT (directory doesn't exist) is OK - treat as success
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Ensures a directory exists, creating it and parents if necessary.
 *
 * @param dirPath - Directory path to create
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/**
 * Checks if a directory exists and is readable.
 *
 * @param dirPath - Directory path to check
 * @returns true if directory exists and is readable
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    await access(dirPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lists all subdirectories in a given directory.
 *
 * @param dirPath - Parent directory path
 * @returns Array of subdirectory names (not full paths)
 */
export async function listSubdirectories(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name);
  } catch (error) {
    // ENOENT means directory doesn't exist - return empty array
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Lists all JSON files in a directory.
 *
 * @param dirPath - Directory path to scan
 * @returns Array of file names (not full paths) ending in .json
 */
export async function listJsonFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name);
  } catch (error) {
    // ENOENT means directory doesn't exist - return empty array
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Validates that an inbox hash is safe for use in file paths.
 *
 * Inbox hashes should be Base64URL encoded (alphanumeric, hyphen, underscore)
 * and reasonable length. This prevents path traversal attacks.
 *
 * @param inboxHash - The inbox hash to validate
 * @returns true if the hash is safe for filesystem use
 */
export function validateInboxHashForPath(inboxHash: string): boolean {
  // Base64URL: alphanumeric, hyphen, underscore, no padding
  // Typical hash length: 43 characters (32 bytes = 256 bits)
  const base64UrlPattern = /^[a-zA-Z0-9_-]+$/;

  if (!inboxHash || inboxHash.length === 0) {
    return false;
  }

  // Prevent excessively long hashes
  if (inboxHash.length > 128) {
    return false;
  }

  // Prevent path traversal attempts
  if (inboxHash.includes('..') || inboxHash.includes('/') || inboxHash.includes('\\')) {
    return false;
  }

  return base64UrlPattern.test(inboxHash);
}

/**
 * Validates that a webhook ID is safe for use in file names.
 *
 * Webhook IDs should start with "whk_" followed by alphanumeric characters.
 *
 * @param webhookId - The webhook ID to validate
 * @returns true if the ID is safe for filesystem use
 */
export function validateWebhookIdForPath(webhookId: string): boolean {
  // Webhook IDs: "whk_" prefix followed by alphanumeric
  const webhookIdPattern = /^whk_[a-zA-Z0-9]+$/;

  if (!webhookId || webhookId.length === 0) {
    return false;
  }

  // Prevent excessively long IDs
  if (webhookId.length > 64) {
    return false;
  }

  return webhookIdPattern.test(webhookId);
}

/**
 * Builds the path to an inbox's persistence directory.
 *
 * @param basePath - Base persistence directory
 * @param inboxHash - Inbox hash (validated)
 * @returns Full path to the inbox directory
 */
export function getInboxPath(basePath: string, inboxHash: string): string {
  return join(basePath, 'inboxes', inboxHash);
}

/**
 * Builds the path to an inbox's metadata file.
 *
 * @param basePath - Base persistence directory
 * @param inboxHash - Inbox hash (validated)
 * @returns Full path to inbox.json
 */
export function getInboxFilePath(basePath: string, inboxHash: string): string {
  return join(basePath, 'inboxes', inboxHash, 'inbox.json');
}

/**
 * Builds the path to an inbox's webhooks directory.
 *
 * @param basePath - Base persistence directory
 * @param inboxHash - Inbox hash (validated)
 * @returns Full path to the webhooks directory
 */
export function getInboxWebhooksPath(basePath: string, inboxHash: string): string {
  return join(basePath, 'inboxes', inboxHash, 'webhooks');
}

/**
 * Builds the path to a specific inbox webhook file.
 *
 * @param basePath - Base persistence directory
 * @param inboxHash - Inbox hash (validated)
 * @param webhookId - Webhook ID (validated)
 * @returns Full path to the webhook JSON file
 */
export function getInboxWebhookFilePath(basePath: string, inboxHash: string, webhookId: string): string {
  return join(basePath, 'inboxes', inboxHash, 'webhooks', `${webhookId}.json`);
}

/**
 * Builds the path to the global webhooks directory.
 *
 * @param basePath - Base persistence directory
 * @returns Full path to the global webhooks directory
 */
export function getGlobalWebhooksPath(basePath: string): string {
  return join(basePath, 'global-webhooks');
}

/**
 * Builds the path to a specific global webhook file.
 *
 * @param basePath - Base persistence directory
 * @param webhookId - Webhook ID (validated)
 * @returns Full path to the webhook JSON file
 */
export function getGlobalWebhookFilePath(basePath: string, webhookId: string): string {
  return join(basePath, 'global-webhooks', `${webhookId}.json`);
}

/**
 * Safely removes a single file.
 *
 * Handles non-existent files gracefully.
 *
 * @param filePath - File path to remove
 */
export async function removeFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    // ENOENT (file doesn't exist) is OK - treat as success
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
