import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll } from '@jest/globals';
import { config as loadEnv } from 'dotenv';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { ConfigService } from '@nestjs/config';
import { SmtpService } from '../../src/smtp/smtp.service';
import { InboxStorageService } from '../../src/inbox/storage/inbox-storage.service';

const envPath = resolve(__dirname, '../../.env.test-e2e');
if (existsSync(envPath)) {
  loadEnv({ path: envPath, override: true, quiet: true });
}

interface BootstrappedApp {
  moduleRef: TestingModule;
  app: INestApplication;
  httpServer: App;
  configService: ConfigService;
  smtpPort: number;
  emailStorageDir: string;
}

let sharedApp: BootstrappedApp | null = null;

async function createTestApp(): Promise<BootstrappedApp> {
  if (sharedApp) {
    return sharedApp;
  }

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  // Listen on ephemeral port for SSE testing
  await app.listen(0);

  const configService = app.get(ConfigService);
  const smtpService = app.get(SmtpService);
  const httpServer = app.getHttpServer() as App;
  const smtpPort = smtpService.getListeningPort() ?? configService.get<number>('vsb.smtp.port') ?? 0;
  const emailStorageDir =
    configService.get<string>('vsb.storage.emailStorageDir') ?? resolve(process.cwd(), 'emails/e2e');

  sharedApp = {
    moduleRef,
    app,
    httpServer,
    configService,
    smtpPort,
    emailStorageDir,
  };

  return sharedApp;
}

export async function bootstrapTestApp(): Promise<BootstrappedApp> {
  return createTestApp();
}

export async function shutdownTestApp(): Promise<void> {
  if (!sharedApp) {
    return;
  }

  await sharedApp.app.close();
  await sharedApp.moduleRef.close();
  sharedApp = null;
}

export async function resetTestState(): Promise<void> {
  const instance = await bootstrapTestApp();
  const inboxStorage = instance.app.get(InboxStorageService);
  inboxStorage.clearAllInboxes();
  await resetEmailStorage(instance.emailStorageDir);
}

async function resetEmailStorage(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
  await mkdir(directory, { recursive: true });
}

export function useTestAppLifecycle() {
  beforeAll(async () => {
    await bootstrapTestApp();
    await resetTestState();
  });

  afterEach(async () => {
    await resetTestState();
  });

  afterAll(async () => {
    await shutdownTestApp();
  }, 60000); // Increased timeout for cleanup

  return {
    get app() {
      if (!sharedApp) {
        throw new Error('Test application not initialized');
      }
      return sharedApp.app;
    },
    get httpServer() {
      if (!sharedApp) {
        throw new Error('Test application not initialized');
      }
      return sharedApp.httpServer;
    },
    get actualHttpServer() {
      if (!sharedApp) {
        throw new Error('Test application not initialized');
      }
      return sharedApp.app.getHttpServer();
    },
    get smtpPort() {
      if (!sharedApp) {
        throw new Error('Test application not initialized');
      }
      return sharedApp.smtpPort;
    },
    get config() {
      if (!sharedApp) {
        throw new Error('Test application not initialized');
      }
      return sharedApp.configService;
    },
  };
}
