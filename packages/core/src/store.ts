import { type DateRange } from './dates';
import { type Paise } from './money';
import { type ReportTx } from './reports';
import { type AccountInfo, type AccountKind, type ProposedTx } from './types';

export interface NewAccount {
  alias: string;
  name: string;
  kind: AccountKind;
  openingBalance: Paise;
}

/** Where a message came from. Stored on the transaction it produced. */
export interface MessageMeta {
  channel: string;
  externalId: string;
  rawText: string;
}

/**
 * Operations available inside one atomic unit of work. Everything `ingest`
 * does for one message goes through a single handle, so a failure rolls the
 * whole message back.
 */
export interface LedgerTxn {
  /** True when this (channel, externalId) was already claimed (SPEC invariant 5). */
  wasProcessed(channel: string, externalId: string): Promise<boolean>;
  /**
   * Records the message as processed. False means another delivery got there
   * first and the caller must write nothing.
   */
  claim(channel: string, externalId: string): Promise<boolean>;
  /** Every account with its balance derived from entries (invariants 4 and 6). */
  accounts(): Promise<AccountInfo[]>;
  createAccount(account: NewAccount): Promise<void>;
  insertTransaction(tx: ProposedTx, meta: MessageMeta): Promise<void>;
  /**
   * Voids the latest non-voided transaction, adjustments included. Returns its
   * description, or null when there is nothing to void.
   */
  voidLatest(at: Date): Promise<{ description: string } | null>;
  /** Non-voided transactions in the half-open range, in creation order. */
  transactionsInRange(range: DateRange): Promise<ReportTx[]>;
}

export interface LedgerStore {
  run<T>(fn: (txn: LedgerTxn) => Promise<T>): Promise<T>;
}
