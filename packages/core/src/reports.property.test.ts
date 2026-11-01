import fc from 'fast-check';
import { expect, it } from 'vitest';

import { CATEGORIES } from './categories';
import { istMonthRange } from './dates';
import { type ReportTx, cashFlow, people, spendByCategory } from './reports';
import { type AccountInfo } from './types';

// SPEC section 4 report rules over random rows. Expected totals are computed
// from the generated rows. All numbers are fake.

const OCTOBER = istMonthRange(2026, 10);

const inOctober = fc.date({
  min: OCTOBER.start,
  max: new Date(OCTOBER.end.getTime() - 1),
  noInvalidDate: true,
});

const anyDate = fc.date({
  min: new Date('2026-09-01T00:00:00.000Z'),
  max: new Date('2026-12-01T00:00:00.000Z'),
  noInvalidDate: true,
});

const category = fc.constantFrom(...CATEGORIES, null);

// Above 2^53, so any Number coercion shows up as a wrong total.
const spend = fc.bigInt({ min: 0n, max: 2n ** 60n });

const tx = (dates: fc.Arbitrary<Date>): fc.Arbitrary<ReportTx> =>
  fc.record({
    type: fc.constant('EXPENSE' as const),
    occurredAt: dates,
    category,
    spendAmount: spend,
    entries: fc.constant([]),
    voidedAt: fc.option(fc.constant(new Date(0))),
  });

const amount = fc.bigInt({ min: 1n, max: 2n ** 60n });

/** A well-formed row with the cash flow it should produce, from the generated numbers. */
interface Generated {
  tx: Omit<ReportTx, 'occurredAt' | 'voidedAt'>;
  in: bigint;
  out: bigint;
  adjustments: bigint;
}

const base = { in: 0n, out: 0n, adjustments: 0n };

const expense = amount.map((a): Generated => ({
  ...base,
  out: a,
  tx: {
    type: 'EXPENSE',
    category: 'Food',
    spendAmount: a,
    entries: [{ accountId: 'bank', amount: -a }],
  },
}));

const income = amount.map((a): Generated => ({
  ...base,
  in: a,
  tx: {
    type: 'INCOME',
    category: 'Salary',
    spendAmount: 0n,
    entries: [{ accountId: 'bank', amount: a }],
  },
}));

const transfer = amount.map((a): Generated => ({
  ...base,
  tx: {
    type: 'TRANSFER',
    category: null,
    spendAmount: 0n,
    entries: [
      { accountId: 'bank', amount: -a },
      { accountId: 'person', amount: a },
    ],
  },
}));

const split = fc.tuple(amount, amount).map(([own, others]): Generated => ({
  ...base,
  out: own,
  tx: {
    type: 'SPLIT',
    category: 'Food',
    spendAmount: own,
    entries: [
      { accountId: 'card', amount: -(own + others) },
      { accountId: 'person', amount: others },
    ],
  },
}));

const adjustment = fc
  .tuple(amount, fc.boolean())
  .map(([a, up]) => (up ? a : -a))
  .map((difference): Generated => ({
    ...base,
    adjustments: difference,
    tx: {
      type: 'ADJUSTMENT',
      category: null,
      spendAmount: 0n,
      entries: [{ accountId: 'bank', amount: difference }],
    },
  }));

const generated = fc.oneof(expense, income, transfer, split, adjustment);

const live = (g: Generated): ReportTx => ({
  ...g.tx,
  occurredAt: OCTOBER.start,
  voidedAt: null,
});

const sumOf = (rows: readonly { total: bigint }[]) =>
  rows.reduce((s, r) => s + r.total, 0n);

const counted = (t: ReportTx) =>
  t.voidedAt === null &&
  t.occurredAt >= OCTOBER.start &&
  t.occurredAt < OCTOBER.end;

it('category totals add up to the spend of non-voided rows in the month', () => {
  fc.assert(
    fc.property(fc.array(tx(anyDate)), (txs) => {
      const want = txs.filter(counted).reduce((s, t) => s + t.spendAmount, 0n);
      expect(sumOf(spendByCategory(txs, OCTOBER))).toBe(want);
    }),
    { numRuns: 1000 },
  );
});

it('voiding a row removes exactly its spend', () => {
  fc.assert(
    fc.property(
      fc.array(tx(anyDate)),
      tx(inOctober).map((t) => ({ ...t, voidedAt: null })),
      fc.nat(),
      (others, target, at) => {
        const position = at % (others.length + 1);
        const withRow = (row: ReportTx) => [
          ...others.slice(0, position),
          row,
          ...others.slice(position),
        ];
        const live = sumOf(spendByCategory(withRow(target), OCTOBER));
        const voided = sumOf(
          spendByCategory(
            withRow({ ...target, voidedAt: new Date(0) }),
            OCTOBER,
          ),
        );
        expect(live - voided).toBe(target.spendAmount);
      },
    ),
    { numRuns: 1000 },
  );
});

