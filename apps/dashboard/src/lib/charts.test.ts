import { describe, expect, it } from 'vitest';

import { areaPath, gaugeDash, linePath, niceMax } from './charts';

describe('niceMax', () => {
  it('rounds up to 1, 2 or 5 times a power of ten', () => {
    expect(niceMax([8_500_000n, 100n])).toBe(10_000_000n);
    expect(niceMax([1_200_000n])).toBe(2_000_000n);
    expect(niceMax([4_100_000n])).toBe(5_000_000n);
    expect(niceMax([10_000_000n])).toBe(10_000_000n);
  });

  it('never returns zero, so an empty chart can still be scaled', () => {
    expect(niceMax([])).toBeGreaterThan(0n);
    expect(niceMax([0n, 0n])).toBeGreaterThan(0n);
  });

  it('treats a negative as its size', () => {
    expect(niceMax([-1_200_000n])).toBe(2_000_000n);
  });
});

describe('paths', () => {
  const size = { width: 600, height: 200 };

  it('puts points at column centres, and the top value at the top', () => {
    expect(linePath([0n, 100n], 100n, size)).toBe(
      'M150 200 C300 200 300 0 450 0',
    );
  });

  it('closes the area along the baseline', () => {
    expect(areaPath([0n, 100n], 100n, size)).toBe(
      'M150 200 C300 200 300 0 450 0 L450 200 L150 200 Z',
    );
  });

  it('stays inside the chart if a value exceeds the maximum', () => {
    expect(linePath([200n], 100n, size)).toBe('M300 0');
  });
});

describe('gaugeDash', () => {
  it('fills the arc in proportion, clamped to it', () => {
    expect(gaugeDash(350)).toBe('35 100');
    expect(gaugeDash(-500)).toBe('0 100');
    expect(gaugeDash(1500)).toBe('100 100');
    expect(gaugeDash(null)).toBe('0 100');
  });
});
