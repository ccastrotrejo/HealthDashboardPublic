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
import type { DailyTrendPoint } from '../../lib/types';
import { Card } from '../shared/Card';
import { useChartTheme } from '../../lib/chartTheme';
import { brand } from '../../lib/palette';
import { ChartContainer } from '../shared/ChartContainer';
import { stepGoalState, stepsCalendarWeek } from '../../lib/chartRefinement';

interface Props {
  trend: DailyTrendPoint[];
  goal: number | null;
}

const COLOR_BAR = brand.cool[500]; // cool-500
const COLOR_TODAY = brand.sage[500]; // sage-500
const COLOR_BELOW = brand.terra[500]; // terra-500 — day fell short of goal

function formatDayLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

function formatDateLong(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function localIsoDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCompactSteps(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  })
    .format(value)
    .toLowerCase();
}

/**
 * Last 7 days of steps as a daily bar chart, with the daily step goal as a
 * dashed reference line. Missing goals stay neutral and missing days stay empty.
 */
function StepsWeekChartImpl({ trend, goal }: Props) {
  const { chartTheme, chartTick, chartAxisLine, chartTooltipStyle } = useChartTheme();
  const COLOR_GOAL_LINE = chartTheme.inkSubtle;
  const todayIso = localIsoDate();
  const last7 = useMemo(
    () => stepsCalendarWeek(trend, todayIso),
    [todayIso, trend],
  );

  const recorded = last7.flatMap((point) => (point.value == null ? [] : [point.value]));
  if (recorded.length === 0) {
    return (
      <Card title="Steps · Last 7 Days" subtitle="Daily totals">
        <p className="text-sm text-ink-500">No recorded steps in the last 7 days.</p>
      </Card>
    );
  }

  const total = recorded.reduce((sum, value) => sum + value, 0);
  const avg = total / Math.max(recorded.length, 1);

  const goalForLine = goal != null && Number.isFinite(goal) && goal > 0 ? goal : null;
  const colors = { uncompared: chartTheme.axisColor, today: COLOR_TODAY, met: COLOR_BAR, below: COLOR_BELOW };

  return (
    <Card
      title="Steps · Last 7 Days"
      subtitle={goalForLine != null ? `Daily steps · goal ${goalForLine.toLocaleString()}` : 'Daily steps · no goal reported'}
      info="steps"
      right={
        <span>
          {recorded.length} recorded days · avg <strong className="tabular-nums">{Math.round(avg).toLocaleString()}</strong>
        </span>
      }
    >
      <div className="h-48 w-full">
        <ChartContainer>
          <BarChart
            data={last7}
            margin={{ top: 8, right: 4, left: -8, bottom: 0 }}
          >
            <XAxis
              dataKey="date"
              tickFormatter={(date: string) => date === todayIso ? 'Today' : formatDayLabel(date)}
              tick={chartTick}
              tickLine={false}
              axisLine={chartAxisLine}
              interval={0}
            />
            <YAxis
              tickFormatter={formatCompactSteps}
              tick={chartTick}
              tickLine={false}
              axisLine={chartAxisLine}
              width={40}
            />
            <Tooltip
              cursor={{ fill: 'transparent' }}
              contentStyle={chartTooltipStyle}
              labelFormatter={(l) => formatDateLong(String(l))}
              formatter={(value) => [
                value != null
                  ? Number(value).toLocaleString() + ' steps'
                  : '—',
                'Steps',
              ]}
            />
            {goalForLine != null && (
              <ReferenceLine
                y={goalForLine}
                stroke={COLOR_GOAL_LINE}
                strokeDasharray="4 4"
                strokeOpacity={0.5}
                ifOverflow="extendDomain"
              />
            )}
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
              {last7.map((d) => {
                const isToday = d.date === todayIso;
                const color = colors[stepGoalState(d.value, goalForLine, isToday)];
                return <Cell key={d.date} fill={color} />;
              })}
            </Bar>
          </BarChart>
        </ChartContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-caption text-ink-500">
        {(goalForLine == null ? [{ label: 'Recorded steps', color: colors.uncompared }] : [
          { label: 'Today · in progress', color: colors.today },
          { label: 'Goal met', color: colors.met },
          { label: 'Below goal', color: colors.below },
        ]).map(({ label, color }) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: color }} />
            {label}
          </span>
        ))}
        {goalForLine != null && <span>Dashed line: daily goal</span>}
        {recorded.length < 7 && <span>{7 - recorded.length} days missing · not counted as zero</span>}
      </div>
    </Card>
  );
}

export const StepsWeekChart = memo(StepsWeekChartImpl);
