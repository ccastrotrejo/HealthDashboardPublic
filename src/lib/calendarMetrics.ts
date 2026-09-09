import { scaleThreshold } from 'd3-scale';
import type { DailyAnalytics } from './types';
import type { TrainingCalendarDay } from './chartRefinement';
import { isCalendarDate, type DateRange } from './exploration';

export type CalendarMetric = 'training' | 'sleep' | 'recovery';

export interface CalendarMetricDay extends TrainingCalendarDay {
  sleep: number | null;
  recovery: number | null;
}

export const CALENDAR_METRICS = {
  training: {
    label: 'Training minutes',
    buckets: ['Rest · 0 min', '> 0–< 30 min', '30–< 60 min', '60–< 120 min', '≥ 120 min'],
  },
  sleep: {
    label: 'Sleep hours',
    buckets: ['0–< 4 h', '4–< 6 h', '6–< 8 h', '8–< 10 h', '≥ 10 h'],
  },
  recovery: {
    label: 'Recovery score',
    buckets: ['0–< 20', '20–< 40', '40–< 60', '60–< 80', '80–100'],
  },
} as const;

const scales = {
  training: scaleThreshold<number, number>().domain([30, 60, 120]).range([1, 2, 3, 4]),
  sleep: scaleThreshold<number, number>().domain([4, 6, 8, 10]).range([0, 1, 2, 3, 4]),
  recovery: scaleThreshold<number, number>().domain([20, 40, 60, 80]).range([0, 1, 2, 3, 4]),
};

function measurement(value: number | null | undefined, max = Infinity): number | null {
  return value != null && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}

/** Join only exact date keys; absent history and null readings never become zero. */
export function joinCalendarMetrics(
  days: TrainingCalendarDay[], trends?: DailyAnalytics['trends'],
): CalendarMetricDay[] {
  const sleep = new Map(trends?.asleepHours.map((point) => [point.date, point.value]));
  const recovery = new Map(trends?.recoveryScore?.map((point) => [point.date, point.value]));
  return days.map((day) => ({
    ...day,
    sleep: measurement(sleep.get(day.date)),
    recovery: measurement(recovery.get(day.date), 100),
  }));
}

export function calendarMetricValue(day: CalendarMetricDay, metric: CalendarMetric): number | null {
  return metric === 'training' ? measurement(day.cell?.minutes) : day[metric];
}

/** Numerical bands only, not health targets or clinical classifications. */
export function calendarMetricBucket(metric: CalendarMetric, value: number | null): number | null {
  const valid = measurement(value, metric === 'recovery' ? 100 : Infinity);
  if (valid == null) return null;
  return metric === 'training' && valid === 0 ? 0 : scales[metric](valid);
}

export function normalizeCalendarRange(range: DateRange | null | undefined): DateRange | null {
  if (!range || !isCalendarDate(range.start) || !isCalendarDate(range.end)) return null;
  return range.start <= range.end ? range : { start: range.end, end: range.start };
}

/** A first endpoint starts a one-day range; reversing endpoints keeps both dates. */
export function calendarRangeFromSelection(
  date: string, edge: 'start' | 'end' | 'day', range: DateRange | null,
): DateRange | null {
  const current = normalizeCalendarRange(range);
  if (!isCalendarDate(date)) return current;
  if (!current || edge === 'day') return { start: date, end: date };
  return normalizeCalendarRange({ ...current, [edge]: date });
}
