import { describe, expect, it } from 'vitest';

import { MemoryStore } from './memory-store';
import { type ProposedTx } from './types';

const meta = (externalId: string) => ({
  channel: 'test',
  externalId,
  rawText: 'lunch 100 a',
});

const tx = (description: string, amount: bigint): ProposedTx => ({
  type: 'EXPENSE',
  occurredAt: new Date('2026-10-26T10:00:00Z'),
  description,
  category: null,
  spendAmount: amount,
  status: 'NEEDS_REVIEW',
  entries: [{ accountId: 'a', amount: -amount }],
});

const seeded = () =>
  new MemoryStore([
    {
      id: 'a',
      alias: 'a',
      name: 'A',
      kind: 'BANK',
      openingBalance: 1_000n,
    },
  ]);

describe('MemoryStore', () => {
  it('derives balances from opening balance plus non-voided entries', async () => {
    const store = seeded();
    await store.run(async (db) => {
      await db.insertTransaction(tx('one', 100n), meta('1'));
      await db.insertTransaction(tx('two', 50n), meta('2'));
    });
    expect((await store.run((db) => db.accounts()))[0]?.balance).toBe(850n);

    await store.run((db) => db.voidLatest(new Date()));
    expect((await store.run((db) => db.accounts()))[0]?.balance).toBe(900n);
  });

  it('rolls back everything when the callback throws', async () => {
    const store = seeded();
    const before = store.snapshot();
    await expect(
      store.run(async (db) => {
        await db.claim('test', '1');
        await db.insertTransaction(tx('one', 100n), meta('1'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(store.snapshot()).toEqual(before);
  });

  it('keeps working after a failed run', async () => {
    const store = seeded();
    await store.run(() => Promise.reject(new Error('boom'))).catch(() => {});
    expect(await store.run((db) => db.claim('test', '1'))).toBe(true);
  });

  it('claim is true once, then false', async () => {
    const store = seeded();
    expect(await store.run((db) => db.claim('test', '1'))).toBe(true);
    expect(await store.run((db) => db.claim('test', '1'))).toBe(false);
    expect(await store.run((db) => db.wasProcessed('test', '1'))).toBe(true);
    expect(await store.run((db) => db.wasProcessed('test', '2'))).toBe(false);
  });

  it('claims are per channel', async () => {
    const store = seeded();
    await store.run((db) => db.claim('telegram', '1'));
    expect(await store.run((db) => db.claim('whatsapp', '1'))).toBe(true);
  });

  it('serialises concurrent runs so only one claim wins', async () => {
    const store = seeded();
    const wins = await Promise.all([
      store.run((db) => db.claim('test', '1')),
      store.run((db) => db.claim('test', '1')),
    ]);
    expect(wins.sort()).toEqual([false, true]);
  });

  it('voidLatest skips voided rows, never deletes, and reports empty', async () => {
    const store = seeded();
    expect(await store.run((db) => db.voidLatest(new Date()))).toBeNull();

    await store.run(async (db) => {
      await db.insertTransaction(tx('one', 100n), meta('1'));
      await db.insertTransaction(tx('two', 50n), meta('2'));
    });
    const at = new Date('2026-10-27T00:00:00Z');
    expect(await store.run((db) => db.voidLatest(at))).toEqual({
      description: 'two',
    });
    expect(await store.run((db) => db.voidLatest(at))).toEqual({
      description: 'one',
    });
    expect(await store.run((db) => db.voidLatest(at))).toBeNull();
    expect(store.snapshot().transactions).toHaveLength(2);
  });

  it('snapshot is a copy', async () => {
    const store = seeded();
    store.snapshot().accounts.pop();
    expect(store.snapshot().accounts).toHaveLength(1);
  });
});
