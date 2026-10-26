import { categorize } from './categories';
import {
  buildAdjustment,
  buildExpense,
  buildIncome,
  buildSplit,
  buildTransfer,
  signedBalance,
} from './ledger';
import { type Command, parseMessage } from './parser';
import {
  type AccountInfo,
  type AccountKind,
  type Clarify,
  type Context,
  type Result,
  clarify,
} from './types';

type Found = { account: AccountInfo } | Clarify;

const known = (ctx: Context) => ctx.accounts.map((a) => a.alias).join(', ');

function find(ctx: Context, alias: string, hint?: string): Found {
  const account = ctx.accounts.find((a) => a.alias.toLowerCase() === alias);
  if (account) return { account };
  return clarify(
    'UNKNOWN_ACCOUNT',
    `I do not know "${alias}". ${hint ?? ''}Known accounts: ${known(ctx) || 'none yet'}.`,
  );
}

function findPerson(ctx: Context, alias: string): Found {
  const found = find(
    ctx,
    alias,
    `Create them first with "open ${alias} 0 receivable". `,
  );
  if ('kind' in found) return found;
  if (found.account.kind !== 'RECEIVABLE') {
    return clarify(
      'KIND_MISMATCH',
      `${found.account.name} is not a person who owes you money.`,
    );
  }
  return found;
}

const isClarify = (x: object): x is Clarify => 'kind' in x;

/**
 * Pure: message text plus a snapshot of accounts in, a proposed write or a
 * clarifying question out. Persistence and idempotency are `ingest()` in M2.
 */
export function interpret(text: string, ctx: Context): Result {
  const parsed = parseMessage(text, ctx.now);
  if (parsed.kind === 'clarify') {
    return parsed.reason === 'MISSING_ACCOUNT'
      ? {
          ...parsed,
          question: `Which account? Known accounts: ${known(ctx) || 'none yet'}.`,
        }
      : parsed;
  }
  return execute(parsed.command, parsed.occurredAt, ctx);
}

function execute(command: Command, at: Date, ctx: Context): Result {
  switch (command.type) {
    case 'undo':
      return { kind: 'undo' };

    case 'accounts':
      return { kind: 'balances', accountIds: ctx.accounts.map((a) => a.id) };

    case 'open':
      return open(command.alias, command.accountKind, command.amount, ctx);

    case 'expense': {
      const found = find(ctx, command.account);
      if (isClarify(found)) return found;
      return buildExpense(
        found.account,
        command.amount,
        command.description,
        categorize(command.description),
        at,
      );
    }

    case 'emi': {
      const found = find(ctx, command.account);
      if (isClarify(found)) return found;
      return buildExpense(
        found.account,
        command.amount,
        'EMI',
        'Home loan EMI',
        at,
      );
    }

    case 'income': {
      const found = find(ctx, command.account);
      if (isClarify(found)) return found;
      return buildIncome(
        found.account,
        command.amount,
        command.description,
        at,
      );
    }

    case 'transfer': {
      const from = find(ctx, command.from);
      if (isClarify(from)) return from;
      const to = find(ctx, command.to);
      if (isClarify(to)) return to;
      const banky: AccountKind[] = ['BANK', 'CREDIT_CARD', 'LOAN'];
      if (
        !banky.includes(from.account.kind) ||
        !banky.includes(to.account.kind)
      ) {
        return clarify(
          'KIND_MISMATCH',
          'xfer works between bank accounts, cards and loans. Use "lend" or "got" for people.',
        );
      }
      return buildTransfer(
        from.account,
        to.account,
        command.amount,
        'Transfer',
        at,
      );
    }

    case 'card-payment': {
      const card = find(ctx, command.card);
      if (isClarify(card)) return card;
      const bank = find(ctx, command.bank);
      if (isClarify(bank)) return bank;
      if (card.account.kind !== 'CREDIT_CARD' || bank.account.kind !== 'BANK') {
        return clarify(
          'KIND_MISMATCH',
          'Use: pay <credit card> <amount> from <bank account>.',
        );
      }
      return buildTransfer(
        bank.account,
        card.account,
        command.amount,
        'Card bill payment',
        at,
      );
    }

    case 'lend':
    case 'repay': {
      const person = findPerson(ctx, command.person);
      if (isClarify(person)) return person;
      const bank = find(ctx, command.account);
      if (isClarify(bank)) return bank;
      if (bank.account.kind !== 'BANK') {
        return clarify(
          'KIND_MISMATCH',
          'Lending and repayments go through a bank account.',
        );
      }
      const lend = command.type === 'lend';
      return buildTransfer(
        lend ? bank.account : person.account,
        lend ? person.account : bank.account,
        command.amount,
        `${lend ? 'Lent to' : 'Repaid by'} ${person.account.name}`,
        at,
      );
    }

    case 'split': {
      const payer = find(ctx, command.account);
      if (isClarify(payer)) return payer;
      const shares: { account: AccountInfo; amount: bigint }[] = [];
      for (const share of command.shares) {
        const person = findPerson(ctx, share.person);
        if (isClarify(person)) return person;
        shares.push({ account: person.account, amount: share.amount });
      }
      return buildSplit(
        payer.account,
        command.amount,
        shares,
        command.description,
        categorize(command.description),
        at,
      );
    }

    case 'bal': {
      if (command.account === undefined) {
        return { kind: 'balances', accountIds: ctx.accounts.map((a) => a.id) };
      }
      const found = find(ctx, command.account);
      if (isClarify(found)) return found;
      if (command.stated === undefined) {
        return { kind: 'balances', accountIds: [found.account.id] };
      }
      const target = signedBalance(found.account.kind, command.stated);
      const difference = target - found.account.balance;
      if (difference === 0n) {
        return {
          kind: 'matches',
          accountId: found.account.id,
          balance: target,
        };
      }
      return buildAdjustment(found.account, difference, at);
    }
  }
}

function open(
  alias: string,
  accountKind: AccountKind,
  amount: bigint,
  ctx: Context,
): Result {
  if (ctx.accounts.some((a) => a.alias.toLowerCase() === alias)) {
    return clarify(
      'DUPLICATE_ALIAS',
      `An account called "${alias}" already exists.`,
    );
  }
  return {
    kind: 'open',
    alias,
    name: alias.toUpperCase(),
    accountKind,
    openingBalance: signedBalance(accountKind, amount),
  };
}
