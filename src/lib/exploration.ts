import { utcDay } from 'd3-time';
import { chartDateTime, shiftChartDate } from './chartRefinement';
import { correlate, pairSeries, type PairedPoint } from './correlation';
import type { DailyAnalytics, DailyTrendPoint, FitnessPoint } from './types';

export interface DateRange {
  start: string;
  end: string;
}

export type ExplorationMetric = 'asleepHours' | 'hrv' | 'rhr' | 'dayStrain' | 'recoveryScore' | 'sleepEfficiency';

export const EXPLORATION_METRICS: readonly {
  key: ExplorationMetric; label: string; unit: string; decimals: number;
}[] = [
  { key: 'asleepHours', label: 'Sleep', unit: 'h', decimals: 1 },
  { key: 'hrv', label: 'HRV', unit: 'ms', decimals: 0 },
  { key: 'rhr', label: 'RHR', unit: 'bpm', decimals: 0 },
  { key: 'dayStrain', label: 'Day strain', unit: '', decimals: 1 },
  { key: 'recoveryScore', label: 'Recovery', unit: '%', decimals: 0 },
  { key: 'sleepEfficiency', label: 'Sleep efficiency', unit: '%', decimals: 0 },
];

export function isCalendarDate(value: string): boolean {
  const time = chartDateTime(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(time)
    && new Date(time).toISOString().slice(0, 10) === value;
}

export function inDateRange(date: string, range: DateRange | null): boolean {
  return !range || (date >= range.start && date <= range.end);
}

/** Inspecting an outside date preserves the existing endpoints for calendar range controls. */
export function includeExplorationDate(date: string, range: DateRange | null): DateRange {
  return {
    start: range && range.start < date ? range.start : date,
    end: range && range.end > date ? range.end : date,
  };
}

/** Ordered, scale-clamped brush instants become inclusive UTC calendar dates. */
export function brushDateRange(startTime: Date, endTime: Date, lastDate: string): DateRange {
  const start = startTime.toISOString().slice(0, 10);
  const end = new Date(Math.max(+startTime, +endTime - 1)).toISOString().slice(0, 10);
  return { start: start > lastDate ? lastDate : start, end: end > lastDate ? lastDate : end };
}

/** Test hit selection in rendered coordinates, including points on the brush boundary. */
export function correlationDatesInBrush(
  points: readonly PairedPoint[],
  [[x0, y0], [x1, y1]]: [[number, number], [number, number]],
  x: (value: number) => number,
  y: (value: number) => number,
): string[] {
  return points.filter((point) => x(point.x) >= x0 && x(point.x) <= x1 && y(point.y) >= y0 && y(point.y) <= y1)
    .map((point) => point.date);
}

export function formatExplorationDate(date: string): string {
  return new Date(chartDateTime(date)).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

/** Inclusive calendar dates, independent of browser timezone and daylight saving. */
export function dateRangeDays(range: DateRange): string[] {
  if (!isCalendarDate(range.start) || !isCalendarDate(range.end) || range.start > range.end) return [];
  return utcDay.range(new Date(chartDateTime(range.start)), new Date(chartDateTime(shiftChartDate(range.end, 1))))
    .map((date) => date.toISOString().slice(0, 10));
}

export function trendRange(trends: DailyAnalytics['trends']): DateRange | null {
  const dates = Object.values(trends).flatMap((series) => series?.map((point) => point.date) ?? [])
    .filter(isCalendarDate).sort();
  return dates.length ? { start: dates[0]!, end: dates.at(-1)! } : null;
}

export function metricPairs(
  trends: DailyAnalytics['trends'], x: ExplorationMetric, y: ExplorationMetric,
  lag: number, range: DateRange | null,
) {
  // Both dates must belong to the selected period; a lag must not pull hidden observations into it.
  return pairSeries(trends[x] ?? [], trends[y] ?? [], lag)
    .filter((point) => inDateRange(point.date, range) && inDateRange(shiftChartDate(point.date, lag), range));
}

export function correlationMatrix(trends: DailyAnalytics['trends'], lag: number, range: DateRange | null) {
  return EXPLORATION_METRICS.map((x) => EXPLORATION_METRICS.map((y) => {
    const points = metricPairs(trends, x.key, y.key, lag, range);
    return { x: x.key, y: y.key, ...correlate(points) };
  }));
}

export interface ExplorerDay {
  date: string;
  load: number | null;
  asleepHours: number | null;
  hrv: number | null;
  recoveryScore: number | null;
}

/** Missing samples stay null, including days omitted by a source altogether. */
export function explorerDays(trends: DailyAnalytics['trends'], fitness: FitnessPoint[], range: DateRange): ExplorerDay[] {
  const series = (points: DailyTrendPoint[]) => new Map(points.map((point) => [point.date, point.value]));
  const sleep = series(trends.asleepHours);
  const hrv = series(trends.hrv);
  const recovery = series(trends.recoveryScore ?? []);
  const loads = new Map(fitness.map((point) => [point.date, point.load]));
  const finite = (value: number | null | undefined) => value != null && Number.isFinite(value) ? value : null;
  return dateRangeDays(range).map((date) => ({
    date, load: finite(loads.get(date)), asleepHours: finite(sleep.get(date)),
    hrv: finite(hrv.get(date)), recoveryScore: finite(recovery.get(date)),
  }));
}
