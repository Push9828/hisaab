import { type Category, categorize, spendCategory } from './categories';
import { type Paise } from './money';
import {
  type AccountInfo,
  type AccountKind,
  type Clarify,
  type Entry,
  type ProposedTx,
  type Result,
  clarify,
} from './types';

const PAYABLE_FROM: AccountKind[] = ['BANK', 'CREDIT_CARD'];

const badAmount = (): Clarify =>
  clarify('BAD_AMOUNT', 'The amount must be greater than zero.');

const mismatch = (what: string): Clarify =>
  clarify('KIND_MISMATCH', `That does not work with those accounts: ${what}.`);

function propose(tx: Omit<ProposedTx, 'status'>): Result {
  const reviewable = tx.type === 'EXPENSE' || tx.type === 'SPLIT';
  const full: ProposedTx = {
    ...tx,
    status: reviewable && tx.category === null ? 'NEEDS_REVIEW' : 'CONFIRMED',
  };
  checkInvariants(full);
  return { kind: 'proposal', tx: full };
}

/** Safety net for SPEC section 4. A throw here is a bug in a builder. */
export function checkInvariants(tx: ProposedTx): void {
  const fail = (why: string): never => {
    throw new Error(`Ledger invariant violated (${tx.type}): ${why}`);
  };
  const sum = tx.entries.reduce((s, e) => s + e.amount, 0n);

  if (tx.entries.length === 0) fail('no entries');
  if (tx.entries.some((e) => e.amount === 0n)) fail('zero-amount entry');
  if (tx.spendAmount < 0n) fail('negative spendAmount');

  const [first, ...rest] = tx.entries;
  switch (tx.type) {
    case 'TRANSFER':
      if (sum !== 0n) fail('entries must sum to zero');
      if (tx.spendAmount !== 0n) fail('spendAmount must be 0');
      break;
    case 'ADJUSTMENT':
      if (tx.entries.length !== 1) fail('exactly one entry');
      if (tx.spendAmount !== 0n) fail('spendAmount must be 0');
      break;
    case 'INCOME':
      if (tx.entries.length !== 1 || (first?.amount ?? 0n) < 0n) {
        fail('one entry into the account');
      }
      if (tx.spendAmount !== 0n) fail('spendAmount must be 0');
      break;
    case 'EXPENSE':
      if (tx.entries.length !== 1 || (first?.amount ?? 0n) > 0n) {
        fail('one entry out of the account');
      }
      if (tx.spendAmount !== -(first?.amount ?? 0n)) {
        fail('spend must equal the payer entry');
      }
      break;
    case 'SPLIT':
      if ((first?.amount ?? 0n) >= 0n) fail('payer entry must be negative');
      if (rest.some((e) => e.amount < 0n)) fail('shares must be positive');
      if (sum !== -tx.spendAmount) fail('entries must sum to -spendAmount');
      break;
  }
}

export function buildExpense(
  account: AccountInfo,
  amount: Paise,
  description: string,
  category: Category | null,
  occurredAt: Date,
): Result {
  if (amount <= 0n) return badAmount();
  if (!PAYABLE_FROM.includes(account.kind)) {
    return mismatch('spend from a bank account or a credit card');
  }
  return propose({
    type: 'EXPENSE',
    occurredAt,
    description,
    category: spendCategory(category),
    spendAmount: amount,
    entries: [{ accountId: account.id, amount: -amount }],
  });
}

export function buildIncome(
  account: AccountInfo,
  amount: Paise,
  description: string,
  occurredAt: Date,
): Result {
  if (amount <= 0n) return badAmount();
  if (account.kind !== 'BANK')
    return mismatch('income goes into a bank account');
  return propose({
    type: 'INCOME',
    occurredAt,
    description,
    category: categorize(description) === 'Salary' ? 'Salary' : 'Other income',
    spendAmount: 0n,
    entries: [{ accountId: account.id, amount }],
  });
}

/** Moves money between two accounts. Never counts as spending. */
export function buildTransfer(
  from: AccountInfo,
  to: AccountInfo,
  amount: Paise,
  description: string,
  occurredAt: Date,
): Result {
  if (amount <= 0n) return badAmount();
  if (from.id === to.id) {
    return clarify(
      'SAME_ACCOUNT',
      'Those are the same account. Which two accounts?',
    );
  }
  return propose({
    type: 'TRANSFER',
    occurredAt,
    description,
    category: null,
    spendAmount: 0n,
    entries: [
      { accountId: from.id, amount: -amount },
      { accountId: to.id, amount },
    ],
  });
}

export function buildSplit(
  payer: AccountInfo,
  total: Paise,
  shares: { account: AccountInfo; amount: Paise }[],
  description: string,
  category: Category | null,
  occurredAt: Date,
): Result {
  if (total <= 0n || shares.some((s) => s.amount <= 0n)) return badAmount();
  if (!PAYABLE_FROM.includes(payer.kind)) {
    return mismatch('the payer must be a bank account or a credit card');
  }
  const others = shares.reduce((s, x) => s + x.amount, 0n);
  if (others > total) {
    return clarify(
      'SPLIT_EXCEEDS_TOTAL',
      'The shares add up to more than the total. Please check the amounts.',
    );
  }
  return propose({
    type: 'SPLIT',
    occurredAt,
    description,
    category: spendCategory(category),
    spendAmount: total - others,
    entries: [
      { accountId: payer.id, amount: -total },
      ...shares.map((s) => ({ accountId: s.account.id, amount: s.amount })),
    ],
  });
}

export function buildAdjustment(
  account: AccountInfo,
  difference: Paise,
  occurredAt: Date,
): Result {
  if (difference === 0n) return badAmount();
  return propose({
    type: 'ADJUSTMENT',
    occurredAt,
    description: 'Reconcile',
    category: null,
    spendAmount: 0n,
    entries: [{ accountId: account.id, amount: difference }],
  });
}

/** Owed kinds hold a negative balance; the user states what they owe. */
export function signedBalance(kind: AccountKind, stated: Paise): Paise {
  return kind === 'BANK' || kind === 'RECEIVABLE' ? stated : -stated;
}

export interface LedgerTx {
  voidedAt: Date | null;
  entries: readonly Entry[];
}

/** SPEC invariants 4 and 6: derived from entries, voided rows excluded. */
export function balanceOf(
  accountId: string,
  openingBalance: Paise,
  txs: readonly LedgerTx[],
): Paise {
  let balance = openingBalance;
  for (const tx of txs) {
    if (tx.voidedAt !== null) continue;
    for (const entry of tx.entries) {
      if (entry.accountId === accountId) balance += entry.amount;
    }
  }
  return balance;
}
