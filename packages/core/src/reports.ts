import { type Category } from './categories';
import { type DateRange } from './dates';
import { signedBalance } from './ledger';
import { type Paise } from './money';
import { type AccountInfo, type AccountKind, type ProposedTx } from './types';

export const UNCATEGORISED = 'Uncategorised';

export interface ReportTx extends Pick<
  ProposedTx,
  'type' | 'occurredAt' | 'category' | 'spendAmount' | 'entries'
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

export interface CashFlow {
  in: Paise;
  out: Paise;
  net: Paise;
  adjustments: Paise; // signed; outside net
}

const entrySum = (tx: ReportTx): Paise =>
  tx.entries.reduce((s, e) => s + e.amount, 0n);

/** SPEC section 4. Out is `spendAmount`, so it always equals the spend report. */
export function cashFlow(txs: readonly ReportTx[], range: DateRange): CashFlow {
  let income = 0n;
  let out = 0n;
  let adjustments = 0n;
  for (const tx of txs) {
    if (!counts(tx, range)) continue;
    out += tx.spendAmount;
    if (tx.type === 'INCOME') income += entrySum(tx);
    if (tx.type === 'ADJUSTMENT') adjustments += entrySum(tx);
  }
  return { in: income, out, net: income - out, adjustments };
}

/**
 * SPEC section 4. Net over in, in tenths of a percent, rounded towards zero.
 * Negative when more went out than came in; null with no income.
 */
export function savingsRate({ in: income, net }: CashFlow): number | null {
  if (income === 0n) return null;
  return Number((net * 1000n) / income);
}

/**
 * SPEC section 4. Money into investments minus money out, for the range. Moves
 * between two funds net to zero. Takes no part in cash flow.
 */
export function netInvested(
  txs: readonly ReportTx[],
  accounts: readonly AccountInfo[],
  range: DateRange,
): Paise {
  const investments = new Set(
    accounts.filter((a) => a.kind === 'INVESTMENT').map((a) => a.id),
  );
  let total = 0n;
  for (const tx of txs) {
    if (!counts(tx, range) || tx.type !== 'TRANSFER') continue;
    for (const entry of tx.entries) {
      if (investments.has(entry.accountId)) total += entry.amount;
    }
  }
  return total;
}

export interface NamedAmount {
  name: string;
  amount: Paise;
}

export interface People {
  owesMe: NamedAmount[];
  owesMeTotal: Paise;
  iOwe: NamedAmount[];
  iOweTotal: Paise;
}

const totalOf = (rows: readonly NamedAmount[]): Paise =>
  rows.reduce((s, r) => s + r.amount, 0n);

const largestFirst = (a: NamedAmount, b: NamedAmount): number => {
  if (a.amount === b.amount) return a.name.localeCompare(b.name);
  return a.amount > b.amount ? -1 : 1;
};

/** SPEC section 4. Amounts are positive; the side says who owes whom. */
export function people(accounts: readonly AccountInfo[]): People {
  const persons = accounts.filter(
    (a) => a.kind === 'RECEIVABLE' || a.kind === 'PAYABLE',
  );
  const owesMe = persons
    .filter((a) => a.balance > 0n)
    .map((a) => ({ name: a.name, amount: a.balance }))
    .sort(largestFirst);
  const iOwe = persons
    .filter((a) => a.balance < 0n)
    .map((a) => ({ name: a.name, amount: -a.balance }))
    .sort(largestFirst);
  return {
    owesMe,
    owesMeTotal: totalOf(owesMe),
    iOwe,
    iOweTotal: totalOf(iOwe),
  };
}

export interface KindBalances {
  kind: AccountKind;
  accounts: NamedAmount[];
  total: Paise;
}

// People are left to the People panel.
const BALANCE_KINDS: AccountKind[] = [
  'BANK',
  'CREDIT_CARD',
  'LOAN',
  'INVESTMENT',
];

/** Amounts read as the user states them: a card or loan shows what is owed. */
export function balancesByKind(
  accounts: readonly AccountInfo[],
): KindBalances[] {
  return BALANCE_KINDS.flatMap((kind) => {
    const rows = accounts
      .filter((a) => a.kind === kind)
      .map((a) => ({ name: a.name, amount: signedBalance(kind, a.balance) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return rows.length === 0
      ? []
      : [{ kind, accounts: rows, total: totalOf(rows) }];
  });
}
