import { fuelingFor } from '../../lib/races';
import type { RaceEvent } from '../../lib/types';
import { Card } from '../shared/Card';

interface Props {
  race: RaceEvent;
  daysUntil: number;
  bodyWeightKg?: number;
}

/** Daily plan for the final 7 days before a race. */
const RACE_WEEK_PLAN: Array<{ day: string; offset: number; advice: string }> = [
  { day: 'T-6', offset: -6, advice: '60-70% normal volume, easy intensity. Last "longer" workout.' },
  { day: 'T-5', offset: -5, advice: 'Short tempo or threshold (15-20 min). Last quality.' },
  { day: 'T-4', offset: -4, advice: 'Easy 30-45 min. Mental prep — visualize the race.' },
  { day: 'T-3', offset: -3, advice: 'Rest or very easy shake-out (20 min). Sleep is the priority.' },
  { day: 'T-2', offset: -2, advice: 'Short race-pace pickups (3-4 × 30s). Carb loading begins.' },
  { day: 'T-1', offset: -1, advice: 'Light shake-out 15-20 min. Stay off feet. Pack everything.' },
  { day: 'T-0', offset: 0, advice: 'RACE DAY. Stick to plan. Trust training.' },
];

export function RaceWeekCard({ race, daysUntil, bodyWeightKg = 75 }: Props) {
  if (daysUntil > 7) return null; // only show inside race week
  const fueling = fuelingFor(race, bodyWeightKg);

  return (
    <Card
      fitContent
      title="Race week strategy"
      subtitle={`${daysUntil} day${daysUntil === 1 ? '' : 's'} out — daily plan + fueling`}
      info="race-week"
      className="col-span-full"
    >
      {/* Daily plan */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
          Daily plan
        </p>
        <ol className="divide-y divide-border text-sm">
          {RACE_WEEK_PLAN.map((d) => {
            const isToday = d.offset === -daysUntil;
            return (
              <li
                key={d.day}
                aria-current={isToday ? 'step' : undefined}
                className={`grid grid-cols-1 gap-x-4 gap-y-1 px-2 py-2 sm:grid-cols-[6rem_minmax(0,1fr)] ${
                  isToday ? 'bg-sage-surface font-medium' : ''
                }`}
              >
                <span className={isToday ? 'text-sage-ink' : 'text-ink-500'}>{d.day}{isToday ? ' · today' : ''}</span>
                <span className="text-ink-700">{d.advice}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Fueling */}
      {fueling && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
            Race-day fueling (est. {fueling.durationHours.toFixed(1)}h)
          </p>
          <p className="mb-3 text-caption text-ink-500">Estimate uses {bodyWeightKg} kg body weight and the event duration assumptions.</p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 min-[420px]:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0">
              <dt className="text-caption text-ink-500">Pre-race carbs</dt>
              <dd className="mt-1">
                <span className="block font-mono text-sm text-ink-900">{fueling.preRaceCarbsG} g</span>
                <span className="block text-caption text-ink-500">2h before start</span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-caption text-ink-500">Carbs per hour</dt>
              <dd className="mt-1">
                <span className="block font-mono text-sm text-ink-900">{fueling.carbsPerHour} g/h</span>
                <span className="block text-caption text-ink-500">{fueling.totalCarbsG} g total</span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-caption text-ink-500">Fluids per hour</dt>
              <dd className="mt-1">
                <span className="block font-mono text-sm text-ink-900">{fueling.fluidsPerHourMl} ml/h</span>
                <span className="block text-caption text-ink-500">{(fueling.totalFluidsMl / 1000).toFixed(1)} L total</span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-caption text-ink-500">Sodium per hour</dt>
              <dd className="mt-1">
                <span className="block font-mono text-sm text-ink-900">{fueling.sodiumPerHourMg} mg/h</span>
                <span className="block text-caption text-ink-500">add electrolyte mix</span>
              </dd>
            </div>
          </dl>
          <ul className="mt-3 space-y-1 text-caption text-ink-500">
            {fueling.notes.map((n, i) => (
              <li key={i}>· {n}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
