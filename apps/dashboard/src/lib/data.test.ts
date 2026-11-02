import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDashboard, loadOrNull } from './data';

import type { ReportTx } from '@hisaab/core';

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  readAccounts: vi.fn(),
  readTransactions: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  unstable_rethrow: (e: unknown) => {
    if (e instanceof Error && e.message === 'redirected') throw e;
  },
}));
vi.mock('./owner', () => ({ requireOwner: mocks.requireOwner }));
vi.mock('./db', () => ({ getDb: () => 'db' }));
vi.mock('@hisaab/db', () => ({
  readAccounts: mocks.readAccounts,
  readTransactions: mocks.readTransactions,
}));

const OCTOBER = { year: 2026, month: 10 };

const spend = (occurredAt: string, spendAmount: bigint): ReportTx => ({
  type: 'EXPENSE',
  occurredAt: new Date(occurredAt),
  category: 'Food',
  spendAmount,
  entries: [],
  voidedAt: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireOwner.mockResolvedValue({});
  mocks.readAccounts.mockResolvedValue([]);
  mocks.readTransactions.mockResolvedValue([]);
});

describe('loadDashboard', () => {
  it('reads nothing unless requireOwner passes', async () => {
    mocks.requireOwner.mockRejectedValue(new Error('redirected'));
    await expect(loadDashboard(OCTOBER)).rejects.toThrow('redirected');
    expect(mocks.readAccounts).not.toHaveBeenCalled();
    expect(mocks.readTransactions).not.toHaveBeenCalled();
  });

  it('queries six months once, ending at the selected month', async () => {
    await loadDashboard(OCTOBER);
    expect(mocks.readTransactions).toHaveBeenCalledTimes(1);
    expect(mocks.readTransactions).toHaveBeenCalledWith('db', {
      start: new Date('2026-04-30T18:30:00Z'),
      end: new Date('2026-10-31T18:30:00Z'),
    });
  });

  it('keeps spend to the selected month, and the history to each month', async () => {
    mocks.readTransactions.mockResolvedValue([
      spend('2026-10-10T00:00:00Z', 500n),
      spend('2026-09-10T00:00:00Z', 200n),
    ]);
    const {
      spend: categories,
      cashFlow,
      history,
    } = await loadDashboard(OCTOBER);
    expect(categories).toEqual([{ category: 'Food', total: 500n }]);
    expect(cashFlow.out).toBe(500n);
    expect(history.map((row) => row.cashFlow.out)).toEqual([
      500n,
      200n,
      0n,
      0n,
      0n,
      0n,
    ]);
  });
});

describe('loadOrNull', () => {
  it('lets the redirect through, so nobody signed out sees a page', async () => {
    mocks.requireOwner.mockRejectedValue(new Error('redirected'));
    await expect(loadOrNull(OCTOBER)).rejects.toThrow('redirected');
  });

  it('turns a failed read into null and logs fixed text only', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.readAccounts.mockRejectedValue(new Error('params: fake-token'));
    await expect(loadOrNull(OCTOBER)).resolves.toBeNull();
    expect(logged.mock.calls).toEqual([['dashboard: could not load']]);
    logged.mockRestore();
  });

  it('adds the savings rate for the selected month', async () => {
    const result = await loadOrNull(OCTOBER);
    expect(result?.savingsRate).toBeNull();
  });
});
