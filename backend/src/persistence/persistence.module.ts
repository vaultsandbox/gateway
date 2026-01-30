import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PERSISTENCE_CONFIG } from './persistence.constants';
import type { PersistenceConfig } from './persistence.interfaces';
import { PersistencePolicy, DEFAULT_DATA_PATH } from '../config/config.constants';
import type { VsbConfiguration } from '../config/config.types';

/**
 * Configuration provider for the PersistenceModule.
 * Extracts persistence configuration from the global config service.
 */
const persistenceConfigProvider = {
  provide: PERSISTENCE_CONFIG,
  useFactory: (configService: ConfigService): PersistenceConfig => {
    const persistence = configService.get<VsbConfiguration['persistence']>('vsb.persistence');

    // Return default config if persistence is not configured (backend mode)
    if (!persistence) {
      return {
        policy: PersistencePolicy.NEVER,
        path: DEFAULT_DATA_PATH,
        persistentGlobalWebhooks: false,
      };
    }

    return {
      policy: persistence.policy,
      path: persistence.path,
      persistentGlobalWebhooks: persistence.persistentGlobalWebhooks,
    };
  },
  inject: [ConfigService],
};

/**
 * PersistenceModule provides optional persistence for inboxes and webhooks.
 *
 * Key concepts:
 * - Persistence = survives server restarts (data saved to disk)
 * - Emails are NOT persisted, only inbox metadata and webhook configurations
 * - TTL still applies to persisted inboxes - they expire based on their TTL
 *
 * Directory structure:
 * ```
 * {persistencePath}/
 * ├── global-webhooks/
 * │   └── whk_{id}.json
 * └── inboxes/
 *     └── {inboxHash}/
 *         ├── inbox.json
 *         └── webhooks/
 *             └── whk_{id}.json
 * ```
 */
@Module({
  providers: [persistenceConfigProvider],
  exports: [PERSISTENCE_CONFIG],
})
export class PersistenceModule {}
