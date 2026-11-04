import { describe, expect, it } from 'vitest';

import { istMonthRange } from './dates';
import { ACCOUNTS, NOW } from './fixtures';
import { ingest } from './ingest';
import { MemoryStore } from './memory-store';
import { netInvested } from './reports';

// All names and numbers are fake. Fixture balances are used as opening balances.
function setup() {
  const store = new MemoryStore(
    ACCOUNTS.map(({ balance, ...rest }) => ({
      ...rest,
      openingBalance: balance,
    })),
  );
  let n = 0;
  const send = (text: string, externalId = `m${++n}`) =>
    ingest({ channel: 'test', externalId, text, now: NOW }, store);
  const balance = async (alias: string) => {
    const accounts = await store.run((db) => db.accounts());
    const account = accounts.find((a) => a.alias === alias);
    if (!account) throw new Error(`no account ${alias}`);
    return account.balance;
  };
  const spend = () =>
    store
      .snapshot()
      .transactions.filter((t) => t.voidedAt === null)
      .reduce((s, t) => s + t.proposed.spendAmount, 0n);
  const count = () => store.snapshot().transactions.length;
  return { store, send, balance, spend, count };
}

describe('ingest: SPEC section 5 investment examples, persisted', () => {
  const opened = async () => {
    const context = setup();
    await context.send('open mfalpha 0 investment');
    await context.send('xfer 10k icici mfalpha');
    return context;
  };

  it('10. a sale for more than went in goes negative and adds no spend', async () => {
    const { send, balance, spend } = await opened();
    await send('xfer 12k mfalpha icici');
    expect(await balance('mfalpha')).toBe(-200_000n);
    expect(await balance('icici')).toBe(8_420_000n + 200_000n);
    expect(spend()).toBe(0n);
  });

  it('12. a refused reconcile writes nothing and claims nothing', async () => {
    const { store, send, balance, count } = await opened();
    const before = count();
    const out = await send('bal mfalpha 15000', 'refused');
    expect(out.reply).toContain('cannot be reconciled');
    expect(await balance('mfalpha')).toBe(1_000_000n);
    expect(count()).toBe(before);
    expect(await store.run((db) => db.wasProcessed('test', 'refused'))).toBe(
      false,
    );
  });

  it('undo reverses a move, in the balance and in Invested', async () => {
    const { store, send, balance } = await opened();
    await send('undo');
    expect(await balance('mfalpha')).toBe(0n);
    expect(await balance('icici')).toBe(8_420_000n);
    const accounts = await store.run((db) => db.accounts());
    const txs = store
      .snapshot()
      .transactions.map((t) => ({ ...t.proposed, voidedAt: t.voidedAt }));
    expect(netInvested(txs, accounts, istMonthRange(2026, 10))).toBe(0n);
  });
});

