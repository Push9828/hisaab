import { eq, sql } from 'drizzle-orm';

import { verification } from '../src/auth-schema';
import { isLocalDatabaseUrl, parseDatabaseUrl } from '../src/database-url';
import { createDb } from '../src/drizzle-store';
import { readAccounts, readTransactions } from '../src/reads';
import { SUPABASE_ROOT_CA } from '../src/supabase-ca';

/**
 * Connects as hisaab_dashboard, the way the dashboard will, and tries what it should
 * and should not be able to do: `pnpm db:check:role:prod`. Forbidden writes run in a
 * transaction that always rolls back. One real write: a row added to and removed from
 * better_auth.verification. Prints pass or fail and error codes, never rows.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
if (!parseDatabaseUrl(url).username.startsWith('hisaab_dashboard')) {
  throw new Error('Refusing: DATABASE_URL is not the hisaab_dashboard role');
}

const { db, pool } = createDb(url, {
  max: 1,
  ...(!isLocalDatabaseUrl(url) && { ca: SUPABASE_ROOT_CA }),
});

const DENIED = '42501';
let failures = 0;
const report = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && ` (${detail})`}`);
};
const codeOf = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x.cause?.code ?? x.code ?? 'unknown error';
};

/** Runs one statement in a transaction that always rolls back, returning the error code. */
async function attempt(statement: string): Promise<string | undefined> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(statement);
    return undefined;
  } catch (e) {
    return codeOf(e);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

const denied = async (name: string, statement: string) => {
  const code = await attempt(statement);
  report(name, code === DENIED, code ?? 'it was allowed');
};

try {
  const accounts = await readAccounts(db);
  report('reads accounts', true, `${accounts.length} rows`);
  // Zero rows looks the same as a missing policy, so check the policies directly.
  const { rows } = await db.execute(
    sql`SELECT count(*)::int AS policies FROM pg_policies
        WHERE policyname = 'dashboard_read'
          AND tablename IN ('Account', 'Entry', 'Transaction')`,
  );
  report(
    'can see rows through its read policies',
    rows[0]?.policies === 3,
    `${String(rows[0]?.policies)} of 3`,
  );
  const txs = await readTransactions(db, {
    start: new Date(0),
    end: new Date('2100-01-01T00:00:00Z'),
  });
  report('reads transactions', true, `${txs.length} rows`);

  await db.delete(verification).where(eq(verification.id, 'role-check'));
  await db.insert(verification).values({
    id: 'role-check',
    identifier: 'role-check',
    value: 'role-check',
    expiresAt: new Date(),
  });
  await db.delete(verification).where(eq(verification.id, 'role-check'));
  report('reads and writes better_auth', true);

  await denied(
    'cannot add a transaction',
    `INSERT INTO "Transaction" ("type", "occurredAt", "description", "spendAmount", "channel", "externalId", "rawText")
     VALUES ('EXPENSE', now(), 'x', 1, 'role-check', 'role-check', 'x')`,
  );
  await denied('cannot change an account', `UPDATE "Account" SET "name" = 'x'`);
  await denied('cannot delete entries', 'DELETE FROM "Entry"');
  await denied('cannot read rawText', 'SELECT "rawText" FROM "Transaction"');
  await denied(
    'cannot read description',
    'SELECT "description" FROM "Transaction"',
  );
  await denied('cannot read messages', 'SELECT * FROM "ProcessedMessage"');
} catch (e) {
  report('connects and reads', false, codeOf(e));
} finally {
  await pool.end();
}

console.log(failures === 0 ? 'all good' : `${failures} failed`);
process.exitCode = failures === 0 ? 0 : 1;
