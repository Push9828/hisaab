import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { SPENDING_CATEGORIES } from './categories';
import { ACCOUNTS, NOW } from './fixtures';
import {
  askReport,
  parseReportAnswer,
  prepareQuestion,
  reportRequest,
  reportReply,
  resolveMonth,
} from './question';

import type { ReportTx } from './reports';

// All names and numbers are fake.
const answer = (report: unknown, month: unknown, category: unknown = 'none') =>
  JSON.stringify({ report, month, category });

describe('prepareQuestion', () => {
  it('sends the lowercased words', () => {
    expect(prepareQuestion('Food, last month?', ACCOUNTS)).toEqual({
      kind: 'question',
      text: 'food last month',
      year: null,
    });
  });

  it('lifts one 20xx word out as the year, and does not send it', () => {
    expect(prepareQuestion('food october 2025', ACCOUNTS)).toEqual({
      kind: 'question',
      text: 'food october',
      year: 2025,
    });
  });

  it.each([
    ['nothing', ''],
    ['only a year', '2025'],
    ['an account alias', 'spend on icici'],
    ['an account name in another case', 'spend on ICICI'],
    ['a person with an account', 'what did john spend'],
    ['a card word', 'food on cc'],
    ['a number', 'food last 3 months'],
    ['a word with a digit', 'food xx1234'],
    ['an expense-like message', 'priya 500 icici'],
    ['two years', 'food october 2025 2024'],
    ['the same year twice', 'food october 2025 2025'],
    ['a year with no month', 'food 2025'],
    ['a year before the month', 'food 2025 october'],
    ['an amount that looks like a year', 'rent above 2000 in october'],
    ['a flat number that looks like a year', 'flat 2048 rent october'],
    ['an expense that looks like a year', 'priya 2000'],
    ['a plural of an account', 'johns spending'],
    ['an account split up', 'ic.ici spend'],
    ['an account split into letters', 'i c i c i'],
    ['a control character', 'ic\u0000ici'],
    ['an emoji', 'food \u{1F355} october'],
    ['a year out of range', 'food october 1999'],
    ['an email', 'food a.b@example.com'],
    ['a UPI handle', 'paid asha@okaxis'],
    ['Devanagari', 'खाना last month'],
    ['Latin with an accent', 'café last month'],
    ['over 100 characters', 'a'.repeat(101)],
  ])('refuses %s, with a question and nothing to send', (_, question) => {
    expect(prepareQuestion(question, ACCOUNTS)).toMatchObject({
      kind: 'clarify',
      reason: 'BAD_QUESTION',
    });
  });

  it.each([
    ['sbi2', 'BANK', 'spend on sbi'],
    ['axis2cc', 'CREDIT_CARD', 'axis'],
    ['kotakbank', 'BANK', 'spend on kotak'],
    ['john-k', 'RECEIVABLE', 'johnk'],
    ['priya_s', 'RECEIVABLE', 'priyas'],
  ] as const)(
    'with an account %s (%s), refuses "%s"',
    (alias, kind, question) => {
      const accounts = [{ alias, name: alias.toUpperCase(), kind }];
      expect(prepareQuestion(question, accounts)).toMatchObject({
        reason: 'BAD_QUESTION',
      });
    },
  );

  it('reads a short month, punctuation and a curly apostrophe', () => {
    expect(prepareQuestion('food oct 2025?', ACCOUNTS)).toMatchObject({
      text: 'food oct',
      year: 2025,
    });
    expect(prepareQuestion('what\u2019s food', ACCOUNTS)).toMatchObject({
      text: 'what s food',
    });
  });

  it('accepts ordinary words next to short aliases', () => {
    expect(prepareQuestion('total last month', ACCOUNTS)).toMatchObject({
      kind: 'question',
    });
  });

  it('accepts exactly 100 characters', () => {
    expect(prepareQuestion('a'.repeat(100), ACCOUNTS)).toMatchObject({
      kind: 'question',
    });
  });

  it('never lets through a digit, an account word or an @ word', () => {
    expect(prepareQuestion('food last', ACCOUNTS).kind).toBe('question');
    const words = fc.array(
      fc.constantFrom(
        'food',
        'john',
        'SAM',
        'icici',
        'bom',
        'cc',
        'xx1234',
        '77',
        'a@b',
        'last',
        '2025',
      ),
      { maxLength: 8 },
    );
    fc.assert(
      fc.property(words, (list) => {
        const out = prepareQuestion(list.join(' '), ACCOUNTS);
        if (out.kind !== 'question') return;
        expect(out.text.length).toBeLessThanOrEqual(100);
        expect(out.text).not.toMatch(/[0-9@]/);
        for (const blocked of ['john', 'sam', 'icici', 'bom', 'cc']) {
          expect(out.text.split(' ')).not.toContain(blocked);
        }
      }),
    );
  });
});