describe('ingest: SPEC section 5 examples, persisted', () => {
  it('1. credit card spend hits the card only and counts as spend', async () => {
    const { send, balance, spend } = setup();
    const out = await send('petrol 4k cc icici');
    expect(out).toEqual({
      duplicate: false,
      reply:
        'Logged: 4,000 Petrol (Transport) on ICICI-CC. Reply "undo" to revert.',
    });
    expect(await balance('icicicc')).toBe(-150_000n - 400_000n);
    expect(await balance('icici')).toBe(8_420_000n);
    expect(spend()).toBe(400_000n);
  });

  it('2. card bill payment moves money and adds no spend', async () => {
    const { send, balance, spend } = setup();
    await send('pay icicicc 4k from icici');
    expect(await balance('icici')).toBe(8_420_000n - 400_000n);
    expect(await balance('icicicc')).toBe(-150_000n + 400_000n);
    expect(spend()).toBe(0n);
  });

  it('3. internal transfer adds no spend', async () => {
    const { send, balance, spend } = setup();
    await send('xfer 25k icici bom');
    expect(await balance('icici')).toBe(8_420_000n - 2_500_000n);
    expect(await balance('bom')).toBe(5_000_000n + 2_500_000n);
    expect(spend()).toBe(0n);
  });

  it('4. EMI counts once, after a transfer that counts nothing', async () => {
    const { send, spend } = setup();
    await send('xfer 25k icici bom');
    await send('emi 32k bom');
    expect(spend()).toBe(3_200_000n);
  });

  it('5. lend and repayment are transfers', async () => {
    const { send, balance, spend } = setup();
    await send('lend rahul 10k icici');
    expect(await balance('rahul')).toBe(1_000_000n);
    await send('got rahul 5k icici');
    expect(await balance('rahul')).toBe(500_000n);
    expect(await balance('icici')).toBe(8_420_000n - 1_000_000n + 500_000n);
    expect(spend()).toBe(0n);
  });

  it('6. split spend is only my share', async () => {
    const { send, balance, spend } = setup();
    await send('dinner 4000 split rahul 1000 anita 1000 cc icici');
    expect(await balance('icicicc')).toBe(-150_000n - 400_000n);
    expect(await balance('rahul')).toBe(100_000n);
    expect(await balance('anita')).toBe(100_000n);
    expect(spend()).toBe(200_000n);
  });

  it('7. income', async () => {
    const { send, balance, spend } = setup();
    await send('in 85k salary icici');
    expect(await balance('icici')).toBe(8_420_000n + 8_500_000n);
    expect(spend()).toBe(0n);
  });

  it('8. reconcile writes an adjustment of the difference', async () => {
    const { store, send, balance, spend } = setup();
    const out = await send('bal icici 85000');
    expect(out.reply).toMatch(/^Adjusted ICICI \+800 /);
    expect(await balance('icici')).toBe(8_500_000n);
    expect(spend()).toBe(0n);
    const [tx] = store.snapshot().transactions;
    expect(tx?.proposed.type).toBe('ADJUSTMENT');
    expect(tx?.proposed.entries[0]?.amount).toBe(80_000n);
  });

  it('stores channel, external id and raw text on the transaction', async () => {
    const { store, send } = setup();
    await send('petrol 4k cc icici', 'abc');
    const [tx] = store.snapshot().transactions;
    expect(tx).toMatchObject({
      channel: 'test',
      externalId: 'abc',
      rawText: 'petrol 4k cc icici',
    });
  });
});

describe('ingest: open', () => {
  it('creates an account whose opening balance is the balance', async () => {
    const { send, balance, count } = setup();
    const out = await send('open hdfc 12k bank');
    expect(out.reply).toBe('Opened HDFC (BANK) with balance 12,000.');
    expect(await balance('hdfc')).toBe(1_200_000n);
    expect(count()).toBe(0);
  });

  it('the new account is usable by the next message', async () => {
    const { send, balance } = setup();
    await send('open hdfc 12k bank');
    await send('lunch 200 hdfc');
    expect(await balance('hdfc')).toBe(1_200_000n - 20_000n);
  });
});

describe('ingest: reads and clarifications write nothing', () => {
  it.each([
    'blah',
    'petrol 4k',
    'petrol 4k nowhere',
    'lunch 100 200 icici',
    'on 30 dec lunch 100 icici',
    'xfer 1k icici icici',
    'open icici 0 bank',
  ])('clarify: %s', async (text) => {
    const { store, send } = setup();
    const before = store.snapshot();
    const out = await send(text);
    expect(out.duplicate).toBe(false);
    expect(store.snapshot()).toEqual(before);
  });

  it.each(['accounts', 'bal', 'bal icici', 'bal icici 84200'])(
    'read: %s',
    async (text) => {
      const { store, send } = setup();
      const before = store.snapshot();
      await send(text);
      expect(store.snapshot()).toEqual(before);
    },
  );

  it('a clarified message can be retried with the same id', async () => {
    const { send, count } = setup();
    await send('petrol 4k', 'x1');
    const retry = await send('petrol 4k cc icici', 'x1');
    expect(retry.duplicate).toBe(false);
    expect(count()).toBe(1);
  });
});

