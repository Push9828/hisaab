import { isMonthName, parseDatePrefix } from './dates';
import { type Paise, parseAmount } from './money';
import { type AccountKind, type Clarify, clarify } from './types';

interface Tok {
  raw: string;
  lc: string;
}

/** A syntactically valid message. Aliases are unresolved lowercase text. */
export type Command =
  | { type: 'open'; alias: string; amount: Paise; accountKind: AccountKind }
  | { type: 'income'; amount: Paise; description: string; account: string }
  | { type: 'expense'; amount: Paise; description: string; account: string }
  | { type: 'transfer'; amount: Paise; from: string; to: string }
  | { type: 'card-payment'; amount: Paise; card: string; bank: string }
  | { type: 'emi'; amount: Paise; account: string }
  | { type: 'lend' | 'repay'; amount: Paise; person: string; account: string }
  | {
      type: 'split';
      amount: Paise;
      description: string;
      shares: { person: string; amount: Paise }[];
      account: string;
    }
  | { type: 'bal'; account?: string; stated?: Paise }
  | { type: 'accounts' }
  | { type: 'undo' };

export type Parsed =
  { kind: 'parsed'; command: Command; occurredAt: Date } | Clarify;

const COMMANDS = [
  'open',
  'in',
  'xfer',
  'pay',
  'emi',
  'lend',
  'got',
  'bal',
  'undo',
  'accounts',
];
const RESERVED = new Set([
  ...COMMANDS,
  'split',
  'from',
  'cc',
  'on',
  'today',
  'yesterday',
]);

const KIND_WORDS: Record<string, AccountKind> = {
  bank: 'BANK',
  cc: 'CREDIT_CARD',
  credit_card: 'CREDIT_CARD',
  receivable: 'RECEIVABLE',
  payable: 'PAYABLE',
  loan: 'LOAN',
  investment: 'INVESTMENT',
};

// Contains a digit and no letters other than a trailing k/l suffix.
const AMOUNT_SHAPED = /^[^a-z]*\d[^a-z]*[kl]?$/i;
const isAmountShaped = (t: Tok) => AMOUNT_SHAPED.test(t.lc);

function isValidAlias(alias: string): boolean {
  return (
    /^[a-z][a-z0-9_-]*$/.test(alias) &&
    !RESERVED.has(alias) &&
    !isMonthName(alias)
  );
}

const unknown = (): Clarify =>
  clarify(
    'UNKNOWN_COMMAND',
    'I did not understand that. Try: "petrol 4k icici", "xfer 5k icici bom", "in 85k salary icici", "bal", or "undo".',
  );

const missingAccount = (): Clarify =>
  clarify('MISSING_ACCOUNT', 'Which account?');

const badAmount = (): Clarify =>
  clarify(
    'BAD_AMOUNT',
    'I could not read that amount. Use forms like 450, 4k, 1.5k or 1.2l.',
  );

type Amount = { amount: Paise } | Clarify;

function amountOf(tok: Tok | undefined, allowZero = false): Amount {
  if (!tok) return unknown();
  const parsed = parseAmount(tok.lc, { allowZero });
  return parsed.ok ? { amount: parsed.paise } : badAmount();
}

/** One alias token, or "cc <x>" meaning the alias "<x>cc". */
function accountFrom(rest: Tok[]): { account: string } | Clarify {
  const [a, b] = rest;
  if (rest.length === 0 || !a) return missingAccount();
  if (rest.length === 1) return { account: a.lc };
  if (rest.length === 2 && a.lc === 'cc' && b) return { account: `${b.lc}cc` };
  return clarify(
    'UNKNOWN_ACCOUNT',
    'I expected a single account at the end of that message. Which account?',
  );
}

function parseExpense(toks: Tok[]): Command | Clarify {
  const at = toks.flatMap((t, i) => (isAmountShaped(t) ? [i] : []));
  if (at.length === 0) return unknown();
  if (at.length > 1) {
    return clarify(
      'AMBIGUOUS_AMOUNT',
      'I found more than one amount. Which one is the total?',
    );
  }
  const i = at[0] as number;
  const amount = amountOf(toks[i]);
  if ('kind' in amount) return amount;
  const description = toks
    .slice(0, i)
    .map((t) => t.raw)
    .join(' ');
  if (!description) {
    return clarify(
      'MISSING_DESCRIPTION',
      'What was it for? Put a short description before the amount.',
    );
  }
  const account = accountFrom(toks.slice(i + 1));
  if ('kind' in account) return account;
  return { type: 'expense', ...amount, description, ...account };
}

