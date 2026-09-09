import { memo, useId, useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import type { FitnessPoint } from '../../lib/types';
import { Card } from '../shared/Card';
import { useChartTheme } from '../../lib/chartTheme';
import { brand } from '../../lib/palette';
import { ChartContainer } from '../shared/ChartContainer';
import { fitnessPlotSeries } from '../../lib/chartRefinement';

interface Props {
  data: FitnessPoint[];
}

const COLOR_CTL = brand.cool[500];
const COLOR_ATL = brand.terra[500];
const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const SIGNED = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, signDisplay: 'exceptZero' });

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function FitnessCurveImpl({ data }: Props) {
  const { chartTheme, chartTick, chartAxisLine, chartTooltipStyle } = useChartTheme();
  const id = useId();
  const series = useMemo(() => fitnessPlotSeries(data), [data]);
  const latest = series.at(-1);
  if (!latest) {
    return (
      <Card title="Fitness & Form" subtitle="Last 90 days">
        <p className="text-sm text-ink-500">No data yet.</p>
      </Card>
    );
  }

  const first = series[0]!;
  const domain: [number, number] = first.timestamp === latest.timestamp
    ? [first.timestamp - 43_200_000, latest.timestamp + 43_200_000]
    : [first.timestamp, latest.timestamp];
  const formLimit = Math.max(1, ...series.map((point) => Math.ceil(Math.abs(point.tsb ?? 0))));
  const hasGaps = series.some((point) => point.ctl == null || point.atl == null || point.tsb == null);
  const dot = series.length <= 7 || hasGaps ? { r: 2 } : false;
  const formatValue = (value: number | null, signed = false) =>
    value == null ? '—' : (signed ? SIGNED : NUMBER).format(value);
  const xAxis = {
    dataKey: 'timestamp', type: 'number' as const, scale: 'time' as const,
    domain, tickFormatter: formatDate, tick: chartTick, tickLine: false,
    axisLine: chartAxisLine, minTickGap: 32,
  };
  const margin = { top: 8, right: 12, left: 0, bottom: 0 };

  return (
    <Card
      title="Fitness & Form"
      subtitle={`${formatDate(first.timestamp)}–${formatDate(latest.timestamp)} · modeled training-load units`}
      info="fitness-curve"
    >
      <dl className="mb-4 grid grid-cols-3 gap-3">
        {[
          { label: 'Fitness · CTL', value: latest.ctl, color: COLOR_CTL },
          { label: 'Fatigue · ATL', value: latest.atl, color: COLOR_ATL },
          { label: 'Form · TSB', value: latest.tsb, color: latest.tsb != null && latest.tsb < 0 ? brand.terra[500] : brand.sage[500] },
        ].map(({ label, value, color }) => (
          <div key={label} className="border-t pt-2" style={{ borderColor: color }}>
            <dt className="text-caption text-ink-500">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-ink-900">
              {formatValue(value, label === 'Form · TSB')}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mb-1 text-caption text-ink-500">
        <span className="text-cool-ink">Fitness · 42d CTL</span>
        {' · '}<span className="text-terra-ink">Fatigue · 7d ATL (dashed)</span>
      </p>
      <div className="h-36 w-full">
        <ChartContainer>
          <ComposedChart data={series} syncId={id} margin={margin}>
            <CartesianGrid stroke={chartTheme.gridColor} vertical={false} />
            <XAxis {...xAxis} hide />
            <YAxis tick={chartTick} tickLine={false} axisLine={false} width={44} domain={[0, 'auto']} />
            <Tooltip
              contentStyle={chartTooltipStyle}
              labelFormatter={(label) => formatDate(Number(label))}
              formatter={(value, name) => [`${formatValue(value == null ? null : Number(value))} load units`, String(name)]}
            />
            <Line dataKey="ctl" name="Fitness · CTL" type="linear" stroke={COLOR_CTL}
              strokeWidth={2} dot={dot} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="atl" name="Fatigue · ATL" type="linear" stroke={COLOR_ATL}
              strokeWidth={1.5} strokeDasharray="4 3" dot={dot} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ChartContainer>
      </div>
      <p className="mb-1 mt-3 text-caption text-ink-500">Form · CTL − ATL · above zero = fresh; below = fatigued</p>
      <div className="h-32 w-full">
        <ChartContainer>
          <ComposedChart data={series} syncId={id} margin={margin}>
            <XAxis {...xAxis} />
            <YAxis tick={chartTick} tickLine={false} axisLine={false} width={44}
              domain={[-formLimit, formLimit]} ticks={[-formLimit, 0, formLimit]}
              tickFormatter={(value: number) => SIGNED.format(value)} />
            <ReferenceLine y={0} stroke={chartTheme.inkSubtle} strokeDasharray="4 3" />
            <Tooltip
              contentStyle={chartTooltipStyle}
              labelFormatter={(label) => formatDate(Number(label))}
              formatter={(value) => [`${formatValue(value == null ? null : Number(value), true)} load units`, 'Form · TSB']}
            />
            <Area dataKey="tsb" name="Form · TSB" type="linear" baseValue={0}
              stroke={chartTheme.axisColor} strokeWidth={1.5}
              fill={chartTheme.axisColor} fillOpacity={0.12}
              dot={dot} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ChartContainer>
      </div>
      {hasGaps && (
        <p className="mt-2 text-caption text-ink-500">Gaps indicate missing model data, not zero load.</p>
      )}
    </Card>
  );
}

export const FitnessCurve = memo(FitnessCurveImpl);