describe('ingest: idempotency (invariant 5)', () => {
  it('replaying a write is a no-op', async () => {
    const { send, balance, count } = setup();
    await send('petrol 4k cc icici', 'a');
    const again = await send('petrol 4k cc icici', 'a');
    expect(again.duplicate).toBe(true);
    expect(count()).toBe(1);
    expect(await balance('icicicc')).toBe(-550_000n);
  });

  it('same external id on another channel is a different message', async () => {
    const { store } = setup();
    const msg = { externalId: 'a', text: 'petrol 4k cc icici', now: NOW };
    await ingest({ ...msg, channel: 'telegram' }, store);
    const other = await ingest({ ...msg, channel: 'whatsapp' }, store);
    expect(other.duplicate).toBe(false);
    expect(store.snapshot().transactions).toHaveLength(2);
  });

  it('replaying undo does not void a second transaction', async () => {
    const { send, count, spend } = setup();
    await send('lunch 100 icici');
    await send('dinner 200 icici');
    await send('undo', 'u');
    const again = await send('undo', 'u');
    expect(again.duplicate).toBe(true);
    expect(count()).toBe(2);
    expect(spend()).toBe(10_000n);
  });

  it('replaying open after success reports a duplicate, not a clash', async () => {
    const { send } = setup();
    await send('open hdfc 0 bank', 'o');
    const again = await send('open hdfc 0 bank', 'o');
    expect(again.duplicate).toBe(true);
  });

  it('two concurrent deliveries of one message write once', async () => {
    const { send, count } = setup();
    const [a, b] = await Promise.all([
      send('petrol 4k cc icici', 'r'),
      send('petrol 4k cc icici', 'r'),
    ]);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(count()).toBe(1);
  });
});

describe('ingest: undo (invariant 4)', () => {
  it('voids the latest transaction; balances and spend exclude it', async () => {
    const { store, send, balance, spend, count } = setup();
    await send('petrol 4k cc icici');
    const out = await send('undo');
    expect(out.reply).toBe('Undone: petrol.');
    expect(await balance('icicicc')).toBe(-150_000n);
    expect(spend()).toBe(0n);
    // never hard-deleted
    expect(count()).toBe(1);
    expect(store.snapshot().transactions[0]?.voidedAt).toEqual(NOW);
  });

  it('repeated undo walks backwards', async () => {
    const { send, spend } = setup();
    await send('lunch 100 icici');
    await send('dinner 200 icici');
    await send('undo');
    expect(spend()).toBe(10_000n);
    await send('undo');
    expect(spend()).toBe(0n);
  });

  it('can undo a reconcile adjustment', async () => {
    const { send, balance } = setup();
    await send('bal icici 85000');
    await send('undo');
    expect(await balance('icici')).toBe(8_420_000n);
  });

  it('with nothing to undo, says so and changes no ledger data', async () => {
    const { store, send } = setup();
    const before = store.snapshot();
    const out = await send('undo', 'u');
    expect(out.reply).toBe('Nothing to undo.');
    const after = store.snapshot();
    expect(after.accounts).toEqual(before.accounts);
    expect(after.transactions).toEqual(before.transactions);
  });

  it('a late redelivery of an empty undo does not void newer transactions', async () => {
    const { send, count, spend } = setup();
    await send('undo', 'u');
    await send('lunch 100 icici');
    const again = await send('undo', 'u');
    expect(again.duplicate).toBe(true);
    expect(count()).toBe(1);
    expect(spend()).toBe(10_000n);
  });

  it('does not undo opening an account', async () => {
    const { send } = setup();
    await send('open hdfc 0 bank');
    const out = await send('undo');
    expect(out.reply).toBe('Nothing to undo.');
  });

  it('skips already voided transactions', async () => {
    const { send, count } = setup();
    await send('lunch 100 icici');
    await send('undo');
    const out = await send('undo');
    expect(out.reply).toBe('Nothing to undo.');
    expect(count()).toBe(1);
  });
});
