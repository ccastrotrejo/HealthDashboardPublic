import { scaleUtc } from 'd3-scale';
import { useId } from 'react';
import { useElementSize } from '../../hooks/useElementSize';
import { useBrandPalette, hueSurface, type Hue } from '../../lib/palette';
import { phaseLabel } from '../../lib/races';
import {
  preparationBandLabel,
  raceTimelineWidth,
  timelineDateLabel,
  timelineEventStatus,
  type PreparationPhase,
  type RaceTimelineModel,
} from '../../lib/raceTimeline';

interface RaceTimelineChartProps {
  model: RaceTimelineModel;
  selectedId: string;
  today: number;
}

export const TIMELINE_PHASE_HUES: Record<PreparationPhase, Hue> = {
  base: 'cool', build: 'amber', peak: 'terra', taper: 'sage', 'race-week': 'sage',
};

/** React owns SVG geometry; D3 supplies only the UTC time scale and calendar ticks. */
export function RaceTimelineChart({ model, selectedId, today }: RaceTimelineChartProps) {
  const palette = useBrandPalette();
  const [ref, size] = useElementSize<HTMLDivElement>();
  const id = useId();
  const width = raceTimelineWidth(model.start, model.end, size.width);
  const left = 224;
  const right = width - 24;
  const rowHeight = 88;
  const height = 72 + model.lanes.length * rowHeight;
  const x = scaleUtc().domain([model.start, model.end]).range([left, right]);
  const ticks = x.ticks(Math.floor((right - left) / 110)).reduce<Date[]>((readable, tick) => {
    const previous = readable[readable.length - 1];
    if (!previous || x(tick) - x(previous) >= 110) readable.push(tick);
    return readable;
  }, []);
  const todayVisible = today >= model.start && today <= model.end;

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Preparation timeline, horizontally scrollable"
      aria-describedby={`${id}-help`}
      tabIndex={0}
      className="min-w-0 overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span id={`${id}-help`} className="sr-only">Use Left and Right arrow keys to scroll. Select an event using the control or chronological list for full details and applicable phase dates.</span>
      <svg width={width} height={height} role="img" aria-labelledby={`${id}-title ${id}-desc`} className="block max-w-none">
        <title id={`${id}-title`}>Race preparation timeline</title>
        <desc id={`${id}-desc`}>
          {timelineDateLabel(model.start)} to {timelineDateLabel(model.end)}. One lane per event.
          Dashed bands are date-based phase guidance, not observed training. Solid markers indicate recorded results;
          hollow markers indicate calendar dates without results. Full dates and phase windows are available in selected event details.
        </desc>
        <defs>
          <clipPath id={`${id}-labels`}><rect x={16} y={0} width={left - 32} height={height} /></clipPath>
        </defs>
        {ticks.map((tick) => (
          <g key={tick.getTime()}>
            <line x1={x(tick)} x2={x(tick)} y1={46} y2={height - 12} stroke={palette.chart.grid} />
            <text x={x(tick)} y={35} textAnchor="middle" fontSize={12} fill={palette.chart.axis}>
              {timelineDateLabel(tick.getTime())}
            </text>
          </g>
        ))}
        <text x={16} y={35} fontSize={12} fill={palette.chart.axis}>Event · priority</text>
        {model.lanes.map(({ race, date, bands }, index) => {
          const y = 56 + index * rowHeight;
          const selected = race.id === selectedId;
          const markerVisible = date >= model.start && date <= model.end;
          const recorded = race.result != null;
          return (
            <g key={race.id} data-race-id={race.id} data-selected={selected}>
              <rect x={1} y={y} width={width - 2} height={rowHeight - 4} fill={selected ? palette.surface.body : 'none'} />
              <line x1={left} x2={right} y1={y + 62} y2={y + 62} stroke={palette.chart.grid} />
              <text x={16} y={y + 26} clipPath={`url(#${id}-labels)`} fontSize={12} fontWeight={selected ? 600 : 400} fill={palette.surface.ink}>
                <title>{race.name}</title>
                {race.name.length > 25 ? `${race.name.slice(0, 24)}…` : race.name}
              </text>
              <text x={16} y={y + 46} fontSize={12} fill={palette.chart.axis}>
                {race.priority} · {race.type === 'race' ? race.sport : race.type}{selected ? ' · selected' : ''}
              </text>
              {bands.map((band) => {
                const hue = TIMELINE_PHASE_HUES[band.phase];
                const bandWidth = x(band.end) - x(band.start);
                const label = phaseLabel(band.phase);
                return (
                  <g key={band.phase} data-phase={band.phase}>
                    <rect
                      x={x(band.start)} y={y + 40} width={bandWidth} height={24} rx={3}
                      fill={hueSurface[hue][palette.mode === 'dark' ? 1 : 0]}
                      stroke={palette.text(hue)} strokeDasharray="4 3"
                    >
                      <title>{`${race.name} · ${label}: ${preparationBandLabel(band)} · date-based guidance`}</title>
                    </rect>
                    {bandWidth >= label.length * 6 + 8 && (
                      <text x={x(band.start) + bandWidth / 2} y={y + 56} textAnchor="middle" fontSize={12} fill={palette.text(hue)}>{label}</text>
                    )}
                  </g>
                );
              })}
              {race.type !== 'race' && (
                <text x={left + 8} y={y + 32} fontSize={12} fill={palette.chart.axis}>Calendar event · no training phases</text>
              )}
              {markerVisible ? (
                <g>
                  <line x1={x(date)} x2={x(date)} y1={y + 36} y2={y + 72} stroke={palette.surface.ink} strokeDasharray={recorded ? undefined : '3 3'} />
                  <circle cx={x(date)} cy={y + 52} r={5} fill={recorded ? palette.surface.ink : palette.surface.card} stroke={palette.surface.ink} strokeWidth={2}>
                    <title>{`${race.name} · ${timelineDateLabel(date)} · ${timelineEventStatus(race, today)}`}</title>
                  </circle>
                  <text x={x(date) < left + 128 ? x(date) + 8 : x(date) - 8} y={y + 20} textAnchor={x(date) < left + 128 ? 'start' : 'end'} fontSize={12} fill={palette.surface.ink}>
                    {timelineDateLabel(date)}
                  </text>
                </g>
              ) : (
                <text x={right} y={y + 20} textAnchor="end" fontSize={12} fill={palette.chart.axis}>
                  {date < model.start ? '←' : '→'} {timelineDateLabel(date)} · outside window
                </text>
              )}
            </g>
          );
        })}
        {todayVisible && (
          <g>
            <line x1={x(today)} x2={x(today)} y1={44} y2={height - 12} stroke={palette.chart.emphasis} strokeDasharray="2 4" />
            <text x={Math.max(left + 40, Math.min(right - 40, x(today)))} y={15} textAnchor="middle" fontSize={12} fill={palette.chart.emphasis}>Today (UTC)</text>
          </g>
        )}
      </svg>
    </div>
  );
}
