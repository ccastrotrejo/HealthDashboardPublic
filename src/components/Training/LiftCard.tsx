import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '../shared/Card';
import type { Lift } from '../../lib/program';

interface Props {
  lift: Lift;
}

/**
 * A single Lift A/B/C breakdown: exercises + core + conditioning.
 */
export function LiftCard({ lift }: Props) {
  return (
    <Card
      title={lift.label}
      subtitle={lift.focus}
      right={<Badge variant="neutral" label={lift.day} />}
    >
      <div className="space-y-3">
        <ul className="space-y-1.5">
          {lift.exercises.map((ex) => (
            <li
              key={ex.name}
              className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-ink-900/5 pb-2 text-sm text-ink-700 last:border-0"
            >
              <span>{ex.name}</span>
              <span className="tabular-nums text-ink-500">
                {ex.sets} × {ex.reps}
              </span>
              {ex.notes && (
                <span className="basis-full text-xs leading-relaxed text-ink-500">{ex.notes}</span>
              )}
            </li>
          ))}
        </ul>

        <div className="border-t border-border pt-3">
          <p className="mb-2 text-xs font-semibold text-ink-500">
            Core · {lift.core.label}
          </p>
          <ul className="space-y-2 text-sm">
            {lift.core.items.map((item) => {
              return (
                <li
                  key={item.name}
                  className="flex flex-wrap items-baseline justify-between gap-x-2 text-ink-700"
                >
                  <span>{item.name}</span>
                  <span className="tabular-nums text-ink-500">
                    {item.sets} × {item.reps}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {lift.conditioning && (
          <div className="border-t border-border pt-3 text-sm leading-relaxed text-ink-700">
            <p className="mb-1 text-xs font-semibold text-ink-500">
              Conditioning
            </p>
            {lift.conditioning}
          </div>
        )}
      </div>
    </Card>
  );
}
