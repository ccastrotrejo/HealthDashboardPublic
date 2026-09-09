import { memo, useMemo, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PrSeries } from '../../lib/types';
import { formatPace } from '../../lib/format';
import { Card } from '../shared/Card';
import { useChartTheme } from '../../lib/chartTheme';
import { ChartContainer } from '../shared/ChartContainer';
import { brand } from '../../lib/palette';
import { prPlotSeries } from '../../lib/chartRefinement';

interface Props {
  series: PrSeries[];
}

const COLOR_DOT = brand.cool[500]; // cool-500
const COLOR_PR_LINE = brand.sage[500]; // sage-500

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC',
  });
}

function PrTrackerImpl({ series }: Props) {
  const { chartTheme, chartTick, chartAxisLine, chartTooltipStyle } = useChartTheme();
  // Pick the first bucket with any data as the default
  const bucketsWithData = series.filter((s) => s.efforts.length > 0);
  const defaultBucket = bucketsWithData[0]?.bucket ?? series[0]?.bucket ?? '5k';
  const [active, setActive] = useState<string>(defaultBucket);

  const current = series.find((s) => s.bucket === active && s.efforts.length > 0) ?? bucketsWithData[0];

  // Derive plotted data with stable identity. Without useMemo, each parent
  // re-render produces fresh arrays and Recharts re-runs animation/layout
  // even when nothing changed.
  const plotted = useMemo(
    () => prPlotSeries(current?.efforts ?? []),
    [current],
  );

  if (!current || plotted.length === 0) {
    return (
      <Card
        title="Distance PRs"
        subtitle="Best pace per standard distance"
        info="pr-tracker"
      >
        <p className="text-sm text-ink-500">
          No qualifying runs yet. As you log runs near 1k / 5k / 10k / half / marathon
          distances, they show up here.
        </p>
      </Card>
    );
  }
  const first = plotted[0]!;
  const latest = plotted.at(-1)!;
  const domain: [number, number] = first.timestamp === latest.timestamp
    ? [first.timestamp - 86_400_000, latest.timestamp + 86_400_000]
    : [first.timestamp, latest.timestamp];

  return (
    <Card
      title="Distance PRs"
      subtitle="Run pace · min/km · approximate distance buckets"
      info="pr-tracker"
      right={
        current.best && (
          <span className="font-mono">
            {current.bucket} PR · {formatPace(current.best.paceSecPerKm)}
          </span>
        )
      }
    >
      {/* Bucket tab strip */}
      <div className="mb-3 flex flex-wrap gap-2">
        {series.map((s) => {
          const isActive = s.bucket === current.bucket;
          const hasData = s.efforts.length > 0;
          return (
            <button
              key={s.bucket}
              type="button"
              onClick={() => setActive(s.bucket)}
              disabled={!hasData}
              aria-pressed={isActive}
              aria-label={`${s.bucket}${hasData ? `, ${s.efforts.length} efforts` : ', no qualifying efforts'}`}
              className={`inline-flex min-h-10 items-center rounded-lg px-3 py-1.5 text-xs ${
                isActive
                  ? 'bg-ink-900 text-ink-50'
                  : hasData
                    ? 'bg-ink-50 text-ink-700 hover:bg-ink-900/10'
                    : 'cursor-not-allowed bg-ink-50/50 text-ink-500'
              }`}
            >
              {s.bucket} {hasData && `· ${s.efforts.length}`}
            </button>
          );
        })}
      </div>
      <p className="mb-2 text-caption text-ink-500">
        {formatDate(first.timestamp)}–{formatDate(latest.timestamp)} · faster pace is higher
      </p>
      <div className="h-48 w-full">
        <ChartContainer>
          <ComposedChart data={plotted} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={domain}
              tickCount={4}
              minTickGap={24}
              tickFormatter={formatDate}
              tick={chartTick}
              tickLine={false}
              axisLine={chartAxisLine}
            />
            <YAxis
              dataKey="paceSecPerKm"
              reversed
              domain={['dataMin - 10', 'dataMax + 10']}
              tick={chartTick}
              tickFormatter={(v: number) => {
                const rounded = Math.round(v);
                const m = Math.floor(rounded / 60);
                const s = rounded % 60;
                return `${m}:${s.toString().padStart(2, '0')}`;
              }}
              tickLine={false}
              axisLine={chartAxisLine}
              width={48}
            />
            <Tooltip
              content={({ active: visible, payload }) => {
                const point = payload?.[0]?.payload as (typeof plotted)[number] | undefined;
                if (!visible || !point) return null;
                return (
                  <div style={chartTooltipStyle}>
                    <p>{formatDate(point.timestamp)}</p>
                    <p>Effort: {formatPace(point.paceSecPerKm)}</p>
                    <p>Best to date: {formatPace(point.best)}</p>
                  </div>
                );
              }}
            />
            <Scatter
              dataKey="paceSecPerKm"
              name="Effort"
              fill={COLOR_DOT}
              shape="circle"
              isAnimationActive={false}
            />
            <Line
              dataKey="best"
              name="Best to date"
              type="stepAfter"
              stroke={COLOR_PR_LINE}
              strokeWidth={2}
              dot={plotted.length === 1}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartContainer>
      </div>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-500">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2 w-2 rounded-full bg-cool-500" />Individual effort</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-3 bg-sage-500" />Best recorded pace</span>
        <span>Based on activity totals, not measured race splits.</span>
      </p>
    </Card>
  );
}

export const PrTracker = memo(PrTrackerImpl);
