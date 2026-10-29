import { execFileSync } from 'node:child_process';

import pg from 'pg';

// Creates the test database if needed and brings it to the current migrations.
export default async function setup() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL is not set. See packages/db/.env.example.',
    );
  }
  const url = new URL(process.env.TEST_DATABASE_URL);
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9]+(_[a-z0-9]+)*_test$/.test(name)) {
    throw new Error(
      'TEST_DATABASE_URL must point at a database ending in _test',
    );
  }

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

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'pipe',
  });
}
