import { describe, expect, it } from 'vitest';
import { correlate, describeCorrelation, pairSeries, pearson, strengthOf } from './correlation';
import type { DailyTrendPoint } from './types';

function series(values: Array<number | null>): DailyTrendPoint[] {
  return values.map((value, index) => ({ date: `2026-09-0${index + 1}`, value }));
}

describe('paired daily observations', () => {
  it('aligns dates rather than array indices, retaining zero and input order', () => {
    const x = series([0, 10, 20]);
    const y = series([100, 200, 300]).reverse();
    const before = structuredClone({ x, y });
    expect(pairSeries(x, y)).toEqual([
      { date: '2026-09-01', x: 0, y: 100 },
      { date: '2026-09-02', x: 10, y: 200 },
      { date: '2026-09-03', x: 20, y: 300 },
    ]);
    expect({ x, y }).toEqual(before);
  });

  it('omits missing and nonfinite readings rather than treating them as zero', () => {
    expect(pairSeries(series([null, NaN, Infinity, 3, 4]), series([1, 2, 3, null, 5])))
      .toEqual([{ date: '2026-09-05', x: 4, y: 5 }]);
    expect(pairSeries(series([1, 2]), series([Infinity, NaN]))).toEqual([]);
  });

  it('uses the last finite reading for duplicate Y dates', () => {
    expect(pairSeries(series([1]), [
      { date: '2026-09-01', value: 2 },
      { date: '2026-09-01', value: 3 },
      { date: '2026-09-01', value: null },
    ])).toEqual([{ date: '2026-09-01', x: 1, y: 3 }]);
  });

  it('pairs positive and negative lags across leap days and year boundaries', () => {
    expect(pairSeries([{ date: '2024-02-28', value: 2 }], [{ date: '2024-02-29', value: 3 }], 1))
      .toEqual([{ date: '2024-02-28', x: 2, y: 3 }]);
    expect(pairSeries([{ date: '2026-01-01', value: 2 }], [{ date: '2025-12-31', value: 3 }], -1))
      .toEqual([{ date: '2026-01-01', x: 2, y: 3 }]);
    expect(pairSeries(series([1, 2, 3]), series([4, 5, 6]), 1)).toHaveLength(2);
  });
});

describe('Pearson correlation', () => {
  it.each([1, -1])('detects a perfect relationship with sign %i', (sign) => {
    const points = pairSeries(series([1, 2, 3, 4]), series([1, 2, 3, 4].map((v) => sign * v)));
    expect(pearson(points)).toBeCloseTo(sign);
    expect(correlate(points)).toEqual({
      r: sign, n: 4, strength: 'very strong',
      label: `very strong ${sign > 0 ? 'positive' : 'negative'}`,
    });
  });

  it('distinguishes no relationship from insufficient data', () => {
    const points = pairSeries(series([-1, 0, 1]), series([1, 0, 1]));
    expect(correlate(points)).toEqual({
      r: 0, n: 3, strength: 'negligible', label: 'no meaningful correlation',
    });
    expect(correlate(points.slice(0, 2))).toEqual({
      r: null, n: 2, strength: 'none', label: 'not enough data',
    });
    expect(pearson([])).toBeNull();
  });

  it('rejects constant axes and nonfinite raw pairs', () => {
    expect(pearson(pairSeries(series([1, 1, 1]), series([1, 2, 3])))).toBeNull();
    expect(pearson(pairSeries(series([1, 2, 3]), series([1, 1, 1])))).toBeNull();
    expect(pearson([
      { date: 'a', x: 1, y: 1 }, { date: 'b', x: 2, y: 2 }, { date: 'c', x: NaN, y: 3 },
    ])).toBeNull();
  });

  it.each([
    [0.099, 'negligible'], [0.1, 'weak'], [0.3, 'moderate'], [0.5, 'strong'], [0.7, 'very strong'],
  ] as const)('classifies magnitude %s independent of direction', (r, strength) => {
    expect(strengthOf(r)).toBe(strength);
    expect(strengthOf(-r)).toBe(strength);
  });

  it('describes missing and negative relationships', () => {
    expect(describeCorrelation(null)).toBe('not enough data');
    expect(describeCorrelation(-0.4)).toBe('moderate negative');
  });
});
