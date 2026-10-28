import { balanceOf } from './ledger';
import {
  type ActiveTx,
  type LedgerStore,
  type MessageMeta,
  type NewAccount,
} from './store';
import { type AccountInfo, type ProposedTx } from './types';

interface StoredTx extends ProposedTx {
  id: string;
  voidedAt: Date | null;
  meta: MessageMeta;
}

interface StoredAccount extends NewAccount {
  id: string;
}

interface State {
  accounts: StoredAccount[];
  txs: StoredTx[];
  processed: Set<string>;
}

/** In-memory `LedgerStore` for tests. Not for production use. */
export class MemoryStore implements LedgerStore {
  private state: State;

  constructor(seed: readonly AccountInfo[] = []) {
    this.state = {
      accounts: seed.map((a) => ({
        id: a.id,
        alias: a.alias,
        name: a.name,
        kind: a.kind,
        openingBalance: a.balance,
      })),
      txs: [],
      processed: new Set(),
    };
  }

  /** Test inspection: every stored transaction, voided ones included. */
  get transactions(): readonly StoredTx[] {
    return this.state.txs;
  }

  get accounts(): readonly StoredAccount[] {
    return this.state.accounts;
  }

  async transaction<T>(fn: (store: LedgerStore) => Promise<T>): Promise<T> {
    // Only `voidedAt` is ever mutated after insert, so a shallow copy per row is enough.
    const before: State = {
      accounts: this.state.accounts.map((a) => ({ ...a })),
      txs: this.state.txs.map((t) => ({ ...t })),
      processed: new Set(this.state.processed),
    };
    try {
      return await fn(this);
    } catch (error) {
      this.state = before;
      throw error;
    }
  }

  async markProcessed(channel: string, externalId: string): Promise<boolean> {
    const key = JSON.stringify([channel, externalId]);
    if (this.state.processed.has(key)) return false;
    this.state.processed.add(key);
    return true;
  }

  async accountsWithBalances(): Promise<AccountInfo[]> {
    return this.state.accounts.map((a) => ({
      id: a.id,
      alias: a.alias,
      name: a.name,
      kind: a.kind,
      balance: balanceOf(a.id, a.openingBalance, this.state.txs),
    }));
  }

  async createAccount(account: NewAccount): Promise<void> {
    this.state.accounts.push({
      ...account,
      id: `acct-${this.state.accounts.length + 1}`,
    });
  }

  async insertTransaction(meta: MessageMeta, tx: ProposedTx): Promise<void> {
    this.state.txs.push({
      ...tx,
      id: `tx-${this.state.txs.length + 1}`,
      voidedAt: null,
      meta,
    });
  }

  async lastActive(): Promise<ActiveTx | null> {
    for (let i = this.state.txs.length - 1; i >= 0; i--) {
      const tx = this.state.txs[i];
      if (tx && tx.voidedAt === null) {
        return { id: tx.id, description: tx.description };
      }
    }
    return null;
  }

  async voidTransaction(id: string, at: Date): Promise<void> {
    const tx = this.state.txs.find((t) => t.id === id);
    if (!tx) throw new Error(`No transaction ${id}`);
    tx.voidedAt = at;
  }
}
