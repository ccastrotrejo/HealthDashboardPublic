/**
 * Pure statistical helper: is a numeric trend genuinely moving, or is the
 * apparent slope just day-to-day noise?
 *
 * Fits an ordinary-least-squares line to the series, derives the slope's
 * standard error, and classifies the trend by the slope's t-statistic
 * (slope / standard error). Larger |t| means the signal beats the noise.
 *
 * No side effects, no `any` — trivially unit-testable in isolation.
 */

export type TrendDirection = 'rising' | 'falling' | 'flat';

/** How much to trust the direction call. */
export type TrendConfidenceLevel = 'high' | 'moderate' | 'low' | 'insufficient';

export interface TrendConfidence {
  direction: TrendDirection;
  confidence: TrendConfidenceLevel;
  /** OLS slope, in series-units per step (≈ per day for a daily series). */
  slope: number;
  /** Standard error of the slope estimate. */
  slopeStdError: number;
  /** t = slope / slopeStdError. |t| grows as the signal beats the noise. */
  tStatistic: number;
  /** Coefficient of determination, 0–1. Share of variance the line explains. */
  rSquared: number;
  /** Count of real (non-null, finite) points used in the fit. */
  n: number;
}

/** A point that carries a possibly-missing value (matches DailyTrendPoint). */
interface ValuePoint {
  value: number | null;
}

type SeriesPoint = number | null | ValuePoint;

/** Minimum real points before a fit is worth attempting. */
const MIN_POINTS = 4;

/**
 * |t| thresholds for the direction/confidence call. Roughly: 2 ≈ 95% that the
 * slope isn't zero for a small daily series; 3.5+ is a strong signal.
 */
const T_MODERATE = 2;
const T_HIGH = 3.5;

function readValue(point: SeriesPoint): number | null {
  if (point === null || typeof point === 'number') return point;
  return point.value;
}

/**
 * Classify a (possibly gappy) numeric series. Accepts either raw numbers or
 * `{ value }` points, so it drops straight onto the dashboard's
 * `DailyTrendPoint[]`. Missing days are skipped but keep their x-position, so
 * gaps don't distort the slope.
 */
export function trendConfidence(series: ReadonlyArray<SeriesPoint>): TrendConfidence {
  const xs: number[] = [];
  const ys: number[] = [];
  series.forEach((point, i) => {
    const v = readValue(point);
    if (v != null && Number.isFinite(v)) {
      xs.push(i);
      ys.push(v);
    }
  });

  const n = ys.length;
  const insufficient: TrendConfidence = {
    direction: 'flat',
    confidence: 'insufficient',
    slope: 0,
    slopeStdError: 0,
    tStatistic: 0,
    rSquared: 0,
    n,
  };
  if (n < MIN_POINTS) return insufficient;

  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return insufficient; // every reading on the same day — can't fit

  const slope = sxy / sxx;

  // Residual sum of squares via SST − SSR (SSR = slope · Sxy).
  const sse = Math.max(0, syy - slope * sxy);
  const rSquared = syy === 0 ? 1 : Math.max(0, Math.min(1, 1 - sse / syy));

  // Standard error of the slope, on n−2 degrees of freedom.
  const residualVariance = sse / (n - 2);
  const slopeStdError = Math.sqrt(residualVariance / sxx);

  let tStatistic: number;
  if (slopeStdError === 0) {
    // Perfect fit: a flat line has zero signal, any tilt is infinite signal.
    tStatistic = slope === 0 ? 0 : slope > 0 ? Infinity : -Infinity;
  } else {
    tStatistic = slope / slopeStdError;
  }

  const absT = Math.abs(tStatistic);
  if (absT < T_MODERATE) {
    return {
      direction: 'flat',
      confidence: 'low',
      slope,
      slopeStdError,
      tStatistic,
      rSquared,
      n,
    };
  }

  const direction: TrendDirection = slope > 0 ? 'rising' : 'falling';
  const confidence: TrendConfidenceLevel = absT >= T_HIGH ? 'high' : 'moderate';
  return { direction, confidence, slope, slopeStdError, tStatistic, rSquared, n };
}

/**
 * Short, presentation-agnostic phrasing for a classification — shared by the
 * card hint and the drill-down modal so the wording never drifts. Returns
 * `null` when there isn't enough data to say anything.
 */
export function describeTrendConfidence(
  c: TrendConfidence,
): { arrow: string; text: string } | null {
  if (c.confidence === 'insufficient') return null;
  const arrow = c.direction === 'rising' ? '↗' : c.direction === 'falling' ? '↘' : '→';
  if (c.direction === 'flat') return { arrow, text: 'Flat · likely noise' };
  const dir = c.direction === 'rising' ? 'Rising' : 'Falling';
  const conf = c.confidence === 'high' ? 'high confidence' : 'moderate confidence';
  return { arrow, text: `${dir} · ${conf}` };
}
