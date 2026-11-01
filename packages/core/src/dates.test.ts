import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  formatDay,
  istMonthOf,
  istMonthRange,
  parseDatePrefix,
  parseMonth,
} from './dates';
import { NOW } from './fixtures';

const noonIst = (iso: string) => new Date(`${iso}T12:00:00+05:30`);

describe('parseDatePrefix', () => {
  it('returns null when there is no prefix', () => {
    expect(parseDatePrefix(['petrol', '4k'], NOW)).toBeNull();
  });

  it('today is now', () => {
    expect(parseDatePrefix(['today', 'petrol'], NOW)).toEqual({
      ok: true,
      occurredAt: NOW,
      consumed: 1,
    });
  });

  it('yesterday is noon IST the day before', () => {
    expect(parseDatePrefix(['yesterday', 'petrol'], NOW)).toEqual({
      ok: true,
      occurredAt: noonIst('2026-10-25'),
      consumed: 1,
    });
  });

  it('on <d> <mon> uses the current IST year', () => {
    expect(parseDatePrefix(['on', '20', 'oct', 'x'], NOW)).toEqual({
      ok: true,
      occurredAt: noonIst('2026-10-20'),
      consumed: 3,
    });
  });

  it('accepts full month names and an explicit year', () => {
    expect(parseDatePrefix(['on', '5', 'march', '2025', 'x'], NOW)).toEqual({
      ok: true,
      occurredAt: noonIst('2025-03-05'),
      consumed: 4,
    });
  });

  it('does not treat a later number as a year', () => {
    const r = parseDatePrefix(['on', '5', 'mar', '4000'], NOW);
    expect(r).toMatchObject({ ok: true, consumed: 3 });
  });

  it('rejects future dates, never rolling back a year', () => {
    expect(parseDatePrefix(['on', '27', 'oct'], NOW)).toMatchObject({
      ok: false,
      reason: 'FUTURE_DATE',
    });
    expect(parseDatePrefix(['on', '1', 'dec'], NOW)).toMatchObject({
      ok: false,
      reason: 'FUTURE_DATE',
    });
    expect(parseDatePrefix(['on', '1', 'jan', '2027'], NOW)).toMatchObject({
      ok: false,
      reason: 'FUTURE_DATE',
    });
  });

  it('accepts today by date', () => {
    expect(parseDatePrefix(['on', '26', 'oct'], NOW)).toMatchObject({
      ok: true,
    });
  });

  it('judges "today" in IST, not UTC', () => {
    const lateUtc = new Date('2026-10-26T20:00:00Z'); // 01:30 IST on 27 Oct
    expect(parseDatePrefix(['on', '27', 'oct'], lateUtc)).toMatchObject({
      ok: true,
    });
    expect(parseDatePrefix(['on', '28', 'oct'], lateUtc)).toMatchObject({
      ok: false,
      reason: 'FUTURE_DATE',
    });
  });

  it.each([
    [['on', '31', 'feb']],
    [['on', '29', 'feb', '2026']],
    [['on', '0', 'oct']],
    [['on', 'oct', '20']],
    [['on', '20']],
    [['on']],
    [['on', '20', 'octember']],
  ])('rejects %j as BAD_DATE', (tokens) => {
    expect(parseDatePrefix(tokens, NOW)).toMatchObject({
      ok: false,
      reason: 'BAD_DATE',
    });
  });

  it('yesterday rolls over month and year boundaries', () => {
    const first = new Date('2026-11-01T10:00:00Z');
    expect(parseDatePrefix(['yesterday'], first)).toMatchObject({
      occurredAt: noonIst('2026-10-31'),
    });
    const newYear = new Date('2027-01-01T10:00:00Z');
    expect(parseDatePrefix(['yesterday'], newYear)).toMatchObject({
      occurredAt: noonIst('2026-12-31'),
    });
  });

  it('judges "yesterday" in IST, not UTC', () => {
    const lateUtc = new Date('2026-10-26T20:00:00Z'); // 01:30 IST on 27 Oct
    expect(parseDatePrefix(['yesterday'], lateUtc)).toMatchObject({
      occurredAt: noonIst('2026-10-26'),
    });
  });

  it('accepts 29 feb without a year only in a leap year', () => {
    const leap = new Date('2028-03-10T10:00:00Z');
    expect(parseDatePrefix(['on', '29', 'feb'], leap)).toMatchObject({
      ok: true,
      occurredAt: noonIst('2028-02-29'),
    });
    expect(parseDatePrefix(['on', '29', 'feb'], NOW)).toMatchObject({
      ok: false,
      reason: 'BAD_DATE',
    });
    expect(parseDatePrefix(['on', '29', 'feb', '2100'], NOW)).toMatchObject({
      ok: false,
      reason: 'BAD_DATE',
    });
  });

  it('accepts "sept"', () => {
    expect(parseDatePrefix(['on', '5', 'sept'], NOW)).toMatchObject({
      ok: true,
      occurredAt: noonIst('2026-09-05'),
    });
  });

  it('accepts a leap day', () => {
    expect(parseDatePrefix(['on', '29', 'feb', '2024'], NOW)).toMatchObject({
      ok: true,
    });
  });
});

