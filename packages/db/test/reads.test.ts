import {
  cashFlow,
  ingest,
  istMonthRange,
  people,
  spendByCategory,
} from '@hisaab/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDb,
  DrizzleStore,
  readAccounts,
  readTransactions,
  transactions,
} from '../src';
import { meta, seed, tx } from './store-contract';
import { assertTestDatabaseUrl } from './test-db';
import { readOnly } from '../src/reads';

// All names and numbers are fake. Amounts are paise.
const { db, pool } = createDb(
  assertTestDatabaseUrl(process.env.TEST_DATABASE_URL).toString(),
);
const store = new DrizzleStore(db);

const NOW = new Date('2026-10-26T10:00:00Z');
const OCTOBER = istMonthRange(2026, 10);

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE "Entry", "Transaction", "Account", "ProcessedMessage" RESTART IDENTITY CASCADE`,
  );
});
afterAll(() => pool.end());

async function openAccounts() {
  await store.run(async (txn) => {
    for (const account of [
      {
        alias: 'icici',
        name: 'ICICI',
        kind: 'BANK',
        openingBalance: 8_420_000n,
      },
      {
        alias: 'icicicc',
        name: 'ICICI-CC',
        kind: 'CREDIT_CARD',
        openingBalance: -150_000n,
      },
      { alias: 'bom', name: 'BOM', kind: 'BANK', openingBalance: 5_000_000n },
      { alias: 'john', name: 'John', kind: 'RECEIVABLE', openingBalance: 0n },
      { alias: 'sam', name: 'Sam', kind: 'RECEIVABLE', openingBalance: 0n },
    ] as const) {
      await txn.createAccount(account);
    }
  });
}

async function send(...messages: string[]) {
  for (const [i, text] of messages.entries()) {
    await ingest(
      { channel: 'test', externalId: `m${i}`, text, now: NOW },
      store,
    );
  }
}

/** An expense of 100 paise at an exact instant, written straight to the store. */
const expenseAt = (accountId: string, id: string, occurredAt: Date) =>
  store.run((txn) =>
    txn.insertTransaction({ ...tx(accountId, id, 100n), occurredAt }, meta(id)),
  );

describe('readAccounts', () => {
  it('matches the balances the ledger store derives', async () => {
    await openAccounts();
    await send('petrol 4k cc icici', 'pay icicicc 4k from icici');
    const read = await readAccounts(db);
    expect(read).toEqual(await store.run((txn) => txn.accounts()));
    expect(read.find((a) => a.alias === 'icici')?.balance).toBe(8_020_000n);
    expect(read.find((a) => a.alias === 'icicicc')?.balance).toBe(-150_000n);
  });

  it('excludes voided entries from the balance', async () => {
    await openAccounts();
    await send('emi 32k bom', 'undo');
    const read = await readAccounts(db);
    expect(read.find((a) => a.alias === 'bom')?.balance).toBe(5_000_000n);
  });

  it('keeps balances beyond 2^53 exact', async () => {
    const opening = 2n ** 60n + 1n;
    const a = await seed(store, opening);
    await store.run((txn) => txn.insertTransaction(tx(a, 'x', 1n), meta('x')));
    expect((await readAccounts(db))[0]?.balance).toBe(opening - 1n);
  });

  it('is empty with no accounts', async () => {
    expect(await readAccounts(db)).toEqual([]);
  });
});

describe('readTransactions', () => {
  it('returns the row and its entries, in creation order', async () => {
    await openAccounts();
    await send('emi 32k bom', 'dinner 4000 split john 1000 sam 1000 cc icici');
    const accounts = await readAccounts(db);
    const idOf = (alias: string) => accounts.find((a) => a.alias === alias)?.id;

    expect(await readTransactions(db, OCTOBER)).toEqual([
      {
        type: 'EXPENSE',
        occurredAt: NOW,
        category: 'Home loan EMI',
        spendAmount: 3_200_000n,
        voidedAt: null,
        entries: [{ accountId: idOf('bom'), amount: -3_200_000n }],
      },
      {
        type: 'SPLIT',
        occurredAt: NOW,
        category: 'Food',
        spendAmount: 200_000n,
        voidedAt: null,
        entries: expect.arrayContaining([
          { accountId: idOf('icicicc'), amount: -400_000n },
          { accountId: idOf('john'), amount: 100_000n },
          { accountId: idOf('sam'), amount: 100_000n },
        ]),
      },
    ]);
  });

  it('uses IST month boundaries: start included, end excluded', async () => {
    const a = await seed(store);
    const { start, end } = OCTOBER;
    await expenseAt(a, 'before', new Date(start.getTime() - 1));
    await expenseAt(a, 'first', start);
    await expenseAt(a, 'last', new Date(end.getTime() - 1));
    await expenseAt(a, 'after', end);

    const read = await readTransactions(db, OCTOBER);
    expect(read.map((t) => t.occurredAt)).toEqual([
      start,
      new Date(end.getTime() - 1),
    ]);
  });

  it('keeps a 31 Oct 23:59 IST expense in October and 1 Nov 00:00 IST out', async () => {
    const a = await seed(store);
    await expenseAt(a, 'oct', new Date('2026-10-31T23:59:00+05:30'));
    await expenseAt(a, 'nov', new Date('2026-11-01T00:00:00+05:30'));
    expect(await readTransactions(db, OCTOBER)).toHaveLength(1);
    expect(await readTransactions(db, istMonthRange(2026, 11))).toHaveLength(1);
  });

  it('excludes voided transactions', async () => {
    await openAccounts();
    await send('emi 32k bom', 'petrol 4k cc icici', 'undo');
    const read = await readTransactions(db, OCTOBER);
    expect(read.map((t) => t.category)).toEqual(['Home loan EMI']);
  });

  it('never returns rawText or the description', async () => {
    await openAccounts();
    await send('emi 32k bom');
    const [row] = await db.select().from(transactions);
    expect(row?.rawText).toBe('emi 32k bom'); // positive control

    const read = await readTransactions(db, OCTOBER);
    expect(Object.keys(read[0] ?? {}).sort()).toEqual([
      'category',
      'entries',
      'occurredAt',
      'spendAmount',
      'type',
      'voidedAt',
    ]);
  });

  it('keeps a transaction with no entries, so its spend is not lost', async () => {
    await db.insert(transactions).values({
      type: 'EXPENSE',
      occurredAt: NOW,
      description: 'x',
      spendAmount: 100n,
      channel: 'test',
      externalId: 'no-entries',
      rawText: 'x',
    });
    const read = await readTransactions(db, OCTOBER);
    expect(read).toMatchObject([{ spendAmount: 100n, entries: [] }]);
  });

  it('keeps amounts beyond 2^53 exact', async () => {
    const a = await seed(store);
    const big = 2n ** 60n + 1n;
    await store.run((txn) => txn.insertTransaction(tx(a, 'x', big), meta('x')));
    const [read] = await readTransactions(db, OCTOBER);
    expect(read?.spendAmount).toBe(big);
    expect(read?.entries).toEqual([{ accountId: a, amount: -big }]);
  });

  it('is empty for a month with no transactions', async () => {
    expect(await readTransactions(db, OCTOBER)).toEqual([]);
  });
});

describe('core reports over Postgres reads', () => {
  it('give the SPEC section 4 and 5 totals', async () => {
    await openAccounts();
    await send(
      'bal icici 85000', // example 8, first so that the ledger still says 84,200
      'petrol 4k cc icici',
      'pay icicicc 4k from icici',
      'xfer 25k icici bom',
      'emi 32k bom',
      'lend john 10k icici',
      'got john 5k icici',
      'dinner 4000 split john 1000 sam 1000 cc icici',
      'in 85k salary icici',
    );
    const txs = await readTransactions(db, OCTOBER);

    expect(spendByCategory(txs, OCTOBER)).toEqual([
      { category: 'Home loan EMI', total: 3_200_000n },
      { category: 'Transport', total: 400_000n },
      { category: 'Food', total: 200_000n },
    ]);
    expect(cashFlow(txs, OCTOBER)).toEqual({
      in: 8_500_000n,
      out: 3_800_000n,
      net: 4_700_000n,
      adjustments: 80_000n,
    });
    expect(people(await readAccounts(db))).toMatchObject({
      owesMe: [
        { name: 'John', amount: 600_000n },
        { name: 'Sam', amount: 100_000n },
      ],
      owesMeTotal: 700_000n,
    });
  });
});

describe('read transactions', () => {
  it('reject writes', async () => {
    const write = readOnly(db, (reader) =>
      reader.insert(transactions).values({
        type: 'EXPENSE',
        occurredAt: NOW,
        description: 'x',
        spendAmount: 100n,
        channel: 'test',
        externalId: 'write',
        rawText: 'x',
      }),
    );
    await expect(write).rejects.toMatchObject({
      cause: { code: '25006' }, // read_only_sql_transaction
    });
    expect(await db.select().from(transactions)).toEqual([]);
  });

  it('set a statement timeout', async () => {
    const result = await readOnly(db, (reader) =>
      reader.execute(sql`SHOW statement_timeout`),
    );
    expect(result.rows).toEqual([{ statement_timeout: '10s' }]);
  });

  it('do not wait for the ledger write lock', async () => {
    const a = await seed(store);
    // store.run holds the advisory lock for its whole callback, so a read that
    // took the same lock would hang here until its statement timeout.
    const during = await store.run(async () => ({
      accounts: await readAccounts(db),
      txs: await readTransactions(db, OCTOBER),
    }));
    expect(during.accounts.map((x) => x.id)).toEqual([a]);
    expect(during.txs).toEqual([]);
  });
});
