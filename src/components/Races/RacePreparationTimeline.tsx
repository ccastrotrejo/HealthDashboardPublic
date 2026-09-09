import { useId, useState } from 'react';
import type { RaceEvent } from '../../lib/types';
import { phaseFor, phaseLabel } from '../../lib/races';
import { hueSurfaceClass, hueTextClass } from '../../lib/palette';
import {
  buildRaceTimeline,
  preparationBandLabel,
  racePreparationBands,
  raceTimelineDate,
  timelineDateLabel,
  timelineEventStatus,
  type PreparationPhase,
  type RaceTimelineRange,
} from '../../lib/raceTimeline';
import { RaceTimelineChart, TIMELINE_PHASE_HUES } from './RaceTimelineChart';

interface RacePreparationTimelineProps {
  races: RaceEvent[];
  selected: RaceEvent | null;
  today: number;
  onSelect: (id: string) => void;
}

const PHASES: PreparationPhase[] = ['base', 'build', 'peak', 'taper', 'race-week'];

/** Read-only comparison of independently calculated event windows, never a combined prescription. */
export function RacePreparationTimeline({ races, selected, today, onSelect }: RacePreparationTimelineProps) {
  const id = useId();
  const [range, setRange] = useState<RaceTimelineRange>('calendar');
  const model = buildRaceTimeline(races, selected, range);
  if (!model || !selected) {
    return <p className="mb-5 text-sm text-ink-500">Preparation timeline unavailable: no valid event dates. Calendar entries are preserved below.</p>;
  }
  const selectedDate = raceTimelineDate(selected.date)!;
  const details = racePreparationBands(selected, selectedDate - 98 * 86_400_000, selectedDate);
  const currentPhase = phaseFor(Math.round((selectedDate - today) / 86_400_000), selected.priority);

  return (
    <section aria-labelledby={`${id}-heading`} className="mb-6 space-y-4 border-b border-border pb-5">
      <div>
        <h4 id={`${id}-heading`} className="text-sm font-semibold text-ink-900">Preparation timeline</h4>
        <p id={`${id}-guidance`} className="mt-1 max-w-prose text-caption text-ink-500">
          Date-based phase guidance · not an individualized training plan. Each race is calculated independently;
          overlapping windows are not a combined prescription or evidence of completed training. Non-race events are calendar markers only.
        </p>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-caption text-ink-500" htmlFor={`${id}-event`}>
          Selected event
          <select
            id={`${id}-event`} value={selected.id} onChange={(event) => onSelect(event.target.value)}
            aria-controls={`${id}-details`}
            className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-border bg-surface px-3 text-sm text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {model.lanes.map(({ race, date }) => <option key={race.id} value={race.id}>{race.name} · {timelineDateLabel(date)}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-caption text-ink-500" htmlFor={`${id}-range`}>
          Timeline window
          <select
            id={`${id}-range`} value={range} onChange={(event) => setRange(event.target.value as RaceTimelineRange)}
            className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <option value="calendar">All supplied events</option>
            <option value="selected">Selected event · 14 weeks before / 1 week after</option>
          </select>
        </label>
      </div>
      <div className="space-y-2">
        <p className="text-caption text-ink-500">
          {timelineDateLabel(model.start)} – {timelineDateLabel(model.end)} · UTC calendar dates
        </p>
        {model.lanes.some(({ race }) => race.type === 'race') && <ul aria-label="Date-based phase legend" className="flex flex-wrap gap-2 text-caption">
          {PHASES.map((phase) => (
            <li key={phase} className={`rounded px-2 py-1 ${hueSurfaceClass[TIMELINE_PHASE_HUES[phase]]} ${hueTextClass[TIMELINE_PHASE_HUES[phase]]}`}>
              {phaseLabel(phase)}
            </li>
          ))}
        </ul>}
        <p className="text-caption text-ink-500">
          Dashed bands: guidance, including past dates. Solid marker: recorded result. Hollow marker: calendar date without a result.
          {' '}Scroll horizontally for readable lanes; select an event for full dates below.
        </p>
      </div>
      <RaceTimelineChart model={model} selectedId={selected.id} today={today} />
      {model.omittedCount > 0 && (
        <p className="text-caption text-amber-ink">{model.omittedCount} event(s) with invalid dates omitted from the chart; entries remain in the list.</p>
      )}
      <div id={`${id}-details`} aria-live="polite" aria-atomic="true" className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-ink-900 [overflow-wrap:anywhere]">{selected.name}</p>
          <p className="mt-1 text-caption text-ink-500">
            {timelineDateLabel(selectedDate)} · {selected.priority} priority · {selected.distance?.label ?? selected.sport}
            {' · '}{timelineEventStatus(selected, today)}
          </p>
          <p className="mt-1 text-caption text-ink-500">
            {selected.type === 'race'
              ? `${phaseLabel(currentPhase)} as of ${timelineDateLabel(today)} (UTC) · date-based guidance only`
              : 'Non-race calendar event · no training phases assigned'}
          </p>
        </div>
        {details.length > 0 && (
          <>
            <dl aria-label={`${selected.name} phase dates`} className="grid gap-x-6 gap-y-2 text-caption sm:grid-cols-2">
              {details.map((band) => (
                <div key={band.phase}>
                  <dt className="font-medium text-ink-900">{phaseLabel(band.phase)}</dt>
                  <dd className="text-ink-500">{preparationBandLabel(band)}</dd>
                </div>
              ))}
            </dl>
            <p className="text-caption text-ink-500">
              Base extends before the plotted window; its left edge is not a prescribed start date.
              {' '}A-priority taper: 21–8 days before race day. B/C: 14–8 days. Race week: 7–1 days.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
