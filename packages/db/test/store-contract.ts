import { describe, expect, it } from 'vitest';

import type { LedgerStore, ProposedTx } from '@hisaab/core';

// What every LedgerStore must do. Run against MemoryStore and DrizzleStore so
// the test double cannot drift from production. Fake data only.

export const meta = (externalId: string) => ({
  channel: 'test',
  externalId,
  rawText: 'lunch 100 a',
});

export const tx = (
  accountId: string,
  description: string,
  amount: bigint,
): ProposedTx => ({
  type: 'EXPENSE',
  occurredAt: new Date('2026-10-26T10:00:00Z'),
  description,
  category: null,
  spendAmount: amount,
  status: 'NEEDS_REVIEW',
  entries: [{ accountId, amount: -amount }],
});

/** Opens account "a" with 1,000 paise and returns its id. */
export async function seed(store: LedgerStore, openingBalance = 1_000n) {
  await store.run((db) =>
    db.createAccount({ alias: 'a', name: 'A', kind: 'BANK', openingBalance }),
  );
  const [account] = await store.run((db) => db.accounts());
  if (!account) throw new Error('seed failed');
  return account.id;
}

const balance = async (store: LedgerStore) =>
  (await store.run((db) => db.accounts()))[0]?.balance;

export function storeContract(name: string, make: () => Promise<LedgerStore>) {
  describe(`${name} satisfies LedgerStore`, () => {
    it('derives balances from opening balance plus non-voided entries', async () => {
      const store = await make();
      const a = await seed(store);
      await store.run(async (db) => {
        await db.insertTransaction(tx(a, 'one', 100n), meta('1'));
        await db.insertTransaction(tx(a, 'two', 50n), meta('2'));
      });
      expect(await balance(store)).toBe(850n);

      await store.run((db) => db.voidLatest(new Date()));
      expect(await balance(store)).toBe(900n);
    });

    it('reads transactions in a half-open range, leaving out voided ones', async () => {
      const store = await make();
      const a = await seed(store);
      const at = (id: string, occurredAt: Date) =>
        store.run((db) =>
          db.insertTransaction({ ...tx(a, id, 1n), occurredAt }, meta(id)),
        );
      const start = new Date('2026-10-01T00:00:00Z');
      const end = new Date('2026-11-01T00:00:00Z');
      await at('first', start);
      await at('voided', start);
      await store.run((db) => db.voidLatest(end));
      await at('last', new Date(end.getTime() - 1));
      await at('before', new Date(start.getTime() - 1));
      await at('after', end);

      const rows = await store.run((db) =>
        db.transactionsInRange({ start, end }),
      );
      expect(rows.map((r) => r.occurredAt)).toEqual([
        start,
        new Date(end.getTime() - 1),
      ]);
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
        'category',
        'entries',
        'occurredAt',
        'spendAmount',
        'type',
        'voidedAt',
      ]);
      expect(rows[0]?.entries).toEqual([{ accountId: a, amount: -1n }]);
    });

    it('stores and returns an INVESTMENT account', async () => {
      const store = await make();
      await store.run((db) =>
        db.createAccount({
          alias: 'fund',
          name: 'FUND',
          kind: 'INVESTMENT',
          openingBalance: 500n,
        }),
      );
      expect(await store.run((db) => db.accounts())).toMatchObject([
        { alias: 'fund', kind: 'INVESTMENT', balance: 500n },
      ]);
    });

    it('rejects a duplicate alias and writes nothing', async () => {
      const store = await make();
      await seed(store);
      await expect(seed(store)).rejects.toThrow();
      expect(await store.run((db) => db.accounts())).toHaveLength(1);
    });

    it('is exact above 2^53 (no Number coercion)', async () => {
      const store = await make();
      const a = await seed(store, 2n ** 60n + 1n);
      await store.run((db) =>
        db.insertTransaction(tx(a, 'big', 3n), meta('1')),
      );
      expect(await balance(store)).toBe(2n ** 60n - 2n);
    });

    it('rolls back everything when the callback throws, and keeps working', async () => {
      const store = await make();
      const a = await seed(store);
      await expect(
        store.run(async (db) => {
          await db.claim('test', '1');
          await db.insertTransaction(tx(a, 'one', 100n), meta('1'));
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await balance(store)).toBe(1_000n);
      expect(await store.run((db) => db.wasProcessed('test', '1'))).toBe(false);
      expect(await store.run((db) => db.claim('test', '1'))).toBe(true);
    });

    it('claim is true once, then false, and is per channel', async () => {
      const store = await make();
      expect(await store.run((db) => db.claim('telegram', '1'))).toBe(true);
      expect(await store.run((db) => db.claim('telegram', '1'))).toBe(false);
      expect(await store.run((db) => db.wasProcessed('telegram', '1'))).toBe(
        true,
      );
      expect(await store.run((db) => db.wasProcessed('telegram', '2'))).toBe(
        false,
      );
      expect(await store.run((db) => db.claim('whatsapp', '1'))).toBe(true);
    });

    // Both stores serialise runs (MemoryStore queue, Postgres advisory lock),
    // which is what makes this pass.
    it('concurrent claims of one message: exactly one wins', async () => {
      const store = await make();
      const wins = await Promise.all([
        store.run((db) => db.claim('test', '1')),
        store.run((db) => db.claim('test', '1')),
      ]);
      expect(wins.sort()).toEqual([false, true]);
    });

    it('voidLatest walks backwards, skips voided rows, and reports empty', async () => {
      const store = await make();
      const a = await seed(store);
      expect(await store.run((db) => db.voidLatest(new Date()))).toBeNull();

      await store.run(async (db) => {
        await db.insertTransaction(tx(a, 'one', 100n), meta('1'));
        await db.insertTransaction(tx(a, 'two', 50n), meta('2'));
      });
      const at = new Date('2026-10-27T00:00:00Z');
      expect(await store.run((db) => db.voidLatest(at))).toEqual({
        description: 'two',
      });
      expect(await store.run((db) => db.voidLatest(at))).toEqual({
        description: 'one',
      });
      expect(await store.run((db) => db.voidLatest(at))).toBeNull();
    });
  });
}
