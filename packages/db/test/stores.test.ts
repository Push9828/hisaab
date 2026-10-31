import { ingest, MemoryStore } from '@hisaab/core';
import { count, isNotNull, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  accounts,
  createDb,
  DrizzleStore,
  entries,
  transactions,
} from '../src';
import { meta, seed, storeContract, tx } from './store-contract';
import { assertTestDatabaseUrl } from './test-db';

const { db, pool } = createDb(
  assertTestDatabaseUrl(process.env.TEST_DATABASE_URL).toString(),
);
const store = new DrizzleStore(db);

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE "Entry", "Transaction", "Account", "ProcessedMessage" RESTART IDENTITY CASCADE`,
  );
});
afterAll(() => pool.end());

storeContract('MemoryStore', () => Promise.resolve(new MemoryStore()));
storeContract('DrizzleStore', () => Promise.resolve(store));

describe('DrizzleStore on Postgres', () => {
  let n = 0;
  const row = (
    type: 'EXPENSE' | 'TRANSFER' | 'INCOME' | 'ADJUSTMENT' | 'SPLIT',
    spendAmount: bigint,
  ) => ({
    type,
    occurredAt: new Date(),
    description: 'x',
    spendAmount,
    channel: 'c',
    externalId: `r${++n}`,
    rawText: 'x',
  });

  /** The name of the CHECK the insert violated, or undefined if it went through. */
  const violated = async (insert: Promise<unknown>) => {
    try {
      await insert;
    } catch (e) {
      return (
        (e as { cause?: { constraint?: string } }).cause?.constraint ??
        'unknown error'
      );
    }
    return undefined;
  };

  it('CHECKs accept valid rows (positive control)', async () => {
    for (const [type, spend] of [
      ['EXPENSE', 100n],
      ['TRANSFER', 0n],
      ['INCOME', 0n],
      ['SPLIT', 100n],
    ] as const) {
      expect(
        await violated(db.insert(transactions).values(row(type, spend))),
      ).toBeUndefined();
    }
  });

  it.each([
    ['TRANSFER', 100n, 'Transaction_spendAmount_zero_for_non_spend'],
    ['ADJUSTMENT', 100n, 'Transaction_spendAmount_zero_for_non_spend'],
    ['INCOME', 100n, 'Transaction_spendAmount_zero_for_non_spend'],
    ['EXPENSE', -5n, 'Transaction_spendAmount_nonneg'],
  ] as const)(
    'CHECK rejects %s with spend %s',
    async (type, spend, constraint) => {
      expect(
        await violated(db.insert(transactions).values(row(type, spend))),
      ).toBe(constraint);
    },
  );

  it('CHECK rejects a zero entry', async () => {
    const [a] = await db
      .insert(accounts)
      .values({ alias: 'a', name: 'A', kind: 'BANK' })
      .returning({ id: accounts.id });
    const [t] = await db
      .insert(transactions)
      .values(row('EXPENSE', 100n))
      .returning({ id: transactions.id });
    const bad = db.insert(entries).values({
      transactionId: t?.id as string,
      accountId: a?.id as string,
      amount: 0n,
    });
    expect(await violated(bad)).toBe('Entry_amount_nonzero');
  });

  it('serialises concurrent undos: each voids a different row', async () => {
    const total = 8;
    const a = await seed(store);
    await store.run(async (txn) => {
      for (let i = 1; i <= total; i++) {
        await txn.insertTransaction(tx(a, `tx${i}`, 1n), meta(`${i}`));
      }
    });
    const voided = await Promise.all(
      Array.from({ length: total }, () =>
        store.run((txn) => txn.voidLatest(new Date())),
      ),
    );
    expect(new Set(voided.map((v) => v?.description)).size).toBe(total);
  });

  it('FK restrict: a transaction that has entries cannot be deleted', async () => {
    const a = await seed(store);
    await store.run((txn) =>
      txn.insertTransaction(tx(a, 'one', 1n), meta('1')),
    );
    expect(await violated(db.delete(transactions))).toBe(
      'Entry_transactionId_Transaction_id_fk',
    );
  });

  it('never deletes: a voided row and its entries are still in the table', async () => {
    const a = await seed(store);
    await store.run((txn) =>
      txn.insertTransaction(tx(a, 'one', 1n), meta('1')),
    );
    await store.run((txn) => txn.voidLatest(new Date()));
    const [voided] = await db
      .select({ n: count() })
      .from(transactions)
      .where(isNotNull(transactions.voidedAt));
    const [kept] = await db.select({ n: count() }).from(entries);
    expect([voided?.n, kept?.n]).toEqual([1, 1]);
  });
});

describe('ingest() through DrizzleStore', () => {
  const send = (text: string, externalId: string) =>
    ingest({ channel: 'test', externalId, text, now: new Date() }, store);
  const balances = async () =>
    Object.fromEntries(
      (await store.run((txn) => txn.accounts())).map((a) => [
        a.alias,
        a.balance,
      ]),
    );
  const spend = async () =>
    (
      await db
        .select({ s: transactions.spendAmount })
        .from(transactions)
        .where(isNull(transactions.voidedAt))
    ).reduce((sum, r) => sum + r.s, 0n);

  beforeEach(async () => {
    await send('open icici 84200 bank', 'o1');
    await send('open icicicc 1500 cc', 'o2');
  });

  it('card bill payment moves money and adds no spend', async () => {
    await send('pay icicicc 4k from icici', 'p1');
    expect(await balances()).toEqual({
      icici: 8_020_000n,
      icicicc: -150_000n + 400_000n,
    });
    expect(await spend()).toBe(0n);
  });

  it('a replayed undo does not void a second transaction', async () => {
    await send('lunch 100 icici', 'a');
    await send('dinner 200 icici', 'b');
    await send('undo', 'u');
    expect((await send('undo', 'u')).duplicate).toBe(true);
    expect(await spend()).toBe(10_000n);
  });

  it('two concurrent deliveries of one message write once', async () => {
    const outs = await Promise.all([
      send('petrol 4k icici', 'r'),
      send('petrol 4k icici', 'r'),
    ]);
    expect(outs.map((o) => o.duplicate).sort()).toEqual([false, true]);
    expect(await spend()).toBe(400_000n);
  });
});

describe('createDb', () => {
  it('rejects ssl parameters in the URL when a CA is given (they would replace it)', () => {
    for (const q of [
      '?sslmode=verify-full',
      '?a=1&sslrootcert=x',
      '?SSL=true',
    ]) {
      expect(() =>
        createDb(`postgresql://u:p@db.invalid:5432/x${q}`, { ca: 'fake' }),
      ).toThrow('must not set ssl parameters');
    }
  });
});
