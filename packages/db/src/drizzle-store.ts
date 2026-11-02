import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { parseDatabaseUrl } from './database-url';
import { accountsWithBalances, setStatementTimeout, type Tx } from './reads';
import { accounts, entries, processedMessages, transactions } from './schema';

import type {
  LedgerStore,
  LedgerTxn,
  MessageMeta,
  NewAccount,
  ProposedTx,
} from '@hisaab/core';

export type Db = NodePgDatabase;

/**
 * Every run takes this lock first, so runs queue up one at a time like
 * MemoryStore's queue. Without it two concurrent undos could both pick the
 * same "latest" row. The key is arbitrary but fixed.
 */
const RUN_LOCK_KEY = 7_240_001;

/** pg's default (0) waits forever for a connection, e.g. to an unreachable host. */
const CONNECT_TIMEOUT_MS = 5_000;

/**
 * The caller owns `pool.end()`. Never pass Drizzle a `logger`: it prints query
 * parameters, which include message bodies (hard rule 8).
 *
 * With `ca`, the connection must use TLS and the server certificate must chain
 * to `ca` and match the host name (libpq's verify-full). The URL is checked by
 * `parseDatabaseUrl`, so no URL parameter can turn that off.
 */
export function createDb(
  connectionString: string,
  options: { ca?: string; max?: number; idleTimeoutMillis?: number } = {},
): { db: Db; pool: pg.Pool } {
  parseDatabaseUrl(connectionString);
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    ...(options.max !== undefined && { max: options.max }),
    ...(options.idleTimeoutMillis !== undefined && {
      idleTimeoutMillis: options.idleTimeoutMillis,
    }),
    ...(options.ca !== undefined && { ssl: { ca: options.ca } }),
  });
  return { db: drizzle(pool), pool };
}

/**
 * Postgres LedgerStore. One `run` is one database transaction. Must never log:
 * rows hold message bodies and balances (hard rule 8).
 */
export class DrizzleStore implements LedgerStore {
  constructor(private readonly db: Db) {}

  run<T>(fn: (txn: LedgerTxn) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await setStatementTimeout(tx);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${RUN_LOCK_KEY})`);
      return fn(handle(tx));
    });
  }
}

function handle(tx: Tx): LedgerTxn {
  return {
    async wasProcessed(channel, externalId) {
      const rows = await tx
        .select({ one: sql`1` })
        .from(processedMessages)
        .where(
          and(
            eq(processedMessages.channel, channel),
            eq(processedMessages.externalId, externalId),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    async claim(channel, externalId) {
      const rows = await tx
        .insert(processedMessages)
        .values({ channel, externalId })
        .onConflictDoNothing()
        .returning({ channel: processedMessages.channel });
      return rows.length === 1;
    },

    accounts: () => accountsWithBalances(tx),

    async createAccount(account: NewAccount) {
      await tx.insert(accounts).values({
        alias: account.alias,
        name: account.name,
        kind: account.kind,
        openingBalance: account.openingBalance,
      });
    },

    async insertTransaction(proposed: ProposedTx, meta: MessageMeta) {
      const [row] = await tx
        .insert(transactions)
        .values({
          type: proposed.type,
          occurredAt: proposed.occurredAt,
          description: proposed.description,
          category: proposed.category,
          spendAmount: proposed.spendAmount,
          status: proposed.status,
          channel: meta.channel,
          externalId: meta.externalId,
          rawText: meta.rawText,
        })
        .returning({ id: transactions.id });
      if (!row) throw new Error('insert returned no row');
      if (proposed.entries.length === 0) return;
      await tx.insert(entries).values(
        proposed.entries.map((e) => ({
          transactionId: row.id,
          accountId: e.accountId,
          amount: e.amount,
        })),
      );
    },

    async voidLatest(at) {
      const [latest] = await tx
        .select({ id: transactions.id, description: transactions.description })
        .from(transactions)
        .where(isNull(transactions.voidedAt))
        .orderBy(desc(transactions.seq))
        .limit(1);
      if (!latest) return null;
      await tx
        .update(transactions)
        .set({ voidedAt: at })
        .where(eq(transactions.id, latest.id));
      return { description: latest.description };
    },
  };
}
