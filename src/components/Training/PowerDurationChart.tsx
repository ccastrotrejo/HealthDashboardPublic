import { useId, useState } from 'react';
import { scaleLinear, scaleLog } from 'd3-scale';
import { curveLinear, line } from 'd3-shape';
import { useElementSize } from '../../hooks/useElementSize';
import type { CyclingAnalytics } from '../../lib/types';
import {
  powerDurationLabel, powerProfilePlotRows, powerProfileSeries,
  type PowerProfilePoint,
} from '../../lib/powerProfile';

interface PowerDurationChartProps {
  data: Pick<CyclingAnalytics, 'powerCurve' | 'powerBlocks'>;
}

const HEIGHT = 240;
const PLOT = { left: 48, top: 20, bottom: 194 };

/** D3 computes geometry only; React owns the SVG and the native effort selector. */
export function PowerDurationChart({ data }: PowerDurationChartProps) {
  const id = useId();
  const [ref, size] = useElementSize<HTMLElement>();
  const width = Math.max(240, size.width);
  const right = width - 16;
  const [duration, setDuration] = useState<number | null>(null);
  const series = powerProfileSeries(data);
  const rows = powerProfilePlotRows(series);
  const points = series.flatMap((item) => item.points);
  const durations = [...new Set(points.map((point) => point.seconds))].sort((a, b) => a - b);
  const selected = duration != null && durations.includes(duration) ? duration : durations[0];
  const minimum = durations[0] ?? 5;
  const maximum = durations.at(-1) ?? 3600;
  const x = scaleLog()
    .domain(minimum === maximum ? [minimum / 2, maximum * 2] : [minimum, maximum])
    .range([PLOT.left, right]);
  const y = scaleLinear().domain([0, Math.max(1, ...points.map((point) => point.watts)) * 1.1])
    .nice(4).range([PLOT.bottom, PLOT.top]);
  const path = line<PowerProfilePoint | null>()
    .defined((point): point is PowerProfilePoint => point != null)
    .x((point) => x(point!.seconds)).y((point) => y(point!.watts)).curve(curveLinear);
  // Keep labels apart on a phone; every duration remains available in the selector.
  const ticks = durations.filter((seconds, index) => index === 0
    || (x(seconds) - x(durations[index - 1]!) >= 64 && x(maximum) - x(seconds) >= 64));
  if (maximum !== minimum) {
    if (ticks.length > 1 && x(maximum) - x(ticks.at(-1)!) < 64) ticks.pop();
    ticks.push(maximum);
  }

  return (
    <section ref={ref} aria-labelledby={`${id}-heading`} className="min-w-0 border-t border-border pt-4">
      <h4 id={`${id}-heading`} className="text-sm font-semibold text-ink-900">
        Power-duration profile
      </h4>
      <p id={`${id}-scope`} className="mt-1 text-xs leading-relaxed text-ink-500">
        {data.powerBlocks
          ? `Disjoint blocks as of ${data.powerBlocks.asOf}: recent 30 days including the snapshot day; preceding 60 days (days 31–90). Activity calendar dates.`
          : 'Last 90 days. This snapshot has no block comparison or source activity attribution.'}
      </p>
      {points.length === 0 ? (
        <p className="mt-3 border-l-2 border-border pl-3 text-sm leading-relaxed text-ink-700">
          No measured power efforts in the last 90 days. This profile needs rides with recorded power
          streams and cached duration summaries. Estimated FTP and heart-rate-only rides cannot fill
          the curve; no values are inferred.
        </p>
      ) : (
        <>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-700">
            {series.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`inline-block h-2.5 w-2.5 ${
                    item.id === 'preceding' ? 'border-2 border-ink-500' : 'rounded-full bg-cool-ink'
                  }`}
                />
                {item.label}
                {!item.points.length && ' · no measured efforts'}
              </li>
            ))}
          </ul>
          <svg
            viewBox={`0 0 ${width} ${HEIGHT}`} role="img"
            aria-labelledby={`${id}-plot-title ${id}-plot-desc`}
            className="mt-2 block h-auto w-full overflow-visible"
          >
            <title id={`${id}-plot-title`}>Measured cycling power by duration</title>
            <desc id={`${id}-plot-desc`}>
              Duration uses a logarithmic scale. Circles mark recent or 90-day efforts; squares mark
              preceding efforts. Straight connectors are guides between recorded durations, not
              measurements between them. Use the duration selector for exact watts and source rides.
            </desc>
            {y.ticks(4).map((watts) => (
              <g key={watts}>
                <line x1={PLOT.left} x2={right} y1={y(watts)} y2={y(watts)} stroke="var(--color-border)" />
                <text x={PLOT.left - 8} y={y(watts)} dy="0.35em" textAnchor="end"
                  fill="var(--color-ink-500)" fontSize={12}>{watts}</text>
              </g>
            ))}
            <text x={PLOT.left} y={11} fill="var(--color-ink-500)" fontSize={12}>Watts</text>
            {ticks.map((seconds) => (
              <text key={seconds} x={x(seconds)} y={PLOT.bottom + 20} textAnchor="middle"
                fill="var(--color-ink-500)" fontSize={12}>{powerDurationLabel(seconds)}</text>
            ))}
            <text x={(PLOT.left + right) / 2} y={HEIGHT - 4} textAnchor="middle"
              fill="var(--color-ink-500)" fontSize={12}>Duration · logarithmic scale</text>
            {series.map((item, index) => {
              const color = item.id === 'preceding' ? 'var(--color-ink-500)' : 'var(--color-cool-ink)';
              return (
                <g key={item.id}>
                  <path d={path(rows.map((row) => row.points[index] ?? null)) ?? undefined}
                    stroke={color} strokeWidth={1.5} fill="none" />
                  {item.points.map((point) => {
                    const size = point.seconds === selected ? 5 : 3.5;
                    return item.id === 'preceding' ? (
                      <rect key={point.seconds} x={x(point.seconds) - size} y={y(point.watts) - size}
                        width={size * 2} height={size * 2} fill="none"
                        stroke={color} strokeWidth={2} />
                    ) : (
                      <circle key={point.seconds} cx={x(point.seconds)} cy={y(point.watts)}
                        r={size} fill={color} />
                    );
                  })}
                </g>
              );
            })}
          </svg>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label htmlFor={`${id}-duration`} className="text-xs font-semibold text-ink-700">
              Inspect duration
            </label>
            <select id={`${id}-duration`} value={selected} onChange={(event) => setDuration(Number(event.target.value))}
              aria-describedby={`${id}-scope`}
              className="min-h-11 rounded-lg border border-border bg-ink-100 px-3 text-sm text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cool-ink">
              {durations.map((seconds) => (
                <option key={seconds} value={seconds}>{powerDurationLabel(seconds)}</option>
              ))}
            </select>
          </div>
          <dl aria-live="polite" aria-atomic="true" className="mt-3 grid gap-3 sm:grid-cols-2">
            {series.map((item) => {
              const point = item.points.find((effort) => effort.seconds === selected);
              const source = point?.source;
              const validSource = source && Number.isSafeInteger(source.activityId) && source.activityId > 0;
              return (
                <div key={item.id} className="min-w-0 border-l-2 border-border pl-3">
                  <dt className="text-xs text-ink-500">{item.label} · {powerDurationLabel(selected!)}</dt>
                  <dd className="mt-1 text-sm text-ink-900">
                    {point ? (
                      <>
                        <span className="font-medium tabular-nums">{point.watts} W</span>
                        <span className="mt-0.5 block text-xs text-ink-500">
                          {validSource ? (
                            <><a href={`https://www.strava.com/activities/${source.activityId}`}
                              className="text-cool-ink underline underline-offset-2">
                              Activity {source.activityId}
                            </a> · {source.date.slice(0, 10)}</>
                          ) : 'Source activity unavailable in this snapshot.'}
                        </span>
                      </>
                    ) : 'No measured effort at this duration.'}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-ink-500">
            Recorded rolling-average maxima, not an FTP estimate. Lines only connect sampled durations.
            {data.powerBlocks && ' Unequal observation windows: missing efforts are not zero or evidence of improvement.'}
          </p>
        </>
      )}
    </section>
  );
}
