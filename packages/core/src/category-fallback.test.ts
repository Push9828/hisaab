import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CATEGORIES, GUESSABLE_CATEGORIES } from './categories';
import {
  askCategory,
  CATEGORY_OPTIONS,
  fallbackText,
  parseCategoryAnswer,
} from './category-fallback';
import { ACCOUNTS } from './fixtures';

// All names here are fake.
const answer = (category: unknown) => JSON.stringify({ category });

describe('CATEGORY_OPTIONS', () => {
  it('is the spending categories but Home loan EMI, and unsure', () => {
    expect(CATEGORY_OPTIONS).toEqual([
      'Food',
      'Groceries',
      'Transport',
      'Rent',
      'Utilities',
      'Shopping',
      'Entertainment',
      'Health',
      'Personal care',
      'Religious & spiritual',
      'Travel',
      'Subscriptions',
      'unsure',
    ]);
    expect(CATEGORY_OPTIONS).not.toContain('Home loan EMI');
    expect(CATEGORY_OPTIONS).not.toContain('Salary');
    expect(CATEGORY_OPTIONS).not.toContain('Other income');
  });
});

describe('parseCategoryAnswer', () => {
  it.each(GUESSABLE_CATEGORIES)('accepts %s', (category) => {
    expect(parseCategoryAnswer(answer(category))).toBe(category);
  });

  it('accepts unsure', () => {
    expect(parseCategoryAnswer(answer('unsure'))).toBe('unsure');
  });

  it.each([
    ['an income category', answer('Salary')],
    ['the other income category', answer('Other income')],
    ['Home loan EMI, which only the emi command sets', answer('Home loan EMI')],
    ['a category not on the list', answer('Pets')],
    ['the wrong case', answer('food')],
    ['a non-string category', answer(7)],
    ['an object property name', answer('constructor')],
    ['no category', '{}'],
    ['a JSON array', '["Food"]'],
    ['JSON null', 'null'],
    ['a bare JSON string', '"Food"'],
    ['text that is not JSON', 'Food'],
    ['an empty string', ''],
  ])('rejects %s', (_, content) => {
    expect(parseCategoryAnswer(content)).toBeNull();
  });

  it.each([[undefined], [null], [7], [{ category: 'Food' }]])(
    'rejects content that is not a string: %j',
    (content) => {
      expect(parseCategoryAnswer(content)).toBeNull();
    },
  );

  it('returns only a guessable category, unsure or null, for any input', () => {
    const allowed = new Set<unknown>([...GUESSABLE_CATEGORIES, 'unsure', null]);
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.string().map(answer),
          fc.constantFrom(...CATEGORIES).map(answer),
          fc.json(),
        ),
        (content) => {
          expect(allowed.has(parseCategoryAnswer(content))).toBe(true);
        },
      ),
    );
  });
});

describe('fallbackText', () => {
  it('drops account words and tokens with a digit', () => {
    expect(fallbackText('Dinner with John', ACCOUNTS)).toBe('dinner with');
    expect(fallbackText('card xx1234 fee', ACCOUNTS)).toBe('card fee');
    expect(fallbackText('icici cc charges', ACCOUNTS)).toBe('charges');
  });

  it('drops a word with an @, which is an email or UPI handle', () => {
    expect(fallbackText('paid asha.k@okaxis tea', ACCOUNTS)).toBe('paid tea');
    expect(fallbackText('jane.doe@example.com refund', ACCOUNTS)).toBe(
      'refund',
    );
  });

  it('sends up to 100 characters and is empty beyond that', () => {
    expect(fallbackText('a'.repeat(100), ACCOUNTS)).toHaveLength(100);
    expect(fallbackText('a'.repeat(101), ACCOUNTS)).toBe('');
  });

  it('is empty when nothing is left to send', () => {
    expect(fallbackText('john', ACCOUNTS)).toBe('');
    expect(fallbackText('दवाई', ACCOUNTS)).toBe('');
  });
});

describe('askCategory', () => {
  const asks = (content: unknown) => ({ ask: () => Promise.resolve(content) });

  it('guesses from a valid category', async () => {
    expect(await askCategory(asks(answer('Food')), 'chai')).toEqual({
      llm: 'guessed',
      category: 'Food',
    });
  });

  it('reports unsure', async () => {
    expect(await askCategory(asks(answer('unsure')), 'asdf')).toEqual({
      llm: 'unsure',
    });
  });

  it('reports failed for an answer outside the list', async () => {
    expect(await askCategory(asks(answer('Salary')), 'x')).toEqual({
      llm: 'failed',
    });
  });

  it('reports failed when the categorizer rejects or throws', async () => {
    const rejects = { ask: () => Promise.reject(new Error('down')) };
    const throws = {
      ask: () => {
        throw new Error('sync');
      },
    };
    expect(await askCategory(rejects, 'x')).toEqual({ llm: 'failed' });
    expect(await askCategory(throws, 'x')).toEqual({ llm: 'failed' });
  });

  it('passes the text through unchanged', async () => {
    const seen: string[] = [];
    await askCategory(
      {
        ask: (text) => {
          seen.push(text);
          return Promise.resolve(answer('Food'));
        },
      },
      'masala dosa',
    );
    expect(seen).toEqual(['masala dosa']);
  });
});
