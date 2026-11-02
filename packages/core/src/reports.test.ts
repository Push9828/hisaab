import { describe, expect, it } from 'vitest';

import { istMonthRange } from './dates';
import { ACCOUNTS, NOW } from './fixtures';
import { ingest } from './ingest';
import { MemoryStore } from './memory-store';
import {
  type ReportTx,
  balancesByKind,
  cashFlow,
  people,
  savingsRate,
  spendByCategory,
} from './reports';
import { type AccountInfo } from './types';

// All names and numbers are fake. Amounts are paise.
const OCTOBER = istMonthRange(2026, 10);

// SPEC section 5, examples 1-8. Example 8 goes first, while the ledger still says 84,200.
const EXAMPLES = [
  'bal icici 85000',
  'petrol 4k cc icici',
  'pay icicicc 4k from icici',
  'xfer 25k icici bom',
  'emi 32k bom',
  'lend rahul 10k icici',
  'got rahul 5k icici',
  'dinner 4000 split rahul 1000 anita 1000 cc icici',
  'in 85k salary icici',
];

async function storeAfter(messages: string[]): Promise<MemoryStore> {
  const store = new MemoryStore(
    ACCOUNTS.map(({ balance, ...rest }) => ({
      ...rest,
      openingBalance: balance,
    })),
  );
  for (const [i, text] of messages.entries()) {
    await ingest(
      { channel: 'test', externalId: `m${i}`, text, now: NOW },
      store,
    );
  }
  return store;
}

async function ledger(...messages: string[]): Promise<ReportTx[]> {
  const store = await storeAfter(messages);
  return store
    .snapshot()
    .transactions.map((t) => ({ ...t.proposed, voidedAt: t.voidedAt }));
}

const accountsAfter = async (...messages: string[]): Promise<AccountInfo[]> =>
  (await storeAfter(messages)).run((db) => db.accounts());

const row = (overrides: Partial<ReportTx> = {}): ReportTx => ({
  type: 'EXPENSE',
  occurredAt: NOW,
  category: 'Food',
  spendAmount: 100n,
  entries: [{ accountId: 'a', amount: -100n }],
  voidedAt: null,
  ...overrides,
});

const account = (
  name: string,
  kind: AccountInfo['kind'],
  balance: bigint,
): AccountInfo => ({ id: name, alias: name, name, kind, balance });

describe('spendByCategory', () => {
  it('SPEC section 5: only examples 1, 4 and 6 add spend', async () => {
    const txs = await ledger(...EXAMPLES);
    expect(txs).toHaveLength(9);
    expect(spendByCategory(txs, OCTOBER)).toEqual([
      { category: 'Home loan EMI', total: 3_200_000n },
      { category: 'Transport', total: 400_000n },
      { category: 'Food', total: 200_000n },
    ]);
  });

  it('adds up several rows in one category', async () => {
    const txs = await ledger('petrol 4k cc icici', 'petrol 1k icici');
    expect(spendByCategory(txs, OCTOBER)).toEqual([
      { category: 'Transport', total: 500_000n },
    ]);
  });

  it('puts NEEDS_REVIEW spend in Uncategorised, so nothing goes missing', async () => {
    const txs = await ledger('zzqx 500 icici', 'petrol 1k icici');
    expect(txs[0]).toMatchObject({ status: 'NEEDS_REVIEW', category: null });
    expect(spendByCategory(txs, OCTOBER)).toEqual([
      { category: 'Transport', total: 100_000n },
      { category: 'Uncategorised', total: 50_000n },
    ]);
  });

  it('leaves out a voided transaction', async () => {
    const txs = await ledger('emi 32k bom', 'petrol 4k cc icici', 'undo');
    expect(spendByCategory(txs, OCTOBER)).toEqual([
      { category: 'Home loan EMI', total: 3_200_000n },
    ]);
  });

  it('shows no row for a category with zero spend', () => {
    const txs = [
      row({ category: null, spendAmount: 0n }), // a transfer or adjustment
      row({ category: 'Salary', spendAmount: 0n }), // income
      row({ category: 'Food', spendAmount: 0n }), // a split with no own share
    ];
    expect(spendByCategory(txs, OCTOBER)).toEqual([]);
  });

  it('includes the first instant of the month and excludes the first of the next', () => {
    const txs = [
      row({ category: 'Food', occurredAt: OCTOBER.start }),
      row({
        category: 'Health',
        occurredAt: new Date(OCTOBER.start.getTime() - 1),
      }),
      row({
        category: 'Rent',
        occurredAt: new Date(OCTOBER.end.getTime() - 1),
      }),
      row({ category: 'Travel', occurredAt: OCTOBER.end }),
    ];
    expect(spendByCategory(txs, OCTOBER)).toEqual([
      { category: 'Food', total: 100n },
      { category: 'Rent', total: 100n },
    ]);
  });

  it('sorts by largest total, then by name', () => {
    const txs = [
      row({ category: 'Rent', spendAmount: 100n }),
      row({ category: 'Food', spendAmount: 100n }),
      row({ category: 'Health', spendAmount: 900n }),
    ];
    expect(spendByCategory(txs, OCTOBER).map((c) => c.category)).toEqual([
      'Health',
      'Food',
      'Rent',
    ]);
  });

  it('compares totals beyond 2^53 exactly', () => {
    const big = 2n ** 60n;
    const txs = [
      row({ category: 'Food', spendAmount: big }),
      row({ category: 'Rent', spendAmount: big + 1n }),
    ];
    expect(spendByCategory(txs, OCTOBER)).toEqual([
      { category: 'Rent', total: big + 1n },
      { category: 'Food', total: big },
    ]);
  });

  it('is empty for no transactions', () => {
    expect(spendByCategory([], OCTOBER)).toEqual([]);
  });
});

