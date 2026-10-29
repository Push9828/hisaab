import { PrismaPg } from '@prisma/adapter-pg';

import { type Prisma, PrismaClient } from './generated/client';

import type {
  AccountInfo,
  LedgerStore,
  LedgerTxn,
  MessageMeta,
  NewAccount,
  ProposedTx,
} from '@hisaab/core';

/**
 * Every run takes this lock first, so runs queue up one at a time like
 * MemoryStore's queue. Without it two concurrent undos could both pick the
 * same "latest" row. The key is arbitrary but fixed.
 */
const RUN_LOCK_KEY = 7_240_001;

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/**
 * Postgres LedgerStore. One `run` is one database transaction. Must never log:
 * rows hold message bodies and balances (hard rule 8).
 */
export class PrismaStore implements LedgerStore {
  constructor(private readonly prisma: PrismaClient) {}

  run<T>(fn: (txn: LedgerTxn) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RUN_LOCK_KEY})`;
      return fn(handle(tx));
    });
  }
}

function handle(tx: Prisma.TransactionClient): LedgerTxn {
  return {
    async wasProcessed(channel, externalId) {
      const row = await tx.processedMessage.findUnique({
        where: { channel_externalId: { channel, externalId } },
      });
      return row !== null;
    },

    async claim(channel, externalId) {
      const { count } = await tx.processedMessage.createMany({
        data: { channel, externalId },
        skipDuplicates: true,
      });
      return count === 1;
    },

    async accounts(): Promise<AccountInfo[]> {
      const [accounts, sums] = await Promise.all([
        tx.account.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
        tx.entry.groupBy({
          by: ['accountId'],
          where: { transaction: { voidedAt: null } },
          _sum: { amount: true },
        }),
      ]);
      const sumOf = new Map(
        sums.map((s) => [s.accountId, s._sum.amount ?? 0n]),
      );
      return accounts.map((a) => ({
        id: a.id,
        alias: a.alias,
        name: a.name,
        kind: a.kind,
        balance: a.openingBalance + (sumOf.get(a.id) ?? 0n),
      }));
    },

    async createAccount(account: NewAccount) {
      await tx.account.create({
        data: {
          alias: account.alias,
          name: account.name,
          kind: account.kind,
          openingBalance: account.openingBalance,
        },
      });
    },

    async insertTransaction(proposed: ProposedTx, meta: MessageMeta) {
      await tx.transaction.create({
        data: {
          type: proposed.type,
          occurredAt: proposed.occurredAt,
          description: proposed.description,
          category: proposed.category,
          spendAmount: proposed.spendAmount,
          status: proposed.status,
          channel: meta.channel,
          externalId: meta.externalId,
          rawText: meta.rawText,
          entries: {
            create: proposed.entries.map((e) => ({
              accountId: e.accountId,
              amount: e.amount,
            })),
          },
        },
      });
    },

    async voidLatest(at) {
      const latest = await tx.transaction.findFirst({
        where: { voidedAt: null },
        orderBy: { seq: 'desc' },
      });
      if (!latest) return null;
      await tx.transaction.update({
        where: { id: latest.id },
        data: { voidedAt: at },
      });
      return { description: latest.description };
    },
  };
}
