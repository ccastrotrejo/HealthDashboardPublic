import { useState } from 'react';
import type { DailyTrendPoint, DayStrainBlock } from '../../lib/types';
import { Card } from '../shared/Card';
import { Sparkline } from '../shared/Sparkline';
import { MetricDetailModal } from '../shared/MetricDetailModal';
import { TrendConfidenceHint } from '../shared/TrendConfidenceHint';
import { trendConfidence } from '../../lib/trendConfidence';
import { brand } from '../../lib/palette';
import { mean } from '../../../utils/statistics';

interface Props {
  data: DayStrainBlock;
  trend?: DailyTrendPoint[];
}

const MAX_STRAIN = 21; // Whoop's scale tops out here

function strainColor(strain: number): string {
  if (strain >= 18) return brand.terra[500]; // terra-500 — all out
  if (strain >= 14) return brand.amber[500]; // amber-500 — hard
  if (strain >= 10) return brand.sage[500]; // sage-500 — moderate
  return brand.cool[500]; // cool-500 — light
}

export function StrainCard({ data, trend }: Props) {
  const [open, setOpen] = useState(false);
  const pct = Math.min(100, (data.strain / MAX_STRAIN) * 100);
  const color = strainColor(data.strain);

  // Compute trend baseline if we have one
  const trendValues = trend?.map((t) => t.value) ?? [];
  const real = trendValues.filter((v): v is number => v != null);
  const baseline = mean(real) ?? undefined;
  const hasTrend = trend != null && trend.length >= 2;
  const confidence = hasTrend ? trendConfidence(trend!) : undefined;

  return (
    <Card
      title="Day strain"
      subtitle="Whoop · 0–21"
      info="strain"
      onExpand={hasTrend ? () => setOpen(true) : undefined}
      expandLabel="Day strain"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-ink-900">
          {data.strain.toFixed(1)}
        </span>
        <span className="text-xs text-ink-500">/ 21</span>
      </div>

      {/* Strain bar */}
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-50">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>

      {/* 30-day strain sparkline */}
      {hasTrend && (
        <div className="mt-4">
          <Sparkline
            values={trendValues}
            baseline={baseline}
            height={64}
            color={color}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-caption">
            <p className="text-ink-500">30d · dashed = mean</p>
            {confidence && <TrendConfidenceHint confidence={confidence} />}
          </div>
        </div>
      )}

      <dl className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-ink-200 pt-3 text-caption">
        <div><dt className="text-ink-500">Avg HR</dt><dd className="tabular-nums text-ink-700">{data.avgHr.toFixed(0)} bpm</dd></div>
        <div><dt className="text-ink-500">Max HR</dt><dd className="tabular-nums text-ink-700">{data.maxHr.toFixed(0)} bpm</dd></div>
        <div><dt className="text-ink-500">Energy</dt><dd className="tabular-nums text-ink-700">{(data.kilojoule / 4.184).toFixed(0)} kcal</dd></div>
      </dl>

      {hasTrend && (
        <MetricDetailModal
          isOpen={open}
          onClose={() => setOpen(false)}
          title="Day strain"
          series={trend!}
          color={color}
          baseline={baseline}
          baselineLabel="30d avg"
          rangeLabel="last 30 days"
          confidence={confidence}
        />
      )}
    </Card>
  );
}
