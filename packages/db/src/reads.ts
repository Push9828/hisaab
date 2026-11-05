import { and, asc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';

import { accounts, entries, transactions } from './schema';

import type { Db } from './drizzle-store';
import type {
  AccountInfo,
  Category,
  DateRange,
  DescriptionCount,
  ReportTx,
} from '@hisaab/core';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Per statement, not per run: it stops one stuck statement (including a wait
 * on the run lock) from blocking forever. A run issues several statements, so
 * the Lambda's 20s timeout is the overall bound. Set per transaction with
 * SET LOCAL rather than as a connection startup parameter, which poolers such
 * as Supavisor may reject.
 */
const STATEMENT_TIMEOUT = '10s';

export const setStatementTimeout = (tx: Tx) =>
  tx.execute(sql.raw(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`));

/** Shared with DrizzleStore, so the bot and the dashboard cannot drift apart. */
export async function accountsWithBalances(tx: Tx): Promise<AccountInfo[]> {
  const rows = await tx
    .select()
    .from(accounts)
    .orderBy(asc(accounts.createdAt), asc(accounts.id));
  // sum(bigint) is numeric, which pg returns as a string. Parse it as a
  // BigInt; never go through Number.
  const sums = await tx
    .select({
      accountId: entries.accountId,
      total: sql<string>`sum(${entries.amount})`,
    })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(isNull(transactions.voidedAt))
    .groupBy(entries.accountId);
  const sumOf = new Map(sums.map((s) => [s.accountId, BigInt(s.total)]));
  return rows.map((a) => ({
    id: a.id,
    alias: a.alias,
    name: a.name,
    kind: a.kind,
    balance: a.openingBalance + (sumOf.get(a.id) ?? 0n),
  }));
}

/**
 * No advisory lock: that only serialises ledger writes, and a read must not
 * wait behind them.
 */
export function readOnly<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(
    async (tx) => {
      await setStatementTimeout(tx);
      return fn(tx);
    },
    { accessMode: 'read only' },
  );
}

export const readAccounts = (db: Db): Promise<AccountInfo[]> =>
  readOnly(db, accountsWithBalances);

/**
 * The next three serve the owner's keyword suggestion script. They are not exported
 * from the package, and the dashboard's role cannot read `description`.
 */
export async function readNeedsReview(tx: Tx): Promise<DescriptionCount[]> {
  const count = sql<number>`count(*)::int`;
  return tx
    .select({ description: transactions.description, count })
    .from(transactions)
    .where(
      and(
        // Guesses included: nobody has reviewed them, so they can still become keywords.
        eq(transactions.status, 'NEEDS_REVIEW'),
        isNull(transactions.voidedAt),
      ),
    )
    .groupBy(transactions.description);
}

export const readAccountNames = (
  tx: Tx,
): Promise<Pick<AccountInfo, 'alias' | 'name' | 'kind'>[]> =>
  tx
    .select({
      alias: accounts.alias,
      name: accounts.name,
      kind: accounts.kind,
    })
    .from(accounts);

/**
 * Confirmed spending under another category whose description holds the keyword as
 * a whole token, so a future message like it would conflict and go to review.
 * Returns a number only.
 */
export async function countConfirmedWithKeyword(
  tx: Tx,
  keyword: string,
  category: Category,
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(
      and(
        inArray(transactions.type, ['EXPENSE', 'SPLIT']),
        eq(transactions.status, 'CONFIRMED'),
        isNull(transactions.voidedAt),
        ne(transactions.category, category),
        // A plain string test on tokens, so that the keyword is never read as a
        // pattern. It matches core's tokenize() except for two rare Unicode letters
        // that lower to ASCII, which only affects this count.
        sql`${keyword} = ANY (regexp_split_to_array(lower(${transactions.description}), '[^a-z0-9]+'))`,
      ),
    );
  return row?.count ?? 0;
}

/**
 * Non-voided transactions with `occurredAt` in the half-open range, in creation
 * order. Lists its columns: `rawText` holds message bodies and is never read,
 * and the dashboard's database role has no grant on it.
 */
export function readTransactions(
  db: Db,
  { start, end }: DateRange,
): Promise<ReportTx[]> {
  return readOnly(db, async (tx) => {
    // A left join, so that a transaction with no entries keeps its spend.
    const rows = await tx
      .select({
        id: transactions.id,
        type: transactions.type,
        occurredAt: transactions.occurredAt,
        category: transactions.category,
        spendAmount: transactions.spendAmount,
        accountId: entries.accountId,
        amount: entries.amount,
      })
      .from(transactions)
      .leftJoin(entries, eq(entries.transactionId, transactions.id))
      .where(
        and(
          isNull(transactions.voidedAt),
          gte(transactions.occurredAt, start),
          lt(transactions.occurredAt, end),
        ),
      )
      .orderBy(asc(transactions.seq));

    const byId = new Map<string, ReportTx>();
    for (const row of rows) {
      let report = byId.get(row.id);
      if (!report) {
        report = {
          type: row.type,
          occurredAt: row.occurredAt,
          // Only core's fixed list is ever written to this column.
          category: row.category as Category | null,
          spendAmount: row.spendAmount,
          entries: [],
          voidedAt: null,
        };
        byId.set(row.id, report);
      }
      if (row.accountId !== null && row.amount !== null) {
        report.entries.push({ accountId: row.accountId, amount: row.amount });
      }
    }
    return [...byId.values()];
  });
}
