import 'server-only';

import {
  balancesByKind,
  cashFlow,
  istMonthRange,
  people,
  spendByCategory,
  type Month,
} from '@hisaab/core';
import { readAccounts, readTransactions } from '@hisaab/db';

import { getDb } from './db';
import { lastSixMonths } from './month';
import { requireOwner } from './owner';

const rangeOf = ({ year, month }: Month) => istMonthRange(year, month);

/** The dashboard's only way to the ledger. Reads nothing unless the owner check passes. */
export async function loadDashboard(month: Month) {
  await requireOwner();

  const months = lastSixMonths(month);
  const oldest = months[months.length - 1] ?? month;
  const db = getDb();
  const accounts = await readAccounts(db);
  const txs = await readTransactions(db, {
    start: rangeOf(oldest).start,
    end: rangeOf(month).end,
  });

  return {
    spend: spendByCategory(txs, rangeOf(month)),
    cashFlow: cashFlow(txs, rangeOf(month)),
    history: months.map((m) => ({
      month: m,
      cashFlow: cashFlow(txs, rangeOf(m)),
    })),
    balances: balancesByKind(accounts),
    people: people(accounts),
  };
}
