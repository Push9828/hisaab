import { existsSync } from 'node:fs';

import { defineConfig } from 'drizzle-kit';

// `generate` needs no database; only `migrate` reads the URL.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
