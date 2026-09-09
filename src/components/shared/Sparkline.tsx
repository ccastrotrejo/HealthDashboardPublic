import { useId } from 'react';
import { useChartTheme } from '../../lib/chartTheme';
import { brand } from '../../lib/palette';
import { useElementSize } from '../../hooks/useElementSize';

interface Props {
  /** Data points, oldest first. null = missing day (line skips over it). */
  values: (number | null)[];
  /** Optional reference line, e.g. the 30-day baseline. */
  baseline?: number;
  /**
   * Minimum drawing height. The sparkline always fills its container's width,
   * and grows past this height when the slot it sits in is taller — so a card
   * stretched by a taller sibling spends the extra room on chart resolution
   * instead of leaving a void.
   */
  height?: number;
  color?: string;
  baselineColor?: string;
  className?: string;
}

/**
 * Minimal SVG sparkline. No tooltip, no axis, no library. The point of a
 * sparkline is to glance and absorb — anything more would be a real chart.
 *
 * Geometry is computed in real pixels from the measured container rather than
 * a fixed viewBox, so the line keeps its 1.5px stroke and round end dot at
 * every card width instead of being stretched by the browser.
 */
export function Sparkline({
  values,
  baseline,
  height = 30,
  color = brand.cool[700],
  baselineColor,
  className = '',
}: Props) {
  const { chartTheme } = useChartTheme();
  // Unique id per instance so multiple sparklines on the page don't collide.
  const gradId = `sparkline-fill-${useId().replace(/:/g, '')}`;
  const [containerRef, size] = useElementSize<HTMLDivElement>();

  // Baseline/empty-state use neutral ink, which must flip with the theme; the
  // trend line color is caller-supplied (saturated brand hues that read on
  // both surfaces).
  const resolvedBaselineColor = baselineColor ?? chartTheme.inkSubtle;
  const emptyColor = chartTheme.axisColor;

  const width = Math.round(size.width);
  const plotHeight = Math.max(height, Math.round(size.height));

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${className}`}
      style={{ minHeight: height }}
    >
      {/* The SVG is taken out of flow so measuring the container can never feed
          back into its own size. Rendering waits for the first measurement;
          min-height reserves the space so nothing shifts. */}
      {width > 0 && (
        <svg
          role="presentation"
          className="absolute inset-0"
          width={width}
          height={plotHeight}
          viewBox={`0 0 ${width} ${plotHeight}`}
        >
          <Plot
            values={values}
            baseline={baseline}
            width={width}
            height={plotHeight}
            color={color}
            gradId={gradId}
            baselineColor={resolvedBaselineColor}
            emptyColor={emptyColor}
          />
        </svg>
      )}
    </div>
  );
}

interface PlotProps {
  values: (number | null)[];
  baseline?: number;
  width: number;
  height: number;
  color: string;
  gradId: string;
  baselineColor: string;
  emptyColor: string;
}

function Plot({
  values,
  baseline,
  width,
  height,
  color,
  gradId,
  baselineColor,
  emptyColor,
}: PlotProps) {
  const real = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v != null);

  if (real.length < 2) {
    return (
      <text x={0} y={height - 8} fontSize={10} fill={emptyColor}>
        not enough data
      </text>
    );
  }

  const allVals = baseline != null ? [...real.map((p) => p.v), baseline] : real.map((p) => p.v);
  const lo = Math.min(...allVals);
  const hi = Math.max(...allVals);
  const range = hi - lo || 1;
  const xMax = values.length - 1 || 1;

  const xPx = (i: number) => (i / xMax) * (width - 2) + 1;
  const yPx = (v: number) => height - ((v - lo) / range) * (height - 4) - 2;

  // Walk the values and collect contiguous segments. Null entries cut the line
  // into separate pieces — the stroke skips the gap, the fill is drawn
  // per-segment so it doesn't bridge missing days with phantom area.
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    current.push([xPx(i), yPx(v)]);
  }
  if (current.length > 0) segments.push(current);

  const fmt = (n: number) => n.toFixed(1);
  const strokeD = segments
    .map((seg) => 'M' + seg.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(' L'))
    .join(' ');
  const baseY = height - 1;
  const fillD = segments
    .filter((seg) => seg.length > 1)
    .map((seg) => {
      const points = seg.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(' L');
      const firstX = fmt(seg[0]![0]);
      const lastX = fmt(seg[seg.length - 1]![0]);
      return `M${firstX} ${baseY} L${points} L${lastX} ${baseY} Z`;
    })
    .join(' ');

  const last = real[real.length - 1]!;

  return (
    <>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.14} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {baseline != null && (
        <line
          x1={0}
          x2={width}
          y1={yPx(baseline)}
          y2={yPx(baseline)}
          stroke={baselineColor}
          strokeWidth={0.8}
          strokeDasharray="2 2"
          opacity={0.35}
        />
      )}
      {fillD && <path d={fillD} fill={`url(#${gradId})`} stroke="none" />}
      <path d={strokeD} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      {/* Last-point dot */}
      <circle cx={xPx(last.i)} cy={yPx(last.v)} r={2} fill={color} />
    </>
  );
}
