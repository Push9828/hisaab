import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { CATEGORIES, SPENDING_CATEGORIES } from './categories';
import { istMonthRange, MONTHS } from './dates';
import { ACCOUNTS, NOW } from './fixtures';
import { ingest } from './ingest';
import { MemoryStore } from './memory-store';
import { formatInr } from './money';
import { type ReportPicker } from './question';
import { spendByCategory, UNCATEGORISED, cashFlow } from './reports';

// SPEC section 5 examples 18-24 and the rules of `ask`. All data is fake.
const NOVEMBER = new Date('2026-11-05T10:00:00Z');
const SECTION_5 = [
  'petrol 4k cc icici',
  'pay icicicc 4k from icici',
  'xfer 25k icici bom',
  'emi 32k bom',
  'lend john 10k icici',
  'got john 5k icici',
  'dinner 4000 split john 1000 sam 1000 cc icici',
  'in 85k salary icici',
  'bal icici 85000',
];

const choice = (report: string, month: string, category = 'none') =>
  JSON.stringify({ report, month, category });

const picking = (
  content: unknown,
): ReportPicker & {
  pick: ReturnType<typeof vi.fn>;
} => ({ pick: vi.fn(() => Promise.resolve(content)) });

function stored() {
  return new MemoryStore(
    ACCOUNTS.map(({ balance, ...rest }) => ({
      ...rest,
      openingBalance: balance,
    })),
  );
}

async function logged() {
  const store = stored();
  for (const [i, text] of SECTION_5.entries()) {
    await ingest(
      { channel: 'test', externalId: `s${i}`, text, now: NOW },
      store,
    );
  }
  return store;
}

const ask = (
  store: MemoryStore,
  text: string,
  picker?: ReportPicker,
  now = NOVEMBER,
  externalId = 'q',
) =>
  ingest({ channel: 'test', externalId, text, now }, store, undefined, picker);

describe('SPEC section 5: ledger questions', () => {
  it('18. all spending', async () => {
    const out = await ask(
      await logged(),
      'ask total last month',
      picking(choice('total', 'last_month')),
    );
    expect(out).toEqual({
      duplicate: false,
      llm: 'answered',
      reply: 'Oct 2026, all spending: 38,000.',
    });
  });

  it('19. one category', async () => {
    const out = await ask(
      await logged(),
      'ask emi last month',
      picking(choice('category', 'last_month', 'Home loan EMI')),
    );
    expect(out.reply).toBe('Oct 2026, Home loan EMI: 32,000.');
  });

  it('20. by category', async () => {
    const out = await ask(
      await logged(),
      'ask kharcha october ka breakdown',
      picking(choice('breakdown', 'october')),
    );
    expect(out.reply).toBe(
      [
        'Oct 2026, spending by category:',
        'Home loan EMI: 32,000',
        'Transport: 4,000',
        'Food: 2,000',
        'Total: 38,000',
      ].join('\n'),
    );
  });

  it('21. a stated year is read by code and not sent', async () => {
    const picker = picking(choice('category', 'october', 'Food'));
    const out = await ask(await logged(), 'ask food october 2025', picker);
    expect(picker.pick.mock.calls).toEqual([['food october']]);
    expect(out.reply).toBe('Oct 2025, Food: 0.');
  });

  it('22. a future month is refused', async () => {
    const out = await ask(
      await logged(),
      'ask food december',
      picking(choice('category', 'december', 'Food')),
    );
    expect(out.reply).toContain('in the future');
  });

  it.each([
    'ask spend on icici',
    'ask food last 3 months',
    'ask priya 500 icici',
  ])('23. refused with no call: %s', async (text) => {
    const picker = picking(choice('total', 'this_month'));
    const store = await logged();
    const before = store.snapshot();
    const out = await ask(store, text, picker);
    expect(picker.pick).not.toHaveBeenCalled();
    expect(out.llm).toBeUndefined();
    expect(out.reply).toContain('nothing was sent');
    expect(store.snapshot()).toEqual(before);
  });

  it.each([
    [
      'unsure',
      picking(choice('unsure', 'this_month')),
      'unsure',
      'I can answer',
    ],
    [
      'off the list',
      picking(choice('balances', 'this_month')),
      'failed',
      'could not answer',
    ],
    ['garbage', picking('not json'), 'failed', 'could not answer'],
    [
      'a failed call',
      { pick: () => Promise.reject(new Error('down')) },
      'failed',
      'could not answer',
    ],
  ])('24. %s gets a fixed reply', async (_, picker, llm, reply) => {
    const out = await ask(await logged(), 'ask total', picker);
    expect(out.llm).toBe(llm);
    expect(out.reply).toContain(reply);
    expect(out.reply).not.toMatch(/\d/);
  });
});

