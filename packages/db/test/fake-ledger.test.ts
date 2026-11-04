import {
  balancesByKind,
  cashFlow,
  istMonthRange,
  netInvested,
  people,
  spendByCategory,
} from '@hisaab/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  demoDatabaseUrl,
  FAKE_MESSAGES,
  seedFake,
} from '../scripts/fake-ledger';
import {
  createDb,
  processedMessages,
  readAccounts,
  readTransactions,
  transactions,
} from '../src';
import { assertTestDatabaseUrl } from './test-db';

const { db, pool } = createDb(
  assertTestDatabaseUrl(process.env.TEST_DATABASE_URL).toString(),
);

const rupees = (n: number) => BigInt(n) * 100n;

const month = async (m: number) => {
  const range = istMonthRange(2026, m);
  const txs = await readTransactions(db, range);
  return { flow: cashFlow(txs, range), spend: spendByCategory(txs, range) };
};

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE "Entry", "Transaction", "Account", "ProcessedMessage" RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});

describe('seedFake', () => {
  it('writes every message: none of them became a clarifying question', async () => {
    await seedFake(db);
    expect(await db.$count(processedMessages)).toBe(FAKE_MESSAGES.length);
  });

  it('is a no-op the second time', async () => {
    await seedFake(db);
    const before = await db.$count(transactions);
    const accounts = await readAccounts(db);
    await seedFake(db);
    expect(await db.$count(transactions)).toBe(before);
    expect(await readAccounts(db)).toEqual(accounts);
  });

  it('spreads three months, with the sums worked out by hand', async () => {
    await seedFake(db);
    const august = await month(8);
    const september = await month(9);
    const october = await month(10);

    expect(august.flow).toEqual({
      in: rupees(85_000),
      out: rupees(55_300),
      net: rupees(29_700),
      adjustments: 0n,
    });
    // Only my share of the split counts.
    expect(september.flow.out).toBe(rupees(56_500));
    expect(october.flow).toEqual({
      in: rupees(85_000),
      out: rupees(55_200),
      net: rupees(29_800),
      adjustments: rupees(500),
    });
  });

  it('shows every panel the dashboard has', async () => {
    await seedFake(db);
    const { spend } = await month(10);
    expect(spend.map((row) => row.category)).toEqual([
      'Home loan EMI',
      'Rent',
      'Groceries',
      'Transport',
      'Uncategorised',
      'Subscriptions',
    ]);

    const accounts = await readAccounts(db);
    expect(people(accounts)).toEqual({
      owesMe: [
        { name: 'RAHUL', amount: rupees(6_000) },
        { name: 'ANITA', amount: rupees(1_000) },
      ],
      owesMeTotal: rupees(7_000),
      iOwe: [{ name: 'RAVI', amount: rupees(3_000) }],
      iOweTotal: rupees(3_000),
    });
    expect(
      balancesByKind(accounts).map((group) => [group.kind, group.total]),
    ).toEqual([
      // The bank sum is after the investment moves: 10k + 10k + 5k + 10k - 3k.
      ['BANK', rupees(163_000 + 73_300 - 32_000)],
      ['CREDIT_CARD', rupees(4_800)],
      ['LOAN', rupees(2_500_000)],
      ['INVESTMENT', rupees(52_000)],
    ]);
  });

  it('nets investment moves by month, with the sums worked out by hand', async () => {
    await seedFake(db);
    const accounts = await readAccounts(db);
    const invested = async (m: number) => {
      const range = istMonthRange(2026, m);
      return netInvested(await readTransactions(db, range), accounts, range);
    };
    expect(await invested(8)).toBe(rupees(10_000));
    expect(await invested(9)).toBe(rupees(15_000));
    // 10k in, a 5k move between funds that nets to 0, 3k out.
    expect(await invested(10)).toBe(rupees(7_000));

    expect(
      balancesByKind(accounts).find((group) => group.kind === 'INVESTMENT'),
    ).toEqual({
      kind: 'INVESTMENT',
      accounts: [
        { name: 'MFALPHA', amount: rupees(25_000) },
        // Includes the 20k opening balance, which is in no month's figure.
        { name: 'MFBETA', amount: rupees(25_000) },
        { name: 'STOCKS', amount: rupees(2_000) },
      ],
      total: rupees(52_000),
    });
  });
});

describe('demoDatabaseUrl', () => {
  it('keeps the local server and credentials, and swaps the database', () => {
    expect(
      demoDatabaseUrl('postgresql://u:p@localhost:5433/hisaab').toString(),
    ).toBe('postgresql://u:p@localhost:5433/hisaab_demo');
  });

  it('accepts 127.0.0.1', () => {
    expect(
      demoDatabaseUrl('postgresql://u:p@127.0.0.1:5433/hisaab').pathname,
    ).toBe('/hisaab_demo');
  });

  it.each([
    'postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:5432/postgres',
    'postgresql://u:p@db.example.com/hisaab',
    'postgresql://u:p@localhost.example.com/hisaab',
  ])('refuses %s', (url) => {
    expect(() => demoDatabaseUrl(url)).toThrow('local');
  });

  it('never echoes the URL when it refuses', () => {
    expect(() =>
      demoDatabaseUrl('postgresql://u:secret@db.example.com/hisaab'),
    ).toThrow(expect.not.stringContaining('secret') as unknown as string);
  });
});
