import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb } from '../src/drizzle-store';
import { SUPABASE_ROOT_CA } from '../src/supabase-ca';

/**
 * Applies pending migrations. `pnpm db:migrate` loads .env (local Docker),
 * `pnpm db:migrate:prod` loads .env.production (Supabase). Not
 * `drizzle-kit migrate`: it loads .env before its config, so it cannot be
 * pointed at prod reliably, and it exits 1 without printing the error.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

// Local Docker has no TLS. Anything else must be Supabase with a verified
// certificate, so a wrong URL fails instead of connecting in plaintext.
const local = LOCAL_HOSTS.has(new URL(url).hostname);
const { db, pool } = createDb(url, local ? {} : { ca: SUPABASE_ROOT_CA });
try {
  await migrate(db, { migrationsFolder: 'drizzle' });
  console.log(
    `migrations applied (${local ? 'local' : 'hosted, TLS verified'})`,
  );
} catch (err) {
  // Print what failed, never the URL or password.
  const { password } = new URL(url);
  const e = err as { code?: string; message?: string; cause?: Error };
  const text = [e.message, e.cause?.message]
    .filter(Boolean)
    .join(' | ')
    .replaceAll(url, '<url>')
    .replaceAll(decodeURIComponent(password), '<password>');
  console.error(
    `migrate failed (${e.code ?? e.cause?.name ?? 'error'}): ${text}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
