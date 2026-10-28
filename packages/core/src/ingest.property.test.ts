import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ACCOUNTS, NOW } from './fixtures';
import { ingest } from './ingest';
import { MemoryStore } from './memory-store';

const rupees = fc.integer({ min: 1, max: 1_000_000 });

// Messages that are valid for the fixture accounts, plus undo and reconcile.
const message = fc.oneof(
  rupees.map((n) => `lunch ${n} icici`),
  rupees.map((n) => `petrol ${n} cc icici`),
  rupees.map((n) => `in ${n} salary bom`),
  rupees.map((n) => `xfer ${n} icici bom`),
  rupees.map((n) => `pay icicicc ${n} from icici`),
  rupees.map((n) => `lend rahul ${n} bom`),
  rupees.map((n) => `got rahul ${n} bom`),
  rupees.map((n) => `dinner ${n * 2} split rahul ${n} cc icici`),
  rupees.map((n) => `bal icici ${n}`),
  fc.constant('undo'),
  fc.constant('bal'),
  fc.constant('gibberish with no meaning'),
);

const run = async (messages: string[]) => {
  const store = new MemoryStore(ACCOUNTS);
  const ids = messages.map((_, i) => `m${i}`);
  for (const [i, text] of messages.entries()) {
    await ingest(
      { channel: 'p', externalId: ids[i] as string, text, now: NOW },
      store,
    );
  }
  return { store, ids };
};

const snapshot = async (store: MemoryStore) =>
  JSON.stringify(
    {
      balances: await store.accountsWithBalances(),
      txs: store.transactions,
    },
    (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
  );

describe('ingest invariants', () => {
  it('replaying any message never changes state (invariant 5, idempotency)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(message, { maxLength: 15 }),
        fc.nat(),
        async (messages, pick) => {
          const { store, ids } = await run(messages);
          if (messages.length === 0) return;
          const i = pick % messages.length;
          const before = await snapshot(store);
          const out = await ingest(
            {
              channel: 'p',
              externalId: ids[i] as string,
              text: messages[i] as string,
              now: NOW,
            },
            store,
          );
          expect(out).toEqual({ status: 'duplicate' });
          expect(await snapshot(store)).toBe(before);
        },
      ),
    );
  });

  it('undoing everything restores the starting balances (invariant 4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(message, { maxLength: 15 }),
        async (messages) => {
          const { store } = await run(messages);
          for (let i = 0; i < messages.length + 1; i++) {
            await ingest(
              { channel: 'p', externalId: `u${i}`, text: 'undo', now: NOW },
              store,
            );
          }
          const balances = await store.accountsWithBalances();
          for (const account of ACCOUNTS) {
            expect(balances.find((b) => b.id === account.id)?.balance).toBe(
              account.balance,
            );
          }
        },
      ),
    );
  });

  it('balances move only by non-voided entries, and transfers conserve money (invariants 3 and 4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(message, { maxLength: 15 }),
        async (messages) => {
          const { store } = await run(messages);
          const live = store.transactions.filter((t) => t.voidedAt === null);

          for (const tx of live) {
            if (tx.type === 'TRANSFER' || tx.type === 'ADJUSTMENT') {
              expect(tx.spendAmount).toBe(0n);
            }
            if (tx.type === 'TRANSFER') {
              expect(tx.entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);
            }
          }

          const balances = await store.accountsWithBalances();
          for (const account of ACCOUNTS) {
            const moved = live
              .flatMap((t) => t.entries)
              .filter((e) => e.accountId === account.id)
              .reduce((s, e) => s + e.amount, 0n);
            expect(balances.find((b) => b.id === account.id)?.balance).toBe(
              account.balance + moved,
            );
          }
        },
      ),
    );
  });
});