describe('parseReportAnswer', () => {
  it('accepts each report', () => {
    expect(parseReportAnswer(answer('total', 'this_month'))).toEqual({
      report: 'total',
      month: 'this_month',
    });
    expect(parseReportAnswer(answer('breakdown', 'october'))).toEqual({
      report: 'breakdown',
      month: 'october',
    });
    expect(parseReportAnswer(answer('category', 'last_month', 'Food'))).toEqual(
      { report: 'category', month: 'last_month', category: 'Food' },
    );
  });

  it.each(SPENDING_CATEGORIES)('accepts %s as a filter', (category) => {
    expect(
      parseReportAnswer(answer('category', 'this_month', category)),
    ).toMatchObject({ category });
  });

  it.each([
    ['report', answer('unsure', 'this_month')],
    ['month', answer('total', 'unsure')],
    ['both', answer('unsure', 'unsure')],
    [
      'a category report with unsure month',
      answer('category', 'unsure', 'Food'),
    ],
  ])('reads unsure in %s', (_, content) => {
    expect(parseReportAnswer(content)).toBe('unsure');
  });

  it.each([
    ['an unknown report', answer('balances', 'this_month')],
    ['an unknown month', answer('total', 'next_month')],
    ['a short month name', answer('total', 'oct')],
    ['an income category', answer('category', 'this_month', 'Salary')],
    ['Uncategorised', answer('category', 'this_month', 'Uncategorised')],
    ['a category report with no category', answer('category', 'this_month')],
    ['a total with a category', answer('total', 'this_month', 'Food')],
    ['a breakdown with a category', answer('breakdown', 'this_month', 'Food')],
    [
      'an extra key',
      JSON.stringify({
        report: 'total',
        month: 'this_month',
        category: 'none',
        account: 'icici',
      }),
    ],
    ['a missing key', JSON.stringify({ report: 'total', month: 'this_month' })],
    ['an array', '[]'],
    ['null', 'null'],
    ['not JSON', 'total'],
    ['not a string', 7],
    ['nothing', undefined],
  ])('rejects %s', (_, content) => {
    expect(parseReportAnswer(content)).toBeNull();
  });
});

describe('resolveMonth', () => {
  // NOW is 26 Oct 2026, in IST.
  it('reads this month and last month', () => {
    expect(resolveMonth('this_month', null, NOW)).toEqual({
      year: 2026,
      month: 10,
    });
    expect(resolveMonth('last_month', null, NOW)).toEqual({
      year: 2026,
      month: 9,
    });
  });

  it('goes back a year from January', () => {
    expect(
      resolveMonth('last_month', null, new Date('2026-01-15T10:00:00Z')),
    ).toEqual({ year: 2025, month: 12 });
  });

  it('uses IST at the month boundary', () => {
    // 18:30 UTC on 31 Oct is 00:00 IST on 1 Nov.
    const before = new Date('2026-10-31T18:29:59Z');
    const after = new Date('2026-10-31T18:30:00Z');
    expect(resolveMonth('this_month', null, before)).toEqual({
      year: 2026,
      month: 10,
    });
    expect(resolveMonth('this_month', null, after)).toEqual({
      year: 2026,
      month: 11,
    });
    expect(resolveMonth('last_month', null, after)).toEqual({
      year: 2026,
      month: 10,
    });
  });

  it('crosses the new year in IST', () => {
    const newYear = new Date('2026-12-31T18:30:00Z');
    expect(resolveMonth('last_month', null, newYear)).toEqual({
      year: 2026,
      month: 12,
    });
    expect(resolveMonth('december', null, newYear)).toMatchObject({
      reason: 'BAD_QUESTION',
    });
  });

  it('reads a named month in the current or stated year', () => {
    expect(resolveMonth('march', null, NOW)).toEqual({ year: 2026, month: 3 });
    expect(resolveMonth('october', null, NOW)).toEqual({
      year: 2026,
      month: 10,
    });
    expect(resolveMonth('december', 2025, NOW)).toEqual({
      year: 2025,
      month: 12,
    });
  });

  it.each([
    ['a later month this year', 'december', null],
    ['a later month in a stated year', 'december', 2026],
    ['a later year', 'january', 2027],
    ['a year with this month', 'this_month', 2025],
    ['a year with last month', 'last_month', 2025],
  ] as const)('refuses %s', (_, month, year) => {
    expect(resolveMonth(month, year, NOW)).toMatchObject({
      kind: 'clarify',
      reason: 'BAD_QUESTION',
    });
  });
});