describe('cashFlow', () => {
  it('SPEC section 4: examples 1-8 give the documented totals', async () => {
    const txs = await ledger(...EXAMPLES);
    expect(cashFlow(txs, OCTOBER)).toEqual({
      in: 8_500_000n,
      out: 3_800_000n,
      net: 4_700_000n,
      adjustments: 80_000n,
    });
  });

  it('counts a card spend at the swipe and not again at the bill payment', async () => {
    const swipe = await ledger('petrol 4k cc icici');
    const paid = await ledger(
      'petrol 4k cc icici',
      'pay icicicc 4k from icici',
    );
    expect(cashFlow(swipe, OCTOBER).out).toBe(400_000n);
    expect(cashFlow(paid, OCTOBER).out).toBe(400_000n);
  });

  it('counts only your share of a split, not the payer total', async () => {
    const txs = await ledger(
      'dinner 4000 split rahul 1000 anita 1000 cc icici',
    );
    expect(cashFlow(txs, OCTOBER).out).toBe(200_000n);
  });

  it('counts nothing for lending and repayment', async () => {
    const txs = await ledger('lend rahul 10k icici', 'got rahul 5k icici');
    expect(cashFlow(txs, OCTOBER)).toEqual({
      in: 0n,
      out: 0n,
      net: 0n,
      adjustments: 0n,
    });
  });

  it('keeps a downward reconcile signed and outside net', async () => {
    const txs = await ledger('bal icici 84000');
    expect(cashFlow(txs, OCTOBER)).toEqual({
      in: 0n,
      out: 0n,
      net: 0n,
      adjustments: -20_000n,
    });
  });

  it('can have a negative net', async () => {
    const txs = await ledger('in 1k salary icici', 'emi 32k bom');
    expect(cashFlow(txs, OCTOBER).net).toBe(100_000n - 3_200_000n);
  });

  it('leaves out voided rows, including voided income', async () => {
    const txs = await ledger('emi 32k bom', 'in 85k salary icici', 'undo');
    expect(cashFlow(txs, OCTOBER)).toMatchObject({
      in: 0n,
      out: 3_200_000n,
    });
  });

  it('leaves out rows outside the month', () => {
    const income = (occurredAt: Date) =>
      row({
        type: 'INCOME',
        occurredAt,
        spendAmount: 0n,
        entries: [{ accountId: 'a', amount: 500n }],
      });
    const txs = [
      income(new Date(OCTOBER.start.getTime() - 1)),
      income(OCTOBER.start),
      income(OCTOBER.end),
    ];
    expect(cashFlow(txs, OCTOBER).in).toBe(500n);
  });

  it('is all zero for no transactions', () => {
    expect(cashFlow([], OCTOBER)).toEqual({
      in: 0n,
      out: 0n,
      net: 0n,
      adjustments: 0n,
    });
  });
});

