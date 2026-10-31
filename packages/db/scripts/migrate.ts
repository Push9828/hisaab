import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { parseDatabaseUrl } from '../src/database-url';
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

// Fixed-text errors; rejects ?host= and ?port=, so the host checked here is
// the host pg connects to.
const parsed = parseDatabaseUrl(url);

// Local Docker has no TLS. Anything else must be Supabase with a verified
// certificate, so a wrong URL fails instead of connecting in plaintext.
const local = LOCAL_HOSTS.has(parsed.hostname);
const { db, pool } = createDb(url, local ? {} : { ca: SUPABASE_ROOT_CA });
try {
  await migrate(db, { migrationsFolder: 'drizzle' });
  console.log(
    `migrations applied (${local ? 'local' : 'hosted, TLS verified'})`,
  );
} catch (err) {
  const e = err as { code?: string; message?: string; cause?: Error };
  const text = redact(
    [e.message, e.cause?.message].filter(Boolean).join(' | '),
  );
  console.error(
    `migrate failed (${e.code ?? e.cause?.name ?? 'error'}): ${text}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}

/**
 * Strips the URL and password, and the user name when it is long enough to be
 * Supabase's `postgres.<project-ref>` (a short one like `u` would mangle words).
 */
function redact(text: string): string {
  const secrets = [url!, parsed.password];
  if (parsed.username.length > 8) secrets.push(parsed.username);
  for (const encoded of [...secrets.slice(1)]) {
    try {
      secrets.push(decodeURIComponent(encoded));
    } catch {
      // A malformed %-sequence: the encoded form is already in the list.
    }
  }
  let out = text;
  for (const s of secrets) if (s) out = out.replaceAll(s, '<redacted>');
  return out;
}
