import { describe, expect, it } from 'vitest';

import { ACCOUNTS, NOW } from './fixtures';
import { ingest } from './ingest';
import { MemoryStore } from './memory-store';
import { type ProposedTx } from './types';

// Fake channel and message ids only.
let counter = 0;
const send = (store: MemoryStore, text: string, externalId?: string) =>
  ingest(
    {
      channel: 'test',
      externalId: externalId ?? `m${++counter}`,
      text,
      now: NOW,
    },
    store,
  );

const balance = async (store: MemoryStore, alias: string) =>
  (await store.accountsWithBalances()).find((a) => a.alias === alias)?.balance;

const fresh = () => new MemoryStore(ACCOUNTS);

describe('SPEC section 5 examples, persisted', () => {
  it('1. credit card spend writes one entry on the card only', async () => {
    const store = fresh();
    const out = await send(store, 'petrol 4k cc icici');
    expect(out.status).toBe('ok');
    expect(store.transactions).toHaveLength(1);
    const tx = store.transactions[0] as ProposedTx;
    expect(tx.type).toBe('EXPENSE');
    expect(tx.spendAmount).toBe(400_000n);
    expect(await balance(store, 'icicicc')).toBe(-550_000n);
    expect(await balance(store, 'icici')).toBe(8_420_000n);
  });

  it('2. card bill payment is a transfer with spendAmount 0', async () => {
    const store = fresh();
    await send(store, 'pay icicicc 4k from icici');
    const tx = store.transactions[0] as ProposedTx;
    expect(tx.type).toBe('TRANSFER');
    expect(tx.spendAmount).toBe(0n);
    expect(await balance(store, 'icici')).toBe(8_020_000n);
    expect(await balance(store, 'icicicc')).toBe(250_000n);
  });

  it('3. internal transfer moves money without spend', async () => {
    const store = fresh();
    await send(store, 'xfer 25k icici bom');
    expect(store.transactions[0]?.spendAmount).toBe(0n);
    expect(await balance(store, 'icici')).toBe(5_920_000n);
    expect(await balance(store, 'bom')).toBe(7_500_000n);
  });

  it('4. EMI is an expense counted once', async () => {
    const store = fresh();
    await send(store, 'emi 32k bom');
    await send(store, 'xfer 25k icici bom');
    const spend = store.transactions.reduce((s, t) => s + t.spendAmount, 0n);
    expect(spend).toBe(3_200_000n);
  });

  it('5. lend and repay', async () => {
    const store = fresh();
    await send(store, 'lend rahul 10k icici');
    expect(await balance(store, 'rahul')).toBe(1_000_000n);
    await send(store, 'got rahul 5k icici');
    expect(await balance(store, 'rahul')).toBe(500_000n);
    expect(await balance(store, 'icici')).toBe(
      8_420_000n - 1_000_000n + 500_000n,
    );
    expect(store.transactions.every((t) => t.spendAmount === 0n)).toBe(true);
  });

  it('6. split bill: my share is the remainder', async () => {
    const store = fresh();
    await send(store, 'dinner 4000 split rahul 1000 anita 1000 cc icici');
    const tx = store.transactions[0] as ProposedTx;
    expect(tx.type).toBe('SPLIT');
    expect(tx.spendAmount).toBe(200_000n);
    expect(await balance(store, 'rahul')).toBe(100_000n);
    expect(await balance(store, 'anita')).toBe(100_000n);
    expect(await balance(store, 'icicicc')).toBe(-550_000n);
  });

  it('7. income', async () => {
    const store = fresh();
    await send(store, 'in 85k salary icici');
    expect(await balance(store, 'icici')).toBe(16_920_000n);
    expect(store.transactions[0]?.spendAmount).toBe(0n);
  });

  it('8. reconcile writes an adjustment and replies with the difference', async () => {
    const store = fresh();
    const out = await send(store, 'bal icici 85000');
    expect(store.transactions[0]?.type).toBe('ADJUSTMENT');
    expect(store.transactions[0]?.spendAmount).toBe(0n);
    expect(await balance(store, 'icici')).toBe(8_500_000n);
    expect(out).toMatchObject({ status: 'ok' });
    if (out.status === 'ok') expect(out.reply).toContain('was');
  });
});

describe('open', () => {
  it('creates the account and says it cannot be undone', async () => {
    const store = fresh();
    const out = await send(store, 'open hdfc 1000 bank');
    expect(store.accounts.some((a) => a.alias === 'hdfc')).toBe(true);
    expect(await balance(store, 'hdfc')).toBe(100_000n);
    if (out.status === 'ok') expect(out.reply).toMatch(/cannot be undone/i);
  });
});

