import { ingest, istMonthRange } from '@hisaab/core';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  accounts,
  authSchema,
  createDb,
  DrizzleStore,
  entries,
  processedMessages,
  readAccounts,
  readTransactions,
  transactions,
} from '../src';
import {
  applyDashboardRole,
  assertTestDatabaseUrl,
  dashboardRoleScript,
  dashboardRoleUrl,
} from './test-db';

// Every query here runs as hisaab_dashboard unless it says `admin`. Fake data only.
const url = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const admin = createDb(url.toString());
const role = createDb(dashboardRoleUrl(url));

const NOW = new Date('2026-10-26T10:00:00Z');
const OCTOBER = istMonthRange(2026, 10);
const INSUFFICIENT_PRIVILEGE = '42501';

/** The Postgres error code the query failed with, or undefined if it went through. */
const failure = async (query: PromiseLike<unknown>) => {
  try {
    await query;
  } catch (e) {
    return (e as { cause?: { code?: string } }).cause?.code ?? 'unknown error';
  }
  return undefined;
};

const newTransaction = {
  type: 'EXPENSE',
  occurredAt: NOW,
  description: 'x',
  spendAmount: 100n,
  channel: 'test',
  externalId: 'from-role',
  rawText: 'x',
} as const;

beforeEach(async () => {
  await admin.db.execute(
    sql`TRUNCATE "Entry", "Transaction", "Account", "ProcessedMessage", better_auth."user", better_auth."verification" RESTART IDENTITY CASCADE`,
  );
  const store = new DrizzleStore(admin.db);
  await store.run((txn) =>
    txn.createAccount({
      alias: 'bom',
      name: 'BOM',
      kind: 'BANK',
      openingBalance: 5_000_000n,
    }),
  );
  await ingest(
    { channel: 'test', externalId: 'm1', text: 'emi 32k bom', now: NOW },
    store,
  );
});

afterAll(async () => {
  await role.pool.end();
  await admin.pool.end();
});

describe('hisaab_dashboard can do what the dashboard needs', () => {
  it('reads accounts with balances', async () => {
    expect(await readAccounts(role.db)).toMatchObject([
      { alias: 'bom', balance: 1_800_000n },
    ]);
  });

  it('reads transactions with entries', async () => {
    expect(await readTransactions(role.db, OCTOBER)).toMatchObject([
      { category: 'Home loan EMI', spendAmount: 3_200_000n },
    ]);
  });

  it('reads and writes all four Better Auth tables', async () => {
    const { user, session, account, verification } = authSchema;
    const now = new Date();
    await role.db.insert(user).values({
      id: 'u1',
      name: 'Fake Owner',
      email: 'owner@example.com',
    });
    await role.db.insert(session).values({
      id: 's1',
      token: 'fake-token',
      userId: 'u1',
      expiresAt: now,
      updatedAt: now,
    });
    await role.db.insert(account).values({
      id: 'a1',
      accountId: 'google-1',
      providerId: 'google',
      userId: 'u1',
      updatedAt: now,
    });
    await role.db.insert(verification).values({
      id: 'v1',
      identifier: 'state',
      value: 'x',
      expiresAt: now,
    });

    await role.db
      .update(user)
      .set({ emailVerified: true })
      .where(eq(user.id, 'u1'));
    expect(await role.db.select().from(user)).toMatchObject([
      { emailVerified: true },
    ]);
    expect(await role.db.select().from(session)).toHaveLength(1);
    expect(await role.db.select().from(account)).toHaveLength(1);
    expect(await role.db.select().from(verification)).toHaveLength(1);

    await role.db.delete(verification).where(eq(verification.id, 'v1'));
    await role.db.delete(session).where(eq(session.id, 's1'));
    await role.db.delete(account).where(eq(account.id, 'a1'));
    await role.db.delete(user).where(eq(user.id, 'u1'));
    expect(await role.db.select().from(user)).toEqual([]);
  });
});

