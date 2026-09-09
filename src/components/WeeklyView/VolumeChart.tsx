import { memo, useMemo } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { WeeklyVolume } from '../../lib/types';
import { Card } from '../shared/Card';
import { useChartTheme } from '../../lib/chartTheme';
import { brand } from '../../lib/palette';
import { ChartContainer } from '../shared/ChartContainer';
import { weeklyVolumeSummary } from '../../lib/chartRefinement';
import { sportLabel } from '../../lib/format';

interface Props {
  data: WeeklyVolume[];
  /** If set, show only this sport's km (from each week's bySport breakdown). */
  sportFilter?: string | null;
}

// Design tokens — keep in sync with tailwind.config.ts
const COLOR_BAR = brand.cool[500]; // cool-500
const COLOR_CURRENT_BAR = brand.sage[500]; // sage-500
const ONE_DECIMAL = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const WHOLE_NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

function formatWeekLabel(iso: string): string {
  // Show as "May 19" — short, dense, locale-friendly
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatKm(n: number): string {
  return `${ONE_DECIMAL.format(n)} km`;
}

function VolumeChartImpl({ data, sportFilter }: Props) {
  const { chartTheme, chartTick, chartAxisLine, chartTooltipStyle } = useChartTheme();
  const COLOR_AVG_LINE = chartTheme.inkSubtle;
  // Memoize the filter map so BarChart sees a stable data reference when
  // unrelated parent state changes (e.g. tab switches, other card updates).
  const filtered = useMemo(
    () =>
      sportFilter
        ? data.map((w) => ({ ...w, km: w.bySport[sportFilter] ?? 0 }))
        : data,
    [data, sportFilter],
  );

  if (!data || data.length === 0) {
    return (
      <Card title="Weekly Volume" subtitle="Last 8 weeks">
        <p className="text-sm text-ink-500">No activity data yet.</p>
      </Card>
    );
  }

  const { weeks, latest, average: avg, comparisonWeeks, partial, deltaPct } =
    weeklyVolumeSummary(filtered, Date.now());
  const currentWeekKey = latest!.weekStart;
  const current = latest!.km;
  const comparisonLabel = `prior ${comparisonWeeks}-week average`;

  return (
    <Card
      title="Weekly Volume"
      subtitle={`${weeks.length} weeks · ${sportFilter ? sportLabel(sportFilter) : 'all sports'} · distance in km`}
      info="weekly-volume"
      right={<span>Week of {formatWeekLabel(currentWeekKey)}{partial ? ' · in progress' : ''}</span>}
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-3xl font-semibold tabular-nums tracking-tight text-ink-900">
            {ONE_DECIMAL.format(current)}
            <span className="ml-1 text-sm font-medium text-ink-500">
              km {partial ? 'so far this week' : 'latest week'}
            </span>
          </p>
        </div>
        <p className="text-xs tabular-nums text-ink-500">
          {deltaPct != null
            ? `${deltaPct > 0 ? '+' : ''}${WHOLE_NUMBER.format(deltaPct)}% vs ${comparisonLabel}`
            : avg != null ? `Prior average ${formatKm(avg)}` : 'No prior weeks to compare'}
        </p>
      </div>
      <div className="h-56 w-full">
        <ChartContainer>
          <BarChart data={weeks} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
            <XAxis
              dataKey="weekStart"
              tickFormatter={formatWeekLabel}
              tick={chartTick}
              tickLine={false}
              axisLine={chartAxisLine}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v: number) => WHOLE_NUMBER.format(v)}
              tick={chartTick}
              tickLine={false}
              axisLine={chartAxisLine}
              width={40}
            />
            <Tooltip
              cursor={{ fill: 'transparent' }}
              contentStyle={chartTooltipStyle}
              labelFormatter={(l) => `Week of ${formatWeekLabel(String(l))}${l === currentWeekKey && partial ? ' · partial week' : ''}`}
              formatter={(value) => [formatKm(Number(value)), 'Volume']}
            />
            {avg != null && <ReferenceLine
              y={avg}
              stroke={COLOR_AVG_LINE}
              strokeDasharray="4 4"
              strokeOpacity={0.6}
              ifOverflow="extendDomain"
            />}
            <Bar dataKey="km" radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false}>
              {weeks.map((w) => (
                <Cell
                  key={w.weekStart}
                  fill={w.weekStart === currentWeekKey ? COLOR_CURRENT_BAR : COLOR_BAR}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </div>
      <p className="mt-3 text-caption text-ink-500">
        {avg != null && <>Dashed line: {formatKm(avg)} · {comparisonLabel}, excluding the latest week. </>}
        {partial && 'Current week is partial; prior weeks are complete.'}
      </p>
    </Card>
  );
}

export const VolumeChart = memo(VolumeChartImpl);
