import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { scaleLinear, scaleUtc } from 'd3-scale';
import {
  brushDateRange, correlationDatesInBrush, correlationMatrix, dateRangeDays, explorerDays,
  includeExplorationDate, inDateRange, isCalendarDate,
  metricPairs, trendRange,
} from '../../src/lib/exploration';
import type { DailyAnalytics, DailyTrendPoint, Snapshot } from '../../src/lib/types';
import { CorrelationPanel } from '../../src/components/DailyGlance/CorrelationPanel';
import { RecoveryExplorer } from '../../src/components/Review/RecoveryExplorer';
import { DateRangeControls } from '../../src/components/Review/DateRangeControls';
import { calendarRangeFromSelection } from '../../src/lib/calendarMetrics';

const series = (values: (number | null)[]): DailyTrendPoint[] => values.map((value, index) => ({
  date: `2026-09-0${index + 1}`, value,
}));
const trends: DailyAnalytics['trends'] = {
  asleepHours: series([6, 7, null, 8, 7]),
  hrv: series([40, 50, 60, 70, 80]),
  rhr: series([60, 59, 58, 57, 56]),
  dayStrain: series([0, 5, 10, 15, 12]),
  recoveryScore: series([40, 50, 60, null, 80]),
};
const snapshot: Snapshot = {
  syncedAt: '2026-09-05T12:00:00Z',
  pipelineVersion: 'test',
  counts: { recoveries: 5, sleeps: 5, workouts: 0, cycles: 5, activities: 0, garminDays: 0 },
  daily: {
    date: '2026-09-05', recovery: null, sleep: null, dayStrain: null,
    todaysCall: { intensity: 'easy', title: 'Easy', reasons: [] },
    trends, anomalies: [], sleepRegularity: [], agreement: [],
  },
  weekly: null, longTerm: null, garmin: null,
};

