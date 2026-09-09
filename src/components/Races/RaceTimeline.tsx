import { useState } from 'react';
import type { RaceEvent } from '../../lib/types';
import { raceTimelineDate, selectedTimelineRace } from '../../lib/raceTimeline';
import { Card } from '../shared/Card';
import { RacePreparationTimeline } from './RacePreparationTimeline';
import { formatRaceDate, raceDaysUntil } from './raceDisplay';

interface Props {
  races: RaceEvent[];
}

/** Time-scaled preparation guidance supplements, rather than replaces, the chronological list. */
export function RaceTimeline({ races }: Props) {
  const [selectedId, setSelectedId] = useState('');
  if (races.length === 0) return null;
  const sorted = [...races].sort((a, b) => a.date.localeCompare(b.date));
  const now = new Date();
  const today = raceTimelineDate(now.toISOString().slice(0, 10))!;
  const selected = selectedTimelineRace(sorted, selectedId, today);

  return (
    <Card title="Race calendar" subtitle="Chronological order · gaps between events" fitContent>
      <RacePreparationTimeline races={sorted} selected={selected} today={today} onSelect={setSelectedId} />
      <ol aria-label="Chronological race calendar" className="space-y-0">
        {sorted.map((race, index) => {
          const previous = sorted[index - 1];
          const date = raceTimelineDate(race.date);
          const previousDate = previous ? raceTimelineDate(previous.date) : null;
          const gap = date !== null && previousDate !== null
            ? raceDaysUntil(race.date, new Date(previousDate))
            : null;
          return (
            <li key={race.id} className="relative ml-1 border-l border-border pb-5 pl-5 last:border-transparent last:pb-0">
              <span aria-hidden className={`absolute -left-1 top-1.5 h-2 w-2 rounded-full ${index === 0 ? 'bg-sage-500' : 'bg-ink-500'}`} />
              <div className="grid min-w-0 gap-x-5 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
                {date !== null
                  ? <time dateTime={race.date} className="text-caption tabular-nums text-ink-500">{formatRaceDate(race.date)}</time>
                  : <span className="text-caption text-ink-500">{race.date || 'Missing date'}</span>}
                <div className="min-w-0">
                  <button
                    type="button" onClick={() => setSelectedId(race.id)}
                    aria-label={`View timeline details for ${race.name}`}
                    aria-pressed={selected?.id === race.id}
                    disabled={date === null}
                    className="min-h-11 text-left text-sm font-medium text-ink-900 underline decoration-border underline-offset-4 [overflow-wrap:anywhere] hover:decoration-current focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:no-underline"
                  >{race.name}</button>
                  <p className="mt-0.5 text-caption text-ink-500">{race.priority} priority · {race.distance?.label ?? race.sport}</p>
                </div>
                <p className="text-caption text-ink-500">
                  {date === null ? 'Date unavailable'
                    : !previous ? (raceDaysUntil(race.date, now) < 0 ? 'Past event' : race.type === 'race' ? 'Next race' : 'Next event')
                    : gap === null ? 'Gap unavailable'
                    : gap === 0 ? 'Same day' : `${gap} days after previous`}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
