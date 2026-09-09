/**
 * Pure, dependency-free correlation helpers.
 *
 * These power the Correlations panel but are deliberately UI-agnostic and
 * side-effect free so they can be unit-tested in isolation. No `any`.
 */

import type { DailyTrendPoint } from './types';
import { addDays } from '../../utils/date';

export { addDays };

/** A single paired observation used for scatter plotting + correlation. */
export interface PairedPoint {
  /** The date the X value was measured (YYYY-MM-DD, UTC). */
  date: string;
  x: number;
  y: number;
}

/** Qualitative reading of a Pearson r, split into magnitude + direction. */
export type CorrelationStrength =
  | 'none'
  | 'negligible'
  | 'weak'
  | 'moderate'
  | 'strong'
  | 'very strong';

export interface CorrelationResult {
  /** Pearson r in [-1, 1], or null when it can't be computed (n < 3 or no variance). */
  r: number | null;
  /** Number of paired samples used. */
  n: number;
  /** Magnitude bucket, ignoring sign. */
  strength: CorrelationStrength;
  /** Plain-language reading, e.g. "moderate positive". */
  label: string;
}

/**
 * Pearson product-moment correlation coefficient.
 *
 * Returns null when there are fewer than 3 pairs or when either variable has
 * zero variance (r is undefined in that case). Guards against NaN/Infinity.
 */
export function pearson(points: readonly PairedPoint[]): number | null {
  const n = points.length;
  if (n < 3) return null;

  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  const denom = Math.sqrt(varX * varY);
  if (denom === 0) return null;

  const r = cov / denom;
  if (!Number.isFinite(r)) return null;
  // Clamp tiny floating-point overshoots past ±1.
  return Math.max(-1, Math.min(1, r));
}

/** Magnitude bucket for |r|, following common effect-size conventions. */
export function strengthOf(r: number): CorrelationStrength {
  const a = Math.abs(r);
  if (a < 0.1) return 'negligible';
  if (a < 0.3) return 'weak';
  if (a < 0.5) return 'moderate';
  if (a < 0.7) return 'strong';
  return 'very strong';
}

/** Plain-language reading of r, e.g. "moderate positive" or "no correlation". */
export function describeCorrelation(r: number | null): string {
  if (r === null) return 'not enough data';
  const strength = strengthOf(r);
  if (strength === 'negligible') return 'no meaningful correlation';
  const direction = r > 0 ? 'positive' : 'negative';
  return `${strength} ${direction}`;
}

/** Full correlation summary for a set of paired points. */
export function correlate(points: readonly PairedPoint[]): CorrelationResult {
  const r = pearson(points);
  return {
    r,
    n: points.length,
    strength: r === null ? 'none' : strengthOf(r),
    label: describeCorrelation(r),
  };
}

/**
 * Build paired samples from two daily series aligned by date.
 *
 * With `lagDays = 0`, X and Y are taken from the same calendar day. With
 * `lagDays = 1`, Y is taken from the day *after* X (X on day d vs Y on day
 * d+1) — used for physiological lags like "today's strain vs tomorrow's RHR".
 *
 * Only days where BOTH values exist (non-null, finite) are returned, so the
 * result is safe to feed straight into `pearson`/`correlate`.
 */
export function pairSeries(
  xSeries: readonly DailyTrendPoint[],
  ySeries: readonly DailyTrendPoint[],
  lagDays = 0,
): PairedPoint[] {
  const yByDate = new Map<string, number>();
  for (const p of ySeries) {
    if (p.value !== null && Number.isFinite(p.value)) {
      yByDate.set(p.date, p.value);
    }
  }

  const paired: PairedPoint[] = [];
  for (const p of xSeries) {
    if (p.value === null || !Number.isFinite(p.value)) continue;
    const targetDate = lagDays === 0 ? p.date : addDays(p.date, lagDays);
    const y = yByDate.get(targetDate);
    if (y === undefined) continue;
    paired.push({ date: p.date, x: p.value, y });
  }
  return paired;
}
