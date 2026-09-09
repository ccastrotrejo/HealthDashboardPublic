import { phaseFor, guidanceForPhase, phaseLabel, type RacePhase } from '../../lib/races';
import type { RaceEvent } from '../../lib/types';
import { Card } from '../shared/Card';

interface Props {
  race: RaceEvent;
  daysUntil: number;
}

const PHASES: RacePhase[] = ['base', 'build', 'peak', 'taper', 'race-week', 'race-day'];

export function PeriodizationCard({ race, daysUntil }: Props) {
  const phase = phaseFor(daysUntil, race.priority);
  const guidance = guidanceForPhase(phase);
  const facts = [
    ['Weekly volume', guidance.weeklyVolumeTarget],
    ['Quality sessions', guidance.qualitySessions],
    ['Long workout', guidance.longWorkout],
    ['Rest', guidance.rest],
  ];

  return (
    <Card title={`Preparation · ${guidance.label}`} subtitle="Date-based phase guidance · not an individualized training plan" fitContent>
      <p className="max-w-prose text-sm leading-relaxed text-ink-700">{guidance.advice}</p>
      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-caption text-ink-500">{label}</dt>
            <dd className="mt-1 text-sm text-ink-900">{value}</dd>
          </div>
        ))}
      </dl>
      <ol aria-label="Training phases" className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-3 text-caption">
        {PHASES.map((item) => (
          <li key={item} aria-current={phase === item ? 'step' : undefined} className={phase === item ? 'font-semibold text-sage-ink' : 'text-ink-500'}>
            {phaseLabel(item)}{phase === item ? ' · current' : ''}
          </li>
        ))}
      </ol>
    </Card>
  );
}
