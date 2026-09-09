import { describe, expect, it } from 'vitest';
import { asOfLabel, latestNonNull } from './trendFallback';

describe('latest available trend reading', () => {
  it.each([undefined, null, []])('handles missing or empty history', (trend) => {
    expect(latestNonNull(trend)).toBeNull();
  });

  it('returns the last measured value and its date without mutating the history', () => {
    const trend = [
      { date: '2026-09-01', value: 10 },
      { date: '2026-09-02', value: null },
      { date: '2026-09-03', value: 0 },
      { date: '2026-09-04', value: null },
    ];
    const before = structuredClone(trend);
    expect(latestNonNull(trend)).toEqual({ date: '2026-09-03', value: 0 });
    expect(trend).toEqual(before);
  });

  it('does not fabricate a reading when all samples are null', () => {
    expect(latestNonNull([{ date: '2026-09-01', value: null }])).toBeNull();
  });

  it('formats the observation date using UTC rather than the browser timezone', () => {
    expect(asOfLabel('2026-01-01')).toBe(new Date('2026-01-01T12:00:00Z').toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', timeZone: 'UTC',
    }));
  });
});
