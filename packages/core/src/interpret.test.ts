import { describe, expect, it } from 'vitest';

import { ACCOUNTS, ctx, id } from './fixtures';
import { interpret } from './interpret';
import { type ClarifyReason } from './types';

function reasonFor(text: string, accounts = ACCOUNTS): ClarifyReason {
  const result = interpret(text, ctx(accounts));
  if (result.kind !== 'clarify') {
    throw new Error(`expected clarify for "${text}", got ${result.kind}`);
  }
  expect(result.question.length).toBeGreaterThan(0);
  return result.reason;
}

describe('ambiguous input writes nothing and asks', () => {
  it.each<[string, ClarifyReason]>([
    ['', 'UNKNOWN_COMMAND'],
    ['hello', 'UNKNOWN_COMMAND'],
    ['petrol 4k', 'MISSING_ACCOUNT'],
    ['petrol 4k nope', 'UNKNOWN_ACCOUNT'],
    ['petrol 4k cc nope', 'UNKNOWN_ACCOUNT'],
    ['petrol 4k john', 'KIND_MISMATCH'],
    ['petrol 4k icici bom', 'UNKNOWN_ACCOUNT'],
    ['4k icici', 'MISSING_DESCRIPTION'],
    ['petrol 1,200 icici', 'BAD_AMOUNT'],
    ['petrol 0 icici', 'BAD_AMOUNT'],
    ['petrol 4.555 icici', 'BAD_AMOUNT'],
    ['2 coffees 300 icici', 'AMBIGUOUS_AMOUNT'],
    ['in 85k icici', 'MISSING_DESCRIPTION'],
    ['in 85k', 'MISSING_ACCOUNT'],
    ['in 85k salary icicicc', 'KIND_MISMATCH'],
    ['xfer 5k icici', 'MISSING_ACCOUNT'],
    ['xfer 5k icici icici', 'SAME_ACCOUNT'],
    ['xfer 5k icici nope', 'UNKNOWN_ACCOUNT'],
    ['xfer 5k icici bom extra', 'UNKNOWN_COMMAND'],
    ['xfer icici bom 5k', 'UNKNOWN_COMMAND'],
    ['pay icicicc 4k', 'MISSING_ACCOUNT'],
    ['pay icicicc 4k from', 'MISSING_ACCOUNT'],
    ['pay icici 4k from icici', 'KIND_MISMATCH'],
    ['pay icicicc 4k via icici', 'UNKNOWN_COMMAND'],
    ['pay rent 15k icici', 'UNKNOWN_COMMAND'],
    ['emi 32k', 'MISSING_ACCOUNT'],
    ['emi 32k john', 'KIND_MISMATCH'],
    ['lend alex 10k icici', 'UNKNOWN_ACCOUNT'],
    ['lend john 10k', 'MISSING_ACCOUNT'],
    ['lend john 10k icicicc', 'KIND_MISMATCH'],
    ['lend icici 10k bom', 'KIND_MISMATCH'],
    ['got milk 50 icici', 'UNKNOWN_ACCOUNT'],
    ['dinner 4000 split', 'BAD_SPLIT'],
    ['dinner 4000 split john 1000', 'MISSING_ACCOUNT'],
    ['dinner 4000 split john cc icici', 'BAD_SPLIT'],
    ['dinner 4000 split john 1000 sam cc icici', 'BAD_SPLIT'],
    ['dinner 4000 split cc icici', 'BAD_SPLIT'],
    ['dinner 4000 split john 5000 icici', 'SPLIT_EXCEEDS_TOTAL'],
    ['dinner 4000 split john 3000 sam 2000 icici', 'SPLIT_EXCEEDS_TOTAL'],
    ['dinner 4000 split john 0 icici', 'BAD_SPLIT'],
    ['dinner 4000 split john 1000 john 1000 icici', 'BAD_SPLIT'],
    ['dinner 4000 split alex 1000 icici', 'UNKNOWN_ACCOUNT'],
    ['dinner 4000 split john 1,000 icici', 'BAD_AMOUNT'],
    ['bal 5000', 'MISSING_ACCOUNT'],
    ['bal nope', 'UNKNOWN_ACCOUNT'],
    ['bal icici 1,000', 'BAD_AMOUNT'],
    ['bal icici 100 extra', 'UNKNOWN_COMMAND'],
    ['undo please', 'UNKNOWN_COMMAND'],
    ['accounts now', 'UNKNOWN_COMMAND'],
    ['on 27 oct petrol 4k icici', 'FUTURE_DATE'],
    ['on 31 feb petrol 4k icici', 'BAD_DATE'],
    ['yesterday undo', 'DATE_NOT_ALLOWED'],
    ['on 20 oct bal icici 100', 'DATE_NOT_ALLOWED'],
    ['yesterday accounts', 'DATE_NOT_ALLOWED'],
    ['yesterday open x 0 bank', 'DATE_NOT_ALLOWED'],
    ['yesterday', 'UNKNOWN_COMMAND'],
  ])('%j -> %s', (text, reason) => {
    expect(reasonFor(text)).toBe(reason);
  });

  it('lists known aliases in the question', () => {
    expect(interpret('petrol 4k', ctx())).toMatchObject({
      kind: 'clarify',
      reason: 'MISSING_ACCOUNT',
      question: expect.stringContaining('icicicc'),
    });
  });

  it('points to "open" when a person is unknown', () => {
    expect(interpret('lend alex 10k icici', ctx())).toMatchObject({
      kind: 'clarify',
      question: expect.stringContaining('open alex 0 receivable'),
    });
  });
});

