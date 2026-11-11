import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { CATEGORIES, GUESSABLE_CATEGORIES } from './categories';
import { ACCOUNTS, NOW } from './fixtures';
import { ingest } from './ingest';
import { MemoryStore } from './memory-store';

import type { Categorizer } from './category-fallback';
import type { LedgerStore } from './store';

// SPEC section 5 examples 13-17 and the fallback's rules. All data is fake.
const stored = () =>
  new MemoryStore(
    ACCOUNTS.map(({ balance, ...rest }) => ({
      ...rest,
      openingBalance: balance,
    })),
  );

const answers = (
  category: unknown,
): Categorizer & { ask: ReturnType<typeof vi.fn> } => ({
  ask: vi.fn(() => Promise.resolve(JSON.stringify({ category }))),
});

function setup(categorizer?: Categorizer) {
  const store = stored();
  let n = 0;
  const send = (text: string, externalId = `m${++n}`) =>
    ingest({ channel: 'test', externalId, text, now: NOW }, store, categorizer);
  const only = () => {
    const [tx] = store.snapshot().transactions;
    if (!tx) throw new Error('nothing was written');
    return tx.proposed;
  };
  return { store, send, only };
}

describe('SPEC section 5: category fallback', () => {
  it('13. a guess fills the category, keeps NEEDS_REVIEW and says so', async () => {
    const { send, only } = setup(answers('Food'));
    const out = await send('chai 20 icici');
    expect(out).toEqual({
      duplicate: false,
      llm: 'guessed',
      reply:
        'Logged: 20 Chai (Food, guessed) on ICICI. Reply "undo" to revert.',
    });
    expect(only()).toMatchObject({
      type: 'EXPENSE',
      category: 'Food',
      status: 'NEEDS_REVIEW',
      spendAmount: 2_000n,
      entries: [{ accountId: 'id-icici', amount: -2_000n }],
    });
  });

  it('14. a guess on a split leaves the shares alone', async () => {
    const { send, only } = setup(answers('Food'));
    const out = await send('momos 900 split john 300 icici');
    expect(out.reply).toBe(
      'Logged: 900 Momos (Food, guessed) on ICICI. Your share 600; John owes 300. Reply "undo" to revert.',
    );
    expect(only()).toMatchObject({
      type: 'SPLIT',
      category: 'Food',
      status: 'NEEDS_REVIEW',
      spendAmount: 60_000n,
      entries: [
        { accountId: 'id-icici', amount: -90_000n },
        { accountId: 'id-john', amount: 30_000n },
      ],
    });
  });

  const NO_ANSWER: [string, Categorizer, string][] = [
    ['unsure', answers('unsure'), 'unsure'],
    ['an income category', answers('Salary'), 'failed'],
    ['a category off the list', answers('Pets'), 'failed'],
    ['Home loan EMI, which only emi sets', answers('Home loan EMI'), 'failed'],
    ['garbage', { ask: () => Promise.resolve('not json') }, 'failed'],
    ['a rejection', { ask: () => Promise.reject(new Error('down')) }, 'failed'],
    [
      'a throw',
      {
        ask: () => {
          throw new Error('sync');
        },
      },
      'failed',
    ],
  ];

  it.each(NO_ANSWER)(
    '15. with %s the message is still logged, for review',
    async (_, categorizer, llm) => {
      const { send, only } = setup(categorizer);
      const out = await send('asdf 100 icici');
      expect(out).toEqual({
        duplicate: false,
        llm,
        reply:
          'Logged: 100 Asdf (category needs review) on ICICI. Reply "undo" to revert.',
      });
      expect(only()).toMatchObject({
        category: null,
        status: 'NEEDS_REVIEW',
        spendAmount: 10_000n,
      });
    },
  );

  it('16. with nothing left to send there is no call', async () => {
    const categorizer = answers('Food');
    const { send, only } = setup(categorizer);
    const out = await send('john 500 icici');
    expect(categorizer.ask).not.toHaveBeenCalled();
    expect(out.llm).toBeUndefined();
    expect(only()).toMatchObject({ category: null, status: 'NEEDS_REVIEW' });
  });

  it('17. a keyword hit makes no call and stays confirmed', async () => {
    const categorizer = answers('Food');
    const { send, only } = setup(categorizer);
    const out = await send('petrol 4k cc icici');
    expect(categorizer.ask).not.toHaveBeenCalled();
    expect(out).toEqual({
      duplicate: false,
      reply:
        'Logged: 4,000 Petrol (Transport) on ICICI-CC. Reply "undo" to revert.',
    });
    expect(only()).toMatchObject({
      category: 'Transport',
      status: 'CONFIRMED',
    });
  });
});

