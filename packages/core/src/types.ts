import { type Category } from './categories';
import { type Paise } from './money';

export type AccountKind =
  'BANK' | 'CREDIT_CARD' | 'RECEIVABLE' | 'PAYABLE' | 'LOAN' | 'INVESTMENT';

export type TxType = 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'SPLIT' | 'ADJUSTMENT';
export type TxStatus = 'CONFIRMED' | 'NEEDS_REVIEW';

/** What `core` knows about an account. The caller derives `balance`. */
export interface AccountInfo {
  id: string;
  alias: string;
  name: string;
  kind: AccountKind;
  balance: Paise;
}

export interface Context {
  now: Date;
  accounts: readonly AccountInfo[];
}

/** Signed paise: negative leaves the account. */
export interface Entry {
  accountId: string;
  amount: Paise;
}

export interface ProposedTx {
  type: TxType;
  occurredAt: Date;
  description: string;
  category: Category | null;
  spendAmount: Paise;
  status: TxStatus;
  entries: Entry[];
}

export type ClarifyReason =
  | 'UNKNOWN_COMMAND'
  | 'MISSING_ACCOUNT'
  | 'MISSING_DESCRIPTION'
  | 'UNKNOWN_ACCOUNT'
  | 'BAD_AMOUNT'
  | 'AMBIGUOUS_AMOUNT'
  | 'BAD_DATE'
  | 'FUTURE_DATE'
  | 'DATE_NOT_ALLOWED'
  | 'KIND_MISMATCH'
  | 'SAME_ACCOUNT'
  | 'BAD_SPLIT'
  | 'SPLIT_EXCEEDS_TOTAL'
  | 'DUPLICATE_ALIAS'
  | 'RESERVED_ALIAS';

/** Ambiguous input: nothing is written, the user is asked a question. */
export interface Clarify {
  kind: 'clarify';
  reason: ClarifyReason;
  question: string;
}

export type Result =
  | { kind: 'proposal'; tx: ProposedTx }
  | {
      kind: 'open';
      alias: string;
      name: string;
      accountKind: AccountKind;
      openingBalance: Paise;
    }
  | { kind: 'undo' }
  | { kind: 'balances'; accountIds: string[] }
  | { kind: 'matches'; accountId: string; balance: Paise }
  | Clarify;

export const clarify = (reason: ClarifyReason, question: string): Clarify => ({
  kind: 'clarify',
  reason,
  question,
});
