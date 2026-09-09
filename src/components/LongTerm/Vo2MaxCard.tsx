import { Badge } from '@astryxdesign/core/Badge';
import type { DailyTrendPoint } from '../../lib/types';
import { Card } from '../shared/Card';
import { Sparkline } from '../shared/Sparkline';
import { brand } from '../../lib/palette';

interface Props {
  latest: number | null;
  trend: DailyTrendPoint[];
}

export function Vo2MaxCard({ latest, trend = [] }: Props) {
  // First non-null value in the carry-forward window is "90 days ago" — use it
  // to compute a delta with concrete meaning to the user.
  const earliest = trend.find((p) => p.value != null)?.value ?? null;
  const delta = latest != null && earliest != null ? latest - earliest : null;

  return (
    <Card title="VO₂ max" subtitle="Garmin · last 90 days" info="vo2max">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-ink-900">
          {latest != null ? latest.toFixed(0) : '—'}
        </span>
        <span className="text-xs text-ink-500">mL/kg/min</span>
        {delta != null && delta !== 0 && (
          <span className="ml-auto">
            <Badge
              variant={delta > 0 ? 'green' : 'red'}
              label={`${delta > 0 ? '+' : ''}${delta.toFixed(1)} vs 90d ago`}
            />
          </span>
        )}
      </div>
      <Sparkline
        className="mt-3 flex-1"
        values={trend.map((t) => t.value)}
        height={48}
        color={brand.cool[700]}
      />
      <p className="mt-1 text-[10px] text-ink-500">
        updates after qualifying outdoor runs — line is flat between readings
      </p>
    </Card>
  );
}
