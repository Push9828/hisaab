import { describe, expect, it } from 'vitest';

import { istMonthRange } from './dates';
import { ACCOUNTS, NOW } from './fixtures';
import { ingest } from './ingest';
import { MemoryStore } from './memory-store';
import { type ReportTx, spendByCategory } from './reports';

// All names and numbers are fake. Amounts are paise.
const OCTOBER = istMonthRange(2026, 10);

async function ledger(...messages: string[]): Promise<ReportTx[]> {
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
  return store
    .snapshot()
    .transactions.map((t) => ({ ...t.proposed, voidedAt: t.voidedAt }));
}

const row = (overrides: Partial<ReportTx> = {}): ReportTx => ({
  occurredAt: NOW,
  category: 'Food',
  spendAmount: 100n,
  voidedAt: null,
  ...overrides,
});

describe('spendByCategory', () => {
  it('SPEC section 5: only examples 1, 4 and 6 add spend', async () => {
    const txs = await ledger(
      'bal icici 85000', // example 8, first so that the ledger still says 84,200
      'petrol 4k cc icici',
      'pay icicicc 4k from icici',
      'xfer 25k icici bom',
      'emi 32k bom',
      'lend rahul 10k icici',
      'got rahul 5k icici',
      'dinner 4000 split rahul 1000 anita 1000 cc icici',
      'in 85k salary icici',
    );
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
