import { existsSync } from 'node:fs';

import { defineConfig } from 'prisma/config';

// Prisma 7 does not load .env itself.
if (existsSync('.env')) process.loadEnvFile('.env');

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url },
});
