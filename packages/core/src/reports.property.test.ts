import fc from 'fast-check';
import { expect, it } from 'vitest';

import { CATEGORIES } from './categories';
import { istMonthRange } from './dates';
import { type ReportTx, spendByCategory } from './reports';

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
    occurredAt: dates,
    category,
    spendAmount: spend,
    voidedAt: fc.option(fc.constant(new Date(0))),
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
