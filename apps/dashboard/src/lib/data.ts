import 'server-only';

import {
  balancesByKind,
  cashFlow,
  istMonthRange,
  netInvested,
  people,
  savingsRate,
  spendByCategory,
  type Month,
} from '@hisaab/core';
import { readAccounts, readTransactions } from '@hisaab/db';
import { unstable_rethrow } from 'next/navigation';

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

  const flow = cashFlow(txs, rangeOf(month));
  return {
    spend: spendByCategory(txs, rangeOf(month)),
    cashFlow: flow,
    savingsRate: savingsRate(flow),
    invested: netInvested(txs, accounts, rangeOf(month)),
    history: months.map((m) => ({
      month: m,
      cashFlow: cashFlow(txs, rangeOf(m)),
      invested: netInvested(txs, accounts, rangeOf(m)),
    })),
    balances: balancesByKind(accounts),
    people: people(accounts),
  };
}

export type Dashboard = Awaited<ReturnType<typeof loadDashboard>>;

/** For pages: null means show the failure message. Lets requireOwner's redirect through. */
export async function loadOrNull(month: Month): Promise<Dashboard | null> {
  try {
    return await loadDashboard(month);
  } catch (e) {
    unstable_rethrow(e);
    // Fixed text: an error can hold query details.
    console.error('dashboard: could not load');
    return null;
  }
}
