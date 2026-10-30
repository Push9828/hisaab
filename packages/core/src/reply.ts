import { formatDay, sameIstDay } from './dates';
import { formatInr } from './money';
import { type Context, type ProposedTx, type Result } from './types';

const UNDO_HINT = 'Reply "undo" to revert.';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function reply(result: Result, ctx: Context): string {
  const name = (id: string) =>
    ctx.accounts.find((a) => a.id === id)?.name ?? 'account';

  switch (result.kind) {
    case 'clarify':
      return result.question;

    case 'undo':
      return 'Reverting the last transaction.';

    case 'open':
      return result.openingBalance < 0n
        ? `Opened ${result.name} (${result.accountKind}), owing ${formatInr(-result.openingBalance)}.`
        : `Opened ${result.name} (${result.accountKind}) with balance ${formatInr(result.openingBalance)}.`;

    case 'matches':
      return `${name(result.accountId)} already matches ${formatInr(
        result.balance < 0n ? -result.balance : result.balance,
      )}.`;

    case 'balances':
      // Never empty: Telegram rejects a message with no text.
      if (result.accountIds.length === 0) {
        return 'No accounts yet. Add one: open <alias> <amount> <kind>';
      }
      return result.accountIds
        .map((id) => {
          const account = ctx.accounts.find((a) => a.id === id);
          return account
            ? `${account.name}: ${formatInr(account.balance)}`
            : null;
        })
        .filter((line) => line !== null)
        .join('\n');

    case 'proposal':
      return confirm(result.tx, ctx, name);
  }
}

function confirm(
  tx: ProposedTx,
  ctx: Context,
  name: (id: string) => string,
): string {
  const first = tx.entries[0];
  const total =
    first && first.amount < 0n ? -first.amount : (first?.amount ?? 0n);
  const label = `${formatInr(total)} ${capitalize(tx.description)}`;
  const category = tx.category
    ? ` (${tx.category})`
    : ' (category needs review)';
  const account = first ? name(first.accountId) : 'account';

  let line: string;
  switch (tx.type) {
    case 'EXPENSE':
      line = `Logged: ${label}${category} on ${account}.`;
      break;
    case 'INCOME':
      line = `Logged: ${label}${category} into ${account}.`;
      break;
    case 'TRANSFER': {
      const to = tx.entries[1];
      line = `Logged: transfer ${formatInr(total)} from ${account} to ${to ? name(to.accountId) : 'account'}.`;
      break;
    }
    case 'SPLIT': {
      const owed = tx.entries
        .slice(1)
        .map((e) => `${name(e.accountId)} owes ${formatInr(e.amount)}`)
        .join(', ');
      line = `Logged: ${label}${category} on ${account}. Your share ${formatInr(tx.spendAmount)}; ${owed}.`;
      break;
    }
    case 'ADJUSTMENT': {
      const diff = first?.amount ?? 0n;
      const now =
        ctx.accounts.find((a) => a.id === first?.accountId)?.balance ?? 0n;
      const sign = diff > 0n ? '+' : '-';
      line = `Adjusted ${account} ${sign}${formatInr(diff < 0n ? -diff : diff)} (was ${formatInr(now)}, now ${formatInr(now + diff)}).`;
      break;
    }
  }

  const dated = sameIstDay(tx.occurredAt, ctx.now)
    ? ''
    : ` Dated ${formatDay(tx.occurredAt)}.`;
  return `${line}${dated} ${UNDO_HINT}`;
}