describe('ingest: ask', () => {
  it('with no key, is switched off and sends nothing', async () => {
    const out = await ask(await logged(), 'ask total');
    expect(out).toEqual({
      duplicate: false,
      reply:
        'Questions are switched off. Monthly spending is on the dashboard.',
    });
  });

  it('bare ask gets the usage, with no call', async () => {
    const picker = picking(choice('total', 'this_month'));
    const out = await ask(await logged(), 'ask', picker);
    expect(picker.pick).not.toHaveBeenCalled();
    expect(out.reply).toContain('Try "ask food last month"');
  });

  it('takes no date prefix', async () => {
    const picker = picking(choice('total', 'this_month'));
    const out = await ask(await logged(), 'yesterday ask total', picker);
    expect(picker.pick).not.toHaveBeenCalled();
    expect(out.reply).toContain('A date only works with entries');
  });

  it('is a reserved alias', async () => {
    const out = await ask(stored(), 'open ask 0 bank');
    expect(out.reply).toContain('cannot be an account alias');
  });

  it('a stated year with last month is refused after the call', async () => {
    const out = await ask(
      stored(),
      'ask food october 2025 last month',
      picking(choice('category', 'last_month', 'Food')),
    );
    expect(out.reply).toContain('A year needs a month name');
  });

  it('a year with no month is refused with no call, whatever the LLM would say', async () => {
    const picker = picking(choice('category', 'october', 'Food'));
    const out = await ask(stored(), 'ask food 2025', picker);
    expect(picker.pick).not.toHaveBeenCalled();
    expect(out.reply).toContain('nothing was sent');
  });

  it('counts a guess under its category and shows Uncategorised only in breakdown', async () => {
    const store = stored();
    await ingest(
      { channel: 'test', externalId: 'g', text: 'chai 20 icici', now: NOW },
      store,
      { ask: () => Promise.resolve('{"category":"Food"}') },
    );
    await ingest(
      { channel: 'test', externalId: 'm', text: 'asdf 50 icici', now: NOW },
      store,
    );
    const food = await ask(
      store,
      'ask food october',
      picking(choice('category', 'october', 'Food')),
    );
    expect(food.reply).toBe('Oct 2026, Food: 20.');
    const all = await ask(
      store,
      'ask breakdown october',
      picking(choice('breakdown', 'october')),
    );
    expect(all.reply).toContain(`${UNCATEGORISED}: 50`);
  });

  it('a pending call does not block another message', async () => {
    const store = stored();
    const out = await ask(store, 'ask total', {
      pick: async () => {
        await ingest(
          {
            channel: 'test',
            externalId: 'b',
            text: 'lunch 100 icici',
            now: NOVEMBER,
          },
          store,
        );
        return choice('total', 'this_month');
      },
    });
    // The read comes after the call, so it sees the entry made during it.
    expect(out.reply).toBe('Nov 2026, all spending: 100.');
  });

  it('a redelivered id that already wrote is a duplicate, with no call', async () => {
    const store = stored();
    await ingest(
      { channel: 'test', externalId: 'd', text: 'lunch 100 icici', now: NOW },
      store,
    );
    const picker = picking(choice('total', 'this_month'));
    const out = await ask(store, 'ask total', picker, NOVEMBER, 'd');
    expect(out.duplicate).toBe(true);
    expect(picker.pick).not.toHaveBeenCalled();
  });

  it('a question can be retried: it claims nothing', async () => {
    const store = stored();
    const picker = picking(choice('total', 'this_month'));
    await ask(store, 'ask total', picker, NOVEMBER, 'r');
    const again = await ask(store, 'ask total', picker, NOVEMBER, 'r');
    expect(again.duplicate).toBe(false);
    expect(picker.pick).toHaveBeenCalledTimes(2);
    expect(await store.run((db) => db.wasProcessed('test', 'r'))).toBe(false);
  });

  it.each([
    'petrol icici',
    'blah',
    'petrol 4k cc icici',
    'accounts',
    'bal',
    'undo',
    'asked around 100 icici',
  ])('never asks for: %s', async (text) => {
    const picker = picking(choice('total', 'this_month'));
    await ask(stored(), text, picker);
    expect(picker.pick).not.toHaveBeenCalled();
  });
});

