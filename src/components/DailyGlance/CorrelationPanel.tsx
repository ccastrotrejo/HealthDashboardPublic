import { memo, useMemo, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import type { DailyAnalytics } from '../../lib/types';
import { correlate } from '../../lib/correlation';
import {
  correlationMatrix, EXPLORATION_METRICS, formatExplorationDate, metricPairs, trendRange,
  type DateRange, type ExplorationMetric,
} from '../../lib/exploration';
import { useBrandPalette } from '../../lib/palette';
import { Card } from '../shared/Card';
import { CorrelationScatter } from '../Review/CorrelationScatter';

interface Props {
  trends: DailyAnalytics['trends'];
  range?: DateRange | null;
  selectedDate?: string | null;
  highlightedDates?: readonly string[];
  onSelectDate?: (date: string) => void;
  onHighlightDates?: (dates: string[]) => void;
}

function CorrelationPanelImpl({ trends, range = null, selectedDate = null, highlightedDates, onSelectDate, onHighlightDates }: Props) {
  const palette = useBrandPalette();
  const [xKey, setXKey] = useState<ExplorationMetric>('asleepHours');
  const [yKey, setYKey] = useState<ExplorationMetric>('hrv');
  const [lag, setLag] = useState(1);
  const [localHighlights, setLocalHighlights] = useState<string[]>([]);
  const [localDate, setLocalDate] = useState<string | null>(null);
  const highlight = onHighlightDates ?? setLocalHighlights;
  const highlights = highlightedDates ?? localHighlights;
  const xMetric = EXPLORATION_METRICS.find((metric) => metric.key === xKey)!;
  const yMetric = EXPLORATION_METRICS.find((metric) => metric.key === yKey)!;
  const available = range ?? trendRange(trends);
  const matrix = useMemo(() => correlationMatrix(trends, lag, range), [trends, lag, range]);
  const points = useMemo(() => metricPairs(trends, xKey, yKey, lag, range), [trends, xKey, yKey, lag, range]);
  const result = correlate(points);
  const color = scaleLinear<string>().domain([-1, 0, 1])
    .range([palette.text('terra'), palette.surface.border, palette.text('cool')]);
  const label = (metric: typeof xMetric) => `${metric.label}${metric.unit ? ` (${metric.unit})` : ''}`;

  return (
    <Card title="Personal patterns"
      subtitle={available ? `${formatExplorationDate(available.start)} to ${formatExplorationDate(available.end)} · exploratory associations` : 'Waiting for daily signals'}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="max-w-prose text-sm text-ink-500">
            Select a relationship to inspect its observations. Rows are the source metric; columns are the {lag ? 'next-day' : 'same-day'} outcome.
          </p>
          <label className="text-caption text-ink-500">Day alignment
            <select value={lag} className="ml-2 min-h-11 rounded-lg border border-ink-200 bg-transparent px-3 text-sm text-ink-900"
              onChange={(event) => {
                const next = Number(event.target.value);
                setLag(next);
                if (next === 0 && xKey === yKey) { setXKey('asleepHours'); setYKey('hrv'); }
                highlight([]);
              }}>
              <option value={0}>Same day</option><option value={1}>Next day</option>
            </select>
          </label>
        </div>
        <div className="overflow-x-auto rounded border border-ink-200">
          <table className="w-full min-w-[38rem] table-fixed text-center text-caption">
            <caption className="sr-only">Pearson correlation matrix. Each cell shows r and paired sample count n. Select a cell for details.</caption>
            <thead><tr><th scope="col" className="p-2 text-left">Source / outcome</th>
              {EXPLORATION_METRICS.map((metric) => <th key={metric.key} scope="col" className="p-2 font-medium text-ink-700">{metric.label}</th>)}
            </tr></thead>
            <tbody>{matrix.map((row, index) => <tr key={EXPLORATION_METRICS[index]!.key}>
              <th scope="row" className="p-2 text-left font-medium text-ink-700">{EXPLORATION_METRICS[index]!.label}</th>
              {row.map((cell, col) => {
                const self = lag === 0 && cell.x === cell.y;
                const selected = cell.x === xKey && cell.y === yKey;
                return <td key={cell.y} className="p-1">
                  <button type="button" disabled={self} aria-pressed={selected}
                    aria-label={`${EXPLORATION_METRICS[index]!.label} versus ${lag ? 'next-day ' : ''}${EXPLORATION_METRICS[col]!.label}: ${self ? 'self comparison omitted' : cell.r == null ? `unavailable, ${cell.n} pairs` : `r ${cell.r.toFixed(2)}, ${cell.n} pairs`}`}
                    className={`min-h-14 w-full rounded border px-1 py-2 tabular-nums ${selected ? 'border-ink-900 bg-cool-surface text-ink-900' : 'border-transparent text-ink-700 hover:bg-ink-100'} disabled:cursor-default disabled:text-ink-500`}
                    onClick={() => { setXKey(cell.x); setYKey(cell.y); highlight([]); }}>
                    <span className="block border-b-2 pb-1" style={{ borderColor: self || cell.r == null ? palette.surface.border : color(cell.r) }}>
                      {self ? '\u2014' : cell.r == null ? 'N/A' : `${cell.r >= 0 ? '+' : ''}${cell.r.toFixed(2)}`}
                    </span>
                    <span className="mt-1 block text-ink-500">{self ? 'same metric' : `n = ${cell.n}`}</span>
                  </button>
                </td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
        <p className="text-caption text-ink-500">r ranges from -1 (opposite directions) to +1 (same direction). N/A means fewer than 3 pairs or no variation, not zero correlation.</p>
        <div className="border-t border-ink-200 pt-4">
          <h4 className="text-sm font-semibold text-ink-900">{xMetric.label} vs {lag ? 'next-day ' : ''}{yMetric.label}</h4>
          <p className="mt-1 text-caption text-ink-500">
            {result.r == null ? 'Correlation unavailable' : `r = ${result.r >= 0 ? '+' : ''}${result.r.toFixed(2)}`} / n = {result.n}
            {result.n < 14 ? ' / Small sample: interpret cautiously.' : ''}
          </p>
          <p className="mb-3 mt-2 text-caption text-ink-500">X: {label(xMetric)} / Y: {lag ? 'next-day ' : ''}{label(yMetric)}</p>
          {points.length ? <CorrelationScatter points={points} xLabel={label(xMetric)} yLabel={label(yMetric)} lag={lag}
            selectedDate={selectedDate ?? localDate} highlightedDates={highlights}
            onSelectDate={onSelectDate ?? setLocalDate} onHighlightDates={highlight} />
            : <p className="py-6 text-sm text-ink-500">No paired observations in these dates. Select a different period or relationship.</p>}
        </div>
        <p className="text-caption text-ink-500">
          Correlation is not causation. This short, repeated-observation history is not a controlled experiment.
          Recovery scores already incorporate physiological inputs; related metrics are not independent evidence.
          Sleep and recovery keep their source dates; next-day alignment literally shifts the outcome by one calendar day.
        </p>
      </div>
    </Card>
  );
}

export const CorrelationPanel = memo(CorrelationPanelImpl);