it('a zero-spend row such as a TRANSFER or ADJUSTMENT changes nothing', () => {
  fc.assert(
    fc.property(
      fc.array(tx(anyDate)),
      tx(inOctober).map((t) => ({ ...t, spendAmount: 0n, voidedAt: null })),
      (txs, zero) => {
        expect(spendByCategory([...txs, zero], OCTOBER)).toEqual(
          spendByCategory(txs, OCTOBER),
        );
      },
    ),
    { numRuns: 1000 },
  );
});

it('no row has a zero total, and each category appears once', () => {
  fc.assert(
    fc.property(fc.array(tx(anyDate)), (txs) => {
      const rows = spendByCategory(txs, OCTOBER);
      expect(rows.every((r) => r.total > 0n)).toBe(true);
      expect(new Set(rows.map((r) => r.category)).size).toBe(rows.length);
    }),
    { numRuns: 1000 },
  );
});

it('cash flow matches the generated numbers, and net is in minus out', () => {
  fc.assert(
    fc.property(fc.array(generated), (rows) => {
      const want = rows.reduce(
        (s, r) => ({
          in: s.in + r.in,
          out: s.out + r.out,
          adjustments: s.adjustments + r.adjustments,
        }),
        base,
      );
      expect(cashFlow(rows.map(live), OCTOBER)).toEqual({
        ...want,
        net: want.in - want.out,
      });
    }),
    { numRuns: 1000 },
  );
});

it('out always equals the spend report', () => {
  fc.assert(
    fc.property(fc.array(generated), (rows) => {
      const txs = rows.map(live);
      expect(cashFlow(txs, OCTOBER).out).toBe(
        sumOf(spendByCategory(txs, OCTOBER)),
      );
    }),
    { numRuns: 1000 },
  );
});

it('a transfer, such as lend, got or a bill payment, changes no cash flow figure', () => {
  fc.assert(
    fc.property(fc.array(generated), transfer, (rows, extra) => {
      const txs = rows.map(live);
      expect(cashFlow([...txs, live(extra)], OCTOBER)).toEqual(
        cashFlow(txs, OCTOBER),
      );
    }),
    { numRuns: 1000 },
  );
});

it('a split adds only its own share to out, never the payer total', () => {
  fc.assert(
    fc.property(fc.array(generated), split, (rows, extra) => {
      const txs = rows.map(live);
      const before = cashFlow(txs, OCTOBER).out;
      const after = cashFlow([...txs, live(extra)], OCTOBER).out;
      expect(after - before).toBe(extra.tx.spendAmount);
    }),
    { numRuns: 1000 },
  );
});

it('a reconcile correction never changes net', () => {
  fc.assert(
    fc.property(fc.array(generated), adjustment, (rows, extra) => {
      const txs = rows.map(live);
      expect(cashFlow([...txs, live(extra)], OCTOBER).net).toBe(
        cashFlow(txs, OCTOBER).net,
      );
    }),
    { numRuns: 1000 },
  );
});

it('a voided or out-of-month row changes no cash flow figure', () => {
  fc.assert(
    fc.property(fc.array(generated), generated, (rows, extra) => {
      const txs = rows.map(live);
      const want = cashFlow(txs, OCTOBER);
      const voided = { ...live(extra), voidedAt: new Date(0) };
      const later = { ...live(extra), occurredAt: OCTOBER.end };
      expect(cashFlow([...txs, voided, later], OCTOBER)).toEqual(want);
    }),
    { numRuns: 1000 },
  );
});

it('people totals net to the sum of person balances, with no zero rows', () => {
  const balance = fc.bigInt({ min: -(2n ** 60n), max: 2n ** 60n });
  const person = fc.record({
    id: fc.uuid(),
    alias: fc.uuid(),
    name: fc.uuid(),
    kind: fc.constantFrom<AccountInfo['kind']>('RECEIVABLE', 'PAYABLE'),
    balance,
  });
  fc.assert(
    fc.property(fc.array(person), (accounts) => {
      const p = people(accounts);
      const net = accounts.reduce((s, a) => s + a.balance, 0n);
      expect(p.owesMeTotal - p.iOweTotal).toBe(net);
      expect([...p.owesMe, ...p.iOwe].every((x) => x.amount > 0n)).toBe(true);
    }),
    { numRuns: 1000 },
  );
});
