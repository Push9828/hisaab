import { describe, expect, it } from 'vitest';

import { ACCOUNTS, NOW, ctx, id } from './fixtures';
import { interpret } from './interpret';
import { type AccountInfo, type ProposedTx } from './types';

// SPEC section 5 worked examples. Amounts are paise.
function propose(text: string, accounts = ACCOUNTS): ProposedTx {
  const result = interpret(text, ctx(accounts));
  if (result.kind !== 'proposal') {
    throw new Error(`expected proposal for "${text}", got ${result.kind}`);
  }
  return result.tx;
}

describe('SPEC section 5 examples', () => {
  it('1. credit card spend', () => {
    const tx = propose('petrol 4k cc icici');
    expect(tx.type).toBe('EXPENSE');
    expect(tx.entries).toEqual([
      { accountId: id('icicicc'), amount: -400_000n },
    ]);
    expect(tx.spendAmount).toBe(400_000n);
    expect(tx.category).toBe('Transport');
    expect(tx.status).toBe('CONFIRMED');
    // the bank account is untouched
    expect(tx.entries.some((e) => e.accountId === id('icici'))).toBe(false);
  });

  it('2. credit card bill payment is a transfer, not spend', () => {
    const tx = propose('pay icicicc 4k from icici');
    expect(tx.type).toBe('TRANSFER');
    expect(tx.entries).toEqual([
      { accountId: id('icici'), amount: -400_000n },
      { accountId: id('icicicc'), amount: 400_000n },
    ]);
    expect(tx.spendAmount).toBe(0n);
  });

  it('3. internal transfer', () => {
    const tx = propose('xfer 25k icici bom');
    expect(tx.type).toBe('TRANSFER');
    expect(tx.entries).toEqual([
      { accountId: id('icici'), amount: -2_500_000n },
      { accountId: id('bom'), amount: 2_500_000n },
    ]);
    expect(tx.spendAmount).toBe(0n);
  });

  it('4. home loan EMI is an expense, counted once', () => {
    const tx = propose('emi 32k bom');
    expect(tx.type).toBe('EXPENSE');
    expect(tx.entries).toEqual([{ accountId: id('bom'), amount: -3_200_000n }]);
    expect(tx.spendAmount).toBe(3_200_000n);
    expect(tx.category).toBe('Home loan EMI');
  });

  it('5. lend money and take repayment', () => {
    const lend = propose('lend rahul 10k icici');
    expect(lend.type).toBe('TRANSFER');
    expect(lend.entries).toEqual([
      { accountId: id('icici'), amount: -1_000_000n },
      { accountId: id('rahul'), amount: 1_000_000n },
    ]);
    expect(lend.spendAmount).toBe(0n);

    const got = propose('got rahul 5k icici');
    expect(got.type).toBe('TRANSFER');
    expect(got.entries).toEqual([
      { accountId: id('rahul'), amount: -500_000n },
      { accountId: id('icici'), amount: 500_000n },
    ]);
    expect(got.spendAmount).toBe(0n);
  });

  it('6. split bill', () => {
    const tx = propose('dinner 4000 split rahul 1000 anita 1000 cc icici');
    expect(tx.type).toBe('SPLIT');
    expect(tx.entries).toEqual([
      { accountId: id('icicicc'), amount: -400_000n },
      { accountId: id('rahul'), amount: 100_000n },
      { accountId: id('anita'), amount: 100_000n },
    ]);
    expect(tx.spendAmount).toBe(200_000n);
    expect(tx.category).toBe('Food');
  });

  it('7. income', () => {
    const tx = propose('in 85k salary icici');
    expect(tx.type).toBe('INCOME');
    expect(tx.entries).toEqual([
      { accountId: id('icici'), amount: 8_500_000n },
    ]);
    expect(tx.spendAmount).toBe(0n);
    expect(tx.category).toBe('Salary');
  });

  it('8. reconcile creates an adjustment of the difference', () => {
    // ledger says 84,200; bank says 85,000
    const tx = propose('bal icici 85000');
    expect(tx.type).toBe('ADJUSTMENT');
    expect(tx.entries).toEqual([{ accountId: id('icici'), amount: 80_000n }]);
    expect(tx.spendAmount).toBe(0n);
  });

  it('8b. reconcile with no difference writes nothing', () => {
    expect(interpret('bal icici 84200', ctx())).toEqual({
      kind: 'matches',
      accountId: id('icici'),
      balance: 8_420_000n,
    });
  });

  it('8c. reconcile a credit card treats the amount as owed', () => {
    // ledger says owes 1,500; card statement says owes 2,000
    const tx = propose('bal icicicc 2000');
    expect(tx.entries).toEqual([
      { accountId: id('icicicc'), amount: -50_000n },
    ]);
  });
});

