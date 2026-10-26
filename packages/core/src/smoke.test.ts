import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

describe('toolchain smoke', () => {
  it('runs vitest', () => {
    expect(1n + 1n).toBe(2n);
  });

  it('runs fast-check', () => {
    fc.assert(fc.property(fc.bigInt(), fc.bigInt(), (a, b) => a + b === b + a));
  });
});
