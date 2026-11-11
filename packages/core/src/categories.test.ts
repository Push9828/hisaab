import { describe, expect, it } from 'vitest';

import { CATEGORIES, categorize, KEYWORDS, tokenize } from './categories';

describe('categorize', () => {
  it.each([
    ['petrol', 'Transport'],
    ['Petrol for the car', 'Transport'],
    ['swiggy', 'Food'],
    ['dinner', 'Food'],
    ['rent', 'Rent'],
    ['salary', 'Salary'],
  ])('%s -> %s', (description, category) => {
    expect(categorize(description)).toBe(category);
  });

  it.each([
    ['hotstar', 'Subscriptions'],
    ['zee5', 'Subscriptions'],
    ['dth', 'Utilities'],
    ['lpg cylinder', 'Utilities'],
    ['toll', 'Transport'],
    ['rapido', 'Transport'],
  ])('matches %s from the fallback test', (description, category) => {
    expect(categorize(description)).toBe(category);
  });

  it.each([
    ['haircut', 'Personal care'],
    ['Haircut at salon', 'Personal care'],
    ['barber', 'Personal care'],
    ['grooming kit', 'Personal care'],
    ['spa', 'Personal care'],
    ['parlour', 'Personal care'],
    ['parlor', 'Personal care'],
    ['pooja samagri', 'Religious & spiritual'],
    ['havan', 'Religious & spiritual'],
    ['aarti', 'Religious & spiritual'],
    ['prasad', 'Religious & spiritual'],
    ['temple donation', 'Religious & spiritual'],
    ['mandir', 'Religious & spiritual'],
    ['astrologer fees', 'Religious & spiritual'],
    ['astrology', 'Religious & spiritual'],
    ['aol course', 'Religious & spiritual'],
    ['artofliving', 'Religious & spiritual'],
  ])('%s -> %s', (description, category) => {
    expect(categorize(description)).toBe(category);
  });

  it('does not treat a name as a keyword', () => {
    expect(categorize('gift for pooja')).toBeNull();
    expect(categorize('puja')).toBeNull();
    expect(categorize('pandit')).toBeNull();
  });

  it('does not match art of living written as three words', () => {
    expect(categorize('art of living')).toBeNull();
  });

  it('allows several keywords from the same category', () => {
    expect(categorize('swiggy dinner')).toBe('Food');
  });

  it('returns null with no match', () => {
    expect(categorize('mystery thing')).toBeNull();
  });

  it('returns null when keywords from two categories conflict', () => {
    expect(categorize('uber swiggy')).toBeNull();
    expect(categorize('temple lunch')).toBeNull();
    expect(categorize('salon uber')).toBeNull();
  });

  it('matches whole tokens only', () => {
    expect(categorize('petroleum')).toBeNull();
    expect(categorize('spaghetti')).toBeNull();
    expect(categorize('templerun')).toBeNull();
  });

  it('only ever returns a listed category', () => {
    for (const word of ['petrol', 'swiggy', 'rent', 'salary', 'netflix']) {
      const c = categorize(word);
      if (c !== null) expect(CATEGORIES).toContain(c);
    }
  });

  it('has single-token keywords, each in one category', () => {
    const seen = new Set<string>();
    for (const words of Object.values(KEYWORDS)) {
      for (const word of words) {
        expect(tokenize(word)).toEqual([word]);
        expect(seen.has(word)).toBe(false);
        seen.add(word);
      }
    }
  });
});