describe('SPEC section 5 examples: investments', () => {
  const fund = (alias: string, balance: bigint): AccountInfo => ({
    id: id(alias),
    alias,
    name: alias.toUpperCase(),
    kind: 'INVESTMENT',
    balance,
  });
  const WITH_FUNDS = [
    ...ACCOUNTS,
    fund('mfalpha', 1_000_000n),
    fund('mfbeta', 0n),
  ];

  it('9. buying is a transfer, not spend', () => {
    const tx = propose('xfer 10k icici mfalpha', WITH_FUNDS);
    expect(tx.type).toBe('TRANSFER');
    expect(tx.entries).toEqual([
      { accountId: id('icici'), amount: -1_000_000n },
      { accountId: id('mfalpha'), amount: 1_000_000n },
    ]);
    expect(tx.spendAmount).toBe(0n);
  });

  it('10. a sale above what went in is allowed, and is not income', () => {
    const tx = propose('xfer 12k mfalpha icici', WITH_FUNDS);
    expect(tx.type).toBe('TRANSFER');
    expect(tx.entries).toEqual([
      { accountId: id('mfalpha'), amount: -1_200_000n },
      { accountId: id('icici'), amount: 1_200_000n },
    ]);
    expect(tx.spendAmount).toBe(0n);
  });

  it('11. fund to fund', () => {
    const tx = propose('xfer 5k mfalpha mfbeta', WITH_FUNDS);
    expect(tx.type).toBe('TRANSFER');
    expect(tx.entries).toEqual([
      { accountId: id('mfalpha'), amount: -500_000n },
      { accountId: id('mfbeta'), amount: 500_000n },
    ]);
    expect(tx.spendAmount).toBe(0n);
  });

  it.each(['bal mfalpha 15000', 'bal mfalpha 10000', 'bal mfalpha 0'])(
    '12. %s is refused, even when it matches',
    (text) => {
      expect(interpret(text, ctx(WITH_FUNDS))).toMatchObject({
        kind: 'clarify',
        reason: 'KIND_MISMATCH',
      });
    },
  );

  it('12b. bal alone still shows the balance', () => {
    expect(interpret('bal mfalpha', ctx(WITH_FUNDS))).toEqual({
      kind: 'balances',
      accountIds: [id('mfalpha')],
    });
  });

  it.each([
    'petrol 4k mfalpha',
    'in 500 dividend mfalpha',
    'emi 4k mfalpha',
    'pay mfalpha 4k from icici',
    'pay icicicc 4k from mfalpha',
    'lend rahul 4k mfalpha',
    'got rahul 4k mfalpha',
    'dinner 4000 split rahul 1000 mfalpha',
    'lend mfalpha 4k icici',
    'dinner 4000 split mfalpha 1000 icici',
  ])('only xfer moves money: %s is refused', (text) => {
    expect(interpret(text, ctx(WITH_FUNDS))).toMatchObject({
      kind: 'clarify',
      reason: 'KIND_MISMATCH',
    });
  });

  it('opens with the money already put in, stored positive', () => {
    expect(interpret('open mfgamma 50k investment', ctx(WITH_FUNDS))).toEqual({
      kind: 'open',
      alias: 'mfgamma',
      name: 'MFGAMMA',
      accountKind: 'INVESTMENT',
      openingBalance: 5_000_000n,
    });
  });

  it('allows an alias equal to the kind word, as with other kinds', () => {
    expect(interpret('open investment 0 investment', ctx()).kind).toBe('open');
  });
});

describe('backdated entries', () => {
  it('defaults to now', () => {
    expect(propose('petrol 4k icici').occurredAt).toEqual(NOW);
  });

  it('applies a date prefix to any transaction command', () => {
    const at = new Date('2026-10-20T12:00:00+05:30');
    expect(propose('on 20 oct petrol 4k icici').occurredAt).toEqual(at);
    expect(propose('on 20 oct xfer 25k icici bom').occurredAt).toEqual(at);
    expect(propose('on 20 oct in 85k salary icici').occurredAt).toEqual(at);
    expect(propose('on 20 oct emi 32k bom').occurredAt).toEqual(at);
    expect(propose('on 20 oct lend rahul 1k icici').occurredAt).toEqual(at);
    expect(propose('on 20 oct pay icicicc 1k from icici').occurredAt).toEqual(
      at,
    );
    expect(
      propose('on 20 oct dinner 400 split rahul 100 icici').occurredAt,
    ).toEqual(at);
  });

  it('yesterday works', () => {
    expect(propose('yesterday petrol 4k icici').occurredAt).toEqual(
      new Date('2026-10-25T12:00:00+05:30'),
    );
  });
});
