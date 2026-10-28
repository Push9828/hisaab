import { type Paise } from './money';
import { type AccountInfo, type AccountKind, type ProposedTx } from './types';

/** Where a message came from. Together these are the idempotency key. */
export interface MessageMeta {
  channel: string;
  externalId: string;
  rawText: string;
}

export interface NewAccount {
  alias: string;
  name: string;
  kind: AccountKind;
  openingBalance: Paise;
}

/** The newest transaction that is not voided; the target of `undo`. */
export interface ActiveTx {
  id: string;
  description: string;
}

/**
 * Persistence as `ingest()` needs it. `core` never touches a database: `db`
 * implements this over Prisma and tests use an in-memory fake.
 */
export interface LedgerStore {
  /** Everything `fn` does commits together or not at all. */
  transaction<T>(fn: (store: LedgerStore) => Promise<T>): Promise<T>;

  /**
   * Record that this message has been handled. Returns false if it already
   * was, in which case the caller must write nothing. Concurrent calls with
   * the same key must not both return true.
   */
  markProcessed(channel: string, externalId: string): Promise<boolean>;

  /** Accounts with balances derived from non-voided entries (SPEC invariant 4). */
  accountsWithBalances(): Promise<AccountInfo[]>;

  createAccount(account: NewAccount): Promise<void>;
  insertTransaction(meta: MessageMeta, tx: ProposedTx): Promise<void>;

  /** Newest non-voided transaction by insertion order, not `occurredAt`. */
  lastActive(): Promise<ActiveTx | null>;
  voidTransaction(id: string, at: Date): Promise<void>;
}
