import { describe, expect, it } from 'vitest';
import {
  formatDuration, formatKm, formatNumber, formatPace, formatRelativeTime,
  formatShortDate, formatSpeed, sportLabel,
} from './format';

const unavailable = '\u2014';

describe('measurement formatting', () => {
  it('uses locale grouping and retains the requested precision across calls', () => {
    for (const digits of [0, 2, 1, 0, 2]) {
      expect(formatNumber(1234.567, digits)).toBe(new Intl.NumberFormat(undefined, {
        minimumFractionDigits: digits, maximumFractionDigits: digits,
      }).format(1234.567));
    }
  });

  it('converts meters and selects precision at ten kilometers', () => {
    expect(formatKm(0)).toBe(`${formatNumber(0, 2)} km`);
    expect(formatKm(5000)).toBe(`${formatNumber(5, 2)} km`);
    expect(formatKm(10000)).toBe(`${formatNumber(10, 1)} km`);
    expect(formatKm(42195)).toBe(`${formatNumber(42.195, 1)} km`);
  });

  it.each([
    [323, '5:23 /km'], [359.49, '5:59 /km'], [359.5, '6:00 /km'],
    [59.9, '1:00 /km'], [60, '1:00 /km'],
  ])('formats pace %s without a sixty-second remainder', (seconds, expected) => {
    expect(formatPace(seconds)).toBe(expected);
  });

  it.each([null, 0, -1, NaN, Infinity, -Infinity])('rejects unavailable pace %s', (value) => {
    expect(formatPace(value)).toBe(unavailable);
  });

  it.each([
    [0, '0s'], [47.4, '47s'], [59.5, '1m 0s'], [1394, '23m 14s'],
    [3599.5, '1h 0m'], [4980, '1h 23m'], [90000, '25h 0m'],
  ])('formats duration %s with one rounding step', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it.each([-1, NaN, Infinity, -Infinity])('rejects invalid duration %s', (value) => {
    expect(formatDuration(value)).toBe(unavailable);
  });

  it('converts speed to km/h and rejects nonpositive or nonfinite speeds', () => {
    expect(formatSpeed(5)).toBe(`${formatNumber(18, 1)} km/h`);
    for (const value of [0, -1, NaN, Infinity]) expect(formatSpeed(value)).toBe(unavailable);
  });

  it('separates PascalCase sport names without altering existing spaces', () => {
    expect(sportLabel('MountainBikeRide')).toBe('Mountain Bike Ride');
    expect(sportLabel('Run')).toBe('Run');
    expect(sportLabel('Open Water Swim')).toBe('Open Water Swim');
    expect(sportLabel('')).toBe('');
  });
});

describe('date formatting', () => {
  const now = new Date('2026-09-06T12:00:00Z');

  it.each([
    [-60, 'just now'], [0, 'just now'], [29, 'just now'], [30, '30s ago'],
    [59, '59s ago'], [60, '1m ago'], [3600, '1h ago'],
    [86400, 'yesterday'], [3 * 86400, '3d ago'],
  ])('formats an age of %s seconds', (seconds, expected) => {
    expect(formatRelativeTime(new Date(now.getTime() - seconds * 1000).toISOString(), now))
      .toBe(expected);
  });

  it('uses a calendar label for older dates and locale-aware short dates', () => {
    const iso = '2026-08-01T12:00:00Z';
    expect(formatRelativeTime(iso, now)).toBe(new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric',
    }));
    expect(formatShortDate(iso)).toBe(new Date(iso).toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
    }));
  });
});
