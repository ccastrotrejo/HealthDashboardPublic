import { useEffect, useRef } from 'react';
import { brushX, type D3BrushEvent } from 'd3-brush';
import { scaleUtc } from 'd3-scale';
import { select } from 'd3-selection';
import { useElementSize } from '../../hooks/useElementSize';
import { chartDateTime, shiftChartDate } from '../../lib/chartRefinement';
import { brushDateRange, formatExplorationDate, type DateRange } from '../../lib/exploration';
import { useBrandPalette } from '../../lib/palette';

interface DateBrushProps {
  bounds: DateRange;
  range: DateRange | null;
  onChange: (range: DateRange | null) => void;
}

/** D3 owns only this group's children; native date controls supply its keyboard equivalent. */
export function DateBrush({ bounds, range, onChange }: DateBrushProps) {
  const [ref, { width }] = useElementSize<HTMLDivElement>();
  const group = useRef<SVGGElement>(null);
  const palette = useBrandPalette();
  useEffect(() => {
    if (!group.current || width <= 0) return;
    const x = scaleUtc().domain([new Date(chartDateTime(bounds.start)), new Date(chartDateTime(shiftChartDate(bounds.end, 1)))])
      .range([0, width]).clamp(true);
    const node = select(group.current);
    const behavior = brushX<unknown>().extent([[0, 0], [width, 44]]).handleSize(12)
      .on('end', (event: D3BrushEvent<unknown>) => {
        if (!event.sourceEvent) return;
        if (!event.selection) { onChange(null); return; }
        const [left, right] = event.selection as [number, number];
        onChange(brushDateRange(x.invert(left), x.invert(right), bounds.end));
      });
    node.call(behavior);
    const overlaps = range && range.start <= bounds.end && range.end >= bounds.start;
    node.call(behavior.move, overlaps
      ? [x(new Date(chartDateTime(range.start))), x(new Date(chartDateTime(shiftChartDate(range.end, 1))))]
      : null);
    node.select('.overlay').attr('fill', palette.surface.body);
    node.select('.selection').attr('fill', palette.fill('cool')).attr('fill-opacity', 0.2).attr('stroke', palette.chart.emphasis);
    node.selectAll('.handle').attr('fill', palette.chart.emphasis);
    return () => { node.on('.brush', null); node.selectAll('*').remove(); };
  }, [bounds.start, bounds.end, range?.start, range?.end, onChange, width, palette]);

  return (
    <div ref={ref} className="min-w-0">
      <p className="mb-2 text-caption text-ink-500">Drag across the recent-signal date range, or use the date controls above.</p>
      <svg width="100%" height={44} aria-hidden="true" className="block rounded border border-ink-200">
        <g ref={group} />
      </svg>
      <div className="mt-1 flex justify-between gap-3 text-caption text-ink-500">
        <span>{formatExplorationDate(bounds.start)}</span><span>{formatExplorationDate(bounds.end)}</span>
      </div>
    </div>
  );
}
