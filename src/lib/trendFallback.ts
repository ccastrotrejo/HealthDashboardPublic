import type { DailyTrendPoint } from './types';

/**
 * Returns the most recent non-null trend point, walking backward from the end.
 * Useful when a "today" metric is null (e.g. Garmin hasn't computed Body
 * Battery yet, or the watch hasn't synced today's steps) — we'd rather show
 * the most recent real value with an "as of <date>" label than a "—".
 */
export function latestNonNull(
  trend: DailyTrendPoint[] | undefined | null,
): { value: number; date: string } | null {
  if (!trend) return null;
  for (let i = trend.length - 1; i >= 0; i--) {
    const p = trend[i];
    if (p && p.value != null) return { value: p.value, date: p.date };
  }
  return null;
}

/**
 * Short, locale-friendly "as of" date label. "May 23" for recent days, falls
 * back to ISO when older than a year (unlikely in this app).
 */
export function asOfLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
