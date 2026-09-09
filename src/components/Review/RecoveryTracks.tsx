import { useId } from 'react';
import { scaleLinear, scaleUtc } from 'd3-scale';
import { line } from 'd3-shape';
import { useElementSize } from '../../hooks/useElementSize';
import { chartDateTime } from '../../lib/chartRefinement';
import { formatExplorationDate, type ExplorerDay } from '../../lib/exploration';
import { useBrandPalette, type Hue } from '../../lib/palette';

interface RecoveryTracksProps {
  days: ExplorerDay[];
  selectedDate: string | null;
  highlightedDates: readonly string[];
  onSelectDate: (date: string) => void;
}

const TRACKS: readonly { key: Exclude<keyof ExplorerDay, 'date'>; label: string; unit: string; hue: Hue }[] = [
  { key: 'load', label: 'Training load', unit: 'modeled units', hue: 'cool' },
  { key: 'asleepHours', label: 'Sleep', unit: 'hours', hue: 'dusty' },
  { key: 'hrv', label: 'HRV', unit: 'ms', hue: 'sage' },
  { key: 'recoveryScore', label: 'Recovery', unit: '%', hue: 'amber' },
];

export function RecoveryTracks({ days, selectedDate, highlightedDates, onSelectDate }: RecoveryTracksProps) {
  const [ref, { width }] = useElementSize<HTMLDivElement>();
  const palette = useBrandPalette();
  const id = useId();
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return <p className="text-sm text-ink-500">No dates in this selection.</p>;
  const plotWidth = Math.max(220, width);
  const left = 44;
  const right = plotWidth - 14;
  const x = scaleUtc().domain([
    new Date(chartDateTime(first.date) - (days.length === 1 ? 43_200_000 : 0)),
    new Date(chartDateTime(last.date) + (days.length === 1 ? 43_200_000 : 0)),
  ]).range([left, right]);
  const active = days.find((day) => day.date === selectedDate) ?? last;
  const highlighted = new Set(highlightedDates);
  const ticks = x.ticks(Math.max(2, Math.floor(plotWidth / 170)));

  return (
    <div ref={ref} className="min-w-0 space-y-3">
      {TRACKS.map((track) => {
        const observed = days.flatMap((day) => day[track.key] == null ? [] : [day[track.key]!]);
        const max = track.key === 'recoveryScore' ? 100 : Math.max(1, ...observed);
        const y = scaleLinear().domain([0, max]).nice().range([76, 8]);
        const path = line<ExplorerDay>().defined((day) => day[track.key] != null)
          .x((day) => x(new Date(chartDateTime(day.date)))).y((day) => y(day[track.key]!))(days);
        return (
          <section key={track.key} aria-label={track.label}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-caption">
              <p className="font-medium text-ink-700">{track.label} <span className="font-normal text-ink-500">/ {track.unit}</span></p>
              <p className="text-ink-500">{observed.length}/{days.length} days recorded</p>
            </div>
            <svg viewBox={`0 0 ${plotWidth} 96`} width="100%" role="img" aria-label={`${track.label} over selected dates; exact values in the daily values table`}>
              {[0, y.domain()[1]!].map((value) => <g key={value}>
                <line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke={palette.chart.grid} />
                <text x={left - 6} y={y(value) + 4} textAnchor="end" fontSize={12} fill={palette.chart.axis}>{Math.round(value)}</text>
              </g>)}
              {path && <path d={path} fill="none" stroke={palette.text(track.hue)} strokeWidth={2} />}
              {days.map((day) => day[track.key] == null ? null : <circle key={day.date}
                cx={x(new Date(chartDateTime(day.date)))} cy={y(day[track.key]!)}
                r={highlighted.has(day.date) || day.date === active.date ? 4 : days.length < 45 ? 2 : 0}
                fill={palette.text(track.hue)} />)}
              <line x1={x(new Date(chartDateTime(active.date)))} x2={x(new Date(chartDateTime(active.date)))}
                y1={4} y2={80} stroke={palette.chart.emphasis} strokeDasharray="3 3" />
              {observed.length === 0 && <text x={(left + right) / 2} y={45} textAnchor="middle" fontSize={12} fill={palette.chart.axis}>No measurements in this period</text>}
              {track.key === 'recoveryScore' && ticks.map((tick) => <text key={+tick} x={x(tick)} y={94} textAnchor="middle" fontSize={12} fill={palette.chart.axis}>
                {tick.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}
              </text>)}
            </svg>
          </section>
        );
      })}
      <label htmlFor={`${id}-day`} className="block text-caption text-ink-500">
        Inspect day: {formatExplorationDate(active.date)}
      </label>
      <input id={`${id}-day`} type="range" min={0} max={Math.max(0, days.length - 1)}
        value={days.indexOf(active)} aria-valuetext={formatExplorationDate(active.date)}
        onChange={(event) => onSelectDate(days[Number(event.target.value)]!.date)} className="block min-h-11 w-full accent-current" />
      <dl className="grid grid-cols-2 gap-3 border-t border-ink-200 pt-3 sm:grid-cols-4" aria-live="polite">
        {TRACKS.map((track) => <div key={track.key}>
          <dt className="text-caption text-ink-500">{track.label}</dt>
          <dd className="text-sm tabular-nums text-ink-900">{active[track.key] == null ? 'No measurement' : `${active[track.key]!.toFixed(track.key === 'asleepHours' ? 1 : 0)} ${track.unit}`}</dd>
        </div>)}
      </dl>
      <details className="border-t border-ink-200 pt-3">
        <summary className="min-h-11 cursor-pointer text-sm text-ink-700">Daily values and selection</summary>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left text-caption tabular-nums">
            <caption className="sr-only">Recorded daily values. A dash indicates missing data.</caption>
            <thead><tr><th scope="col" className="p-2">Date</th>{TRACKS.map((track) => <th key={track.key} scope="col" className="p-2">{track.label} ({track.unit})</th>)}</tr></thead>
            <tbody>{days.map((day) => <tr key={day.date} className={highlighted.has(day.date) || day.date === active.date ? 'bg-cool-surface' : ''}>
              <th scope="row" className="p-2 font-normal"><button type="button" onClick={() => onSelectDate(day.date)}
                aria-pressed={day.date === active.date} className="min-h-11 text-left underline underline-offset-4">{day.date}</button>
                {highlighted.has(day.date) && <span className="block text-cool-ink">Highlighted</span>}
              </th>
              {TRACKS.map((track) => <td key={track.key} className="p-2">{day[track.key]?.toFixed(track.key === 'asleepHours' ? 1 : 0) ?? '\u2014'}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