describe('row-level security', () => {
  it.each(['Account', 'Entry', 'Transaction', 'ProcessedMessage'])(
    '%s has it on, so no role gets rows without a policy',
    async (table) => {
      const { rows } = await admin.pool.query(
        'SELECT relrowsecurity AS rls FROM pg_class WHERE oid = $1::regclass',
        [`"${table}"`],
      );
      expect(rows).toEqual([{ rls: true }]);
    },
  );

  it('lets hisaab_dashboard see rows, instead of silently showing nothing', async () => {
    expect(
      await role.db.select({ id: accounts.id }).from(accounts),
    ).toHaveLength(1);
    expect(
      await role.db.select({ id: entries.transactionId }).from(entries),
    ).toHaveLength(1);
    expect(await readTransactions(role.db, OCTOBER)).toHaveLength(1);
  });

  it('gives a role with table access but no policy nothing', async () => {
    const client = await admin.pool.connect();
    try {
      await client.query('DROP ROLE IF EXISTS sim_anon');
      await client.query('CREATE ROLE sim_anon NOLOGIN');
      await client.query('GRANT SELECT ON "Account" TO sim_anon');
      await client.query('SET ROLE sim_anon');
      const { rows } = await client.query('SELECT * FROM "Account"');
      expect(rows).toEqual([]);
    } finally {
      await client.query('RESET ROLE');
      await client.query('REVOKE ALL ON "Account" FROM sim_anon');
      await client.query('DROP ROLE sim_anon');
      client.release();
    }
  });
});

