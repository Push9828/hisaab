import { type AccountInfo, type Context } from './types';

// 2026-10-26 15:30 IST. All names and numbers here are fake.
export const NOW = new Date('2026-10-26T10:00:00Z');

const account = (
  alias: string,
  name: string,
  kind: AccountInfo['kind'],
  balance = 0n,
): AccountInfo => ({ id: `id-${alias}`, alias, name, kind, balance });

export const ACCOUNTS: AccountInfo[] = [
  account('icici', 'ICICI', 'BANK', 8_420_000n),
  account('icicicc', 'ICICI-CC', 'CREDIT_CARD', -150_000n),
  account('bom', 'BOM', 'BANK', 5_000_000n),
  account('rahul', 'Rahul', 'RECEIVABLE'),
  account('anita', 'Anita', 'RECEIVABLE'),
];

export const ctx = (accounts: AccountInfo[] = ACCOUNTS): Context => ({
  now: NOW,
  accounts,
});

export const id = (alias: string): string => `id-${alias}`;
