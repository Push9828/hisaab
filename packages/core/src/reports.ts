import { type Category } from './categories';
import { type DateRange } from './dates';
import { type Paise } from './money';
import { type ProposedTx } from './types';

export const UNCATEGORISED = 'Uncategorised';

export interface ReportTx extends Pick<
  ProposedTx,
  'occurredAt' | 'category' | 'spendAmount'
> {
  voidedAt: Date | null;
}

export interface CategorySpend {
  category: Category | typeof UNCATEGORISED;
  total: Paise;
}

const counts = (tx: ReportTx, { start, end }: DateRange): boolean =>
  tx.voidedAt === null && tx.occurredAt >= start && tx.occurredAt < end;

/**
 * SPEC section 4. Totals equal total spend for the range, because a null
 * category goes in Uncategorised. Sorted by largest total, then by name.
 */
export function spendByCategory(
  txs: readonly ReportTx[],
  range: DateRange,
): CategorySpend[] {
  const totals = new Map<CategorySpend['category'], Paise>();
  for (const tx of txs) {
    // Transfers, adjustments and income have zero spend and get no row.
    if (!counts(tx, range) || tx.spendAmount === 0n) continue;
    const category = tx.category ?? UNCATEGORISED;
    totals.set(category, (totals.get(category) ?? 0n) + tx.spendAmount);
  }
  return [...totals]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => {
      if (a.total === b.total) return a.category.localeCompare(b.category);
      return a.total > b.total ? -1 : 1;
    });
}
