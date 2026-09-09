import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import type { DailyTrendPoint, HrvStatus } from '../../lib/types';
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
  /** Derived 7d-vs-baseline status — parallel to Garmin's HRV-status enum. */
  status?: HrvStatus;
}

/** Same tone vocabulary as the rest of the dashboard — soft colours, no loud reds. */
const statusStyle: Record<
  HrvStatus,
  { label: string; variant: 'success' | 'neutral' | 'error' }
> = {
  balanced: { label: 'Balanced', variant: 'success' },
  unbalanced: { label: 'Unbalanced', variant: 'neutral' },
  low: { label: 'Low', variant: 'error' },
  poor: { label: 'Poor', variant: 'error' },
  unknown: { label: '', variant: 'neutral' },
};

export function HrvCard({ latest, deltaPct, trend, status = 'unknown' }: Props) {
  const [open, setOpen] = useState(false);
  // 30-day baseline from the trend itself (skip nulls)
  const real = trend.map((t) => t.value).filter((v): v is number => v != null);
  const baseline = mean(real) ?? undefined;
  const s = statusStyle[status];
  const confidence = trendConfidence(trend);

  return (
    <Card title="HRV" subtitle="Heart-rate variability" info="hrv" onExpand={() => setOpen(true)} expandLabel="HRV">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-ink-900">
          {latest != null ? latest.toFixed(0) : '—'}
        </span>
        <span className="text-xs text-ink-500">ms</span>
        {deltaPct != null && (
          <span
            className={`ml-auto text-xs tabular-nums ${
              deltaPct >= 0 ? 'text-sage-ink' : 'text-terra-ink'
            }`}
          >
            {deltaPct >= 0 ? '+' : ''}
            {deltaPct.toFixed(0)}% vs 30d
          </span>
        )}
      </div>
      {s.label && (
        <span
          className="mt-2 inline-flex self-start"
          aria-label={`HRV status: ${s.label}. 7-day mean versus the prior 23-day baseline.`}
        >
          <Badge
            variant={s.variant}
            label={<span className="text-caption">{s.label}</span>}
          />
        </span>
      )}
      <Sparkline
        className="mt-4"
        values={trend.map((t) => t.value)}
        baseline={baseline}
        height={64}
        color={brand.cool[500]}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-caption">
        <p className="text-ink-500">
          30d mean {baseline != null ? `${baseline.toFixed(0)} ms` : 'unavailable'} · dashed
        </p>
        <TrendConfidenceHint confidence={confidence} />
      </div>
      <MetricDetailModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="HRV"
        series={trend}
        unit="ms"
        color={brand.cool[500]}
        baseline={baseline}
        baselineLabel="30d mean"
        rangeLabel="last 30 days"
        confidence={confidence}
      />
    </Card>
  );
}
