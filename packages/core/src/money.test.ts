import { describe, expect, it } from 'vitest';

import { formatInr, parseAmount } from './money';

describe('parseAmount', () => {
  it.each([
    ['450', 45_000n],
    ['4k', 400_000n],
    ['4K', 400_000n],
    ['1.5k', 150_000n],
    ['1.25k', 125_000n],
    ['1.2l', 12_000_000n],
    ['1.2L', 12_000_000n],
    ['450.50', 45_050n],
    ['0.5', 50n],
    ['1.2345k', 123_450n],
    ['85000', 8_500_000n],
  ])('parses %s to %s paise', (token, paise) => {
    expect(parseAmount(token)).toEqual({ ok: true, paise });
  });

  it.each([
    '',
    '0',
    '0k',
    '-5',
    '1,200',
    '₹500',
    'rs500',
    '.5',
    '1.',
    '450.555',
    '1.234567k',
    '4kk',
    '1e3',
    '5 0',
    '100000000000000000000',
    '100000001', // over the 10 crore cap
  ])('rejects %j', (token) => {
    expect(parseAmount(token).ok).toBe(false);
  });

  it('accepts exactly 10 crore', () => {
    expect(parseAmount('100000000')).toEqual({
      ok: true,
      paise: 10_000_000_000n,
    });
  });

  it('allows zero only when asked', () => {
    expect(parseAmount('0', { allowZero: true })).toEqual({
      ok: true,
      paise: 0n,
    });
  });
});

describe('formatInr', () => {
  it.each([
    [0n, '0'],
    [99n, '0.99'],
    [100n, '1'],
    [400_000n, '4,000'],
    [9_999_900n, '99,999'],
    [10_000_000n, '1,00,000'],
    [12_500_000n, '1,25,000'],
    [8_500_050n, '85,000.50'],
    [-150_000n, '-1,500'],
    [10_000_000_000n, '10,00,00,000'],
  ])('formats %s as %s', (paise, text) => {
    expect(formatInr(paise)).toBe(text);
  });
});
