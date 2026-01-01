import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

// Load .env.test-e2e BEFORE any modules are imported
// This must run in setupFiles (not setupFilesAfterEnv) to ensure
// env vars are available during module compilation
const envPath = resolve(__dirname, '../.env.test-e2e');
if (existsSync(envPath)) {
  loadEnv({ path: envPath, override: true });
}
