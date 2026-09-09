import { describe, expect, it } from 'vitest';
import { aiStatus, AI_STALE_AFTER_HOURS, formatAge, lookup } from './aiMeta';
import type { AiProvenance } from './types';

const now = new Date('2026-09-06T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

describe('artifact age', () => {
  it.each([
    [-1, 'just now'], [0, 'just now'], [1 / 60, '1m ago'], [1, '1h ago'],
    [24, '1 day ago'], [48, '2 days ago'], [14 * 24, '2 weeks ago'],
    [56 * 24, '8 weeks ago'], [60 * 24, '2 months ago'], [90 * 24, '3 months ago'],
  ])('formats %s hours of age', (hours, expected) => {
    expect(formatAge(hoursAgo(hours), now)).toBe(expected);
  });

  it('labels unparseable dates as unknown', () => {
    expect(formatAge('invalid', now)).toBe('unknown');
    expect(formatAge(now.toISOString(), new Date(NaN))).toBe('unknown');
  });
});

describe('artifact provenance', () => {
  it.each(Object.entries(AI_STALE_AFTER_HOURS))('uses the %s cadence of %i hours', (artifact, hours) => {
    const data = { model: 'llm:test', generatedAt: hoursAgo(hours) };
    expect(aiStatus(data, artifact, now).isStale).toBe(false);
    expect(aiStatus({ ...data, generatedAt: hoursAgo(hours + 1 / 3600) }, artifact, now).isStale).toBe(true);
  });

  it('uses the default freshness budget for unknown artifact kinds', () => {
    expect(aiStatus({ model: 'llm:test', generatedAt: hoursAgo(37) }, 'future-artifact', now).isStale).toBe(true);
  });

  it('separates generation fallback, stale source data and artifact age', () => {
    const data: AiProvenance = {
      generatedAt: hoursAgo(1), model: 'template', fallbackReason: 'No provider', dataStale: true,
    };
    expect(aiStatus(data, 'insights', now)).toEqual({
      isTemplate: true, fallbackReason: 'No provider', isStale: false,
      fromStaleData: true, ageHours: 1, relative: '1h ago',
    });
    expect(aiStatus({ ...data, model: 'llm:test', isTemplate: true }, 'insights', now).isTemplate).toBe(true);
    expect(aiStatus({ ...data, model: 'llm:test', dataStale: false }, 'insights', now))
      .toMatchObject({ isTemplate: false, fromStaleData: false });
  });

  it('clamps runner clock skew to a nonnegative age', () => {
    expect(aiStatus({ model: 'llm:test', generatedAt: hoursAgo(-1) }, 'insights', now))
      .toMatchObject({ ageHours: 0, isStale: false, relative: 'just now' });
  });

  it('retains the public lookup API while preserving valid falsy entries', () => {
    expect(lookup({ zero: 0 }, 'zero', 1)).toBe(0);
    expect(lookup({ ready: 'Ready' }, 'toString', 'Unknown')).toBe('Unknown');
  });
});
