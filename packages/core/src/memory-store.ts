import { balanceOf } from './ledger';
import {
  type LedgerStore,
  type LedgerTxn,
  type MessageMeta,
  type NewAccount,
} from './store';
import { type AccountInfo, type ProposedTx } from './types';

export interface MemoryAccount extends NewAccount {
  id: string;
}

export interface MemoryTx extends MessageMeta {
  id: string;
  proposed: ProposedTx;
  voidedAt: Date | null;
}

export interface MemoryState {
  accounts: MemoryAccount[];
  transactions: MemoryTx[];
  processed: string[];
}

const key = (channel: string, externalId: string) =>
  JSON.stringify([channel, externalId]);

// Rows are replaced, never mutated in place, apart from voidedAt, so copying
// each row one level deep is enough. (core's lib has no structuredClone.)
const copy = (s: MemoryState): MemoryState => ({
  accounts: s.accounts.map((a) => ({ ...a })),
  transactions: s.transactions.map((t) => ({ ...t })),
  processed: [...s.processed],
});

/**
 * In-memory LedgerStore for tests. Runs are serialised and rolled back when
 * the callback throws, which is what the Postgres store must also do.
 */
export class MemoryStore implements LedgerStore {
  private state: MemoryState;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 1;

  constructor(accounts: readonly MemoryAccount[] = []) {
    this.state = { accounts: [...accounts], transactions: [], processed: [] };
  }

  /** A deep copy, so tests can compare before and after. */
  snapshot(): MemoryState {
    return copy(this.state);
  }

  run<T>(fn: (txn: LedgerTxn) => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const draft = copy(this.state);
      const value = await fn(this.handle(draft));
      this.state = draft;
      return value;
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private handle(draft: MemoryState): LedgerTxn {
    return {
      wasProcessed: (channel, externalId) =>
        Promise.resolve(draft.processed.includes(key(channel, externalId))),

      claim: (channel, externalId) => {
        const k = key(channel, externalId);
        if (draft.processed.includes(k)) return Promise.resolve(false);
        draft.processed.push(k);
        return Promise.resolve(true);
      },

      accounts: () =>
        Promise.resolve(
          draft.accounts.map((a): AccountInfo => ({
            id: a.id,
            alias: a.alias,
            name: a.name,
            kind: a.kind,
            balance: balanceOf(
              a.id,
              a.openingBalance,
              draft.transactions.map((t) => ({
                voidedAt: t.voidedAt,
                entries: t.proposed.entries,
              })),
            ),
          })),
        ),

      createAccount: (account) => {
        // Postgres has a unique index on alias; this keeps the stores in step.
        if (draft.accounts.some((a) => a.alias === account.alias)) {
          return Promise.reject(new Error('alias already exists'));
        }
        draft.accounts.push({ ...account, id: `acc-${this.nextId++}` });
        return Promise.resolve();
      },

      insertTransaction: (proposed, meta) => {
        draft.transactions.push({
          ...meta,
          id: `tx-${this.nextId++}`,
          proposed,
          voidedAt: null,
        });
        return Promise.resolve();
      },

      voidLatest: (at) => {
        const latest = [...draft.transactions]
          .reverse()
          .find((t) => t.voidedAt === null);
        if (!latest) return Promise.resolve(null);
        latest.voidedAt = at;
        return Promise.resolve({ description: latest.proposed.description });
      },

      transactionsInRange: ({ start, end }) =>
        Promise.resolve(
          draft.transactions
            .filter(
              ({ voidedAt, proposed: { occurredAt } }) =>
                voidedAt === null && occurredAt >= start && occurredAt < end,
            )
            .map(({ proposed }) => ({
              type: proposed.type,
              occurredAt: proposed.occurredAt,
              category: proposed.category,
              spendAmount: proposed.spendAmount,
              entries: proposed.entries,
              voidedAt: null,
            })),
        ),
    };
  }
}