describe('people', () => {
  it('SPEC section 5: Rahul owes 6,000 and Anita 1,000', async () => {
    const accounts = await accountsAfter(...EXAMPLES);
    expect(people(accounts)).toEqual({
      owesMe: [
        { name: 'Rahul', amount: 600_000n },
        { name: 'Anita', amount: 100_000n },
      ],
      owesMeTotal: 700_000n,
      iOwe: [],
      iOweTotal: 0n,
    });
  });

  it('puts PAYABLE and an overpaid RECEIVABLE under "I owe", as positive amounts', () => {
    const accounts = [
      account('Kiran', 'PAYABLE', -300n),
      account('Meera', 'RECEIVABLE', -500n),
      account('Dev', 'RECEIVABLE', 200n),
    ];
    expect(people(accounts)).toEqual({
      owesMe: [{ name: 'Dev', amount: 200n }],
      owesMeTotal: 200n,
      iOwe: [
        { name: 'Meera', amount: 500n },
        { name: 'Kiran', amount: 300n },
      ],
      iOweTotal: 800n,
    });
  });

  it('hides zero balances', () => {
    const accounts = [
      account('Dev', 'RECEIVABLE', 0n),
      account('Kiran', 'PAYABLE', 0n),
    ];
    expect(people(accounts)).toEqual({
      owesMe: [],
      owesMeTotal: 0n,
      iOwe: [],
      iOweTotal: 0n,
    });
  });

  it('ignores banks, cards and loans', () => {
    const accounts = [
      account('Bank', 'BANK', 100n),
      account('Card', 'CREDIT_CARD', -100n),
      account('Loan', 'LOAN', -100n),
    ];
    expect(people(accounts).owesMe).toEqual([]);
    expect(people(accounts).iOwe).toEqual([]);
  });

  it('sorts by largest amount, then by name', () => {
    const accounts = [
      account('Meera', 'RECEIVABLE', 100n),
      account('Dev', 'RECEIVABLE', 100n),
      account('Kiran', 'RECEIVABLE', 900n),
    ];
    expect(people(accounts).owesMe.map((p) => p.name)).toEqual([
      'Kiran',
      'Dev',
      'Meera',
    ]);
  });
});

describe('balancesByKind', () => {
  it('groups banks, cards and loans in a fixed order, sorted by name', () => {
    const accounts = [
      account('Loan', 'LOAN', -900n),
      account('Card', 'CREDIT_CARD', -400n),
      account('Zeta', 'BANK', 100n),
      account('Alpha', 'BANK', 200n),
    ];
    expect(balancesByKind(accounts)).toEqual([
      {
        kind: 'BANK',
        accounts: [
          { name: 'Alpha', amount: 200n },
          { name: 'Zeta', amount: 100n },
        ],
        total: 300n,
      },
      {
        kind: 'CREDIT_CARD',
        accounts: [{ name: 'Card', amount: 400n }],
        total: 400n,
      },
      { kind: 'LOAN', accounts: [{ name: 'Loan', amount: 900n }], total: 900n },
    ]);
  });

  it('shows what is owed on a card as positive, and an overpaid card as negative', () => {
    const accounts = [
      account('Owed', 'CREDIT_CARD', -400n),
      account('Overpaid', 'CREDIT_CARD', 100n),
    ];
    expect(balancesByKind(accounts)).toEqual([
      {
        kind: 'CREDIT_CARD',
        accounts: [
          { name: 'Overpaid', amount: -100n },
          { name: 'Owed', amount: 400n },
        ],
        total: 300n,
      },
    ]);
  });

  it('keeps an overdrawn bank negative and a zero bank visible', () => {
    const accounts = [account('Low', 'BANK', -50n), account('Nil', 'BANK', 0n)];
    expect(balancesByKind(accounts)).toEqual([
      {
        kind: 'BANK',
        accounts: [
          { name: 'Low', amount: -50n },
          { name: 'Nil', amount: 0n },
        ],
        total: -50n,
      },
    ]);
  });

  it('leaves people to the people panel and omits empty groups', () => {
    const accounts = [
      account('Dev', 'RECEIVABLE', 100n),
      account('Kiran', 'PAYABLE', -100n),
    ];
    expect(balancesByKind(accounts)).toEqual([]);
  });

  it('reflects a bill payment on both the card and the named bank', async () => {
    const accounts = await accountsAfter(
      'petrol 4k cc icici',
      'pay icicicc 4k from icici',
    );
    const [bank, card] = balancesByKind(accounts);
    expect(bank?.accounts).toContainEqual({
      name: 'ICICI',
      amount: 8_420_000n - 400_000n,
    });
    expect(card?.accounts).toEqual([{ name: 'ICICI-CC', amount: 150_000n }]);
  });
});

describe('savingsRate', () => {
  const flow = (income: bigint, out: bigint) => ({
    in: income,
    out,
    net: income - out,
    adjustments: 0n,
  });

  it('is net over in, in tenths of a percent', () => {
    expect(savingsRate(flow(8_500_000n, 5_520_000n))).toBe(350);
    expect(savingsRate(flow(100n, 0n))).toBe(1000);
  });

  it('is exact for a one-in-three split, rounding towards zero', () => {
    expect(savingsRate(flow(300n, 200n))).toBe(333);
  });

  it('goes negative when more went out than came in', () => {
    expect(savingsRate(flow(100n, 150n))).toBe(-500);
  });

  it('is null with no income, rather than dividing by zero', () => {
    expect(savingsRate(flow(0n, 500n))).toBeNull();
  });

  it('ignores reconcile corrections, as net does', () => {
    expect(savingsRate({ ...flow(200n, 100n), adjustments: 999n })).toBe(500);
  });
});
