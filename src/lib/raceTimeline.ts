import { phaseFor, type RacePhase } from './races';
import type { RaceEvent } from './types';

const DAY = 86_400_000;

export type PreparationPhase = Exclude<RacePhase, 'race-day' | 'past'>;
export type RaceTimelineRange = 'calendar' | 'selected';

export interface PreparationBand {
  phase: PreparationPhase;
  /** UTC boundaries, with an exclusive end. Base is clipped to the visible range. */
  start: number;
  end: number;
}

export interface RaceTimelineLane {
  race: RaceEvent;
  date: number;
  bands: PreparationBand[];
}

export interface RaceTimelineModel {
  start: number;
  end: number;
  lanes: RaceTimelineLane[];
  omittedCount: number;
}

/** Reject normalized dates such as February 30 rather than plotting a different day. */
export function raceTimelineDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === value
    ? date
    : null;
}

/** Derive every transition from phaseFor; all bands remain guidance, never observed training. */
export function racePreparationBands(race: RaceEvent, start: number, end: number): PreparationBand[] {
  const date = raceTimelineDate(race.date);
  if (race.type !== 'race' || date === null || start >= end) return [];
  const bands: PreparationBand[] = [];
  let days = 1;
  while (true) {
    const phase = phaseFor(days, race.priority) as PreparationPhase;
    const bandEnd = date - (days - 1) * DAY;
    if (phase !== 'base') {
      while (phaseFor(days + 1, race.priority) === phase) days++;
    }
    const bandStart = phase === 'base' ? start : date - days * DAY;
    const clippedStart = Math.max(start, bandStart);
    const clippedEnd = Math.min(end, bandEnd);
    if (clippedStart < clippedEnd) {
      bands.push({ phase, start: clippedStart, end: clippedEnd });
    }
    if (phase === 'base') break;
    days++;
  }
  return bands.reverse();
}

/** Choose a stable selection without treating an elapsed date as a recorded result. */
export function selectedTimelineRace(races: readonly RaceEvent[], selectedId: string, today: number): RaceEvent | null {
  const valid = races.filter((race) => raceTimelineDate(race.date) !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  return valid.find((race) => race.id === selectedId)
    ?? valid.find((race) => raceTimelineDate(race.date)! >= today)
    ?? [...valid].reverse().find((race) => race.result != null)
    ?? valid[valid.length - 1]
    ?? null;
}

/** Show the supplied events only; a selected-event window clips lanes without inventing dates. */
export function buildRaceTimeline(
  races: readonly RaceEvent[],
  selected: RaceEvent | null,
  range: RaceTimelineRange,
): RaceTimelineModel | null {
  const valid = races.flatMap((race) => {
    const date = raceTimelineDate(race.date);
    return date === null ? [] : [{ race, date }];
  }).sort((a, b) => a.date - b.date);
  const first = valid[0];
  const last = valid[valid.length - 1];
  if (!first || !last) return null;
  const selectedDate = selected ? raceTimelineDate(selected.date) : null;
  const focused = range === 'selected' && selectedDate !== null;
  const start = (focused ? selectedDate : first.date) - 98 * DAY;
  const end = (focused ? selectedDate : last.date) + 7 * DAY;
  return {
    start,
    end,
    lanes: valid.map(({ race, date }) => ({ race, date, bands: racePreparationBands(race, start, end) })),
    omittedCount: races.length - valid.length,
  };
}

/** Use a minimum nine pixels per day so a seven-day phase never becomes an unreadable sliver. */
export function raceTimelineWidth(start: number, end: number, containerWidth: number): number {
  return Math.max(960, containerWidth, 248 + Math.ceil((end - start) / DAY) * 9);
}

/** Format calendar dates in UTC, matching phaseFor countdowns and the existing race list. */
export function timelineDateLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

/** A phase's printed last day is the day before its exclusive SVG boundary. */
export function preparationBandLabel(band: PreparationBand): string {
  return band.phase === 'base'
    ? `Through ${timelineDateLabel(band.end - DAY)}`
    : `${timelineDateLabel(band.start)} – ${timelineDateLabel(band.end - DAY)}`;
}

/** Past dates alone are not evidence of participation; only results use solid markers. */
export function timelineEventStatus(race: RaceEvent, today: number): string {
  if (race.result != null) return 'Recorded result';
  const date = raceTimelineDate(race.date);
  if (date !== null && date < today) return 'Past date · no result recorded';
  return `${race.status === 'considering' ? 'Tentative' : 'Scheduled'} · ${race.status}`;
}