function parseIncome(toks: Tok[]): Command | Clarify {
  const [first, ...rest] = toks;
  if (!first || !isAmountShaped(first)) return unknown();
  if (rest.some(isAmountShaped)) {
    return clarify(
      'AMBIGUOUS_AMOUNT',
      'I found more than one amount. Which one is the income?',
    );
  }
  const amount = amountOf(first);
  if ('kind' in amount) return amount;
  if (rest.length === 0) return missingAccount();

  const tail = rest.slice(-2);
  const hasCc = tail.length === 2 && tail[0]?.lc === 'cc';
  const account = hasCc
    ? `${tail[1]?.lc}cc`
    : (rest[rest.length - 1] as Tok).lc;
  const description = rest
    .slice(0, hasCc ? -2 : -1)
    .map((t) => t.raw)
    .join(' ');
  if (!description) {
    return clarify(
      'MISSING_DESCRIPTION',
      'Add a description and account: in <amount> <description> <account>.',
    );
  }
  return { type: 'income', ...amount, description, account };
}

function parseTransfer(toks: Tok[]): Command | Clarify {
  const [first, from, to, ...extra] = toks;
  if (!first || !isAmountShaped(first)) return unknown();
  const amount = amountOf(first);
  if ('kind' in amount) return amount;
  if (!from || !to) return missingAccount();
  if (extra.length > 0) return unknown();
  return { type: 'transfer', ...amount, from: from.lc, to: to.lc };
}

function parseCardPayment(toks: Tok[]): Command | Clarify {
  const [card, amountTok, word, bank, ...extra] = toks;
  if (!card || !amountTok || !isAmountShaped(amountTok)) return unknown();
  if (word && word.lc !== 'from') return unknown();
  const amount = amountOf(amountTok);
  if ('kind' in amount) return amount;
  if (!word || !bank) return missingAccount();
  if (extra.length > 0) return unknown();
  return { type: 'card-payment', ...amount, card: card.lc, bank: bank.lc };
}

function parseEmi(toks: Tok[]): Command | Clarify {
  const [first, ...rest] = toks;
  if (!first || !isAmountShaped(first)) return unknown();
  const amount = amountOf(first);
  if ('kind' in amount) return amount;
  const account = accountFrom(rest);
  if ('kind' in account) return account;
  return { type: 'emi', ...amount, ...account };
}

function parsePerson(type: 'lend' | 'repay', toks: Tok[]): Command | Clarify {
  const [person, amountTok, ...rest] = toks;
  if (!person || !amountTok || !isAmountShaped(amountTok)) return unknown();
  const amount = amountOf(amountTok);
  if ('kind' in amount) return amount;
  const account = accountFrom(rest);
  if ('kind' in account) return account;
  return { type, ...amount, person: person.lc, ...account };
}

function parseSplit(toks: Tok[], at: number): Command | Clarify {
  const head = toks.slice(0, at);
  const amountTok = head[head.length - 1];
  if (!amountTok || !isAmountShaped(amountTok)) return unknown();
  if (head.slice(0, -1).some(isAmountShaped)) {
    return clarify(
      'AMBIGUOUS_AMOUNT',
      'I found more than one amount before "split". Which one is the total?',
    );
  }
  const amount = amountOf(amountTok);
  if ('kind' in amount) return amount;
  const description = head
    .slice(0, -1)
    .map((t) => t.raw)
    .join(' ');
  if (!description) {
    return clarify(
      'MISSING_DESCRIPTION',
      'What was it for? Put a short description before the amount.',
    );
  }

  const after = toks.slice(at + 1);
  const tail = after.slice(-2);
  let account: string;
  let pairs: Tok[];
  if (tail.length === 2 && tail[0]?.lc === 'cc') {
    account = `${tail[1]?.lc}cc`;
    pairs = after.slice(0, -2);
  } else if (after.length % 2 === 1) {
    account = (after[after.length - 1] as Tok).lc;
    pairs = after.slice(0, -1);
  } else {
    return after.length === 0 ? badSplit() : missingAccount();
  }
  if (pairs.length === 0 || pairs.length % 2 !== 0) return badSplit();

  const shares: { person: string; amount: Paise }[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const person = pairs[i] as Tok;
    const share = pairs[i + 1] as Tok;
    if (!isAmountShaped(share)) return badSplit();
    const shareAmount = amountOf(share, true);
    if ('kind' in shareAmount) return shareAmount;
    if (
      shareAmount.amount === 0n ||
      shares.some((s) => s.person === person.lc)
    ) {
      return badSplit();
    }
    shares.push({ person: person.lc, amount: shareAmount.amount });
  }
  return { type: 'split', ...amount, description, shares, account };
}

