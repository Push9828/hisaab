import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

// Money is bigint paise (hard rule 1). Balances are derived, never stored
// (hard rule 5). Column names are camelCase and quoted, like the original
// migration, so the CHECK SQL below reads the same as the SPEC.

const money = (name: string) => bigint(name, { mode: 'bigint' });
const instant = (name: string) =>
  timestamp(name, { precision: 3, withTimezone: true, mode: 'date' });

export const accountKind = pgEnum('AccountKind', [
  'BANK',
  'CREDIT_CARD',
  'RECEIVABLE',
  'PAYABLE',
  'LOAN',
  'INVESTMENT',
]);
export const txType = pgEnum('TxType', [
  'INCOME',
  'EXPENSE',
  'TRANSFER',
  'SPLIT',
  'ADJUSTMENT',
]);
export const txStatus = pgEnum('TxStatus', ['CONFIRMED', 'NEEDS_REVIEW']);

export const accounts = pgTable('Account', {
  id: text('id').primaryKey().$defaultFn(randomUUID),
  alias: text('alias').notNull().unique('Account_alias_key'),
  name: text('name').notNull(),
  kind: accountKind('kind').notNull(),
  openingBalance: money('openingBalance')
    .notNull()
    .default(sql`0`),
  createdAt: instant('createdAt').notNull().defaultNow(),
}).enableRLS();

export const transactions = pgTable(
  'Transaction',
  {
    id: text('id').primaryKey().$defaultFn(randomUUID),
    type: txType('type').notNull(),
    occurredAt: instant('occurredAt').notNull(),
    description: text('description').notNull(),
    category: text('category'),
    spendAmount: money('spendAmount')
      .notNull()
      .default(sql`0`),
    status: txStatus('status').notNull().default('CONFIRMED'),
    voidedAt: instant('voidedAt'),
    channel: text('channel').notNull(),
    externalId: text('externalId').notNull(),
    rawText: text('rawText').notNull(),
    createdAt: instant('createdAt').notNull().defaultNow(),
    // Creation order. `undo` voids the highest non-voided seq.
    seq: integer('seq')
      .notNull()
      .generatedAlwaysAsIdentity()
      .unique('Transaction_seq_key'),
  },
  (t) => [
    unique('Transaction_channel_externalId_key').on(t.channel, t.externalId),
    // Hard rule 3: TRANSFER, ADJUSTMENT and INCOME never count as spending.
    check('Transaction_spendAmount_nonneg', sql`${t.spendAmount} >= 0`),
    check(
      'Transaction_spendAmount_zero_for_non_spend',
      sql`${t.type} NOT IN ('TRANSFER', 'ADJUSTMENT', 'INCOME') OR ${t.spendAmount} = 0`,
    ),
  ],
).enableRLS();

export const entries = pgTable(
  'Entry',
  {
    id: text('id').primaryKey().$defaultFn(randomUUID),
    transactionId: text('transactionId')
      .notNull()
      .references(() => transactions.id, { onDelete: 'restrict' }),
    accountId: text('accountId')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    amount: money('amount').notNull(),
  },
  (t) => [
    index('Entry_accountId_idx').on(t.accountId),
    index('Entry_transactionId_idx').on(t.transactionId),
    // Direction is the sign; a zero entry is meaningless.
    check('Entry_amount_nonzero', sql`${t.amount} <> 0`),
  ],
).enableRLS();

// One row per processed message that wrote something, claimed in the same DB
// transaction as the write. Covers `undo` and `open`, which create no Transaction.
export const processedMessages = pgTable(
  'ProcessedMessage',
  {
    channel: text('channel').notNull(),
    externalId: text('externalId').notNull(),
    createdAt: instant('createdAt').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.channel, t.externalId] })],
).enableRLS();
