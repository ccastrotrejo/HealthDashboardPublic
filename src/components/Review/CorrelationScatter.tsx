import { useEffect, useMemo, useRef } from 'react';
import { scaleLinear } from 'd3-scale';
import { brush, type D3BrushEvent } from 'd3-brush';
import { select } from 'd3-selection';
import { useElementSize } from '../../hooks/useElementSize';
import type { PairedPoint } from '../../lib/correlation';
import { shiftChartDate } from '../../lib/chartRefinement';
import { correlationDatesInBrush } from '../../lib/exploration';
import { useBrandPalette } from '../../lib/palette';

interface CorrelationScatterProps {
  points: PairedPoint[];
  xLabel: string;
  yLabel: string;
  lag: number;
  selectedDate: string | null;
  highlightedDates: readonly string[];
  onSelectDate: (date: string) => void;
  onHighlightDates: (dates: string[]) => void;
}

export function CorrelationScatter({ points, xLabel, yLabel, lag, selectedDate, highlightedDates, onSelectDate, onHighlightDates }: CorrelationScatterProps) {
  const [ref, { width }] = useElementSize<HTMLDivElement>();
  const palette = useBrandPalette();
  const group = useRef<SVGGElement>(null);
  const plotWidth = Math.max(220, width);
  const [x, y] = useMemo(() => {
    const domain = (values: number[]): [number, number] => {
      if (!values.length) return [0, 1];
      const min = Math.min(...values);
      const max = Math.max(...values);
      const padding = min === max ? Math.max(1, Math.abs(min) * 0.05) : (max - min) * 0.08;
      return [min - padding, max + padding];
    };
    return [
      scaleLinear().domain(domain(points.map((point) => point.x))).nice().range([48, plotWidth - 20]),
      scaleLinear().domain(domain(points.map((point) => point.y))).nice().range([190, 15]),
    ];
  }, [points, plotWidth]);
  const highlighted = new Set(highlightedDates);

  useEffect(() => {
    if (!group.current || width <= 0 || !points.length) return;
    const node = select(group.current);
    const behavior = brush<unknown>().extent([[48, 15], [plotWidth - 20, 190]]).handleSize(12)
      .on('end', (event: D3BrushEvent<unknown>) => {
        if (!event.sourceEvent) return;
        if (!event.selection) { onHighlightDates([]); return; }
        onHighlightDates(correlationDatesInBrush(points, event.selection as [[number, number], [number, number]], x, y));
        node.call(behavior.move, null);
      });
    node.call(behavior);
    node.select('.selection').attr('fill', palette.fill('cool')).attr('stroke', palette.chart.emphasis);
    return () => { node.on('.brush', null); node.selectAll('*').remove(); };
  }, [points, width, plotWidth, palette, onHighlightDates, x, y]);

  return (
    <div ref={ref} className="min-w-0">
      <p className="mb-3 text-caption text-ink-500">Drag a box to highlight source dates across the explorer and calendar. Use the observation checkboxes for the same selection without dragging.</p>
      <svg viewBox={`0 0 ${plotWidth} 238`} width="100%" role="img" aria-label={`${xLabel} versus ${yLabel}. Exact paired observations follow.`}>
        {y.ticks(4).map((tick) => <g key={tick}><line x1={48} x2={plotWidth - 20} y1={y(tick)} y2={y(tick)} stroke={palette.chart.grid} />
          <text x={42} y={y(tick) + 4} textAnchor="end" fontSize={12} fill={palette.chart.axis}>{tick}</text></g>)}
        {x.ticks(Math.max(2, Math.floor(plotWidth / 110))).map((tick) => <text key={tick} x={x(tick)} y={211} textAnchor="middle" fontSize={12} fill={palette.chart.axis}>{tick}</text>)}
        <text x={(plotWidth + 28) / 2} y={233} textAnchor="middle" fontSize={12} fill={palette.chart.axis}>{xLabel}</text>
        {points.map((point) => <circle key={point.date} cx={x(point.x)} cy={y(point.y)}
          r={selectedDate === point.date || highlighted.has(point.date) ? 6 : 4}
          fill={palette.text('cool')} fillOpacity={!highlighted.size || highlighted.has(point.date) ? 0.85 : 0.25}
          stroke={point.date === selectedDate ? palette.chart.emphasis : palette.surface.card} strokeWidth={2} />)}
        <g ref={group} aria-hidden="true" />
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-ink-500">
        <p aria-live="polite">{highlightedDates.length} source dates highlighted / {points.length} paired observations</p>
        <button type="button" onClick={() => onHighlightDates([])} className="min-h-11 rounded px-3 text-ink-700 underline underline-offset-4">Clear highlights</button>
      </div>
      <details className="mt-2 border-t border-ink-200 pt-3">
        <summary className="min-h-11 cursor-pointer text-sm text-ink-700">Paired observations and keyboard selection</summary>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left text-caption tabular-nums">
            <caption className="sr-only">{xLabel} and {yLabel}; dates of both observations are shown.</caption>
            <thead><tr><th scope="col" className="p-2">Highlight</th><th scope="col" className="p-2">Source date</th>
              <th scope="col" className="p-2">{xLabel}</th><th scope="col" className="p-2">Outcome date</th><th scope="col" className="p-2">{yLabel}</th></tr></thead>
            <tbody>{points.map((point) => <tr key={point.date}>
              <td className="p-2"><label className="flex min-h-11 min-w-11 items-center justify-center">
                <input type="checkbox" aria-label={`Highlight ${point.date}`} checked={highlighted.has(point.date)}
                  onChange={(event) => onHighlightDates(event.target.checked ? [...highlightedDates, point.date] : highlightedDates.filter((date) => date !== point.date))} /></label></td>
              <th scope="row" className="p-2 font-normal"><button type="button" aria-pressed={selectedDate === point.date}
                className="min-h-11 underline underline-offset-4" onClick={() => onSelectDate(point.date)}>{point.date}</button></th>
              <td className="p-2">{point.x.toFixed(1)}</td><td className="p-2">{shiftChartDate(point.date, lag)}</td><td className="p-2">{point.y.toFixed(1)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