describe('hisaab_dashboard cannot change the ledger', () => {
  it.each([
    [
      'INSERT Transaction',
      () => role.db.insert(transactions).values(newTransaction),
    ],
    [
      'UPDATE Transaction',
      () => role.db.update(transactions).set({ spendAmount: 1n }),
    ],
    [
      'void a Transaction',
      () => role.db.update(transactions).set({ voidedAt: NOW }),
    ],
    ['DELETE Transaction', () => role.db.delete(transactions)],
    [
      'INSERT Entry',
      () =>
        role.db
          .insert(entries)
          .values({ transactionId: 'x', accountId: 'x', amount: 1n }),
    ],
    ['UPDATE Entry', () => role.db.update(entries).set({ amount: 1n })],
    ['DELETE Entry', () => role.db.delete(entries)],
    [
      'INSERT Account',
      () =>
        role.db
          .insert(accounts)
          .values({ alias: 'x', name: 'x', kind: 'BANK' }),
    ],
    [
      'UPDATE Account',
      () => role.db.update(accounts).set({ openingBalance: 1n }),
    ],
    ['DELETE Account', () => role.db.delete(accounts)],
    [
      'INSERT ProcessedMessage',
      () =>
        role.db
          .insert(processedMessages)
          .values({ channel: 'c', externalId: 'x' }),
    ],
    [
      'TRUNCATE',
      () =>
        role.db.execute(
          sql`TRUNCATE "Entry", "Transaction", "Account" CASCADE`,
        ),
    ],
  ])('%s is denied', async (_name, query) => {
    expect(await failure(query())).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('ingest fails and leaves the ledger unchanged', async () => {
    const store = new DrizzleStore(role.db);
    await expect(
      ingest(
        { channel: 'test', externalId: 'm2', text: 'emi 1k bom', now: NOW },
        store,
      ),
    ).rejects.toThrow();
    expect(await admin.db.select().from(transactions)).toHaveLength(1);
  });

  it('positive control: the same writes work as admin', async () => {
    expect(
      await failure(admin.db.insert(transactions).values(newTransaction)),
    ).toBeUndefined();
  });
});

describe('hisaab_dashboard cannot read message text', () => {
  it.each([
    ['rawText', sql`SELECT "rawText" FROM "Transaction"`],
    ['description', sql`SELECT "description" FROM "Transaction"`],
    ['SELECT *', sql`SELECT * FROM "Transaction"`],
    ['ProcessedMessage', sql`SELECT * FROM "ProcessedMessage"`],
    ['the migrations table', sql`SELECT * FROM drizzle.__drizzle_migrations`],
  ])('%s is denied', async (_name, query) => {
    expect(await failure(role.db.execute(query))).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('positive control: rawText is there, as admin', async () => {
    const result = await admin.db.execute(
      sql`SELECT "rawText" FROM "Transaction"`,
    );
    expect(result.rows).toEqual([{ rawText: 'emi 32k bom' }]);
  });
});

describe('hisaab_dashboard cannot widen its own access', () => {
  it.each([
    ['create a table in public', sql`CREATE TABLE public.x (id int)`],
    ['create a table in better_auth', sql`CREATE TABLE better_auth.x (id int)`],
    ['create a schema', sql`CREATE SCHEMA x`],
    ['drop a Better Auth table', sql`DROP TABLE better_auth.verification`],
    ['alter a ledger table', sql`ALTER TABLE "Transaction" ADD COLUMN x int`],
    [
      'grant itself rawText',
      sql`GRANT SELECT ON "Transaction" TO hisaab_dashboard`,
    ],
    ['switch to the admin role', sql.raw(`SET ROLE "${url.username}"`)],
  ])('%s is denied', async (_name, query) => {
    expect(await failure(role.db.execute(query))).toBeDefined();
  });

  it('has no special role attributes', async () => {
    const result = await role.db.execute(sql`
      SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
    `);
    expect(result.rows).toEqual([
      {
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        rolbypassrls: false,
      },
    ]);
  });
});

describe('dashboard-role.sql', () => {
  it('can be run again, and takes back anything granted since', async () => {
    await admin.db.execute(
      sql`GRANT SELECT ("rawText") ON "Transaction" TO hisaab_dashboard`,
    );
    await admin.db.execute(
      sql`GRANT INSERT ON "Transaction" TO hisaab_dashboard`,
    );
    await admin.db.execute(
      sql`GRANT SELECT ON "ProcessedMessage" TO hisaab_dashboard`,
    );
    expect(
      await failure(role.db.execute(sql`SELECT "rawText" FROM "Transaction"`)),
    ).toBeUndefined();

    await applyDashboardRole(admin.pool);

    expect(
      await failure(role.db.execute(sql`SELECT "rawText" FROM "Transaction"`)),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    expect(
      await failure(role.db.insert(transactions).values(newTransaction)),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    expect(
      await failure(role.db.execute(sql`SELECT * FROM "ProcessedMessage"`)),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await readAccounts(role.db)).toHaveLength(1);
  });

  // Supabase's `postgres` admin is not a superuser, and only a role that holds an
  // attribute may change it. Fake admin role, created and dropped here.
  it('runs as a non-superuser admin, as on Supabase', async () => {
    const client = await admin.pool.connect();
    try {
      await client.query('DROP ROLE IF EXISTS sim_admin');
      await client.query('CREATE ROLE sim_admin NOLOGIN CREATEROLE');
      await client.query(`GRANT "${url.username}" TO sim_admin`);
      await client.query(
        'GRANT hisaab_dashboard TO sim_admin WITH ADMIN OPTION',
      );
      await client.query('SET ROLE sim_admin');
      await client.query(await dashboardRoleScript());
      await client.query('RESET ROLE');
      expect(await readAccounts(role.db)).toHaveLength(1);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.query('RESET ROLE');
      await client.query(`REVOKE "${url.username}" FROM sim_admin`);
      await client.query('REVOKE hisaab_dashboard FROM sim_admin');
      await client.query('DROP ROLE sim_admin');
      client.release();
    }
  });

  it('refuses to finish if the role has gained a special attribute', async () => {
    await admin.db.execute(sql`ALTER ROLE hisaab_dashboard CREATEDB`);
    try {
      await expect(applyDashboardRole(admin.pool)).rejects.toThrow(
        'special attribute',
      );
    } finally {
      await admin.pool.query('ROLLBACK').catch(() => {});
      await admin.db.execute(sql`ALTER ROLE hisaab_dashboard NOCREATEDB`);
    }
    await applyDashboardRole(admin.pool);
  });

  it('holds no password', async () => {
    const script = await dashboardRoleScript();
    const statements = script.replace(/--.*$/gm, '');
    expect(statements).not.toMatch(/PASSWORD/i);
  });
});