describe('formatDay', () => {
  it('formats in IST', () => {
    expect(formatDay(noonIst('2026-10-20'))).toBe('20 Oct');
  });
});

describe('istMonthOf', () => {
  it('changes month at midnight IST, not UTC', () => {
    expect(istMonthOf(new Date('2026-10-31T18:29:59.999Z'))).toEqual({
      year: 2026,
      month: 10,
    });
    expect(istMonthOf(new Date('2026-10-31T18:30:00.000Z'))).toEqual({
      year: 2026,
      month: 11,
    });
  });

  it('changes year at midnight IST, not UTC', () => {
    expect(istMonthOf(new Date('2026-12-31T18:30:00.000Z'))).toEqual({
      year: 2027,
      month: 1,
    });
  });
});

describe('istMonthRange', () => {
  it('starts at midnight IST and ends at the next month start', () => {
    expect(istMonthRange(2026, 10)).toEqual({
      start: new Date('2026-09-30T18:30:00.000Z'),
      end: new Date('2026-10-31T18:30:00.000Z'),
    });
  });

  it('rolls December over to January', () => {
    expect(istMonthRange(2026, 12)).toEqual({
      start: new Date('2026-11-30T18:30:00.000Z'),
      end: new Date('2026-12-31T18:30:00.000Z'),
    });
  });

  it('covers a leap February', () => {
    expect(istMonthRange(2028, 2)).toEqual({
      start: new Date('2028-01-31T18:30:00.000Z'),
      end: new Date('2028-02-29T18:30:00.000Z'),
    });
  });

  it('puts every instant in exactly one month range', () => {
    const inRange = (at: Date, { start, end }: { start: Date; end: Date }) =>
      at >= start && at < end;

    fc.assert(
      fc.property(
        fc.date({
          min: new Date('2000-01-01T00:00:00.000Z'),
          max: new Date('2099-12-31T00:00:00.000Z'),
          noInvalidDate: true,
        }),
        (at) => {
          const { year, month } = istMonthOf(at);
          const range = istMonthRange(year, month);
          expect(inRange(at, range)).toBe(true);

          const previous =
            month === 1
              ? istMonthRange(year - 1, 12)
              : istMonthRange(year, month - 1);
          const next =
            month === 12
              ? istMonthRange(year + 1, 1)
              : istMonthRange(year, month + 1);
          expect(inRange(at, previous)).toBe(false);
          expect(inRange(at, next)).toBe(false);
          expect(previous.end).toEqual(range.start);
          expect(range.end).toEqual(next.start);
        },
      ),
      { numRuns: 2000 },
    );
  });
});

describe('parseMonth', () => {
  it('reads YYYY-MM', () => {
    expect(parseMonth('2026-10')).toEqual({ year: 2026, month: 10 });
    expect(parseMonth('2027-01')).toEqual({ year: 2027, month: 1 });
  });

  it.each([
    '',
    '2026',
    '2026-1',
    '2026-00',
    '2026-13',
    '2026-010',
    '26-10',
    '1999-10',
    '0050-10',
    '2026/10',
    ' 2026-10',
    '2026-10 ',
    '2026-10\n',
    '2026-10-01',
    'oct',
  ])('rejects %j', (value) => {
    expect(parseMonth(value)).toBeNull();
  });
});
