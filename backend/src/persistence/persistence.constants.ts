/**
 * Persistence Module Constants
 *
 * File names, version numbers, and directory structure constants
 * for the persistence system.
 */

/**
 * Current schema version for persisted data.
 * Increment when making breaking changes to persisted file formats.
 */
export const PERSISTENCE_SCHEMA_VERSION = 1;

/**
 * Directory names within the persistence path
 */
export const PERSISTENCE_DIRECTORIES = {
  INBOXES: 'inboxes',
  GLOBAL_WEBHOOKS: 'global-webhooks',
} as const;

/**
 * File names for persisted data
 */
export const PERSISTENCE_FILES = {
  INBOX: 'inbox.json',
  WEBHOOKS_DIR: 'webhooks',
} as const;

/**
 * Prefix for webhook files
 */
export const WEBHOOK_FILE_PREFIX = 'whk_';
export const WEBHOOK_FILE_EXTENSION = '.json';

/**
 * Injection token for persistence configuration
 */
export const PERSISTENCE_CONFIG = Symbol('PERSISTENCE_CONFIG');
