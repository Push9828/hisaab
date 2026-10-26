import { describe, expect, it } from 'vitest';

import { CATEGORIES, categorize } from './categories';

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

  it('allows several keywords from the same category', () => {
    expect(categorize('swiggy dinner')).toBe('Food');
  });

  it('returns null with no match', () => {
    expect(categorize('mystery thing')).toBeNull();
  });

  it('returns null when keywords from two categories conflict', () => {
    expect(categorize('uber swiggy')).toBeNull();
  });

  it('matches whole tokens only', () => {
    expect(categorize('petroleum')).toBeNull();
  });

  it('only ever returns a listed category', () => {
    for (const word of ['petrol', 'swiggy', 'rent', 'salary', 'netflix']) {
      const c = categorize(word);
      if (c !== null) expect(CATEGORIES).toContain(c);
    }
  });
});
