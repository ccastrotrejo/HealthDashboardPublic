import { describe, expect, it } from 'vitest';
import { isCurrentCoachWeek } from './trainingPresentation';

describe('coach calendar-week boundaries', () => {
  it.each([
    ['2026-03-02', 2026, 2, 2],
    ['2026-10-26', 2026, 9, 26],
  ] as const)('keeps a seven-calendar-day window from %s through DST changes', (start, year, month, day) => {
    expect(isCurrentCoachWeek(start, new Date(year, month, day - 1, 23, 59))).toBe(false);
    expect(isCurrentCoachWeek(start, new Date(year, month, day, 0, 0))).toBe(true);
    expect(isCurrentCoachWeek(start, new Date(year, month, day + 6, 23, 59))).toBe(true);
    expect(isCurrentCoachWeek(start, new Date(year, month, day + 7, 0, 0))).toBe(false);
  });
});
