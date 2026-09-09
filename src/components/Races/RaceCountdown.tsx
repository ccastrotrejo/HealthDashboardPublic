import { COUNTDOWN_WINDOW_DAYS, countdownProgress } from '../../lib/threeScene';
import { MetricRing } from '../shared/MetricRing';
import { ThreeView } from '../shared/ThreeView';

interface RaceCountdownProps {
  daysUntil: number;
}

/** Explicit calendar window; the ring does not claim readiness or training progress. */
export function RaceCountdown({ daysUntil }: RaceCountdownProps) {
  const progress = countdownProgress(daysUntil);
  if (progress === null) {
    return <p className="text-caption text-ink-500">A future race date is needed for the countdown view.</p>;
  }
  return (
    <div className="mt-5 grid items-center gap-4 border-t border-border pt-4 sm:grid-cols-[16rem_minmax(0,1fr)]">
      <ThreeView
        label="Race countdown"
        scene={{ kind: 'countdown', progress }}
        className="h-44"
        readout={{ value: String(daysUntil), label: daysUntil === 0 ? 'race day' : daysUntil === 1 ? 'day' : 'days' }}
        fallback={<MetricRing progress={progress} value={daysUntil === 0 ? 'Race day' : `${daysUntil}d`} />}
      />
      <div>
        <p className="text-sm font-medium tabular-nums text-ink-900">
          {daysUntil === 0 ? 'Race day is today' : `${daysUntil} ${daysUntil === 1 ? 'day' : 'days'} until race day`}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          The ring fills during the final {COUNTDOWN_WINDOW_DAYS} calendar days.
          Earlier dates show an empty ring. This is elapsed time, not training completion or predicted readiness.
        </p>
      </div>
    </div>
  );
}
