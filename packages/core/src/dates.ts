// IST is a fixed UTC+5:30 with no DST, so no timezone database is needed.
const IST_OFFSET_MS = 330 * 60_000;

export const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

interface Day {
  year: number;
  month: number; // 1-12
  day: number;
}

export function istDay(date: Date): Day {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1,
    day: ist.getUTCDate(),
  };
}

const dayKey = (d: Day) => d.year * 10_000 + d.month * 100 + d.day;

export const sameIstDay = (a: Date, b: Date): boolean =>
  dayKey(istDay(a)) === dayKey(istDay(b));

export function formatDay(date: Date): string {
  const { month, day } = istDay(date);
  return `${day} ${MONTH_LABELS[month - 1]}`;
}

const noonIst = ({ year, month, day }: Day): Date =>
  new Date(Date.UTC(year, month - 1, day, 12, 0) - IST_OFFSET_MS);

export interface Month {
  year: number;
  month: number; // 1-12
}

export interface DateRange {
  start: Date; // inclusive
  end: Date; // exclusive
}

export function istMonthOf(date: Date): Month {
  const { year, month } = istDay(date);
  return { year, month };
}

export const monthLabel = ({ year, month }: Month): string =>
  `${MONTH_LABELS[month - 1]} ${year}`;

export const istMonthRange = (year: number, month: number): DateRange => ({
  start: new Date(Date.UTC(year, month - 1, 1) - IST_OFFSET_MS),
  end: new Date(Date.UTC(year, month, 1) - IST_OFFSET_MS),
});

/** Reads a strict YYYY-MM. Accepts only 20xx, as the date prefix does. */
export function parseMonth(value: string): Month | null {
  const match = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

export const isMonthName = (token: string): boolean => monthIndex(token) !== -1;

function monthIndex(token: string): number {
  if (token === 'sept') return 8;
  if (token.length < 3) return -1;
  return MONTHS.findIndex((m) => m === token || m.slice(0, 3) === token);
}

export type DatePrefix =
  | { ok: true; occurredAt: Date; consumed: number }
  | { ok: false; reason: 'BAD_DATE' | 'FUTURE_DATE'; question: string };

const BAD_DATE: DatePrefix = {
  ok: false,
  reason: 'BAD_DATE',
  question:
    'I could not read that date. Use "yesterday", "on 20 oct" or "on 20 oct 2025" before the entry.',
};

/**
 * Reads an optional leading date: today | yesterday | on <d> <mon> [yyyy].
 * Takes lowercase tokens. Returns null when the message has no date prefix.
 * Day-only entries are stamped 12:00 IST; "today" is `now` itself.
 */
export function parseDatePrefix(
  tokens: string[],
  now: Date,
): DatePrefix | null {
  const first = tokens[0];
  const today = istDay(now);

  if (first === 'today') return { ok: true, occurredAt: now, consumed: 1 };
  if (first === 'yesterday') {
    const back = noonIst({ ...today, day: today.day - 1 });
    return { ok: true, occurredAt: back, consumed: 1 };
  }
  if (first !== 'on') return null;

  const dayToken = tokens[1] ?? '';
  const month = monthIndex(tokens[2] ?? '') + 1;
  if (!/^\d{1,2}$/.test(dayToken) || month === 0) return BAD_DATE;

  // Accept an explicit year only as 20xx, so an amount is never read as one.
  const yearToken = tokens[3] ?? '';
  const hasYear = /^20\d{2}$/.test(yearToken);
  const target: Day = {
    year: hasYear ? Number(yearToken) : today.year,
    month,
    day: Number(dayToken),
  };

  const check = new Date(Date.UTC(target.year, month - 1, target.day));
  if (
    target.day < 1 ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== target.day
  ) {
    return BAD_DATE;
  }

  if (dayKey(target) > dayKey(today)) {
    return {
      ok: false,
      reason: 'FUTURE_DATE',
      question: hasYear
        ? 'That date is in the future. Which past date did you mean?'
        : 'That date is in the future this year. If you meant a past year, add it: "on 20 oct 2025".',
    };
  }

  const consumed = hasYear ? 4 : 3;
  const isToday = dayKey(target) === dayKey(today);
  return {
    ok: true,
    occurredAt: isToday ? now : noonIst(target),
    consumed,
  };
}
