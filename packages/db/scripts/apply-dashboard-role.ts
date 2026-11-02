import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { isLocalDatabaseUrl } from '../src/database-url';
import { createDb } from '../src/drizzle-store';
import { SUPABASE_ROOT_CA } from '../src/supabase-ca';

/**
 * Runs dashboard-role.sql: `pnpm db:role` locally, `pnpm db:role:prod` on
 * Supabase, with TLS verified as in migrate.ts. Run it after migrations, and
 * again whenever better_auth gains a table. Prints no values.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const { pool } = createDb(
  url,
  isLocalDatabaseUrl(url) ? {} : { ca: SUPABASE_ROOT_CA },
);
try {
  await pool.query(
    await readFile(
      fileURLToPath(new URL('./dashboard-role.sql', import.meta.url)),
      'utf8',
    ),
  );
  console.log('dashboard role applied');
} catch (err) {
  // Fixed fields only: a query error can hold parameters.
  const e = err as { code?: string; cause?: { code?: string } };
  console.error(`failed: ${e.cause?.code ?? e.code ?? 'unknown error'}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
