/**
 * Shared Recharts theming.
 *
 * Recharts writes colors as literal SVG attributes (`stroke`, `fill`), which
 * don't resolve CSS `var()` — so we can't hand charts our `light-dark()`
 * tokens directly. This hook resolves concrete hex values for the active color
 * mode instead. The values themselves come from `lib/palette.ts`, which is the
 * single source of truth shared with the Astryx theme and the `@theme` block;
 * this file only shapes them into the props Recharts expects.
 */
import { useMemo } from 'react';
import { useBrandPalette } from './palette';

interface ChartTheme {
  /** Axis ticks / labels. */
  axisColor: string;
  /** Gridlines / axis lines. */
  gridColor: string;
  /** Emphasis lines (avg/goal/reference) and dark accents. */
  inkSubtle: string;
}

export interface UseChartThemeReturn {
  chartTheme: ChartTheme;
  /** `tick` prop for any Recharts XAxis/YAxis. */
  chartTick: { fontSize: number; fill: string; fontFamily: string; fontWeight: number };
  /** `axisLine` prop for any Recharts XAxis/YAxis. */
  chartAxisLine: { stroke: string };
  /** `contentStyle` for any Recharts Tooltip. */
  chartTooltipStyle: {
    background: string;
    border: string;
    borderRadius: number;
    fontSize: number;
    padding: string;
    color: string;
    boxShadow: string;
    lineHeight: string;
  };
}

/**
 * Resolve chart colors for the active color mode. Call inside a chart
 * component so it re-runs when the theme flips.
 */
export function useChartTheme(): UseChartThemeReturn {
  const palette = useBrandPalette();

  return useMemo(() => {
    const chartTheme: ChartTheme = {
      axisColor: palette.chart.axis,
      gridColor: palette.chart.grid,
      inkSubtle: palette.chart.emphasis,
    };
    return {
      chartTheme,
      chartTick: {
        fontSize: 12,
        fill: chartTheme.axisColor,
        fontFamily: 'Archivo Variable, system-ui, sans-serif',
        fontWeight: 500,
      },
      chartAxisLine: { stroke: chartTheme.gridColor },
      chartTooltipStyle: {
        background: palette.surface.card,
        border: `1px solid ${chartTheme.gridColor}`,
        borderRadius: 10,
        fontSize: 13,
        padding: '8px 12px',
        color: chartTheme.inkSubtle,
        boxShadow: '0 12px 28px -16px rgb(0 0 0 / 0.35)',
        lineHeight: '1.4',
      },
    };
  }, [palette]);
}
