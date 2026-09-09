import { describe, expect, it } from 'vitest';
import { mean } from './statistics';

describe('shared statistics', () => {
  it('distinguishes absent observations from measured zero', () => {
    expect(mean([])).toBeNull();
    expect(mean([0])).toBe(0);
  });

  it('handles singleton, negative, and fractional observations', () => {
    expect(mean([12])).toBe(12);
    expect(mean([-10, 0, 10])).toBe(0);
    expect(mean([0.1, 0.2, 0.3])).toBeCloseTo(0.2);
  });

  it('accepts readonly observations without mutating them', () => {
    const values = Object.freeze([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(mean(values)).toBe(5);
    expect(values).toEqual([2, 4, 4, 4, 5, 5, 7, 9]);
  });

  it('is independent of sample order and shifts with a constant offset', () => {
    const values = [2, 5, 8, 3];
    expect(mean([...values].reverse())).toBe(mean(values));
    expect(mean(values.map((value) => value + 10))).toBe(mean(values)! + 10);
  });

  it('does not silently drop invalid observations or replace them with zero', () => {
    expect(mean([1, NaN])).toBeNaN();
    expect(mean([1, Infinity])).toBe(Infinity);
  });
});
