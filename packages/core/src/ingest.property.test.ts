import fc from 'fast-check';
import { expect, it } from 'vitest';

import { ACCOUNTS, NOW } from './fixtures';
import { ingest } from './ingest';
import { MemoryStore } from './memory-store';

// SPEC invariants 4, 5 and 6 over random message sequences. The model is built
// from the generated numbers, not from interpret(), so the code is not
// checking itself. Single cases live in ingest.test.ts. All numbers are fake.

type Alias = 'icici' | 'bom';
const other = (a: Alias): Alias => (a === 'icici' ? 'bom' : 'icici');

// Above 2^53, so any Number coercion shows up as a wrong balance.
const OPENING: Record<Alias, bigint> = { icici: 2n ** 60n + 1n, bom: 0n };

type Cmd =
  | { t: 'expense'; rupees: number; acct: Alias }
  | { t: 'income'; rupees: number; acct: Alias }
  | { t: 'xfer'; rupees: number; acct: Alias }
  | { t: 'undo' }
  | { t: 'replay'; k: number };

const rupees = fc.integer({ min: 1, max: 99_999_999 });
const alias = fc.constantFrom<Alias>('icici', 'bom');
const cmd = fc.oneof(
  fc.record({ t: fc.constant('expense' as const), rupees, acct: alias }),
  fc.record({ t: fc.constant('income' as const), rupees, acct: alias }),
  fc.record({ t: fc.constant('xfer' as const), rupees, acct: alias }),
  fc.constant({ t: 'undo' } as const),
  fc.record({ t: fc.constant('replay' as const), k: fc.nat(1000) }),
);

interface ModelTx {
  delta: Record<Alias, bigint>;
  spend: bigint;
  voided: boolean;
}

/** Message text and its expected effect. Null for commands that send no new message. */
function expected(c: Cmd): { text: string; tx: ModelTx | null } | null {
  if (c.t === 'replay') return null;
  if (c.t === 'undo') return { text: 'undo', tx: null };
  const p = BigInt(c.rupees) * 100n;
  const delta = { icici: 0n, bom: 0n };
  if (c.t === 'expense') {
    delta[c.acct] = -p;
    return {
      text: `petrol ${c.rupees} ${c.acct}`,
      tx: { delta, spend: p, voided: false },
    };
  }
  if (c.t === 'income') {
    delta[c.acct] = p;
    return {
      text: `in ${c.rupees} salary ${c.acct}`,
      tx: { delta, spend: 0n, voided: false },
    };
  }
  delta[c.acct] = -p;
  delta[other(c.acct)] = p;
  return {
    text: `xfer ${c.rupees} ${c.acct} ${other(c.acct)}`,
    tx: { delta, spend: 0n, voided: false },
  };
}

it('balances, spend, voiding and replays match the model after every step', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(cmd, { maxLength: 25 }), async (cmds) => {
      const store = new MemoryStore(
        ACCOUNTS.map(({ balance, ...rest }) => ({
          ...rest,
          openingBalance:
            rest.alias in OPENING ? OPENING[rest.alias as Alias] : balance,
        })),
      );
      const send = (text: string, externalId: string) =>
        ingest({ channel: 'test', externalId, text, now: NOW }, store);

      const model: ModelTx[] = [];
      const sent: string[] = []; // ids of messages that wrote
      let voidedBefore = new Set<string>();

      for (const c of cmds) {
        const before = store.snapshot();
        const e = expected(c);

        if (c.t === 'replay' || !e) {
          if (c.t !== 'replay') continue;
          if (sent.length === 0) continue;
          // Invariant 5: a redelivery, whatever its text, changes nothing.
          const out = await send('undo', sent[c.k % sent.length] as string);
          expect(out.duplicate).toBe(true);
          expect(store.snapshot()).toEqual(before);
          continue;
        }

        const id = `m${sent.length}`;
        expect((await send(e.text, id)).duplicate).toBe(false);
        sent.push(id);
        if (e.tx) model.push(e.tx);
        else {
          const latest = [...model].reverse().find((t) => !t.voided);
          if (latest) latest.voided = true;
        }

        const snap = store.snapshot();
        const live = model.filter((t) => !t.voided);

        // Invariants 4 and 6: balance = opening + entries on non-voided rows.
        const accounts = await store.run((db) => db.accounts());
        for (const a of ['icici', 'bom'] as const) {
          const want = live.reduce((s, t) => s + t.delta[a], OPENING[a]);
          expect(accounts.find((x) => x.alias === a)?.balance).toBe(want);
        }
        const spend = snap.transactions
          .filter((t) => t.voidedAt === null)
          .reduce((s, t) => s + t.proposed.spendAmount, 0n);
        expect(spend).toBe(live.reduce((s, t) => s + t.spend, 0n));

        // Hard rule 4: nothing is deleted and a void is never undone.
        expect(snap.transactions).toHaveLength(model.length);
        for (const id of voidedBefore) {
          expect(
            snap.transactions.find((t) => t.id === id)?.voidedAt,
          ).not.toBeNull();
        }
        voidedBefore = new Set(
          snap.transactions.filter((t) => t.voidedAt !== null).map((t) => t.id),
        );
      }
    }),
    { numRuns: 300 },
  );
});