describe('ingest: what counts as a miss', () => {
  it.each([
    ['no keyword', 'chai 20 icici'],
    ['keywords from two categories', 'doctor hotel 20 icici'],
    ['an income word on an expense', 'salary advance 20 icici'],
  ])('asks on %s', async (_, text) => {
    const categorizer = answers('Food');
    const { send, only } = setup(categorizer);
    await send(text);
    expect(categorizer.ask).toHaveBeenCalledOnce();
    expect(only().category).toBe('Food');
  });

  it.each([
    'emi 32k bom',
    'in 500 mystery icici',
    'xfer 25k icici bom',
    'pay icicicc 4k from icici',
    'lend john 10k icici',
    'got john 5k icici',
    'bal icici 85000',
    'bal icici',
    'accounts',
    'open hdfc 0 bank',
    'undo',
    'blah',
    'chai 20',
    'chai 20 nowhere',
  ])('makes no call for: %s', async (text) => {
    const categorizer = answers('Food');
    const { send } = setup(categorizer);
    const out = await send(text);
    expect(categorizer.ask).not.toHaveBeenCalled();
    expect(out.llm).toBeUndefined();
  });

  it('sends the filtered description and nothing else', async () => {
    const categorizer = answers('Food');
    const { send } = setup(categorizer);
    await send('yesterday dinnr with john xx1234 450 cc icici');
    expect(categorizer.ask.mock.calls).toEqual([['dinnr with']]);
  });

  it('with no categorizer behaves as it did before', async () => {
    const { send, only } = setup();
    const out = await send('chai 20 icici');
    expect(out).toEqual({
      duplicate: false,
      reply:
        'Logged: 20 Chai (category needs review) on ICICI. Reply "undo" to revert.',
    });
    expect(only().category).toBeNull();
  });
});

describe('ingest: the call sits outside any transaction', () => {
  it('another message can finish while the call is waiting', async () => {
    const store = stored();
    const send = (
      text: string,
      externalId: string,
      categorizer?: Categorizer,
    ) =>
      ingest(
        { channel: 'test', externalId, text, now: NOW },
        store,
        categorizer,
      );
    // MemoryStore queues runs, so this would never finish inside a run.
    const out = await send('chai 20 icici', 'a', {
      ask: async () => {
        await send('lunch 100 icici', 'b');
        return JSON.stringify({ category: 'Food' });
      },
    });
    expect(out.llm).toBe('guessed');
    expect(
      store.snapshot().transactions.map((t) => t.proposed.description),
    ).toEqual(['lunch', 'chai']);
  });

  it('a replay makes no call', async () => {
    const categorizer = answers('Food');
    const { send } = setup(categorizer);
    await send('chai 20 icici', 'r');
    const again = await send('chai 20 icici', 'r');
    expect(again.duplicate).toBe(true);
    expect(again.llm).toBeUndefined();
    expect(categorizer.ask).toHaveBeenCalledOnce();
  });

  it('a delivery racing during the call writes once and reports a duplicate', async () => {
    const store = stored();
    const send = (categorizer?: Categorizer) =>
      ingest(
        { channel: 'test', externalId: 'r', text: 'chai 20 icici', now: NOW },
        store,
        categorizer,
      );
    const out = await send({
      ask: async () => {
        await send();
        return JSON.stringify({ category: 'Food' });
      },
    });
    expect(out.duplicate).toBe(true);
    expect(out.llm).toBeUndefined();
    expect(store.snapshot().transactions).toHaveLength(1);
  });

  it('claims nothing until the call is over', async () => {
    const store = stored();
    let claimed: boolean | undefined;
    await ingest(
      { channel: 'test', externalId: 'c', text: 'chai 20 icici', now: NOW },
      store,
      {
        ask: async () => {
          claimed = await store.run((db) => db.wasProcessed('test', 'c'));
          return null;
        },
      },
    );
    expect(claimed).toBe(false);
    expect(await store.run((db) => db.wasProcessed('test', 'c'))).toBe(true);
  });

  it('a long description makes no call and is stored for review', async () => {
    const categorizer = answers('Food');
    const { send, only } = setup(categorizer);
    await send(`${'word '.repeat(30)}20 icici`);
    expect(categorizer.ask).not.toHaveBeenCalled();
    expect(only()).toMatchObject({ category: null, status: 'NEEDS_REVIEW' });
  });

  it('a write that fails after the call leaves nothing, and a retry asks again', async () => {
    const inner = stored();
    let failures = 1;
    const failing: LedgerStore = {
      run: (fn) =>
        inner.run((db) =>
          fn({
            ...db,
            insertTransaction: (tx, meta) =>
              failures-- > 0
                ? Promise.reject(new Error('connection lost'))
                : db.insertTransaction(tx, meta),
          }),
        ),
    };
    const categorizer = answers('Food');
    const send = () =>
      ingest(
        { channel: 'test', externalId: 'f', text: 'chai 20 icici', now: NOW },
        failing,
        categorizer,
      );

    await expect(send()).rejects.toThrow('connection lost');
    expect(inner.snapshot().transactions).toEqual([]);
    expect(inner.snapshot().processed).toEqual([]);

    expect((await send()).llm).toBe('guessed');
    expect(categorizer.ask).toHaveBeenCalledTimes(2);
    expect(inner.snapshot().transactions).toHaveLength(1);
  });

  it('an undo after a guess voids it', async () => {
    const { store, send } = setup(answers('Food'));
    await send('chai 20 icici');
    expect((await send('undo')).reply).toBe('Undone: chai.');
    expect(store.snapshot().transactions[0]?.voidedAt).toEqual(NOW);
  });
});

