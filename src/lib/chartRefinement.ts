import type {
  AcwrResult, DailyTrainingCell, DailyTrendPoint, FitnessPoint,
  PrEffort, WeeklyVolume, YearCumulativePoint,
} from './types';
import { DAY_MS, utcDateTime as chartDateTime, addDays as shiftChartDate } from '../../utils/date';

export { chartDateTime, shiftChartDate };

/** The displayed week never contributes to its own completed-week comparator. */
export function weeklyVolumeSummary(data: WeeklyVolume[], now: number) {
  const weeks = [...data].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const latest = weeks.at(-1);
  const previous = weeks.slice(-5, -1);
  const average = previous.length
    ? previous.reduce((sum, week) => sum + week.km, 0) / previous.length
    : null;
  return {
    weeks, latest, average, comparisonWeeks: previous.length,
    partial: latest != null && now >= chartDateTime(latest.weekStart)
      && now < chartDateTime(latest.weekStart) + 7 * DAY_MS,
    deltaPct: latest && average != null && average > 0
      ? ((latest.km - average) / average) * 100 : null,
  };
}

export function acwrRatioToPercent(ratio: number): number {
  return Number.isFinite(ratio) ? Math.max(0, Math.min(2, ratio)) * 50 : 0;
}

export function acwrUnitLabel(unit: AcwrResult['unit'] = 'km'): string {
  return unit === 'strain' ? 'strain units' : unit === 'sRPE' ? 'sRPE units' : 'km';
}

/** Fill missing dates with null, not zero; seven entries need not mean seven days. */
export function stepsCalendarWeek(trend: DailyTrendPoint[], today: string): DailyTrendPoint[] {
  const byDate = new Map(trend.map((point) => [point.date, point.value]));
  return Array.from({ length: 7 }, (_, index) => {
    const date = shiftChartDate(today, index - 6);
    const value = byDate.get(date);
    return { date, value: value != null && Number.isFinite(value) ? value : null };
  });
}

export function stepGoalState(value: number | null, goal: number | null, today: boolean) {
  if (value == null || goal == null || !Number.isFinite(goal) || goal <= 0) return 'uncompared';
  if (today) return 'today';
  return value >= goal ? 'met' : 'below';
}

/** Explicit null rows break paths across unobserved dates; no interpolation is added. */
export function fitnessPlotSeries(data: FitnessPoint[]) {
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((point) => [point.date, point]));
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return [];
  const count = Math.round((chartDateTime(last.date) - chartDateTime(first.date)) / DAY_MS) + 1;
  return Array.from({ length: count }, (_, index) => {
    const date = shiftChartDate(first.date, index);
    const point = byDate.get(date);
    return {
      date, timestamp: chartDateTime(date),
      ctl: point && Number.isFinite(point.ctl) ? point.ctl : null,
      atl: point && Number.isFinite(point.atl) ? point.atl : null,
      tsb: point && Number.isFinite(point.tsb) ? point.tsb : null,
    };
  });
}

/** Keep all efforts at their true timestamps; records change only at an effort. */
export function prPlotSeries(efforts: PrEffort[]) {
  let best = Infinity;
  return efforts
    .filter((effort) => Number.isFinite(chartDateTime(effort.date))
      && Number.isFinite(effort.paceSecPerKm) && effort.paceSecPerKm > 0)
    .map((effort) => ({ ...effort, timestamp: chartDateTime(effort.date) }))
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((effort) => {
      best = Math.min(best, effort.paceSecPerKm);
      return { ...effort, best };
    });
}

/** Align the reported day ordinals, including gaps; labels use each actual year. */
export function yearComparisonSeries(thisYear: YearCumulativePoint[], lastYear: YearCumulativePoint[]) {
  const current = new Map(thisYear.map((point) => [point.doy, point.km]));
  const previous = new Map(lastYear.map((point) => [point.doy, point.km]));
  const lastDay = Math.max(-1, ...current.keys(), ...previous.keys());
  return Array.from({ length: lastDay + 1 }, (_, doy) => ({
    doy, thisYear: current.get(doy) ?? null, lastYear: previous.get(doy) ?? null,
  }));
}

export function yearOrdinalDate(year: number, doy: number): string {
  return new Date(Date.UTC(year, 0, doy + 1)).toISOString().slice(0, 10);
}

/** Round once to avoid impossible clock labels such as 23:60. */
export function formatChartClock(hour: number): string {
  if (!Number.isFinite(hour)) return '—';
  const minutes = ((Math.round(hour * 60) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export interface TrainingCalendarDay {
  date: string;
  cell: DailyTrainingCell | null;
}

/** Preserve missing days as unknown, distinct from explicitly recorded rest. */
export function trainingCalendarDays(data: DailyTrainingCell[]): TrainingCalendarDay[] {
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.at(-1);
  const first = sorted[0];
  if (!first || !last) return [];
  const start = first.date > shiftChartDate(last.date, -364)
    ? first.date : shiftChartDate(last.date, -364);
  const byDate = new Map(sorted.map((cell) => [cell.date, cell]));
  const count = Math.round((chartDateTime(last.date) - chartDateTime(start)) / DAY_MS) + 1;
  return Array.from({ length: count }, (_, index) => {
    const date = shiftChartDate(start, index);
    return { date, cell: byDate.get(date) ?? null };
  });
}

export function calendarArrowDate(date: string, key: string, first: string, last: string): string {
  const offset: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
  const next = key === 'Home' ? first : key === 'End' ? last
    : shiftChartDate(date, offset[key] ?? 0);
  return next < first ? first : next > last ? last : next;
}
