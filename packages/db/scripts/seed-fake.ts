import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { demoDatabaseUrl, seedFake } from './fake-ledger';
import { createDb } from '../src/drizzle-store';

/**
 * Fills the local `hisaab_demo` database with fake data: `pnpm db:seed`. Creates
 * it if needed and never touches any other database, so it cannot mix with what
 * the bot wrote locally. Loads .env only, and refuses a non-local DATABASE_URL.
 */
const raw = process.env.DATABASE_URL;
if (!raw) throw new Error('DATABASE_URL is not set');
const url = demoDatabaseUrl(raw);

const admin = new pg.Client({
  connectionString: Object.assign(new URL(url), {
    pathname: '/postgres',
  }).toString(),
});
await admin.connect();
try {
  const name = url.pathname.slice(1);
  const found = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [name],
  );
  if (found.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
} finally {
  await admin.end();
}

const { db, pool } = createDb(url.toString());
try {
  await migrate(db, { migrationsFolder: 'drizzle' });
  await pool.query(
    await readFile(
      fileURLToPath(new URL('./dashboard-role.sql', import.meta.url)),
      'utf8',
    ),
  );
  await seedFake(db);
  console.log('fake data ready in hisaab_demo');
} finally {
  await pool.end();
}