const badSplit = (): Clarify =>
  clarify(
    'BAD_SPLIT',
    'Use: <desc> <total> split <person> <amount> [<person> <amount> ...] <account>. Each person once, with a non-zero amount.',
  );

function parseBal(toks: Tok[]): Command | Clarify {
  const [account, stated, ...extra] = toks;
  if (!account) return { type: 'bal' };
  if (isAmountShaped(account)) return missingAccount();
  if (extra.length > 0) return unknown();
  if (!stated) return { type: 'bal', account: account.lc };
  const amount = amountOf(stated, true);
  if ('kind' in amount) return amount;
  return { type: 'bal', account: account.lc, stated: amount.amount };
}

function parseOpen(toks: Tok[]): Command | Clarify {
  const [alias, amountTok, kindTok, ...extra] = toks;
  if (!alias || !amountTok || !kindTok || extra.length > 0) return unknown();
  const kind = KIND_WORDS[kindTok.lc];
  if (!kind || !isAmountShaped(amountTok)) return unknown();
  const amount = amountOf(amountTok, true);
  if ('kind' in amount) return amount;
  if (!isValidAlias(alias.lc)) {
    return clarify(
      'RESERVED_ALIAS',
      'That name cannot be an account alias. Use letters and digits, starting with a letter, and avoid command words and month names.',
    );
  }
  return { type: 'open', alias: alias.lc, ...amount, accountKind: kind };
}

const NO_DATE: Record<string, true> = {
  open: true,
  bal: true,
  undo: true,
  accounts: true,
};

export function parseMessage(text: string, now: Date): Parsed {
  let toks: Tok[] = text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, lc: raw.toLowerCase() }));

  const date = parseDatePrefix(
    toks.map((t) => t.lc),
    now,
  );
  if (date && !date.ok) return clarify(date.reason, date.question);
  if (date) toks = toks.slice(date.consumed);
  const occurredAt = date ? date.occurredAt : now;

  const head = toks[0];
  if (!head) return unknown();
  if (date && NO_DATE[head.lc]) {
    return clarify(
      'DATE_NOT_ALLOWED',
      'A date only works with entries, not with that command.',
    );
  }

  const args = toks.slice(1);
  const splitAt = toks.findIndex((t) => t.lc === 'split');
  let command: Command | Clarify;
  switch (head.lc) {
    case 'open':
      command = parseOpen(args);
      break;
    case 'in':
      command = parseIncome(args);
      break;
    case 'xfer':
      command = parseTransfer(args);
      break;
    case 'pay':
      command = parseCardPayment(args);
      break;
    case 'emi':
      command = parseEmi(args);
      break;
    case 'lend':
      command = parsePerson('lend', args);
      break;
    case 'got':
      command = parsePerson('repay', args);
      break;
    case 'bal':
      command = parseBal(args);
      break;
    case 'undo':
      command = args.length === 0 ? { type: 'undo' } : unknown();
      break;
    case 'accounts':
      command = args.length === 0 ? { type: 'accounts' } : unknown();
      break;
    default:
      command = splitAt > 0 ? parseSplit(toks, splitAt) : parseExpense(toks);
  }

  return 'kind' in command ? command : { kind: 'parsed', command, occurredAt };
}
