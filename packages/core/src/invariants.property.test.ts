import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ACCOUNTS, NOW, ctx } from './fixtures';
import { interpret } from './interpret';
import {
  balanceOf,
  buildAdjustment,
  buildExpense,
  buildIncome,
  buildSplit,
  buildTransfer,
  checkInvariants,
} from './ledger';
import { parseAmount } from './money';
import { type AccountInfo, type Entry } from './types';

const positive = fc.bigInt({ min: 1n, max: 10_000_000_000n });
const bank = ACCOUNTS.find((a) => a.alias === 'icici') as AccountInfo;
const bom = ACCOUNTS.find((a) => a.alias === 'bom') as AccountInfo;
const rahul = ACCOUNTS.find((a) => a.alias === 'rahul') as AccountInfo;
const anita = ACCOUNTS.find((a) => a.alias === 'anita') as AccountInfo;

describe('invariant 1: amounts are positive integers', () => {
  it('parseAmount round-trips whole rupees', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000_000 }), (rupees) => {
        expect(parseAmount(String(rupees))).toEqual({
          ok: true,
          paise: BigInt(rupees) * 100n,
        });
      }),
    );
  });

  it('parseAmount is exact for N.M, N.Mk and N.Ml (no paise lost or invented)', () => {
    const digits = (min: number, max: number) =>
      fc.stringMatching(new RegExp(`^[0-9]{${min},${max}}$`));
    fc.assert(
      fc.property(
        digits(1, 6),
        fc.option(digits(1, 5), { nil: undefined }),
        fc.constantFrom('', 'k', 'l'),
        (whole, frac, suffix) => {
          const token = `${whole}${frac === undefined ? '' : `.${frac}`}${suffix}`;
          const mult = suffix === 'k' ? 1000n : suffix === 'l' ? 100_000n : 1n;
          // independent computation: value in paise = digits * mult * 100 / 10^fraclen
          const num = BigInt(whole + (frac ?? '')) * mult * 100n;
          const den = 10n ** BigInt((frac ?? '').length);
          const r = parseAmount(token);
          if (num % den !== 0n) {
            expect(r.ok).toBe(false);
            return;
          }
          const paise = num / den;
          const valid = paise > 0n && paise <= 10_000_000_000n;
          expect(r).toEqual(valid ? { ok: true, paise } : { ok: false });
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('builders reject zero and negative amounts', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -1_000_000n, max: 0n }), (amount) => {
        const at = NOW;
        expect(buildExpense(bank, amount, 'x', null, at).kind).toBe('clarify');
        expect(buildIncome(bank, amount, 'x', at).kind).toBe('clarify');
        expect(buildTransfer(bank, bom, amount, 'x', at).kind).toBe('clarify');
        expect(buildSplit(bank, amount, [], 'x', null, at).kind).toBe(
          'clarify',
        );
      }),
    );
  });
});

describe('invariant 2 and hard rule 3: transfers and adjustments never spend', () => {
  it('TRANSFER entries sum to zero and spendAmount is 0', () => {
    fc.assert(
      fc.property(positive, (amount) => {
        const r = buildTransfer(bank, bom, amount, 'x', NOW);
        expect(r.kind).toBe('proposal');
        if (r.kind !== 'proposal') return;
        expect(r.tx.entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);
        expect(r.tx.spendAmount).toBe(0n);
        expect(() => checkInvariants(r.tx)).not.toThrow();
      }),
    );
  });

  it('transfers parsed from text keep the rule, whatever the amount', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99_999_999 }), (rupees) => {
        const r = interpret(`xfer ${rupees} icici bom`, ctx());
        expect(r.kind).toBe('proposal');
        if (r.kind !== 'proposal') return;
        expect(r.tx.spendAmount).toBe(0n);
        expect(r.tx.entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);
      }),
    );
  });

  it('ADJUSTMENT always has spendAmount 0', () => {
    fc.assert(
      fc.property(
        fc
          .bigInt({ min: -10_000_000n, max: 10_000_000n })
          .filter((n) => n !== 0n),
        (diff) => {
          const r = buildAdjustment(bank, diff, NOW);
          expect(r.kind).toBe('proposal');
          if (r.kind === 'proposal') expect(r.tx.spendAmount).toBe(0n);
        },
      ),
    );
  });

  it('INCOME never counts as spending', () => {
    fc.assert(
      fc.property(positive, (amount) => {
        const r = buildIncome(bank, amount, 'salary', NOW);
        if (r.kind === 'proposal') expect(r.tx.spendAmount).toBe(0n);
      }),
    );
  });
});

describe('invariant 3: split arithmetic', () => {
  it('payer = -total, shares credited, own share = total - shares >= 0', () => {
    fc.assert(
      fc.property(
        positive,
        fc.array(positive, { minLength: 1, maxLength: 2 }),
        (total, shares) => {
          const people = [rahul, anita];
          const r = buildSplit(
            bank,
            total,
            shares.map((amount, i) => ({
              account: people[i] as AccountInfo,
              amount,
            })),
            'dinner',
            'Food',
            NOW,
          );
          const sum = shares.reduce((s, n) => s + n, 0n);
          if (sum > total) {
            expect(r).toMatchObject({
              kind: 'clarify',
              reason: 'SPLIT_EXCEEDS_TOTAL',
            });
            return;
          }
          expect(r.kind).toBe('proposal');
          if (r.kind !== 'proposal') return;
          const [payer, ...others] = r.tx.entries;
          expect(payer?.amount).toBe(-total);
          expect(others.reduce((s, e) => s + e.amount, 0n)).toBe(sum);
          expect(r.tx.spendAmount).toBe(total - sum);
          expect(r.tx.spendAmount >= 0n).toBe(true);
        },
      ),
    );
  });
});