describe('ingest: properties of ask (hard rule 2)', () => {
  const CANARY = 'zzcanaryzz';
  const valid = fc
    .record({
      report: fc.constantFrom('total', 'breakdown', 'category', 'unsure'),
      month: fc.constantFrom(
        'this_month',
        'last_month',
        'unsure',
        CANARY,
        ...MONTHS,
      ),
      category: fc.constantFrom('none', CANARY, ...CATEGORIES),
    })
    .map((r) => JSON.stringify(r));
  const anyAnswer = fc.oneof(
    valid,
    fc.json(),
    fc.string(),
    fc.constant(CANARY),
    fc.constant(undefined),
    fc.constant(null),
    fc.integer(),
  );

  it('for any answer nothing changes, nothing is claimed, and no LLM text reaches the reply', async () => {
    const store = await logged();
    const before = store.snapshot();
    await fc.assert(
      fc.asyncProperty(anyAnswer, async (content) => {
        const out = await ask(store, 'ask total', {
          pick: () => Promise.resolve(content),
        });
        expect(store.snapshot()).toEqual(before);
        expect(out.reply).not.toContain(CANARY);
        expect(out.reply.length).toBeGreaterThan(0);
      }),
      { numRuns: 300 },
    );
  });

  it('figures equal the existing reports directly', async () => {
    const store = await logged();
    const txs = store
      .snapshot()
      .transactions.map((t) => ({ ...t.proposed, voidedAt: t.voidedAt }));
    const range = istMonthRange(2026, 10);
    const rows = spendByCategory(txs, range);
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...SPENDING_CATEGORIES),
        async (category) => {
          const out = await ask(
            store,
            'ask spending october',
            picking(choice('category', 'october', category)),
          );
          const want = rows.find((r) => r.category === category)?.total ?? 0n;
          expect(out.reply).toBe(`Oct 2026, ${category}: ${formatInr(want)}.`);
        },
      ),
      { numRuns: 30 },
    );
    const total = await ask(
      store,
      'ask total october',
      picking(choice('total', 'october')),
    );
    expect(total.reply).toContain(formatInr(cashFlow(txs, range).out));
  });

  it('voided rows are not counted', async () => {
    const store = stored();
    await ingest(
      { channel: 'test', externalId: 'a', text: 'lunch 100 icici', now: NOW },
      store,
    );
    await ingest(
      { channel: 'test', externalId: 'b', text: 'dinner 200 icici', now: NOW },
      store,
    );
    await ingest(
      { channel: 'test', externalId: 'c', text: 'undo', now: NOW },
      store,
    );
    const out = await ask(
      store,
      'ask total october',
      picking(choice('total', 'october')),
    );
    expect(out.reply).toBe('Oct 2026, all spending: 100.');
  });

  it('this month holds now, and last month ends where it starts, for any now', async () => {
    const instants = fc.date({
      min: new Date('2020-01-01T00:00:00Z'),
      max: new Date('2099-12-31T00:00:00Z'),
      noInvalidDate: true,
    });
    await fc.assert(
      fc.asyncProperty(instants, async (now) => {
        const store = stored();
        // An entry at `now` exactly, so only the right month can count it.
        await ingest(
          { channel: 'test', externalId: 'e', text: 'lunch 100 icici', now },
          store,
        );
        const asked = (month: string) =>
          ask(store, 'ask total', picking(choice('total', month)), now);
        expect((await asked('this_month')).reply).toMatch(/spending: 100\.$/);
        expect((await asked('last_month')).reply).toMatch(/spending: 0\.$/);
      }),
      { numRuns: 200 },
    );
  });
});
