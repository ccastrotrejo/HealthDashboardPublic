import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarHeatmap, CalendarPlot } from '../../src/components/LongTerm/CalendarHeatmap';
import { calendarArrowDate, shiftChartDate, trainingCalendarDays } from '../../src/lib/chartRefinement';
import {
  CALENDAR_METRICS, calendarMetricBucket, calendarMetricValue, calendarRangeFromSelection,
  joinCalendarMetrics, normalizeCalendarRange, type CalendarMetric,
} from '../../src/lib/calendarMetrics';
import type { DailyAnalytics, DailyTrainingCell } from '../../src/lib/types';

const cell = (date: string, minutes: number): DailyTrainingCell => ({ date, minutes, bySport: { Run: minutes } });
const trends: DailyAnalytics['trends'] = {
  asleepHours: [{ date: '2026-09-03', value: 7.5 }, { date: '2026-09-01', value: 0 }],
  recoveryScore: [
    { date: '2026-09-02', value: 80 }, { date: '2026-09-03', value: null },
    { date: '2026-09-01', value: 0 },
  ],
  hrv: [], rhr: [], dayStrain: [],
};
const data = [cell('2026-09-01', 0), cell('2026-09-03', 35)];

function rectFor(html: string, date: string): string {
  const rect = html.match(new RegExp(`<rect[^>]*data-date="${date}"[^>]*>`))?.[0];
  expect(rect).toBeDefined();
  return rect!;
}

describe('calendar metric date joins', () => {
  it('joins unsorted, independent trends by actual dates without replacing training facts', () => {
    const days = joinCalendarMetrics(trainingCalendarDays(data), trends);
    expect(days).toEqual([
      { date: '2026-09-01', cell: data[0], sleep: 0, recovery: 0 },
      { date: '2026-09-02', cell: null, sleep: null, recovery: 80 },
      { date: '2026-09-03', cell: data[1], sleep: 7.5, recovery: null },
    ]);
    expect(calendarMetricValue(days[0]!, 'training')).toBe(0);
    expect(calendarMetricValue(days[1]!, 'training')).toBeNull();
    expect(calendarMetricValue(days[1]!, 'recovery')).toBe(80);
    expect(trends.asleepHours[0]?.date).toBe('2026-09-03');
  });

  it('keeps 335 days outside the 30-day physiology history missing on a 365-day calendar', () => {
    const year = Array.from({ length: 365 }, (_, index) => cell(shiftChartDate('2025-09-04', index), 0));
    const recent = year.slice(-30).map(({ date }) => ({ date, value: 8 }));
    const result = joinCalendarMetrics(trainingCalendarDays(year), { ...trends, asleepHours: recent, recoveryScore: [] });
    expect(result).toHaveLength(365);
    expect(result.filter((day) => day.sleep == null)).toHaveLength(335);
    expect(result.slice(0, 335).every((day) => calendarMetricBucket('sleep', day.sleep) == null)).toBe(true);
    expect(result.every((day) => day.recovery == null)).toBe(true);
    expect(result.every((day) => calendarMetricValue(day, 'training') === 0)).toBe(true);
  });

  it('supports old snapshots, absent trends, nulls, non-finite and invalid measurements', () => {
    const days = trainingCalendarDays(data);
    expect(joinCalendarMetrics(days).every((day) => day.sleep == null && day.recovery == null)).toBe(true);
    const result = joinCalendarMetrics(days, {
      ...trends,
      asleepHours: [
        { date: '2026-09-01', value: NaN }, { date: '2026-09-02', value: Infinity },
        { date: '2026-09-03', value: -1 },
      ],
      recoveryScore: undefined,
    });
    expect(result.every((day) => day.sleep == null && day.recovery == null)).toBe(true);
    expect(joinCalendarMetrics(days, {
      ...trends, recoveryScore: [{ date: '2026-09-01', value: 101 }],
    })[0]?.recovery).toBeNull();
    expect(calendarMetricValue({ ...result[0]!, cell: cell('2026-09-01', NaN) }, 'training')).toBeNull();
    expect(joinCalendarMetrics([], trends)).toEqual([]);
  });
});

