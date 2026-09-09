import { useMemo } from 'react';
import { useBrandPalette } from '../../lib/palette';
import { useElementSize } from '../../hooks/useElementSize';
import type { RouteData, RouteProjection, RouteSample } from '../../lib/route';

interface RouteChartProps {
  route: RouteData;
  selected: RouteSample;
}

function segmentPath(segment: readonly RouteSample[], position: (sample: RouteSample) => string): string {
  const first = position(segment[0]!);
  return `M${first} L${segment.length === 1 ? first : segment.slice(1).map(position).join(' ')}`;
}

/** Decorative geometry; source values and selection controls remain in HTML. */
export function RoutePlan({ route, projection, selected }: RouteChartProps & { projection: RouteProjection }) {
  const palette = useBrandPalette();
  const { path, scale } = useMemo(() => {
    let width = 0;
    let depth = 0;
    for (const point of projection.points) {
      width = Math.max(width, Math.abs(point.x) * 2);
      depth = Math.max(depth, Math.abs(point.z) * 2);
    }
    const scale = Math.min(width > 0 ? 552 / width : Infinity, depth > 0 ? 272 / depth : Infinity);
    const safeScale = Number.isFinite(scale) ? scale : 1;
    const position = (sample: RouteSample) => {
      const point = projection.points[sample.sourceIndex - 1]!;
      return `${(300 + point.x * safeScale).toFixed(2)},${(160 + point.z * safeScale).toFixed(2)}`;
    };
    return { scale: safeScale, path: route.renderSegments.map((segment) => segmentPath(segment, position)).join(' ') };
  }, [route, projection]);
  const point = projection.points[selected.sourceIndex - 1]!;
  return <svg viewBox="0 0 600 320" className="h-full w-full" aria-hidden="true" focusable="false">
    <path d={path} fill="none" stroke={palette.text('cool')} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx={300 + point.x * scale} cy={160 + point.z * scale} r="6"
      fill={palette.surface.card} stroke={palette.surface.ink} strokeWidth="2.5" />
  </svg>;
}

/** Profile runs split at missing elevations as well as GPX segment boundaries. */
export function RouteProfile({ route, selected }: RouteChartProps) {
  const palette = useBrandPalette();
  const [measure, size] = useElementSize<HTMLDivElement>();
  const width = Math.max(240, size.width);
  const low = route.stats.minElevationMeters;
  const high = route.stats.maxElevationMeters;
  const x = (distance: number) => 64 + (route.stats.distanceMeters ? distance / route.stats.distanceMeters : 0.5) * (width - 84);
  const y = (elevation: number) => low === null || high === null || high === low
    ? 80 : 144 - (elevation - low) / (high - low) * 128;
  const path = useMemo(() => route.profileSegments?.map((segment) =>
    segmentPath(segment, (sample) => `${x(sample.distanceMeters).toFixed(2)},${y(sample.elevationMeters!).toFixed(2)}`)).join(' '),
  [route, width]);

  return <figure className="min-w-0">
    <figcaption className="text-sm font-medium text-ink-900">Elevation profile</figcaption>
    <p className="mt-1 text-caption text-ink-500">
      Distance along recorded segments (horizontal) and recorded elevation in metres (vertical).
      Axes scale independently here; gaps are not interpolated.
    </p>
    <div ref={measure}>
    {route.profileSegments === null ? <p className="mt-3 text-sm text-ink-700">
      Too many separate elevation runs to draw within the 2,000-point limit. Original sample details remain available below.
    </p> : low === null || high === null ? <p className="mt-3 text-sm text-ink-700">
      No usable elevation samples are present, so no elevation profile can be drawn.
    </p> : <svg viewBox={`0 0 ${width} 184`} className="mt-2 h-[184px] w-full" aria-hidden="true" focusable="false">
      <path d={`M64 16 V144 H${width - 20}`} fill="none" stroke={palette.chart.axis} />
      <path d={path} fill="none" stroke={palette.text('sage')} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {selected.elevationMeters !== null && <circle cx={x(selected.distanceMeters)} cy={y(selected.elevationMeters)}
        r="5" fill={palette.surface.card} stroke={palette.surface.ink} strokeWidth="2.5" />}
      <text x="58" y={high === low ? 84 : 20} textAnchor="end" fill={palette.chart.axis} fontSize="12">{Math.round(high)} m</text>
      {high !== low && <text x="58" y="146" textAnchor="end" fill={palette.chart.axis} fontSize="12">{Math.round(low)} m</text>}
      <text x="64" y="169" fill={palette.chart.axis} fontSize="12">0 km</text>
      <text x={width - 20} y="169" textAnchor="end" fill={palette.chart.axis} fontSize="12">
        {(route.stats.distanceMeters / 1_000).toFixed(2)} km
      </text>
    </svg>}
    </div>
  </figure>;
}
