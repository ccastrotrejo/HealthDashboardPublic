import { useState } from 'react';
import type { DailyTrendPoint } from '../../lib/types';
import { Card } from '../shared/Card';
import { Sparkline } from '../shared/Sparkline';
import { MetricDetailModal } from '../shared/MetricDetailModal';
import { TrendConfidenceHint } from '../shared/TrendConfidenceHint';
import { trendConfidence } from '../../lib/trendConfidence';
import { brand } from '../../lib/palette';
import { mean } from '../../../utils/statistics';

interface Props {
  latest: number | null;
  deltaPct: number | null;
  trend: DailyTrendPoint[];
}

export function RhrCard({ latest, deltaPct, trend }: Props) {
  const [open, setOpen] = useState(false);
  const real = trend.map((t) => t.value).filter((v): v is number => v != null);
  const baseline = mean(real) ?? undefined;

  // For RHR, "up vs baseline" is bad (rising RHR = under-recovery or illness)
  const deltaBad = deltaPct != null && deltaPct > 0;
  const confidence = trendConfidence(trend);

  return (
    <Card title="Resting HR" subtitle="Overnight" info="rhr" onExpand={() => setOpen(true)} expandLabel="Resting HR">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-ink-900">
          {latest != null ? latest.toFixed(0) : '—'}
        </span>
        <span className="text-xs text-ink-500">bpm</span>
        {deltaPct != null && (
          <span
            className={`ml-auto text-xs tabular-nums ${
              deltaBad ? 'text-terra-ink' : 'text-sage-ink'
            }`}
          >
            {deltaPct >= 0 ? '+' : ''}
            {deltaPct.toFixed(0)}% vs 30d
          </span>
        )}
      </div>
      <Sparkline
        className="mt-4"
        values={trend.map((t) => t.value)}
        baseline={baseline}
        height={64}
        color={brand.terra[500]}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-caption">
        <p className="text-ink-500">
          30d mean {baseline != null ? `${baseline.toFixed(0)} bpm` : 'unavailable'} · dashed
        </p>
        <TrendConfidenceHint confidence={confidence} />
      </div>
      <MetricDetailModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Resting HR"
        series={trend}
        unit="bpm"
        color={brand.terra[500]}
        baseline={baseline}
        baselineLabel="30d mean"
        rangeLabel="last 30 days"
        confidence={confidence}
      />
    </Card>
  );
}