describe('D3 numerical metric bands', () => {
  it.each([
    ['training', [0, 0.5, 29.9, 30, 59.9, 60, 119.9, 120], [0, 1, 1, 2, 2, 3, 3, 4]],
    ['sleep', [0, 3.99, 4, 5.99, 6, 7.99, 8, 9.99, 10], [0, 0, 1, 1, 2, 2, 3, 3, 4]],
    ['recovery', [0, 19.9, 20, 39.9, 40, 59.9, 60, 79.9, 80, 100], [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]],
  ] as const)('assigns exact %s boundaries without grading health', (metric, values, buckets) => {
    expect(values.map((value) => calendarMetricBucket(metric, value))).toEqual(buckets);
    expect(CALENDAR_METRICS[metric].buckets).toHaveLength(5);
    expect(CALENDAR_METRICS[metric].buckets.join(' ')).not.toMatch(/poor|good|healthy|optimal/i);
  });

  it.each(['training', 'sleep', 'recovery'] as const)('%s missing is never bucket zero', (metric) => {
    for (const value of [null, NaN, Infinity, -1]) expect(calendarMetricBucket(metric, value)).toBeNull();
  });
});

describe('selected-day range controls', () => {
  it.each(['start', 'end', 'day'] as const)('starts a valid single-day range from %s', (edge) => {
    expect(calendarRangeFromSelection('2026-09-02', edge, null))
      .toEqual({ start: '2026-09-02', end: '2026-09-02' });
  });

  it('orders reversed endpoints and allows resetting an existing range to one day', () => {
    const range = { start: '2026-09-01', end: '2026-09-03' };
    expect(calendarRangeFromSelection('2026-09-05', 'start', range))
      .toEqual({ start: '2026-09-03', end: '2026-09-05' });
    expect(calendarRangeFromSelection('2026-08-31', 'end', range))
      .toEqual({ start: '2026-08-31', end: '2026-09-01' });
    expect(calendarRangeFromSelection('2026-09-02', 'day', range))
      .toEqual({ start: '2026-09-02', end: '2026-09-02' });
    expect(range).toEqual({ start: '2026-09-01', end: '2026-09-03' });
  });

  it('rejects impossible or malformed dates rather than emitting an invalid range', () => {
    const range = { start: '2026-09-01', end: '2026-09-03' };
    for (const invalid of ['not-a-date', '2026-02-30', '2026-9-1']) {
      expect(calendarRangeFromSelection(invalid, 'day', range)).toEqual(range);
      expect(calendarRangeFromSelection(invalid, 'day', null)).toBeNull();
      expect(normalizeCalendarRange({ start: invalid, end: '2026-09-03' })).toBeNull();
    }
    expect(normalizeCalendarRange(null)).toBeNull();
    expect(normalizeCalendarRange({ start: range.end, end: range.start })).toEqual(range);
  });
});

