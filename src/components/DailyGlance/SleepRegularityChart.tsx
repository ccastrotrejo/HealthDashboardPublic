import {
  CartesianGrid,
  ReferenceLine,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  ComposedChart,
} from 'recharts';
import type { SleepRegularityPoint } from '../../lib/types';
import { Card } from '../shared/Card';
import { useChartTheme } from '../../lib/chartTheme';
import { brand } from '../../lib/palette';
import { ChartContainer } from '../shared/ChartContainer';
import { chartDateTime, formatChartClock } from '../../lib/chartRefinement';

interface Props {
  data: SleepRegularityPoint[];
}

const COLOR_BED = brand.cool[700]; // cool-700
const COLOR_WAKE = brand.amber[500]; // amber-500

function fmtDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function SleepRegularityChart({ data }: Props) {
  const { chartTheme, chartTick, chartAxisLine, chartTooltipStyle } = useChartTheme();
  if (!data || data.length < 3) {
    return (
      <Card
        title="Sleep regularity"
        subtitle="Last 30 nights · bed + wake times"
        info="sleep-regularity"
      >
        <p className="text-sm text-ink-500">Not enough nights yet — needs ≥3.</p>
      </Card>
    );
  }

  // Y axis range: just below the earliest bed time, just after the latest wake time
  const lo = Math.floor(Math.min(...data.map((p) => p.bedHourLocal)) - 0.5);
  const hi = Math.ceil(Math.max(...data.map((p) => p.wakeHourLocal)) + 0.5);

  const merged = data.map((p) => ({
    date: p.date,
    timestamp: chartDateTime(p.date),
    bed: p.bedHourLocal,
    wake: p.wakeHourLocal,
  })).sort((a, b) => a.timestamp - b.timestamp);
  const first = merged[0]!;
  const last = merged.at(-1)!;
  const ticks = Array.from({ length: Math.floor((hi - lo) / 2) + 1 }, (_, index) => lo + index * 2);

  return (
    <Card
      title="Sleep regularity"
      subtitle={`${data.length} recorded nights · ${fmtDate(first.timestamp)}–${fmtDate(last.timestamp)} · local clock time`}
      info="sleep-regularity"
    >
      <p className="mb-3 text-xs text-ink-500">
        Latest night · bed <strong className="font-medium tabular-nums text-ink-900">{formatChartClock(last.bed)}</strong>
        {' · '}wake <strong className="font-medium tabular-nums text-ink-900">{formatChartClock(last.wake)}</strong>
      </p>
      <div className="h-56 w-full">
        <ChartContainer>
          <ComposedChart data={merged} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickCount={4}
              tickFormatter={fmtDate}
              tick={chartTick}
              tickLine={false}
              axisLine={chartAxisLine}
              interval="preserveStartEnd"
              minTickGap={30}
            />
            <YAxis
              domain={[lo, hi]}
              ticks={ticks}
              tickFormatter={formatChartClock}
              tick={chartTick}
              tickLine={false}
              axisLine={chartAxisLine}
              width={56}
              reversed
            />
            <Tooltip
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as (typeof merged)[number] | undefined;
                if (!active || !point) return null;
                return (
                  <div style={chartTooltipStyle}>
                    <p>Recorded night · {fmtDate(point.timestamp)}</p>
                    <p>Bed: {formatChartClock(point.bed)}</p>
                    <p>Wake: {formatChartClock(point.wake)}{Math.floor(point.wake / 24) > Math.floor(point.bed / 24) ? ' · next morning' : ''}</p>
                  </div>
                );
              }}
            />
            {lo < 24 && hi > 24 && <ReferenceLine y={24} stroke={chartTheme.axisColor} strokeDasharray="4 3" />}
            <Scatter
              dataKey="bed"
              fill={COLOR_BED}
              name="Bed"
              isAnimationActive={false}
            />
            <Scatter
              dataKey="wake"
              fill={COLOR_WAKE}
              name="Wake"
              shape="diamond"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLOR_BED }} />
          Bed time
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2 w-2 rotate-45" style={{ background: COLOR_WAKE }} />
          Wake time
        </span>
        <span className="text-ink-500">
          Tighter clusters indicate a more regular schedule.
        </span>
      </div>
      <p className="mt-2 text-caption text-ink-500">
        Dates use the recorded sleep-start date (UTC); clock times are local.
        Morning hours continue below midnight{lo < 24 && hi > 24 ? ' (dashed line)' : ''}.
        Points are bed and wake times, not sleep stages.
      </p>
    </Card>
  );
}
