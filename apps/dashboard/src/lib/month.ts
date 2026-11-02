import { istMonthOf, parseMonth, type Month } from '@hisaab/core';

/** Anything but one valid YYYY-MM falls back to the current IST month. */
export function selectedMonth(
  value: string | string[] | undefined,
  now: Date,
): Month {
  const parsed = typeof value === 'string' ? parseMonth(value) : null;
  return parsed ?? istMonthOf(now);
}

export function shiftMonth({ year, month }: Month, by: number): Month {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export const lastSixMonths = (month: Month): Month[] =>
  [0, 1, 2, 3, 4, 5].map((back) => shiftMonth(month, -back));

export const monthParam = ({ year, month }: Month): string =>
  `${year}-${String(month).padStart(2, '0')}`;

export const withMonth = (path: string, month: Month): string =>
  `${path}?month=${monthParam(month)}`;

const LABEL = new Intl.DateTimeFormat('en-IN', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export const monthLabel = ({ year, month }: Month): string =>
  LABEL.format(new Date(Date.UTC(year, month - 1, 1)));