describe('calendar layers server-rendered semantics', () => {
  const days = joinCalendarMetrics(trainingCalendarDays(data), trends);
  const plot = (metric: CalendarMetric) => renderToStaticMarkup(createElement(CalendarPlot, {
    days, metric, selected: '2026-09-03', onSelect: () => {}, onHover: () => {},
    range: { start: '2026-09-02', end: '2026-09-03' },
    highlightedDates: new Set(['2026-09-02']), descriptionId: 'keyboard-help',
  }));

  it.each(['training', 'sleep', 'recovery'] as const)('renders the %s layer with missing records, scope and accessible details', (metric) => {
    const html = plot(metric);
    expect(html.match(/role="gridcell"/g)).toHaveLength(3);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).not.toMatch(/<rect[^>]*tabindex/);
    expect(rectFor(html, '2026-09-01')).toContain('Rest day · 0 min');
    expect(rectFor(html, '2026-09-01')).toContain('Sleep: 0 h · Recovery: 0/100');
    expect(rectFor(html, '2026-09-01')).toContain('fill-opacity="0.22"');
    expect(rectFor(html, '2026-09-01')).toContain('Outside shared range');
    expect(rectFor(html, '2026-09-02')).toContain('Training: No record');
    expect(rectFor(html, '2026-09-02')).toContain('In shared range · Highlighted date');
    expect(rectFor(html, '2026-09-03')).toContain('Sleep: 7.5 h · Recovery: No measurement');
    expect(rectFor(html, '2026-09-03')).toContain('aria-selected="true"');
    const missingDate = metric === 'recovery' ? '2026-09-03' : '2026-09-02';
    expect(rectFor(html, missingDate)).toContain('data-missing="true"');
    expect(rectFor(html, missingDate)).toContain('fill="none"');
    expect(rectFor(html, missingDate)).toContain('stroke-dasharray="2 2"');
    expect(rectFor(html, missingDate)).toContain('pointer-events="all"');
    expect(html.match(/<line /g)).toHaveLength(2);
    expect(rectFor(html, '2026-09-01')).toContain('data-missing="false"');
  });

  it('preserves native metric selection, range buttons, hover details and mobile year toggle', () => {
    const html = renderToStaticMarkup(createElement(CalendarHeatmap, {
      data, trends, selectedDate: '2026-09-01',
      range: { start: '2026-09-03', end: '2026-09-01' },
      highlightedDates: ['2026-09-02'],
    }));
    expect(html).toContain('<select');
    expect(html).toContain('value="training" selected=""');
    expect(html).toContain('>Sleep hours</option>');
    expect(html).toContain('>Recovery score</option>');
    expect(html).toContain('Use as range start');
    expect(html).toContain('Use as range end');
    expect(html).toContain('Use only this day');
    expect(html).toContain('Clear range');
    expect(html).toContain('Shared range:');
    expect(html).toContain('Reversed endpoints are ordered earliest to latest.');
    expect(html).toContain('1 training · 1 rest · 1 missing');
    expect(html).toContain('Show full year');
    expect(html).toContain('Recent 4 weeks');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Rest · 0 min');
    expect(html).toContain('numerical bands, not health targets');
    expect(html).toContain('focus-visible:outline');
  });

  it('keeps uncontrolled selection fallback and handles cleared or out-of-history shared selection honestly', () => {
    const fallback = renderToStaticMarkup(createElement(CalendarHeatmap, { data }));
    expect(rectFor(fallback, '2026-09-03')).toContain('aria-selected="true"');
    const cleared = renderToStaticMarkup(createElement(CalendarHeatmap, { data, selectedDate: null }));
    expect(cleared).not.toContain('aria-selected="true"');
    expect(cleared).toContain('Select a day to set a range');
    expect(cleared).toContain('disabled=""');
    const outside = renderToStaticMarkup(createElement(CalendarHeatmap, { data, trends, selectedDate: '2026-08-31' }));
    expect(outside).not.toContain('aria-selected="true"');
    expect(outside).toContain('Training: No record');
    expect(outside).toContain('Sleep: No measurement · Recovery: No measurement');
    expect(renderToStaticMarkup(createElement(CalendarHeatmap, { data: [], trends })))
      .toContain('No training history yet.');
  });

  it('retains one keyboard entry per responsive grid across a full year and bounded arrow navigation', () => {
    const year = Array.from({ length: 365 }, (_, index) => cell(shiftChartDate('2025-09-04', index), 0));
    const html = renderToStaticMarkup(createElement(CalendarHeatmap, {
      data: year, trends, range: { start: '2026-09-01', end: '2026-09-03' },
    }));
    expect(html.match(/tabindex="0"/g)).toHaveLength(2);
    expect(html.match(/role="gridcell"/g)).toHaveLength(365 + 28);
    expect(html).not.toMatch(/<rect[^>]*tabindex/);
    expect(calendarArrowDate('2026-09-02', 'ArrowLeft', '2026-09-01', '2026-09-03')).toBe('2026-09-01');
    expect(calendarArrowDate('2026-09-02', 'ArrowDown', '2026-09-01', '2026-09-03')).toBe('2026-09-03');
    expect(calendarArrowDate('2026-09-02', 'Home', '2026-09-01', '2026-09-03')).toBe('2026-09-01');
    expect(calendarArrowDate('2026-09-02', 'End', '2026-09-01', '2026-09-03')).toBe('2026-09-03');
  });
});
