import { sql } from 'drizzle-orm';

import { isLocalDatabaseUrl } from '../src/database-url';
import { createDb } from '../src/drizzle-store';
import { readOnly } from '../src/reads';
import { SUPABASE_ROOT_CA } from '../src/supabase-ca';

/**
 * Read-only: `pnpm db:check` locally, `pnpm db:check:prod` on Supabase. Prints row
 * counts, grants and policies. Never reads a row's contents, so the output is safe
 * to share.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const { db, pool } = createDb(url, {
  max: 1,
  ...(!isLocalDatabaseUrl(url) && { ca: SUPABASE_ROOT_CA }),
});

try {
  await readOnly(db, async (tx) => {
    const show = async (label: string, query: ReturnType<typeof sql>) =>
      console.log(label, JSON.stringify((await tx.execute(query)).rows));

    await show(
      'rows',
      sql`SELECT (SELECT count(*)::int FROM "Account") AS accounts,
                 (SELECT count(*)::int FROM "Transaction") AS transactions,
                 (SELECT count(*)::int FROM "Entry") AS entries,
                 (SELECT count(*)::int FROM "ProcessedMessage") AS messages`,
    );
    await show(
      'sign-in',
      sql`SELECT (SELECT count(*)::int FROM better_auth."user") AS users,
                 (SELECT count(*)::int FROM better_auth."session") AS sessions`,
    );
    await show(
      'migrations',
      sql`SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations`,
    );
    await show(
      'row-level security',
      sql`SELECT c.relname AS "table", c.relrowsecurity AS on
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`,
    );
    await show(
      'policies',
      sql`SELECT tablename AS "table", policyname AS name, cmd, roles::text
          FROM pg_policies WHERE schemaname = 'public' ORDER BY 1`,
    );
    await show(
      'dashboard role',
      sql`SELECT rolcanlogin AS login, rolsuper AS super, rolcreaterole AS createrole,
                 rolcreatedb AS createdb, rolreplication AS replication, rolbypassrls AS bypassrls
          FROM pg_roles WHERE rolname = 'hisaab_dashboard'`,
    );
    await show(
      'dashboard access',
      sql`SELECT has_table_privilege('hisaab_dashboard', '"Account"', 'SELECT') AS read_accounts,
                 has_column_privilege('hisaab_dashboard', '"Transaction"', 'spendAmount', 'SELECT') AS read_spend,
                 has_column_privilege('hisaab_dashboard', '"Transaction"', 'rawText', 'SELECT') AS read_raw_text,
                 has_table_privilege('hisaab_dashboard', '"Transaction"', 'INSERT') AS write_ledger,
                 has_table_privilege('hisaab_dashboard', '"ProcessedMessage"', 'SELECT') AS read_messages`,
    );
    await show(
      'better_auth grants to anon or authenticated',
      sql`SELECT count(*)::int AS grants FROM information_schema.role_table_grants
          WHERE table_schema = 'better_auth' AND grantee IN ('anon', 'authenticated')`,
    );
  });
} catch (err) {
  // Fixed fields only: a query error can hold parameters.
  const e = err as { code?: string; cause?: { code?: string } };
  console.error(`failed: ${e.cause?.code ?? e.code ?? 'unknown error'}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
