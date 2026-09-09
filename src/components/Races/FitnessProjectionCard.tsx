import { useId } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartContainer } from '../shared/ChartContainer';
import type { FitnessPoint } from '../../lib/types';
import { projectFitness } from '../../lib/races';
import { Card } from '../shared/Card';
import { useChartTheme } from '../../lib/chartTheme';
import { useBrandPalette } from '../../lib/palette';
import { formatRaceDate, raceTsbZeroOffset, segmentRaceForecast } from './raceDisplay';

interface Props {
  fitnessCurve: FitnessPoint[];
  raceDate: string;
  raceName: string;
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function FitnessProjectionCard({ fitnessCurve, raceDate, raceName }: Props) {
  const { chartTheme, chartTick, chartAxisLine, chartTooltipStyle } = useChartTheme();
  const palette = useBrandPalette();
  const gradientId = `race-tsb-${useId().replace(/:/g, '')}`;
  const projection = projectFitness(fitnessCurve, raceDate);
  const { rows, boundaryDate } = segmentRaceForecast(projection.series);
  if (rows.length === 0 || !projection.raceDay || !projection.current || !boundaryDate) {
    return (
      <Card title="Fitness forecast" subtitle="Assumes the recent CTL trend continues" fitContent>
        <p className="text-sm text-ink-500">No fitness history is available to project yet.</p>
      </Card>
    );
  }

  const ctlDelta = projection.raceDay.ctl - projection.current.ctl;
  const hasForecast = rows.some((point) => point.projected);
  const boundaryNearEnd = rows.findIndex((point) => point.date === boundaryDate) > rows.length / 2;
  const zeroOffset = raceTsbZeroOffset(rows.map((point) => point.tsb));
  const recentCount = Math.min(28, fitnessCurve.length);

  return (
    <Card
      title="Fitness forecast · if the recent trend continues"
      subtitle={`${raceName} · ${formatRaceDate(raceDate)}`}
      fitContent
    >
      <dl className="mb-3 flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <dt className="text-caption text-ink-500">Last observed CTL · {fmtDate(boundaryDate)}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-ink-900">{projection.current.ctl.toFixed(0)}</dd>
        </div>
        <div>
          <dt className="text-caption text-ink-500">{hasForecast ? 'Projected race-day CTL' : 'Recorded race-day CTL'}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-ink-900">
            {projection.raceDay.ctl.toFixed(0)}
            <span className="ml-2 text-sm font-normal text-ink-500">({ctlDelta >= 0 ? '+' : '−'}{Math.abs(ctlDelta).toFixed(0)})</span>
          </dd>
        </div>
      </dl>
      <p className="mb-3 text-caption text-ink-500">
        {formatRaceDate(rows[0]!.date)}–{formatRaceDate(raceDate)} · CTL = fitness load · TSB = freshness balance
      </p>
      <div className="h-64 min-w-0 w-full">
        <ChartContainer>
          <ComposedChart data={rows} margin={{ top: 28, right: 12, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset={zeroOffset} stopColor={palette.fill('sage')} stopOpacity={0.18} />
                <stop offset={zeroOffset} stopColor={palette.fill('terra')} stopOpacity={0.18} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={chartTick} tickLine={false} axisLine={chartAxisLine} interval="preserveStartEnd" minTickGap={48} />
            <YAxis tick={chartTick} tickLine={false} axisLine={chartAxisLine} width={44} />
            <Tooltip
              contentStyle={chartTooltipStyle}
              labelFormatter={(label) => `${formatRaceDate(String(label))}${String(label) > boundaryDate ? ' · Projected' : ' · Observed'}`}
              formatter={(value, name) => [Number(value).toFixed(1), String(name)]}
            />
            <ReferenceLine y={0} stroke={chartTheme.gridColor} />
            {hasForecast && (
              <>
                <ReferenceArea x1={boundaryDate} x2={raceDate} fill={palette.fill('cool')} fillOpacity={0.04} />
                <ReferenceLine
                  x={boundaryDate}
                  stroke={chartTheme.axisColor}
                  strokeDasharray="4 4"
                  label={{ value: 'Forecast begins', position: boundaryNearEnd ? 'insideTopLeft' : 'insideTopRight', fill: chartTheme.axisColor, fontSize: 12 }}
                />
              </>
            )}
            <Area type="linear" dataKey="tsb" stroke="none" fill={`url(#${gradientId})`} isAnimationActive={false} name="TSB" />
            <Line
              type="linear"
              dataKey="observedCtl"
              stroke={palette.text('cool')}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              name="CTL · observed"
              connectNulls={false}
            />
            <Line
              type="linear"
              dataKey="forecastCtl"
              stroke={palette.text('cool')}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
              name="CTL · projected"
              connectNulls={false}
            />
          </ComposedChart>
        </ChartContainer>
      </div>
      <ul aria-label="Chart legend" className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-caption text-ink-500">
        <li className="flex items-center gap-2"><span aria-hidden className="w-5 border-t-2 border-cool-ink" />Observed CTL</li>
        <li className="flex items-center gap-2"><span aria-hidden className="w-5 border-t-2 border-dashed border-cool-ink" />Projected CTL</li>
        <li className="text-sage-ink">TSB above zero</li>
        <li className="text-terra-ink">TSB below zero</li>
      </ul>
      <p className="mt-3 text-caption leading-relaxed text-ink-500">
        Based on the latest {recentCount} daily observation{recentCount === 1 ? '' : 's'} (up to 28).
        {' '}CTL follows a linear trend; projected ATL is fixed at 90% of CTL, so projected TSB is assumed—not a measured recovery forecast.
        {' '}This does not model your training plan or taper.
      </p>
    </Card>
  );
}
