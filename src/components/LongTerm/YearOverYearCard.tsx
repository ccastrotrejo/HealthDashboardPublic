import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { YearProgressBlock } from '../../lib/types';
import { Card } from '../shared/Card';
import { useChartTheme } from '../../lib/chartTheme';
import { ChartContainer } from '../shared/ChartContainer';
import { brand } from '../../lib/palette';
import { yearComparisonSeries, yearOrdinalDate } from '../../lib/chartRefinement';

interface Props {
  data: YearProgressBlock;
  thisYearNum: number; // pass-in so the component is deterministic
}

const COLOR_THIS = brand.cool[500];
const COMPACT_KM = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function doyToLabel(year: number, doy: number): string {
  const d = new Date(yearOrdinalDate(year, doy) + 'T00:00:00Z');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function YearOverYearCard({ data, thisYearNum }: Props) {
  const { chartTheme, chartTick, chartAxisLine, chartTooltipStyle } = useChartTheme();
  const { thisYear, lastYear, ytdKm, ytdKmLastYear } = data;

  const merged = yearComparisonSeries(thisYear, lastYear);
  const currentEnd = Math.max(-1, ...thisYear.map((point) => point.doy));
  const priorEnd = Math.max(-1, ...lastYear.map((point) => point.doy));

  const delta = ytdKm - ytdKmLastYear;
  const pct = ytdKmLastYear > 0 ? (delta / ytdKmLastYear) * 100 : null;

  const yearStart = Date.UTC(thisYearNum, 0, 1);
  const ticks = Array.from({ length: 12 }, (_, month) =>
    Math.round((Date.UTC(thisYearNum, month, 1) - yearStart) / 86_400_000));
  const finalDay = Math.round((Date.UTC(thisYearNum + 1, 0, 1) - yearStart) / 86_400_000) - 1;

  if (merged.length === 0) {
    return <Card title="Year over year" subtitle="All sports · cumulative distance in km">
      <p className="text-sm text-ink-500">No yearly distance history yet.</p>
    </Card>;
  }

  return (
    <Card
      title="Year over year"
      subtitle="All sports · cumulative distance in km · aligned by day of year"
      info="year-over-year"
      right={
        <span
          className="font-mono text-ink-700"
        >
          {delta > 0 ? '+' : ''}
          {delta.toFixed(0)} km
          {pct != null && ` (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%)`}
        </span>
      }
    >
      <div className="mb-3">
        <MetadataList columns={2}>
          <MetadataListItem label={`${thisYearNum}${currentEnd >= 0 ? ` · through ${doyToLabel(thisYearNum, currentEnd)}` : ''}`}>
            <span className="font-mono text-ink-900">{ytdKm.toFixed(0)} km</span>
          </MetadataListItem>
          <MetadataListItem label={`${thisYearNum - 1}${priorEnd >= 0 ? ` · through ${doyToLabel(thisYearNum - 1, priorEnd)}` : ''}`}>
            <span className="font-mono text-ink-900">{ytdKmLastYear.toFixed(0)} km</span>
          </MetadataListItem>
        </MetadataList>
      </div>
      <div className="h-48 w-full">
        <ChartContainer>
          <LineChart data={merged} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="doy"
              type="number"
              domain={[0, finalDay]}
              ticks={ticks}
              tickFormatter={(doy: number) => doyToLabel(thisYearNum, doy)}
              minTickGap={24}
              tick={chartTick}
              tickLine={false}
              axisLine={chartAxisLine}
            />
            <YAxis
              tickFormatter={(value: number) => COMPACT_KM.format(value)}
              tick={chartTick}
              tickLine={false}
              axisLine={chartAxisLine}
              width={48}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              labelFormatter={(l) => `Day ${Number(l) + 1} of each year`}
              formatter={(v, name) => [
                v == null ? '—' : `${Number(v).toFixed(0)} km`,
                name === 'thisYear' ? String(thisYearNum) : String(thisYearNum - 1),
              ]}
            />
            <Line
              dataKey="lastYear"
              stroke={chartTheme.axisColor}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
              type="linear"
              name="lastYear"
            />
            <Line
              dataKey="thisYear"
              stroke={COLOR_THIS}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
              type="linear"
              name="thisYear"
            />
          </LineChart>
        </ChartContainer>
      </div>
      <p className="mt-3 text-caption text-ink-500">
        Solid: {thisYearNum} · dashed: {thisYearNum - 1}. Month labels follow {thisYearNum};
        leap years can shift the comparison date by one day. Distance change is not a readiness score.
      </p>
    </Card>
  );
}
