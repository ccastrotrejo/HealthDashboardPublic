import { useMemo } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartContainer } from './ChartContainer';
import type { DailyTrendPoint } from '../../lib/types';
import type { TrendConfidence } from '../../lib/trendConfidence';
import { describeTrendConfidence } from '../../lib/trendConfidence';
import { useChartTheme } from '../../lib/chartTheme';
import { ErrorBoundary } from './ErrorBoundary';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Metric name, e.g. "HRV". */
  title: string;
  /** The full series to plot, oldest first. null = missing day (gap). */
  series: DailyTrendPoint[];
  /** Unit suffix for the tooltip/axis, e.g. "ms". */
  unit?: string;
  color: string;
  /** Optional reference line (e.g. the mean baseline). */
  baseline?: number;
  baselineLabel?: string;
  /** Human range label, e.g. "last 30 days". Shown as the dialog subtitle. */
  rangeLabel: string;
  /** Optional trend-confidence read-out for this series. */
  confidence?: TrendConfidence;
}

function formatDate(iso: string): string {
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Reusable drill-down dialog: takes a metric's full historical series and
 * renders it as a larger Recharts line chart with axis labels and an optional
 * baseline — the detail behind a card's 30-day sparkline.
 *
 * Built on the Astryx `Dialog` (native <dialog> + showModal), which provides
 * the modal a11y contract for free: focus trap, Escape to close, backdrop
 * dismiss, body scroll-lock, and focus restoration to the trigger on close.
 */
export function MetricDetailModal({
  isOpen,
  onClose,
  title,
  series,
  unit,
  color,
  baseline,
  baselineLabel,
  rangeLabel,
  confidence,
}: Props) {
  const { chartTheme, chartTick, chartAxisLine, chartTooltipStyle } = useChartTheme();
  const data = useMemo(
    () => series.map((p) => ({ date: p.date, value: p.value })),
    [series],
  );
  const realCount = useMemo(
    () => series.filter((p) => p.value != null).length,
    [series],
  );

  const described = confidence ? describeTrendConfidence(confidence) : null;

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      width={680}
      maxHeight="80vh"
    >
      <Layout
        header={
          <DialogHeader
            title={`${title} · full history`}
            subtitle={rangeLabel}
            onOpenChange={(open) => {
              if (!open) onClose();
            }}
          />
        }
        content={
          <LayoutContent>
            <ErrorBoundary section={`${title} history`}>
              {realCount < 2 ? (
                <p className="py-8 text-center text-sm text-ink-500">
                  Not enough history to chart yet.
                </p>
              ) : (
                <>
                  <div className="h-72 w-full">
                    <ChartContainer>
                      <LineChart data={data} margin={{ top: 8, right: 16, left: -4, bottom: 0 }}>
                        <CartesianGrid stroke={chartTheme.gridColor} vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatDate}
                          tick={chartTick}
                          tickLine={false}
                          axisLine={chartAxisLine}
                          minTickGap={40}
                        />
                        <YAxis
                          tick={chartTick}
                          tickLine={false}
                          axisLine={chartAxisLine}
                          width={44}
                          domain={['auto', 'auto']}
                          unit={unit ? ` ${unit}` : undefined}
                        />
                        <Tooltip
                          cursor={{ stroke: chartTheme.gridColor }}
                          contentStyle={chartTooltipStyle}
                          labelFormatter={(l) => formatDate(String(l))}
                          formatter={(value) => [
                            value != null ? `${Number(value).toLocaleString()}${unit ? ` ${unit}` : ''}` : '—',
                            title,
                          ]}
                        />
                        {baseline != null && (
                          <ReferenceLine
                            y={baseline}
                            stroke={chartTheme.inkSubtle}
                            strokeDasharray="4 4"
                            strokeOpacity={0.4}
                            label={{
                              value: baselineLabel ?? 'baseline',
                              position: 'insideTopRight',
                              fill: chartTheme.axisColor,
                              fontSize: 12,
                            }}
                          />
                        )}
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke={color}
                          strokeWidth={2}
                          dot={false}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ChartContainer>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-caption text-ink-500">
                    <span>
                      {rangeLabel} · {realCount} readings
                    </span>
                    {described && confidence && (
                      <span className="inline-flex items-center gap-1">
                        <span aria-hidden>{described.arrow}</span>
                        {described.text}
                        <span className="tabular-nums">
                          {' '}
                          (t=
                          {Number.isFinite(confidence.tStatistic)
                            ? confidence.tStatistic.toFixed(1)
                            : '∞'}
                          , R²={confidence.rSquared.toFixed(2)})
                        </span>
                      </span>
                    )}
                  </div>
                </>
              )}
            </ErrorBoundary>
          </LayoutContent>
        }
      />
    </Dialog>
  );
}
