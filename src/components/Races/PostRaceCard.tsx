import type { ReactNode } from 'react';
import type { RaceEvent, RaceResult } from '../../lib/types';
import { Card } from '../shared/Card';
import { formatDuration, formatPace } from '../../lib/format';
import { formatRaceTime } from './raceDisplay';

interface Props {
  race: RaceEvent;
}

function ResultFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-ink-500">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function recoveryDaysFor(race: RaceEvent): number {
  // Rough rule: 1 easy day per km. Tris weighted slightly more for the
  // multisport whole-body load.
  const km = race.distance?.meters ? race.distance.meters / 1000 : 0;
  const baseDays = Math.round(km);
  return race.sport === 'tri' ? Math.round(baseDays * 1.2) : baseDays;
}

export function PostRaceCard({ race }: Props) {
  if (!race.result) return null;
  const r: RaceResult = race.result;
  const recoveryDays = recoveryDaysFor(race);

  // Did we hit the goal?
  let goalGap: number | null = null;
  if (race.goal?.timeSeconds != null && r.finishSeconds != null) {
    goalGap = r.finishSeconds - race.goal.timeSeconds;
  }

  // Pace achieved
  const paceSecPerKm =
    race.sport === 'run' && r.finishSeconds && race.distance?.meters
      ? r.finishSeconds / (race.distance.meters / 1000)
      : null;

  return (
    <Card title="Result" subtitle="Recorded finish, placements and splits" fitContent>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 min-[420px]:grid-cols-2 lg:grid-cols-4">
        {r.finishSeconds != null && (
          <ResultFact label="Finish time">
            <span className="block font-mono text-base text-ink-900">
              {formatRaceTime(r.finishSeconds, 2)}
            </span>
            {paceSecPerKm != null && (
              <span className="block text-caption text-ink-500">
                {formatPace(paceSecPerKm)}
              </span>
            )}
          </ResultFact>
        )}
        {r.overallPlace != null && (
          <ResultFact label="Overall">
            <span className="block font-mono text-base text-ink-900">
              #{r.overallPlace}
              {r.overallFinishers != null && (
                <span className="text-ink-500"> / {r.overallFinishers}</span>
              )}
            </span>
            {r.overallFinishers != null && r.overallFinishers > 0 && (
              <span className="block text-caption text-ink-500">
                top {Math.round((r.overallPlace / r.overallFinishers) * 100)}%
              </span>
            )}
          </ResultFact>
        )}
        {r.divisionPlace != null && (
          <ResultFact label={r.division ?? 'Division'}>
            <span className="font-mono text-base text-ink-900">#{r.divisionPlace}</span>
          </ResultFact>
        )}
        {goalGap != null && (
          <ResultFact label="Vs goal">
            <span
              className={`block font-mono text-base ${
                goalGap <= 0 ? 'text-sage-ink' : 'text-terra-ink'
              }`}
            >
              {goalGap < 0 ? '−' : goalGap > 0 ? '+' : ''}
              {formatDuration(Math.abs(goalGap))}
            </span>
            <span className="block text-caption text-ink-500">
              {goalGap < 0 ? 'Beat goal' : goalGap === 0 ? 'Met goal' : 'Off goal'}
            </span>
          </ResultFact>
        )}
      </dl>

      {r.legs && r.legs.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
            Splits
          </p>
          <ul className="divide-y divide-border border-y border-border">
            {r.legs.map((leg, index) => {
              const pct =
                r.finishSeconds && r.finishSeconds > 0
                  ? (leg.durationSeconds / r.finishSeconds) * 100
                  : null;
              return (
                <li key={`${leg.name}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                  <span className="text-sm text-ink-700">{leg.name}</span>
                  <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="font-mono text-sm text-ink-900">{formatRaceTime(leg.durationSeconds, 2)}</span>
                    {leg.paceLabel && <span className="text-caption tabular-nums text-ink-500">{leg.paceLabel}</span>}
                    {pct != null && <span className="text-caption tabular-nums text-ink-500">{pct.toFixed(1)}% of race</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {r.notes && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-caption text-ink-500">
            Notes
          </p>
          <p className="mt-1 text-sm text-ink-700">{r.notes}</p>
        </div>
      )}

      <p className="mt-4 text-caption text-ink-500">
        Suggested easy-recovery window after a race like this:{' '}
        <strong>{recoveryDays} day{recoveryDays === 1 ? '' : 's'}</strong>
        {race.sport === 'tri' && ' (multisport gets a 20% bump)'}.
      </p>
    </Card>
  );
}
