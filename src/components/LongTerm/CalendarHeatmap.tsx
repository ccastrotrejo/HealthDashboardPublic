import { memo, useId, useMemo, useState } from 'react';
import type { DailyAnalytics, DailyTrainingCell } from '../../lib/types';
import { sportLabel } from '../../lib/format';
import { Card } from '../shared/Card';
import { useBrandPalette } from '../../lib/palette';
import {
  calendarArrowDate, chartDateTime, trainingCalendarDays,
} from '../../lib/chartRefinement';
import {
  CALENDAR_METRICS, calendarMetricBucket, calendarMetricValue, calendarRangeFromSelection,
  joinCalendarMetrics, normalizeCalendarRange, type CalendarMetric, type CalendarMetricDay,
} from '../../lib/calendarMetrics';
import { formatExplorationDate, inDateRange, isCalendarDate, type DateRange } from '../../lib/exploration';

interface Props {
  data: DailyTrainingCell[];
  trends?: DailyAnalytics['trends'];
  selectedDate?: string | null;
  onSelectDate?: (date: string) => void;
  range?: DateRange | null;
  onRangeChange?: (range: DateRange | null) => void;
  highlightedDates?: readonly string[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CONTROL_CLASS = 'min-h-10 rounded-lg border border-ink-200 px-3 text-xs text-ink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900 disabled:opacity-50';

function fmtMinutes(minutes: number): string {
  const rounded = Math.round(minutes);
  return rounded < 60 ? `${rounded}m` : `${Math.floor(rounded / 60)}h ${rounded % 60}m`;
}

function shortDate(iso: string): string {
  return new Date(chartDateTime(iso)).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function daySummary(day: CalendarMetricDay): string {
  const minutes = calendarMetricValue(day, 'training');
  return `${shortDate(day.date)} · Training: ${minutes == null ? 'No record' : minutes > 0
    ? `${fmtMinutes(minutes)} (${minutes.toLocaleString()} min)` : 'Rest day · 0 min'}`;
}

function physiologySummary(day: CalendarMetricDay): string {
  return `Sleep: ${day.sleep == null ? 'No measurement' : `${day.sleep.toLocaleString()} h`} · Recovery: ${
    day.recovery == null ? 'No measurement' : `${day.recovery.toLocaleString()}/100`}`;
}

interface CalendarPlotProps {
  days: CalendarMetricDay[];
  selected: string | null;
  onSelect: (date: string) => void;
  onHover: (day: CalendarMetricDay | null) => void;
  metric: CalendarMetric;
  range: DateRange | null;
  highlightedDates: ReadonlySet<string>;
  compact?: boolean;
  descriptionId: string;
}

export function CalendarPlot({
  days, selected, onSelect, onHover, metric, range, highlightedDates, compact = false, descriptionId,
}: CalendarPlotProps) {
  const id = useId();
  const { heatScale, chart } = useBrandPalette();
  const first = days[0]!;
  const last = days.at(-1)!;
  const selectedDate = days.some((day) => day.date === selected) ? selected! : last.date;
  const startOffset = new Date(chartDateTime(first.date)).getUTCDay();
  const size = compact || days.length <= 35 ? 24 : 12;
  const step = size + 3;
  const left = 34;
  const top = 24;
  const weeks = Math.ceil((days.length + startOffset) / 7);
  const width = left + weeks * step + 28;
  const height = top + 7 * step;
  const months: { label: string; x: number }[] = [];
  let lastMonth = '';
  days.forEach((day, index) => {
    const month = day.date.slice(0, 7);
    const x = left + Math.floor((index + startOffset) / 7) * step;
    if (month !== lastMonth) {
      if (!months.length || x - months.at(-1)!.x >= 36) {
        months.push({
          x, label: new Date(chartDateTime(day.date)).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }),
        });
      }
      lastMonth = month;
    }
  });

  return (
    <div className="overflow-x-auto pb-1">
      <svg
        role="grid"
        tabIndex={0}
        aria-label={`${CALENDAR_METRICS[metric].label} calendar, ${shortDate(first.date)} to ${shortDate(last.date)}`}
        aria-describedby={descriptionId}
        aria-rowcount={7}
        aria-colcount={weeks}
        aria-activedescendant={`${id}-${selectedDate}`}
        viewBox={`0 0 ${width} ${height}`}
        style={{ minWidth: width, width: days.length > 180 ? '100%' : width }}
        className="block w-full rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900"
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(null)}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = calendarArrowDate(selectedDate, event.key, first.date, last.date);
          onHover(null);
          onSelect(next);
          event.currentTarget.querySelector(`[data-date="${next}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }}
      >
        <g aria-hidden>
          {months.map((month) => (
            <text key={month.x} x={month.x} y={14} fontSize={12} fill={chart.axis}>{month.label}</text>
          ))}
        </g>
        {WEEKDAYS.map((weekday, row) => (
          <g key={weekday} role="row" aria-label={weekday} aria-rowindex={row + 1}>
            {row % 2 === 1 && (
              <text aria-hidden x={0} y={top + row * step + size - 1} fontSize={12} fill={chart.axis}>{weekday}</text>
            )}
            {days.map((day, index) => {
              if ((index + startOffset) % 7 !== row) return null;
              const col = Math.floor((index + startOffset) / 7);
              const bucket = calendarMetricBucket(metric, calendarMetricValue(day, metric));
              const inRange = inDateRange(day.date, range);
              const highlighted = highlightedDates.has(day.date);
              const isSelected = day.date === selected;
              const label = `${daySummary(day)} · ${physiologySummary(day)}${
                range ? inRange ? ' · In shared range' : ' · Outside shared range' : ''
              }${highlighted ? ' · Highlighted date' : ''}`;
              return (
                <g key={day.date} role="presentation">
                  <rect
                    id={`${id}-${day.date}`}
                    data-date={day.date}
                    data-metric={metric}
                    data-missing={bucket == null}
                    data-in-range={range ? inRange : undefined}
                    role="gridcell"
                    aria-colindex={col + 1}
                    aria-selected={isSelected}
                    aria-label={label}
                    x={left + col * step} y={top + row * step}
                    width={size} height={size} rx={2}
                    fill={bucket == null ? 'none' : heatScale[bucket]}
                    fillOpacity={inRange ? 1 : 0.22}
                    stroke={isSelected ? chart.emphasis : bucket == null ? chart.axis : 'none'}
                    strokeWidth={isSelected ? 2 : 1}
                    strokeOpacity={!inRange && !isSelected ? 0.45 : 1}
                    strokeDasharray={bucket == null ? '2 2' : undefined}
                    pointerEvents="all"
                    onMouseEnter={() => onHover(day)}
                    onClick={(event) => {
                      event.currentTarget.ownerSVGElement?.focus();
                      onSelect(day.date);
                      onHover(null);
                    }}
                  >
                    <title>{label}</title>
                  </rect>
                  {range && inRange && (
                    <line aria-hidden pointerEvents="none"
                      x1={left + col * step} x2={left + col * step + size}
                      y1={top + row * step + size + 1.5} y2={top + row * step + size + 1.5}
                      stroke={chart.emphasis} strokeWidth={1} />
                  )}
                  {highlighted && (
                    <circle aria-hidden pointerEvents="none"
                      cx={left + col * step + size - 3} cy={top + row * step + 3}
                      r={2} fill={chart.emphasis} />
                  )}
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}

function CalendarHeatmapImpl({ data, trends, selectedDate, onSelectDate, range, onRangeChange, highlightedDates }: Props) {
  const id = useId();
  const { heatScale, surface } = useBrandPalette();
  const days = useMemo(() => joinCalendarMetrics(trainingCalendarDays(data), trends), [data, trends]);
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const [localRange, setLocalRange] = useState<DateRange | null>(null);
  const [metric, setMetric] = useState<CalendarMetric>('training');
  const [hover, setHover] = useState<CalendarMetricDay | null>(null);
  const [mobileYear, setMobileYear] = useState(false);
  const highlights = useMemo(() => new Set(highlightedDates), [highlightedDates]);
  if (!days.length) {
    return <Card title="Training Calendar" subtitle="Last 365 days">
      <p className="text-sm text-ink-500">No training history yet.</p>
    </Card>;
  }

  const selected = selectedDate === undefined
    ? days.find((day) => day.date === localSelected)?.date ?? days.at(-1)!.date
    : selectedDate;
  const selectedDay = selected && isCalendarDate(selected)
    ? days.find((day) => day.date === selected) ?? joinCalendarMetrics([{
      date: selected, cell: data.find((cell) => cell.date === selected) ?? null,
    }], trends)[0]!
    : null;
  const activeRange = normalizeCalendarRange(range === undefined ? localRange : range);
  const selectDay = (date: string) => {
    setLocalSelected(date);
    onSelectDate?.(date);
  };
  const changeRange = (next: DateRange | null) => {
    setLocalRange(next);
    onRangeChange?.(next);
  };
  const detail = hover ?? selectedDay;
  const recent = days.slice(-28);
  const totalMin = days.reduce((sum, day) => sum + (calendarMetricValue(day, 'training') ?? 0), 0);
  const trained = days.filter((day) => (calendarMetricValue(day, 'training') ?? 0) > 0).length;
  const rest = days.filter((day) => calendarMetricValue(day, 'training') === 0).length;
  const missing = days.length - trained - rest;
  const measured = days.filter((day) => calendarMetricValue(day, metric) != null);
  const plotProps = {
    selected: selectedDay?.date ?? null, onSelect: selectDay, onHover: setHover, metric,
    range: activeRange, highlightedDates: highlights, descriptionId: `${id}-keys`,
  };

  return (
    <Card title="Training Calendar"
      subtitle={`All sports · ${days.length} days · ${trained} training · ${rest} rest${missing ? ` · ${missing} missing` : ''}`}
      right={<span className="font-mono">{fmtMinutes(totalMin)} recorded</span>}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-metric`} className="text-xs font-medium text-ink-700">Color by</label>
        <select id={`${id}-metric`} value={metric} className={CONTROL_CLASS} style={{ backgroundColor: surface.card }}
          onChange={(event) => { setMetric(event.target.value as CalendarMetric); setHover(null); }}>
          {(Object.keys(CALENDAR_METRICS) as CalendarMetric[]).map((value) => (
            <option key={value} value={value}>{CALENDAR_METRICS[value].label}</option>
          ))}
        </select>
      </div>
      <p className="mb-3 text-caption text-ink-500" aria-live="polite">
        {CALENDAR_METRICS[metric].label}: {measured.length} of {days.length} days recorded · {days.length - measured.length} missing.
        {metric !== 'training' && <>
          {' '}Sleep and recovery histories may be shorter than training history. Unmeasured days are dashed, not zero.
          {measured.length > 0 && <> Recorded {formatExplorationDate(measured[0]!.date)}–{formatExplorationDate(measured.at(-1)!.date)}.</>}
        </>}
      </p>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 md:hidden">
        <p className="text-xs text-ink-500">{mobileYear ? 'Full history · scroll horizontally' : 'Recent 4 weeks'}</p>
        <button type="button" aria-pressed={mobileYear}
          className={CONTROL_CLASS}
          onClick={() => {
            setMobileYear(!mobileYear);
            setHover(null);
            if (mobileYear && selectedDay && selectedDay.date < recent[0]!.date) selectDay(days.at(-1)!.date);
          }}>
          {mobileYear ? 'Show recent 4 weeks' : 'Show full year'}
        </button>
      </div>
      <div className="hidden md:block">
        <CalendarPlot days={days} {...plotProps} />
      </div>
      <div className="md:hidden">
        <CalendarPlot days={mobileYear ? days : recent} compact={!mobileYear} {...plotProps} />
      </div>
      <p id={`${id}-keys`} className="mt-2 text-caption text-ink-500">
        Select a day for details. Arrow keys move by day ↑↓ or week ←→; Home / End jump to the displayed history endpoints.
      </p>
      <div className="mt-3 min-h-12 border-t border-ink-200 pt-3 text-xs" aria-live="polite" aria-atomic="true">
        <p className="font-medium text-ink-900">{detail ? daySummary(detail) : 'Select a day for details.'}</p>
        {detail && <p className="mt-1 text-ink-500">{physiologySummary(detail)}</p>}
        {detail?.cell && detail.cell.minutes > 0 && (
          <p className="mt-1 text-ink-500">
            {Object.entries(detail.cell.bySport).map(([sport, minutes]) => `${sportLabel(sport)} ${fmtMinutes(minutes)}`).join(' · ')}
          </p>
        )}
      </div>
      <fieldset className="mt-3 border-t border-ink-200 pt-3">
        <legend className="text-xs font-medium text-ink-700">
          {selectedDay ? `Range controls · selected ${shortDate(selectedDay.date)}` : 'Select a day to set a range'}
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(['start', 'end', 'day'] as const).map((edge) => (
            <button key={edge} type="button" className={CONTROL_CLASS} disabled={!selectedDay}
              onClick={() => {
                if (selectedDay) changeRange(calendarRangeFromSelection(selectedDay.date, edge, activeRange));
              }}>
              {edge === 'day' ? 'Use only this day' : `Use as range ${edge}`}
            </button>
          ))}
          <button type="button" className={CONTROL_CLASS} disabled={!activeRange} onClick={() => changeRange(null)}>
            Clear range
          </button>
        </div>
        <p className="mt-2 text-caption text-ink-500" aria-live="polite">
          {activeRange
            ? `Shared range: ${formatExplorationDate(activeRange.start)}–${formatExplorationDate(activeRange.end)}. Underlined days are in range; other days stay visible, subdued.`
            : 'No shared range. Setting either endpoint starts a one-day range.'}
          {' '}Reversed endpoints are ordered earliest to latest.
        </p>
      </fieldset>
      <p className="mt-3 text-caption text-ink-500">
        {CALENDAR_METRICS[metric].label}{metric === 'recovery' ? ' · score out of 100' : ''} · numerical bands, not health targets.
      </p>
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-caption text-ink-500">
        {heatScale.map((color, index) => (
          <li key={CALENDAR_METRICS[metric].buckets[index]} className="flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
            {CALENDAR_METRICS[metric].buckets[index]}
          </li>
        ))}
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 border border-dashed border-ink-500" />{metric === 'training' ? 'No record' : 'No measurement'}</li>
        {activeRange && <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 border-b border-ink-900" />Shared range</li>}
        {highlights.size > 0 && <li className="flex items-center gap-1.5"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ink-900" />Highlighted date</li>}
      </ul>
    </Card>
  );
}

export const CalendarHeatmap = memo(CalendarHeatmapImpl);