describe('reads and clarifications write nothing', () => {
  it('ambiguous input writes nothing and replies with the question', async () => {
    const store = fresh();
    const out = await send(store, 'petrol 4k');
    expect(store.transactions).toHaveLength(0);
    expect(out.status).toBe('ok');
    if (out.status === 'ok') expect(out.reply).toMatch(/Which account/);
  });

  it('balances reads without writing', async () => {
    const store = fresh();
    const out = await send(store, 'bal');
    expect(store.transactions).toHaveLength(0);
    if (out.status === 'ok') expect(out.reply).toContain('ICICI');
  });
});

describe('idempotency', () => {
  it('replaying an expense writes nothing and returns duplicate', async () => {
    const store = fresh();
    await send(store, 'petrol 4k cc icici', 'same');
    const again = await send(store, 'petrol 4k cc icici', 'same');
    expect(again).toEqual({ status: 'duplicate' });
    expect(store.transactions).toHaveLength(1);
    expect(await balance(store, 'icicicc')).toBe(-550_000n);
  });

  it('replaying undo does not void a second transaction', async () => {
    const store = fresh();
    await send(store, 'lunch 500 icici');
    await send(store, 'tea 100 icici');
    await send(store, 'undo', 'u1');
    expect(await send(store, 'undo', 'u1')).toEqual({ status: 'duplicate' });
    expect(store.transactions.map((t) => t.voidedAt !== null)).toEqual([
      false,
      true,
    ]);
  });

  it('replaying open gives duplicate, not a "duplicate alias" clarification', async () => {
    const store = fresh();
    await send(store, 'open hdfc 0 bank', 'o1');
    expect(await send(store, 'open hdfc 0 bank', 'o1')).toEqual({
      status: 'duplicate',
    });
  });

  it('the same externalId on another channel is a different message', async () => {
    const store = fresh();
    const base = { externalId: 'x', text: 'tea 100 icici', now: NOW };
    await ingest({ ...base, channel: 'a' }, store);
    const other = await ingest({ ...base, channel: 'b' }, store);
    expect(other.status).toBe('ok');
    expect(store.transactions).toHaveLength(2);
  });

  it('a failed write leaves nothing behind, not even the processed marker', async () => {
    class Failing extends MemoryStore {
      override async insertTransaction(): Promise<void> {
        throw new Error('disk on fire');
      }
    }
    const store = new Failing(ACCOUNTS);
    await expect(send(store, 'tea 100 icici', 'f1')).rejects.toThrow(
      'disk on fire',
    );
    // The retry is not mistaken for a duplicate.
    expect(await store.markProcessed('test', 'f1')).toBe(true);
  });
});

describe('undo', () => {
  it('voids the last transaction and restores the balance', async () => {
    const store = fresh();
    await send(store, 'lunch 500 icici');
    const out = await send(store, 'undo');
    expect(await balance(store, 'icici')).toBe(8_420_000n);
    expect(store.transactions[0]?.voidedAt).not.toBeNull();
    if (out.status === 'ok') expect(out.reply).toMatch(/lunch/i);
  });

  it('twice voids two different transactions', async () => {
    const store = fresh();
    await send(store, 'lunch 500 icici');
    await send(store, 'tea 100 icici');
    await send(store, 'undo');
    await send(store, 'undo');
    expect(store.transactions.every((t) => t.voidedAt !== null)).toBe(true);
    expect(await balance(store, 'icici')).toBe(8_420_000n);
  });

  it('with nothing to undo says so and writes nothing', async () => {
    const store = fresh();
    const out = await send(store, 'undo');
    expect(out).toEqual({
      status: 'ok',
      reply: 'Nothing to undo.',
      kind: 'undo',
    });
    expect(store.transactions).toHaveLength(0);
  });

  it('targets the newest entry, not the newest occurredAt (backdating)', async () => {
    const store = fresh();
    await send(store, 'lunch 500 icici');
    await send(store, 'yesterday tea 100 icici');
    await send(store, 'undo');
    expect(store.transactions.map((t) => t.voidedAt !== null)).toEqual([
      false,
      true,
    ]);
  });

  it('can undo an adjustment', async () => {
    const store = fresh();
    await send(store, 'bal icici 85000');
    await send(store, 'undo');
    expect(await balance(store, 'icici')).toBe(8_420_000n);
  });

  it('does not touch accounts: undo after open voids the earlier transaction', async () => {
    const store = fresh();
    await send(store, 'lunch 500 icici');
    await send(store, 'open hdfc 0 bank');
    await send(store, 'undo');
    expect(store.accounts.some((a) => a.alias === 'hdfc')).toBe(true);
    expect(store.transactions[0]?.voidedAt).not.toBeNull();
  });
});