describe('invariant 4 and 6: balances are derived and exclude voided rows', () => {
  const txArb = fc.record({
    voided: fc.boolean(),
    entries: fc.array(
      fc.record({
        accountId: fc.constantFrom('a', 'b'),
        amount: fc.bigInt({ min: -1_000_000n, max: 1_000_000n }),
      }),
      { maxLength: 4 },
    ),
  });

  const toLedger = (t: { voided: boolean; entries: Entry[] }) => ({
    voidedAt: t.voided ? NOW : null,
    entries: t.entries,
  });

  it('balance = opening + entries on non-voided transactions', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -1_000_000n, max: 1_000_000n }),
        fc.array(txArb, { maxLength: 8 }),
        (opening, txs) => {
          const expected = txs
            .filter((t) => !t.voided)
            .flatMap((t) => t.entries)
            .filter((e) => e.accountId === 'a')
            .reduce((s, e) => s + e.amount, opening);
          expect(balanceOf('a', opening, txs.map(toLedger))).toBe(expected);
        },
      ),
    );
  });

  it('voiding a transaction removes exactly its effect', () => {
    fc.assert(
      fc.property(fc.array(txArb, { minLength: 1, maxLength: 8 }), (txs) => {
        const all = txs.map((t) => ({ ...t, voided: false }));
        const [first, ...rest] = all;
        if (!first) return;
        const before = balanceOf('a', 0n, all.map(toLedger));
        const after = balanceOf(
          'a',
          0n,
          [{ ...first, voided: true }, ...rest].map(toLedger),
        );
        const effect = first.entries
          .filter((e) => e.accountId === 'a')
          .reduce((s, e) => s + e.amount, 0n);
        expect(before - after).toBe(effect);
      }),
    );
  });

  it('is independent of entry order', () => {
    fc.assert(
      fc.property(fc.array(txArb, { maxLength: 8 }), (txs) => {
        const ledger = txs.map(toLedger);
        expect(balanceOf('a', 0n, ledger)).toBe(
          balanceOf('a', 0n, [...ledger].reverse()),
        );
      }),
    );
  });
});

describe('interpret is total and never writes on bad input', () => {
  it('never throws, and a clarify carries no transaction', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (text) => {
        const r = interpret(text, ctx());
        if (r.kind === 'clarify') {
          expect(r.question.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('never throws on mutated valid messages', () => {
    const valid = [
      'petrol 4k cc icici',
      'on 20 oct petrol 4k icici',
      'yesterday coffee 1.5k bom',
      'in 85k salary icici',
      'xfer 25k icici bom',
      'pay icicicc 4k from icici',
      'emi 32k bom',
      'lend rahul 10k icici',
      'got rahul 5k icici',
      'dinner 4000 split rahul 1000 anita 1000 cc icici',
      'dinner 4000 split rahul 1000 icici',
      'bal icici 85000',
      'bal icicicc',
      'open sam 0 receivable',
      'accounts',
      'undo',
    ].map((m) => m.split(' '));
    const noise = fc.constantFrom(
      'cc',
      'split',
      'from',
      'on',
      'today',
      'oct',
      '0',
      '31',
      '2025',
      'rahul',
      '1,2',
      '4k',
      'icici',
      'xfer',
      'in',
      'bal',
      '',
      '₹5',
      '9'.repeat(30),
    );
    const mutation = fc.oneof(
      fc.record({ op: fc.constant('drop' as const), at: fc.nat(12) }),
      fc.record({ op: fc.constant('dup' as const), at: fc.nat(12) }),
      fc.record({
        op: fc.constant('insert' as const),
        at: fc.nat(12),
        word: noise,
      }),
      fc.record({
        op: fc.constant('swap' as const),
        at: fc.nat(12),
        word: noise,
      }),
    );
    fc.assert(
      fc.property(
        fc.constantFrom(...valid),
        fc.array(mutation, { maxLength: 4 }),
        (base, mutations) => {
          const words = [...base];
          for (const m of mutations) {
            const at = m.at % (words.length + 1);
            if (m.op === 'drop') words.splice(at, 1);
            else if (m.op === 'dup') words.splice(at, 0, words[at] ?? '');
            else if (m.op === 'insert') words.splice(at, 0, m.word);
            else words[at % Math.max(words.length, 1)] = m.word;
          }
          const r = interpret(words.join(' '), ctx());
          if (r.kind === 'proposal') {
            expect(() => checkInvariants(r.tx)).not.toThrow();
            const known = new Set(ACCOUNTS.map((a) => a.id));
            for (const e of r.tx.entries)
              expect(known.has(e.accountId)).toBe(true);
          }
        },
      ),
      { numRuns: 5000 },
    );
  });
});
