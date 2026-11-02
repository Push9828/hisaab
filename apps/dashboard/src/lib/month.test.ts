import { describe, expect, it } from 'vitest';

import {
  lastSixMonths,
  monthLabel,
  monthParam,
  selectedMonth,
  shiftMonth,
  withMonth,
} from './month';

// 18:30 UTC on 31 Oct is already 1 Nov in IST.
const NOW = new Date('2026-10-31T18:30:00Z');

describe('selectedMonth', () => {
  it('reads a valid ?month=', () => {
    expect(selectedMonth('2026-03', NOW)).toEqual({ year: 2026, month: 3 });
  });

  it('defaults to the current IST month', () => {
    expect(selectedMonth(undefined, NOW)).toEqual({ year: 2026, month: 11 });
  });

  it.each([
    ['garbage', 'x'],
    ['month 13', '2026-13'],
    ['an injection attempt', "2026-10' OR 1=1"],
    ['a repeated parameter', ['2026-01', '2026-02']],
  ])('falls back to the current month on %s', (_name, value) => {
    expect(selectedMonth(value, NOW)).toEqual({ year: 2026, month: 11 });
  });
});

describe('shiftMonth', () => {
  it('crosses year boundaries both ways', () => {
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
    });
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({
      year: 2027,
      month: 1,
    });
  });
});

describe('lastSixMonths', () => {
  it('runs newest first, ending at the given month', () => {
    expect(lastSixMonths({ year: 2026, month: 2 }).map(monthParam)).toEqual([
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
      '2025-10',
      '2025-09',
    ]);
  });
});

describe('labels', () => {
  it('pads the parameter, so parseMonth reads it back', () => {
    expect(monthParam({ year: 2026, month: 3 })).toBe('2026-03');
  });

  it('names the month', () => {
    expect(monthLabel({ year: 2026, month: 3 })).toBe('March 2026');
  });
});

describe('withMonth', () => {
  it('keeps the month across pages', () => {
    expect(withMonth('/spending', { year: 2026, month: 3 })).toBe(
      '/spending?month=2026-03',
    );
  });
});
