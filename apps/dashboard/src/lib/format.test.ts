import { describe, expect, it } from 'vitest';

import { initials, inr, percent, signedInr } from './format';

describe('inr', () => {
  it('uses Indian grouping and a real minus sign', () => {
    expect(inr(25_00_000_00n)).toBe('₹25,00,000');
    expect(inr(-150n)).toBe('−₹1.50');
    expect(inr(0n)).toBe('₹0');
  });
});

describe('signedInr', () => {
  it('shows the direction, except on zero', () => {
    expect(signedInr(100n)).toBe('+₹1');
    expect(signedInr(-100n)).toBe('−₹1');
    expect(signedInr(0n)).toBe('₹0');
  });
});

describe('percent', () => {
  it('reads tenths of a percent', () => {
    expect(percent(350)).toBe('35%');
    expect(percent(333)).toBe('33.3%');
    expect(percent(-500)).toBe('−50%');
  });
});

describe('initials', () => {
  it('takes up to two', () => {
    expect(initials('RAHUL')).toBe('RA');
    expect(initials('Rahul Fake Name')).toBe('RF');
    expect(initials('x')).toBe('X');
  });
});
