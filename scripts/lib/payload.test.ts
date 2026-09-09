/**
 * Prompt payload size.
 *
 * The budget was originally forced by GitHub Models, which capped gpt-4o-mini
 * input at 8,000 tokens and rejected anything larger with HTTP 413 — treated as
 * unretryable, so the generator fell back to its template and, under `--strict`,
 * the workflow failed.
 *
 * That is not hypothetical: the first live run of this pipeline failed exactly
 * this way, at roughly 8,300 tokens. The payload had been expanded to carry the
 * multi-week series the prompts need without anyone measuring the result.
 *
 * GitHub Models was retired on 2026-07-30 and the Copilot CLI that replaced it
 * has a much larger window, so these bounds no longer guard a hard 413. They are
 * kept because the payload still grows on its own, cost still scales with it,
 * and any OpenAI-compatible provider configured through `LLM_API_KEY` may
 * reintroduce a small window at any time.
 *
 * These tests exist because the failure is invisible locally — it only appears
 * against a real provider — and because the payload grows on its own as
 * activities, races and lift sessions accumulate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeDailyAnalytics } from './daily.js';
import { computeLongTermAnalytics, computeWeeklyAnalytics } from './analytics.js';
import { addDays } from '../../utils/date.js';
import {
  PROMPT_TOKEN_BUDGET,
  compactSnapshot,
  estimateTokens,
  fitPayload,
  snapshotForPrompt,
} from './ai-context.js';
import type { Snapshot } from './types.js';

const now = new Date('2026-06-30T12:00:00Z');
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());
const daily = computeDailyAnalytics([], [], [], null, now);
for (const [index, key] of ['hrv', 'rhr', 'sleepHours', 'recovery', 'strain'].entries()) {
  if (!(key in daily.trends)) continue;
  const points = Array.from({ length: 30 }, (_, day) => ({
    date: addDays('2026-06-01', day), value: 40 + index + day / 3,
  }));
  Object.assign(daily.trends, { [key]: points });
}
const weekly = computeWeeklyAnalytics([], now);
weekly.recentActivities = Array.from({ length: 14 }, (_, index) => ({
  id: index + 1, name: `Synthetic session ${index + 1}`, sportType: 'Ride',
  startDateUtc: `${addDays('2026-06-30', -index)}T08:00:00Z`,
  startDateLocal: `${addDays('2026-06-30', -index)}T08:00:00Z`,
  distanceMeters: 12000, movingTimeSeconds: 2400, averagePaceSecPerKm: null,
  averageHeartrate: 120, intensity: 'easy', source: 'strava',
}));
const snapshot: Snapshot = {
  syncedAt: now.toISOString(), pipelineVersion: 'synthetic-test',
  counts: { recoveries: 0, sleeps: 0, cycles: 0, workouts: 0, activities: 14, garminDays: 0 },
  daily, weekly, longTerm: computeLongTermAnalytics([], now), garmin: null,
};

describe('prompt payload budget', () => {
  it('keeps the synthetic snapshot inside the budget', () => {
    expect(estimateTokens(snapshotForPrompt(snapshot))).toBeLessThanOrEqual(PROMPT_TOKEN_BUDGET);
  });

  it('leaves the whole prompt inside a conservative provider window', () => {
    // Budget covers the snapshot only; the system prompt, athlete brief and
    // facts block add roughly 2,200 more.
    //
    // This previously asserted 6,500, which tracked the 8,000-token GitHub
    // Models cap and retired with it. 10,000 replaces it: comfortably inside the
    // smallest window a modern OpenAI-compatible provider is likely to expose,
    // and a bound on per-call cost now that no provider limit supplies one.
    expect(PROMPT_TOKEN_BUDGET + 2200).toBeLessThanOrEqual(10_000);
  });

  it.each(['daily', 'weekly', 'monthly'] as const)(
    'keeps the %s payload inside the budget',
    (detail) => {
      expect(estimateTokens(snapshotForPrompt(snapshot, detail))).toBeLessThanOrEqual(
        PROMPT_TOKEN_BUDGET,
      );
    },
  );

  it('sends the daily tasks less trend history than the monthly pass', () => {
    const daily = compactSnapshot(snapshot, 'daily');
    const monthly = compactSnapshot(snapshot, 'monthly');
    expect(daily.daily!.trends.hrv!.v.length).toBeLessThan(monthly.daily!.trends.hrv!.v.length);
  });

  it('gives only the Sunday review a full fortnight of sessions', () => {
    const weekly = compactSnapshot(snapshot, 'weekly');
    const daily = compactSnapshot(snapshot, 'daily');
    expect(weekly.weekly!.recentActivities.length).toBeGreaterThan(
      daily.weekly!.recentActivities.length,
    );
  });

  it('estimates JSON density, not prose density', () => {
    // Measured against a real request: 2.6 chars/token. The prose rule of thumb
    // (4) underestimated an over-limit prompt by nearly half.
    expect(estimateTokens('x'.repeat(2600))).toBe(1000);
  });

  it.each(['daily', 'weekly', 'monthly'] as const)(
    'does not thin the %s payload — it is sized to fit as built',
    (detail) => {
      // Thinning on an ordinary run means quietly shipping less data than the
      // prompts were designed around. Only `daily` was asserted here before,
      // which is how the weekly payload reached 5,297 tokens against a 4,000
      // budget and thinned on every Sunday run without failing anything.
      expect(fitPayload(snapshot, PROMPT_TOKEN_BUDGET, detail).dropped).toEqual([]);
    },
  );

  it('thins progressively when the budget is tight, cheapest sections first', () => {
    const { dropped } = fitPayload(snapshot, 500);
    expect(dropped.length).toBeGreaterThan(0);
    // Garmin step counts go before the training data the prompts reason over.
    expect(dropped[0]).toContain('garmin');
    expect(dropped.join(' ')).not.toMatch(/^weekly|^daily\.trends/);
  });

  it('shrinks as far as it can when forced to an aggressive budget', () => {
    const full = estimateTokens(JSON.stringify(fitPayload(snapshot, PROMPT_TOKEN_BUDGET, 'monthly').payload));
    const { payload, dropped } = fitPayload(snapshot, 1, 'monthly');
    const thin = estimateTokens(JSON.stringify(payload));

    // Thinning is best-effort: a core of always-included fields (today's
    // recovery, sleep, the call, the load ratios) is not reducible, so this
    // asserts real reduction and full effort rather than a guarantee it cannot
    // make. Exceeding budget after all steps logs a warning.
    expect(thin).toBeLessThan(full);
    expect(dropped.length).toBe(7);
  });
});

describe('series packing', () => {
  const packed = compactSnapshot(snapshot) as {
    daily: { trends: Record<string, { from: string; v: Array<number | null> } | undefined> };
    longTerm: { fitnessCurve?: { from: string; ctl: number[] } };
  };

  it('packs a trend as a start date plus consecutive values', () => {
    const hrv = packed.daily.trends['hrv'];
    expect(hrv).toBeDefined();
    expect(hrv!.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(hrv!.v)).toBe(true);
    expect(hrv!.v.length).toBeGreaterThan(10);
  });

  it('strips the float noise vendors ship', () => {
    // Provider precision is intentionally reduced before entering a prompt.
    for (const value of packed.daily.trends['hrv']?.v ?? []) {
      if (value == null) continue;
      expect(Number.isInteger(value)).toBe(true);
    }
    for (const ctl of packed.longTerm.fitnessCurve?.ctl ?? []) {
      expect(Number(ctl.toFixed(1))).toBe(ctl);
    }
  });

  it('omits a series that has no readings at all rather than sending nulls', () => {
    for (const [, series] of Object.entries(packed.daily.trends)) {
      if (series === undefined) continue;
      expect(series.v.some((x) => x != null)).toBe(true);
    }
  });

  it('is materially smaller than the per-point object encoding it replaced', () => {
    const hrv = packed.daily.trends['hrv']!;
    const asObjects = JSON.stringify(
      hrv.v.map((value, i) => ({ date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`, value })),
    );
    expect(JSON.stringify(hrv).length).toBeLessThan(asObjects.length / 3);
  });
});