describe('exploration calendar and date alignment', () => {
  it('validates real calendar dates rather than accepting rolled-over dates', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '', '2026-9-1', '2026-09-01T01:00:00Z']) {
      expect(isCalendarDate(value)).toBe(false);
    }
  });

  it('includes both ends across daylight saving and rejects a reversed window', () => {
    expect(dateRangeDays({ start: '2026-03-07', end: '2026-03-10' }))
      .toEqual(['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
    expect(dateRangeDays({ start: '2026-09-05', end: '2026-09-01' })).toEqual([]);
    expect(dateRangeDays({ start: 'invalid', end: '2026-09-01' })).toEqual([]);
    expect(inDateRange('2026-09-05', { start: '2026-09-01', end: '2026-09-05' })).toBe(true);
    expect(inDateRange('2026-09-06', { start: '2026-09-01', end: '2026-09-05' })).toBe(false);
  });

  it('computes availability from date keys even when measurements are missing', () => {
    expect(trendRange(trends)).toEqual({ start: '2026-09-01', end: '2026-09-05' });
    expect(trendRange({ asleepHours: [], hrv: [], rhr: [], dayStrain: [] })).toBeNull();
  });

  it('accepts optional trend fields explicitly set to undefined in older callers', () => {
    expect(trendRange({ ...trends, recoveryScore: undefined, sleepEfficiency: undefined }))
      .toEqual({ start: '2026-09-01', end: '2026-09-05' });
  });

  it('preserves existing calendar endpoints while inspecting outside dates', () => {
    const initial = { start: '2026-09-01', end: '2026-09-03' };
    const expanded = includeExplorationDate('2026-08-29', initial);
    expect(expanded).toEqual({ start: '2026-08-29', end: '2026-09-03' });
    expect(calendarRangeFromSelection('2026-08-29', 'start', expanded)).toEqual(expanded);
    const later = includeExplorationDate('2026-09-05', initial);
    expect(calendarRangeFromSelection('2026-09-05', 'end', later))
      .toEqual({ start: '2026-09-01', end: '2026-09-05' });
    expect(includeExplorationDate('2026-09-02', initial)).toEqual(initial);
    expect(includeExplorationDate('2026-09-02', null)).toEqual({ start: '2026-09-02', end: '2026-09-02' });
  });

  describe('D3 brush interaction logic', () => {
    it('converts a brush ending at midnight to the last included calendar day', () => {
      expect(brushDateRange(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-04T00:00:00Z'), '2026-09-05'))
        .toEqual({ start: '2026-09-01', end: '2026-09-03' });
    });

    it('keeps partially selected days and a zero-width selection on the same date', () => {
      expect(brushDateRange(new Date('2026-09-02T12:00:00Z'), new Date('2026-09-03T12:00:00Z'), '2026-09-05'))
        .toEqual({ start: '2026-09-02', end: '2026-09-03' });
      const instant = new Date('2026-09-02T00:00:00Z');
      expect(brushDateRange(instant, instant, '2026-09-05')).toEqual({ start: '2026-09-02', end: '2026-09-02' });
    });

    it.each([240, 768, 1440])('preserves full-window dates at a %i-pixel chart width', (width) => {
      const scale = scaleUtc().domain([new Date('2026-03-07T00:00:00Z'), new Date('2026-03-11T00:00:00Z')])
        .range([0, width]).clamp(true);
      expect(brushDateRange(scale.invert(-10), scale.invert(width + 10), '2026-03-10'))
        .toEqual({ start: '2026-03-07', end: '2026-03-10' });
      expect(brushDateRange(scale.invert(width), scale.invert(width), '2026-03-10'))
        .toEqual({ start: '2026-03-10', end: '2026-03-10' });
    });

    it('handles the year boundary without including the excluded final day', () => {
      expect(brushDateRange(new Date('2026-12-31T20:00:00Z'), new Date('2027-01-02T00:00:00Z'), '2027-01-05'))
        .toEqual({ start: '2026-12-31', end: '2027-01-01' });
    });

    it.each([240, 768, 1440])('selects scatter dates in rendered coordinates at %i pixels, including inverted Y', (width) => {
      const points = [
        { date: '2026-09-01', x: 2, y: 8 }, { date: '2026-09-02', x: 5, y: 5 },
        { date: '2026-09-03', x: 8, y: 2 }, { date: '2026-09-04', x: 9, y: 9 },
        { date: '2026-09-05', x: 5, y: 5 },
      ];
      const x = scaleLinear().domain([0, 10]).range([48, width - 20]);
      const y = scaleLinear().domain([0, 10]).range([190, 15]);
      const selected = correlationDatesInBrush(points, [[x(2), y(8)], [x(8), y(2)]], x, y);
      expect(selected).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-05']);
      expect(correlationDatesInBrush(points, [[0, 0], [1, 1]], x, y)).toEqual([]);
      expect(correlationDatesInBrush([], [[0, 0], [width, 200]], x, y)).toEqual([]);
      expect(points.map((point) => point.date)).toHaveLength(5);
    });
  });

  it('requires both observations in a lagged pair to belong to the selected dates', () => {
    expect(metricPairs(trends, 'asleepHours', 'hrv', 1, { start: '2026-09-02', end: '2026-09-04' }))
      .toEqual([{ date: '2026-09-02', x: 7, y: 60 }]);
    expect(metricPairs(trends, 'asleepHours', 'hrv', 0, { start: '2026-09-02', end: '2026-09-04' }))
      .toEqual([{ date: '2026-09-02', x: 7, y: 50 }, { date: '2026-09-04', x: 8, y: 70 }]);
  });

  it('keeps explicit zero, absent dates, nonfinite values and missing source fields distinct', () => {
    const days = explorerDays({ ...trends, hrv: series([NaN, Infinity, 0]) }, [
      { date: '2026-09-01', load: 0, ctl: 1, atl: 1, tsb: 0 },
    ], { start: '2026-09-01', end: '2026-09-06' });
    expect(days[0]).toMatchObject({ load: 0, hrv: null });
    expect(days[1]).toMatchObject({ load: null, hrv: null });
    expect(days[2]).toMatchObject({ hrv: 0, asleepHours: null });
    expect(days[5]).toEqual({ date: '2026-09-06', load: null, hrv: null, asleepHours: null, recoveryScore: null });
  });
});

describe('personal patterns matrix', () => {
  it('computes all metric pairs with sample counts and unsupported series left unavailable', () => {
    const matrix = correlationMatrix(trends, 0, null);
    expect(matrix).toHaveLength(6);
    expect(matrix[0]).toHaveLength(6);
    expect(matrix[1]![2]).toMatchObject({ x: 'hrv', y: 'rhr', r: -1, n: 5 });
    expect(matrix[0]![5]).toMatchObject({ r: null, n: 0 });
  });

  it('does not turn an uncomputable short-window association into a zero', () => {
    const cell = correlationMatrix(trends, 1, { start: '2026-09-01', end: '2026-09-02' })[0]![1]!;
    expect(cell.n).toBe(1);
    expect(cell.r).toBeNull();
  });

  it('renders named metric controls, lagged observation dates and causality caveats', () => {
    const html = renderToStaticMarkup(createElement(CorrelationPanel, { trends }));
    expect(html).toContain('Pearson correlation matrix');
    expect(html).toContain('Day alignment');
    expect(html).toContain('Highlight 2026-09-01');
    expect(html).toContain('Outcome date');
    expect(html).toContain('Correlation is not causation');
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});

describe('recovery explorer presentation', () => {
  it('renders usable date controls and exact daily values without complete source coverage', () => {
    const html = renderToStaticMarkup(createElement(RecoveryExplorer, {
      snapshot, range: null, selectedDate: null, highlightedDates: [],
      onRangeChange: () => {}, onSelectDate: () => {},
    }));
    expect(html).toContain('Recovery &amp; training explorer');
    expect(html).toContain('type="date"');
    expect(html).toContain('type="range"');
    expect(html).toContain('Daily values and selection');
    expect(html).toContain('No measurements in this period');
    expect(html).toContain('an empty list does not establish a rest day');
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it('shows an honest singleton selection outside physiological coverage', () => {
    const html = renderToStaticMarkup(createElement(RecoveryExplorer, {
      snapshot, range: { start: '2026-08-01', end: '2026-08-01' },
      selectedDate: '2026-08-01', highlightedDates: [],
      onRangeChange: () => {}, onSelectDate: () => {},
    }));
    expect(html).toContain('0/1 days recorded');
    expect(html).toContain('No measurement');
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it('provides non-dragging range controls with names and bounds', () => {
    const html = renderToStaticMarkup(createElement(DateRangeControls, {
      bounds: { start: '2026-08-01', end: '2026-09-05' }, range: null, onChange: () => {},
    }));
    expect(html).toContain('min="2026-08-01"');
    expect(html).toContain('max="2026-09-05"');
    expect(html).toContain('Apply dates');
    expect(html).toContain('Last 7 days');
    expect(html).toContain('Reset');
  });
});
