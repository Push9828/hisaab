import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { assertTestDatabaseUrl } from './test-db';

// Creates the test database if needed and brings it to the current migrations.
export default async function setup() {
  const url = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const name = url.pathname.slice(1);

  const admin = new pg.Client({
    connectionString: Object.assign(new URL(url), {
      pathname: '/postgres',
    }).toString(),
  });
  await admin.connect();
  try {
    const found = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    if (found.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const pool = new pg.Pool({ connectionString: url.toString() });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  } finally {
    await pool.end();
  }
}