describe('reportReply', () => {
  const OCT = { year: 2026, month: 10 };
  const at = new Date('2026-10-10T10:00:00Z');
  const spend = (
    category: ReportTx['category'],
    rupees: bigint,
    overrides: Partial<ReportTx> = {},
  ): ReportTx => ({
    type: 'EXPENSE',
    occurredAt: at,
    category,
    spendAmount: rupees * 100n,
    entries: [],
    voidedAt: null,
    ...overrides,
  });
  const txs = [
    spend('Food', 2000n),
    spend('Home loan EMI', 32000n),
    spend(null, 500n),
    spend('Food', 900n, { voidedAt: at }),
    spend(null, 0n, { type: 'TRANSFER' }),
    spend('Food', 700n, { occurredAt: new Date('2026-09-10T10:00:00Z') }),
  ];

  it('total', () => {
    expect(reportReply({ report: 'total' }, OCT, txs)).toBe(
      'Oct 2026, all spending: 34,500.',
    );
  });

  it('category, and zero when nothing is there', () => {
    const category = (c: 'Food' | 'Rent') =>
      reportReply({ report: 'category', category: c }, OCT, txs);
    expect(category('Food')).toBe('Oct 2026, Food: 2,000.');
    expect(category('Rent')).toBe('Oct 2026, Rent: 0.');
  });

  it('breakdown, with lines that add up to the total', () => {
    expect(reportReply({ report: 'breakdown' }, OCT, txs)).toBe(
      [
        'Oct 2026, spending by category:',
        'Home loan EMI: 32,000',
        'Food: 2,000',
        'Uncategorised: 500',
        'Total: 34,500',
      ].join('\n'),
    );
  });

  it('an empty breakdown is never blank', () => {
    expect(reportReply({ report: 'breakdown' }, OCT, [])).toBe(
      'Oct 2026: no spending logged.',
    );
  });
});

describe('askReport', () => {
  const picks = (content: unknown) => ({
    pick: () => Promise.resolve(content),
  });

  it('answers with a valid choice', async () => {
    expect(await askReport(picks(answer('total', 'march')), 'x')).toEqual({
      llm: 'answered',
      choice: { report: 'total', month: 'march' },
    });
  });

  it('reports unsure and failed', async () => {
    expect(await askReport(picks(answer('unsure', 'march')), 'x')).toEqual({
      llm: 'unsure',
    });
    expect(await askReport(picks('junk'), 'x')).toEqual({ llm: 'failed' });
  });

  it('reports failed on a rejection or a throw', async () => {
    const rejects = { pick: () => Promise.reject(new Error('down')) };
    const throws = {
      pick: () => {
        throw new Error('sync');
      },
    };
    expect(await askReport(rejects, 'x')).toEqual({ llm: 'failed' });
    expect(await askReport(throws, 'x')).toEqual({ llm: 'failed' });
  });
});

describe('reportRequest', () => {
  // Without the list, Sarvam picked the category report and answered "none".
  it.each(SPENDING_CATEGORIES)('names %s in the prompt', (category) => {
    expect(reportRequest('x').messages[0]?.content).toContain(category);
  });

  it('holds the text only in the user message', () => {
    const request = reportRequest('food last month');
    const { messages } = request;
    expect(messages[1]).toEqual({ role: 'user', content: 'food last month' });
    expect(
      JSON.stringify({ ...request, messages: [messages[0]] }),
    ).not.toContain('food last month');
  });
});
