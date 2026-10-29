import { MemoryStore } from '@hisaab/core';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, PrismaStore } from '../src';
import { storeContract } from './store-contract';

const url = process.env.TEST_DATABASE_URL as string;
const prisma = createPrismaClient(url);
const store = new PrismaStore(prisma);

// Never wipe a database that is not a test database.
if (!/_test$/.test(new URL(url).pathname.slice(1))) {
  throw new Error('TEST_DATABASE_URL must point at a database ending in _test');
}

beforeEach(async () => {
  await prisma.$executeRaw`TRUNCATE "Entry", "Transaction", "Account", "ProcessedMessage" RESTART IDENTITY CASCADE`;
});
afterAll(() => prisma.$disconnect());

storeContract('MemoryStore', () => Promise.resolve(new MemoryStore()));
storeContract('PrismaStore', () => Promise.resolve(store));

describe('PrismaStore on Postgres', () => {
  const insert = (type: string, spend: number, entry = 1) =>
    prisma.$executeRawUnsafe(
      `WITH a AS (INSERT INTO "Account"(id, alias, name, kind) VALUES ('a1','a','A','BANK') ON CONFLICT DO NOTHING)
       , t AS (INSERT INTO "Transaction"(id, type, "occurredAt", description, "spendAmount", channel, "externalId", "rawText")
               VALUES ('t1', '${type}', now(), 'x', ${spend}, 'c', '1', 'x'))
       INSERT INTO "Entry"(id, "transactionId", "accountId", amount) VALUES ('e1', 't1', 'a1', ${entry})`,
    );

  it.each([
    ['TRANSFER with spend', 'TRANSFER', 100, 1],
    ['negative spend', 'EXPENSE', -5, 1],
    ['zero entry', 'EXPENSE', 100, 0],
  ])('CHECK rejects %s', async (_name, type, spend, entry) => {
    await expect(insert(type, spend, entry)).rejects.toThrow();
  });

  it('serialises concurrent undos: each voids a different row', async () => {
    const n = 8;
    await store.run((db) =>
      db.createAccount({
        alias: 'a',
        name: 'A',
        kind: 'BANK',
        openingBalance: 0n,
      }),
    );
    const [account] = await store.run((db) => db.accounts());
    await store.run(async (db) => {
      for (let i = 1; i <= n; i++) {
        await db.insertTransaction(
          {
            type: 'EXPENSE',
            occurredAt: new Date(),
            description: `tx${i}`,
            category: null,
            spendAmount: 1n,
            status: 'NEEDS_REVIEW',
            entries: [{ accountId: account?.id as string, amount: -1n }],
          },
          { channel: 'test', externalId: `${i}`, rawText: 'x' },
        );
      }
    });
    const voided = await Promise.all(
      Array.from({ length: n }, () =>
        store.run((db) => db.voidLatest(new Date())),
      ),
    );
    expect(new Set(voided.map((v) => v?.description)).size).toBe(n);
  });

  it('never deletes: a voided row is still in the table', async () => {
    await store.run((db) =>
      db.createAccount({
        alias: 'a',
        name: 'A',
        kind: 'BANK',
        openingBalance: 0n,
      }),
    );
    const [account] = await store.run((db) => db.accounts());
    await store.run((db) =>
      db.insertTransaction(
        {
          type: 'EXPENSE',
          occurredAt: new Date(),
          description: 'one',
          category: null,
          spendAmount: 1n,
          status: 'NEEDS_REVIEW',
          entries: [{ accountId: account?.id as string, amount: -1n }],
        },
        { channel: 'test', externalId: '1', rawText: 'x' },
      ),
    );
    await store.run((db) => db.voidLatest(new Date()));
    expect(
      await prisma.transaction.count({ where: { voidedAt: { not: null } } }),
    ).toBe(1);
    expect(await prisma.entry.count()).toBe(1);
  });
});
