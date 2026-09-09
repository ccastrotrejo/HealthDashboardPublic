import type { FitnessProjection } from '../../lib/races';
import type { RaceEvent } from '../../lib/types';
import { DAY_MS, utcDateTime } from '../../../utils/date';

/** Keep countdowns and race ordering on the same UTC calendar-day boundary. */
export function raceDaysUntil(date: string, now: Date): number {
  const today = now.toISOString().slice(0, 10);
  return Math.round((utcDateTime(date) - utcDateTime(today)) / DAY_MS);
}

/** Prefer the next event; without one, lead with the newest recorded result. */
export function orderRaceDisplay(races: RaceEvent[], now: Date) {
  const upcoming = races
    .filter((race) => raceDaysUntil(race.date, now) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const past = races
    .filter((race) => raceDaysUntil(race.date, now) < 0)
    .sort((a, b) => b.date.localeCompare(a.date));
  const primary = upcoming[0] ?? past.find((race) => race.result != null) ?? past[0] ?? null;
  return { upcoming, past, primary };
}

/** Share only the final observed point so the dashed forecast joins the solid line. */
export function segmentRaceForecast(series: FitnessProjection['series']) {
  const firstForecast = series.findIndex((point) => point.projected);
  const boundaryIndex = firstForecast < 0 ? series.length - 1 : firstForecast - 1;
  const rows = series.map((point, index) => ({
    ...point,
    observedCtl: point.projected ? null : point.ctl,
    forecastCtl: point.projected || (firstForecast >= 0 && index === boundaryIndex) ? point.ctl : null,
  }));
  return { rows, boundaryDate: series[boundaryIndex]?.date ?? null };
}

/** SVG gradient transition at zero, including entirely positive/negative series. */
export function raceTsbZeroOffset(values: number[]): number {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  return max === min ? 1 : max / (max - min);
}

export function formatRaceDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Estimates round to seconds; recorded results can retain published hundredths. */
export function formatRaceTime(seconds: number, precision: 0 | 2 = 0): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const scale = 10 ** precision;
  const ticks = Math.round(seconds * scale);
  const total = Math.floor(ticks / scale);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const fraction = ticks % scale;
  const remainder = String(total % 60).padStart(2, '0') +
    (fraction > 0 ? `.${String(fraction).padStart(precision, '0')}` : '');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
    : `${minutes}:${remainder}`;
}
