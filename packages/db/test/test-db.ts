import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

export const dashboardRoleScript = () =>
  readFile(
    fileURLToPath(new URL('../scripts/dashboard-role.sql', import.meta.url)),
    'utf8',
  );

export const applyDashboardRole = async (pool: pg.Pool) => {
  await pool.query(await dashboardRoleScript());
};

/**
 * Roles belong to the whole Postgres server, so the local dev and test databases
 * share this one. It takes the local admin password, which keeps a test run from
 * changing it to something else and adds no new secret.
 */
export const setDashboardRolePassword = (pool: pg.Pool, url: URL) =>
  pool.query(
    `ALTER ROLE hisaab_dashboard PASSWORD ${pg.escapeLiteral(decodeURIComponent(url.password))}`,
  );

export const dashboardRoleUrl = (url: URL): string =>
  Object.assign(new URL(url), { username: 'hisaab_dashboard' }).toString();

/** Throws unless the URL names a database ending in `_test`. Used before anything is created or wiped. */
export function assertTestDatabaseUrl(raw: string | undefined): URL {
  if (!raw) {
    throw new Error(
      'TEST_DATABASE_URL is not set. See packages/db/.env.example.',
    );
  }
  const url = new URL(raw);
  if (!/^[a-z0-9]+(_[a-z0-9]+)*_test$/.test(url.pathname.slice(1))) {
    throw new Error(
      'TEST_DATABASE_URL must point at a database ending in _test',
    );
  }
  return url;
}