describe('ingest: properties of the fallback (hard rule 2)', () => {
  // Anything an LLM could send back, including valid and income categories.
  const anyAnswer = fc.oneof(
    fc
      .constantFrom(...CATEGORIES, 'unsure')
      .map((category) => JSON.stringify({ category })),
    fc.json(),
    fc.string(),
    fc.constant(undefined),
    fc.constant(null),
    fc.integer(),
  );
  const message = fc.oneof(
    fc
      .tuple(
        fc.integer({ min: 1, max: 99_999_999 }),
        fc.constantFrom('icici', 'bom', 'cc icici'),
      )
      .map(([rupees, account]) => `mystery item ${rupees} ${account}`),
    fc
      .tuple(fc.integer({ min: 2, max: 9_999 }))
      .map(
        ([rupees]) =>
          `mystery ${rupees * 2} split john ${rupees} sam ${rupees - 1} icici`,
      ),
  );

  it('only the category can differ from a run with no LLM', async () => {
    await fc.assert(
      fc.asyncProperty(message, anyAnswer, async (text, answer) => {
        const plain = setup();
        const llm = setup({ ask: () => Promise.resolve(answer) });
        await plain.send(text, 'p');
        await llm.send(text, 'p');

        const { category: guess, ...rest } = llm.only();
        const { category: none, ...expected } = plain.only();
        expect(rest).toEqual(expected);
        expect(rest.status).toBe('NEEDS_REVIEW');
        expect(none).toBeNull();
        expect(guess === null || GUESSABLE_CATEGORIES.includes(guess)).toBe(
          true,
        );
        expect(await llm.store.run((db) => db.accounts())).toEqual(
          await plain.store.run((db) => db.accounts()),
        );
      }),
      { numRuns: 200 },
    );
  });

  it('text sent never holds a digit or an account word', async () => {
    const words = fc.array(
      fc.constantFrom(
        'chai',
        'john',
        'SAM',
        'icici',
        'bom',
        'cc',
        'xx1234',
        'with',
        'a1b',
      ),
      { minLength: 1, maxLength: 6 },
    );
    await fc.assert(
      fc.asyncProperty(words, async (description) => {
        const seen: string[] = [];
        const { send } = setup({
          ask: (text) => {
            seen.push(text);
            return Promise.resolve(null);
          },
        });
        await send(`on 20 oct ${description.join(' ')} 450 icici`);
        // A word that survives the filter proves the call happened.
        if (description.includes('chai')) expect(seen).toHaveLength(1);
        for (const text of seen) {
          expect(text).not.toMatch(/[0-9]/);
          for (const blocked of ['john', 'sam', 'icici', 'bom', 'cc']) {
            expect(text.split(' ')).not.toContain(blocked);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