describe('command words always win', () => {
  it('treats the first token as the command', () => {
    expect(reasonFor('got milk 50 icici')).toBe('UNKNOWN_ACCOUNT');
  });

  it('is case-insensitive', () => {
    expect(interpret('XFER 5K ICICI BOM', ctx()).kind).toBe('proposal');
    expect(interpret('Petrol 4k CC ICICI', ctx()).kind).toBe('proposal');
  });

  it('tolerates extra whitespace', () => {
    expect(interpret('  xfer   5k  icici  bom ', ctx()).kind).toBe('proposal');
  });
});

describe('categories', () => {
  it('flags an unknown category for review but still writes', () => {
    const r = interpret('mystery 500 icici', ctx());
    expect(r).toMatchObject({
      kind: 'proposal',
      tx: { category: null, status: 'NEEDS_REVIEW', spendAmount: 50_000n },
    });
  });

  it('income without a salary keyword is Other income', () => {
    const r = interpret('in 5k gift icici', ctx());
    expect(r).toMatchObject({
      kind: 'proposal',
      tx: { category: 'Other income' },
    });
  });
});

describe('spending never carries an income category', () => {
  it('sends "salary advance" to review instead of Salary', () => {
    expect(interpret('salary advance 5k icici', ctx())).toMatchObject({
      kind: 'proposal',
      tx: { type: 'EXPENSE', category: null, status: 'NEEDS_REVIEW' },
    });
  });
});

describe('got', () => {
  it('may exceed what is owed (documented: SPEC section 6)', () => {
    expect(interpret('got john 5k icici', ctx())).toMatchObject({
      kind: 'proposal',
      tx: { type: 'TRANSFER', spendAmount: 0n },
    });
  });
});

describe('split', () => {
  it('allows the own share to be zero', () => {
    const r = interpret('lunch 2000 split john 1000 sam 1000 icici', ctx());
    expect(r).toMatchObject({ kind: 'proposal', tx: { spendAmount: 0n } });
  });

  it('works with a bank payer and a single person', () => {
    const r = interpret('lunch 500 split john 200 icici', ctx());
    expect(r).toMatchObject({
      kind: 'proposal',
      tx: {
        spendAmount: 30_000n,
        entries: [
          { accountId: id('icici'), amount: -50_000n },
          { accountId: id('john'), amount: 20_000n },
        ],
      },
    });
  });
});

describe('open, bal, accounts, undo', () => {
  it('opens a bank account', () => {
    expect(interpret('open hdfc 50000 bank', ctx())).toEqual({
      kind: 'open',
      alias: 'hdfc',
      name: 'HDFC',
      accountKind: 'BANK',
      openingBalance: 5_000_000n,
    });
  });

  it('stores owed amounts as negative for cards, payables and loans', () => {
    for (const kind of ['cc', 'payable', 'loan']) {
      const r = interpret(`open thing 1000 ${kind}`, ctx());
      expect(r).toMatchObject({ kind: 'open', openingBalance: -100_000n });
    }
  });

  it('stores receivables as positive and allows a zero opening balance', () => {
    expect(interpret('open alex 0 receivable', ctx())).toMatchObject({
      kind: 'open',
      accountKind: 'RECEIVABLE',
      openingBalance: 0n,
    });
    expect(interpret('open alex 500 receivable', ctx())).toMatchObject({
      openingBalance: 50_000n,
    });
  });

  it.each([
    ['open icici 0 bank', 'DUPLICATE_ALIAS'],
    ['open ICICI 0 bank', 'DUPLICATE_ALIAS'],
    ['open pay 0 bank', 'RESERVED_ALIAS'],
    ['open split 0 bank', 'RESERVED_ALIAS'],
    ['open cc 0 bank', 'RESERVED_ALIAS'],
    ['open oct 0 bank', 'RESERVED_ALIAS'],
    ['open yesterday 0 bank', 'RESERVED_ALIAS'],
    ['open 4k 0 bank', 'RESERVED_ALIAS'],
    ['open a$b 0 bank', 'RESERVED_ALIAS'],
    ['open hdfc 0 wallet', 'UNKNOWN_COMMAND'],
    ['open hdfc 0', 'UNKNOWN_COMMAND'],
    ['open hdfc 1,0 bank', 'BAD_AMOUNT'],
  ] as [string, ClarifyReason][])('%j -> %s', (text, reason) => {
    expect(reasonFor(text)).toBe(reason);
  });

  it('accounts and bare bal list everything', () => {
    const all = ACCOUNTS.map((a) => a.id);
    expect(interpret('accounts', ctx())).toEqual({
      kind: 'balances',
      accountIds: all,
    });
    expect(interpret('bal', ctx())).toEqual({
      kind: 'balances',
      accountIds: all,
    });
  });

  it('bal <account> shows one account', () => {
    expect(interpret('bal bom', ctx())).toEqual({
      kind: 'balances',
      accountIds: [id('bom')],
    });
  });

  it('undo is an intent only', () => {
    expect(interpret('undo', ctx())).toEqual({ kind: 'undo' });
  });
});
