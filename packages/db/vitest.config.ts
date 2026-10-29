import { existsSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

// Needs Postgres (pnpm db:up) and TEST_DATABASE_URL in packages/db/.env.
const envFile = new URL('.env', import.meta.url).pathname;
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  test: {
    name: '@hisaab/db',
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
  },
});
