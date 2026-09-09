import { describe, expect, it } from 'vitest';
import { addDays, dateKey, DAY_MS, utcDateTime } from './date';

describe('UTC calendar arithmetic', () => {
  it('interprets date-only keys as midnight UTC and honors timestamp offsets', () => {
    expect(utcDateTime('2026-09-06')).toBe(Date.UTC(2026, 8, 6));
    expect(utcDateTime('2026-09-06T23:00:00-04:00')).toBe(Date.UTC(2026, 8, 7, 3));
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
  });

  it.each([
    ['2024-02-28', 1, '2024-02-29'],
    ['2024-02-28', 2, '2024-03-01'],
    ['2025-02-28', 1, '2025-03-01'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-03-08', 1, '2026-03-09'],
    ['2026-11-01', 1, '2026-11-02'],
    ['2026-09-06', 0, '2026-09-06'],
  ])('shifts %s by %i days to %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
    expect(utcDateTime(expected) - utcDateTime(date)).toBe(days * DAY_MS);
    expect(addDays(expected, -days)).toBe(date);
  });

  it('preserves timestamp support used by chart callers', () => {
    expect(addDays('2026-09-06T23:00:00-04:00', 1)).toBe('2026-09-08');
  });

  it('does not disguise malformed dates as a valid date', () => {
    expect(utcDateTime('invalid')).toBeNaN();
    expect(() => addDays('invalid', 1)).toThrow(RangeError);
  });

  it('formats UTC dates across offset boundaries without changing the input instant', () => {
    const instant = new Date('2026-09-06T23:30:00-04:00');
    const original = instant.getTime();
    expect(dateKey(instant)).toBe('2026-09-07');
    expect(instant.getTime()).toBe(original);
    expect(() => dateKey(new Date('invalid'))).toThrow(RangeError);
  });
});
