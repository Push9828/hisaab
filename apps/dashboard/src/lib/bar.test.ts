import { describe, expect, it } from 'vitest';

import { barPercent } from './bar';

describe('barPercent', () => {
  it('scales against the largest value', () => {
    expect(barPercent(3_200_000n, 3_200_000n)).toBe('100%');
    expect(barPercent(800_000n, 3_200_000n)).toBe('25%');
    expect(barPercent(1n, 3n)).toBe('33.3%');
  });

  it('keeps a small amount visible', () => {
    expect(barPercent(1n, 3_200_000_000n)).toBe('0.5%');
  });

  it('shows nothing for zero, or when there is no maximum', () => {
    expect(barPercent(0n, 100n)).toBe('0%');
    expect(barPercent(5n, 0n)).toBe('0%');
  });

  it('stays exact above the safe integer range', () => {
    const huge = 10n ** 30n;
    expect(barPercent(huge / 2n, huge)).toBe('50%');
  });
});
