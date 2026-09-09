import { describe, expect, it } from 'vitest';
import { describeTrendConfidence, trendConfidence } from './trendConfidence';

describe('trend confidence', () => {
  it('requires four finite readings, including when entries are value objects', () => {
    expect(trendConfidence([])).toMatchObject({ n: 0, confidence: 'insufficient', direction: 'flat' });
    const result = trendConfidence([1, { value: 2 }, null, { value: null }, NaN, Infinity, 3]);
    expect(result).toMatchObject({ n: 3, confidence: 'insufficient', slope: 0 });
    expect(describeTrendConfidence(result)).toBeNull();
  });

  it.each([1, -1])('detects a perfect slope of %i', (slope) => {
    const result = trendConfidence([1, 2, 3, 4, 5].map((v) => v * slope));
    expect(result).toMatchObject({
      n: 5, direction: slope > 0 ? 'rising' : 'falling', confidence: 'high',
      slope, slopeStdError: 0, rSquared: 1, tStatistic: slope * Infinity,
    });
    expect(describeTrendConfidence(result)?.text)
      .toBe(`${slope > 0 ? 'Rising' : 'Falling'} \u00b7 high confidence`);
  });

  it('keeps missing days in the x-axis instead of compressing time', () => {
    const input = Object.freeze([0, null, 4, { value: null }, 8, NaN, { value: 12 }]);
    expect(trendConfidence(input)).toMatchObject({ n: 4, slope: 2, rSquared: 1, confidence: 'high' });
  });

  it('treats a constant series as low-confidence flat, not an infinite signal', () => {
    const result = trendConfidence([5, 5, 5, 5]);
    expect(result).toMatchObject({
      direction: 'flat', confidence: 'low', slope: 0, slopeStdError: 0, tStatistic: 0, rSquared: 1,
    });
    expect(describeTrendConfidence(result)).toEqual({ arrow: '\u2192', text: 'Flat \u00b7 likely noise' });
  });

  it('distinguishes a noisy series from a directional signal', () => {
    expect(trendConfidence([10, 30, 5, 35, 10, 30, 5])).toMatchObject({ direction: 'flat', confidence: 'low' });
    const result = trendConfidence([1, 3, 2, 5, 4]);
    expect(result).toMatchObject({ direction: 'rising', confidence: 'moderate', slope: 0.8, n: 5 });
    expect(result.rSquared).toBeCloseTo(0.64);
    expect(result.tStatistic).toBeCloseTo(2.309401);
    expect(describeTrendConfidence(result)?.text).toBe('Rising \u00b7 moderate confidence');
  });
});
