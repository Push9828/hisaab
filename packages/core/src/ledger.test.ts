import { describe, expect, it } from 'vitest';

import { checkInvariants } from './ledger';
import { type ProposedTx } from './types';

const tx = (over: Partial<ProposedTx>): ProposedTx => ({
  type: 'TRANSFER',
  occurredAt: new Date('2026-10-26T10:00:00Z'),
  description: 'x',
  category: null,
  spendAmount: 0n,
  status: 'CONFIRMED',
  entries: [
    { accountId: 'a', amount: -100n },
    { accountId: 'b', amount: 100n },
  ],
  ...over,
});

describe('checkInvariants rejects hand-built violations', () => {
  it('accepts a valid transfer', () => {
    expect(() => checkInvariants(tx({}))).not.toThrow();
  });

  it.each<[string, Partial<ProposedTx>]>([
    ['transfer with spend (hard rule 3)', { spendAmount: 100n }],
    [
      'transfer that does not sum to zero',
      {
        entries: [
          { accountId: 'a', amount: -100n },
          { accountId: 'b', amount: 90n },
        ],
      },
    ],
    [
      'adjustment with spend (hard rule 3)',
      {
        type: 'ADJUSTMENT',
        spendAmount: 5n,
        entries: [{ accountId: 'a', amount: 5n }],
      },
    ],
    ['adjustment with two entries', { type: 'ADJUSTMENT' }],
    [
      'income that leaves the account',
      { type: 'INCOME', entries: [{ accountId: 'a', amount: -5n }] },
    ],
    [
      'income with spend',
      {
        type: 'INCOME',
        spendAmount: 5n,
        entries: [{ accountId: 'a', amount: 5n }],
      },
    ],
    [
      'expense with a mismatched spend',
      {
        type: 'EXPENSE',
        spendAmount: 90n,
        entries: [{ accountId: 'a', amount: -100n }],
      },
    ],
    [
      'expense that credits the account',
      {
        type: 'EXPENSE',
        spendAmount: 100n,
        entries: [{ accountId: 'a', amount: 100n }],
      },
    ],
    [
      'split whose payer is credited',
      {
        type: 'SPLIT',
        spendAmount: 0n,
        entries: [
          { accountId: 'a', amount: 100n },
          { accountId: 'b', amount: -100n },
        ],
      },
    ],
    [
      'split with a wrong spend',
      {
        type: 'SPLIT',
        spendAmount: 50n,
        entries: [
          { accountId: 'a', amount: -100n },
          { accountId: 'b', amount: 20n },
        ],
      },
    ],
    ['negative spendAmount', { spendAmount: -1n }],
    ['no entries', { entries: [] }],
    [
      'a zero entry',
      {
        entries: [
          { accountId: 'a', amount: 0n },
          { accountId: 'b', amount: 0n },
        ],
      },
    ],
  ])('%s', (_, over) => {
    expect(() => checkInvariants(tx(over))).toThrow(/invariant/i);
  });
});
