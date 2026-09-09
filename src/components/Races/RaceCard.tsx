import type { ReactNode } from 'react';
import type { RaceEvent, Snapshot } from '../../lib/types';
import { Card } from '../shared/Card';
import { formatDuration, formatPace, formatKm } from '../../lib/format';
import { phaseFor, phaseLabel } from '../../lib/races';
import { SportGlyph } from '../shared/icons';
import { formatRaceDate, formatRaceTime } from './raceDisplay';
import { RaceCountdown } from './RaceCountdown';

interface Props {
  race: RaceEvent;
  daysUntil: number;
  snapshot: Snapshot | null;
  isPast?: boolean;
  detailsOnly?: boolean;
}

function RaceFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-ink-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-ink-900">{children}</dd>
    </div>
  );
}

const STATUS_LABEL = {
  registered: 'Registered',
  planned: 'Planned',
  considering: 'Considering',
};

function RaceFacts({ race }: { race: RaceEvent }) {
  return (
    <>
      <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
        <RaceFact label="Sport">
          <span className="inline-flex items-center gap-1.5">
            <SportGlyph sportType={race.sport === 'ride' ? 'Ride' : race.sport} size="sm" className="text-ink-500" />
            {race.sport}
          </span>
        </RaceFact>
        {race.distance && <RaceFact label="Distance">{formatKm(race.distance.meters)}</RaceFact>}
        {race.elevationGainMeters != null && <RaceFact label="Elevation">{race.elevationGainMeters.toLocaleString()} m</RaceFact>}
        {race.terrain && <RaceFact label="Terrain"><span className="capitalize">{race.terrain}</span></RaceFact>}
        {race.location?.name && <RaceFact label="Location">{race.location.name}</RaceFact>}
        {race.goal?.timeSeconds != null && <RaceFact label="Goal time"><span className="font-mono">{formatRaceTime(race.goal.timeSeconds)}</span></RaceFact>}
        {race.goal?.paceSecPerKm != null && <RaceFact label="Goal pace"><span className="font-mono">{formatPace(race.goal.paceSecPerKm)}</span></RaceFact>}
        {race.goal?.finishOnly && <RaceFact label="Goal">Finish</RaceFact>}
      </dl>
      {race.notes && <p className="mt-4 text-sm leading-relaxed text-ink-700">{race.notes}</p>}
      {race.url && /^https?:\/\//i.test(race.url) && (
        <a href={race.url} target="_blank" rel="noreferrer noopener" className="mt-3 inline-block text-caption text-cool-ink hover:underline">
          Event page ↗
        </a>
      )}
    </>
  );
}

export function RaceCard({ race, daysUntil, snapshot, isPast = false, detailsOnly = false }: Props) {
  const phase = phaseLabel(phaseFor(daysUntil, race.priority));
  // Running pace models are not whole-event predictions for multisport or cycling.
  const distance = race.sport === 'run' ? race.distance?.meters : undefined;
  const prBucket = distance ? snapshot?.longTerm?.prSeries.find((series) => Math.abs(series.distanceMeters - distance) <= series.distanceMeters * 0.1) : null;
  const prediction = distance ? snapshot?.longTerm?.racePredictions.find((item) => Math.abs(item.distanceMeters - distance) <= item.distanceMeters * 0.1) : null;
  const goalGap = race.goal?.timeSeconds != null && prediction ? race.goal.timeSeconds - prediction.predictedSeconds : null;
  const countdown = daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil} days to go`;
  const goal = race.goal?.timeSeconds != null
    ? formatRaceTime(race.goal.timeSeconds)
    : race.goal?.finishOnly ? 'Finish the race'
      : race.goal?.paceSecPerKm != null ? formatPace(race.goal.paceSecPerKm) : 'No goal recorded';
  const finish = race.result?.finishSeconds;
  const comparisons = (prediction || prBucket?.best) && (
    <div className="mt-4 border-t border-border pt-4">
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        {prBucket?.best && (
          <RaceFact label={isPast ? 'Current recorded PR pace' : 'Recorded PR pace'}>
            <span className="font-mono">{formatPace(prBucket.best.paceSecPerKm)}</span>
          </RaceFact>
        )}
        {prediction && (
          <RaceFact label={isPast ? 'Current Riegel estimate' : 'Riegel estimate'}>
            <span className="font-mono">{formatRaceTime(prediction.predictedSeconds)}</span>
          </RaceFact>
        )}
        {goalGap != null && (
          <RaceFact label={isPast ? 'Original goal vs current estimate' : 'Goal vs estimate'}>
            <span className="tabular-nums">
              {formatDuration(Math.abs(goalGap))} {goalGap < 0 ? 'faster' : goalGap > 0 ? 'slower' : 'difference'}
            </span>
          </RaceFact>
        )}
      </dl>
      <p className="mt-2 text-caption text-ink-500">
        {isPast
          ? 'Current running comparisons, not predictions recorded before this event.'
          : 'Running estimates, not performance guarantees.'}
      </p>
    </div>
  );

  return (
    <Card
      title={detailsOnly ? 'Event details' : race.name}
      subtitle={`${formatRaceDate(race.date)} · ${race.distance?.label ?? (race.duration?.hours != null ? `${race.duration.hours}h` : race.sport)}`}
      right={
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{race.priority} priority</span>
          <span>{isPast ? (race.result ? 'Result recorded' : 'No result recorded') : STATUS_LABEL[race.status]}</span>
        </span>
      }
      fitContent
    >
      {detailsOnly ? <><RaceFacts race={race} />{comparisons}</> : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-caption text-ink-500">{isPast ? 'Recorded finish' : 'Race goal'}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-ink-900 sm:text-3xl">
                {isPast ? (finish != null ? formatRaceTime(finish, 2) : 'No finish time recorded') : goal}
              </p>
              {!isPast && race.goal?.paceSecPerKm != null && race.goal?.timeSeconds != null && (
                <p className="mt-1 font-mono text-sm text-ink-700">{formatPace(race.goal.paceSecPerKm)}</p>
              )}
            </div>
            {!isPast && (
              <div className="text-sm text-ink-700">
                <p className="font-semibold text-ink-900">{countdown}</p>
                <p className="mt-1 text-caption">{phase}</p>
              </div>
            )}
            {isPast && race.result?.overallPlace != null && (
              <p className="text-sm tabular-nums text-ink-700">
                Overall <strong className="font-semibold text-ink-900">{race.result.overallPlace}</strong>
                {race.result.overallFinishers != null ? ` of ${race.result.overallFinishers}` : ''}
              </p>
            )}
          </div>

          {isPast && race.result?.notes && (
            <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700">{race.result.notes}</p>
          )}

          {!isPast && comparisons}
          {!isPast && <RaceCountdown daysUntil={daysUntil} />}

          {!isPast && (
            <details className="mt-4 border-t border-border pt-3">
              <summary className="cursor-pointer text-sm font-medium text-ink-700">Event details, goal and notes</summary>
              <div className="pt-4"><RaceFacts race={race} /></div>
            </details>
          )}
        </>
      )}
    </Card>
  );
}
