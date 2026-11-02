import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { createDb } from '../src';
import { assertTestDatabaseUrl } from './test-db';

const { db, pool } = createDb(
  assertTestDatabaseUrl(process.env.TEST_DATABASE_URL).toString(),
);
afterAll(() => pool.end());

const tablesIn = async (schema: string) => {
  const result = await db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = ${schema}`,
  );
  return result.rows.map((r) => r.table_name).sort();
};

describe('better_auth schema', () => {
  it('holds exactly the four Better Auth tables', async () => {
    expect(await tablesIn('better_auth')).toEqual([
      'account',
      'session',
      'user',
      'verification',
    ]);
  });

  it('adds nothing to the ledger tables in public', async () => {
    const tables = await tablesIn('public');
    expect(tables.filter((t) => t !== '__drizzle_migrations')).toEqual([
      'Account',
      'Entry',
      'ProcessedMessage',
      'Transaction',
    ]);
  });

  it('has no foreign key between the auth tables and the ledger', async () => {
    const result = await db.execute<{ crossing: string }>(sql`
      SELECT count(*)::text AS crossing
      FROM pg_constraint c
      JOIN pg_class source ON source.oid = c.conrelid
      JOIN pg_class target ON target.oid = c.confrelid
      WHERE c.contype = 'f'
        AND source.relnamespace <> target.relnamespace
    `);
    expect(result.rows).toEqual([{ crossing: '0' }]);
  });
});
