import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarHeatmap } from '../../src/components/LongTerm/CalendarHeatmap';
import { AcwrGauge } from '../../src/components/WeeklyView/AcwrGauge';
import { VolumeChart } from '../../src/components/WeeklyView/VolumeChart';
import { StepsWeekChart } from '../../src/components/DailyGlance/StepsWeekChart';
import { SleepRegularityChart } from '../../src/components/DailyGlance/SleepRegularityChart';
import { YearOverYearCard } from '../../src/components/LongTerm/YearOverYearCard';
import {
  acwrRatioToPercent, acwrUnitLabel, calendarArrowDate, chartDateTime,
  fitnessPlotSeries, formatChartClock, prPlotSeries, shiftChartDate,
  stepGoalState, stepsCalendarWeek, trainingCalendarDays, weeklyVolumeSummary,
  yearComparisonSeries, yearOrdinalDate,
} from '../../src/lib/chartRefinement';

afterEach(() => vi.useRealTimers());

describe('weekly chart comparisons', () => {
  const week = (weekStart: string, km: number) => ({ weekStart, km, bySport: { Run: km } });

  it('uses up to four prior weeks, never the displayed partial week itself', () => {
    const result = weeklyVolumeSummary([
      week('2026-08-31', 10), week('2026-08-03', 20), week('2026-07-27', 999),
      week('2026-08-10', 30), week('2026-08-17', 40), week('2026-08-24', 50),
    ], chartDateTime('2026-09-04'));
    expect(result.average).toBe(35);
    expect(result.comparisonWeeks).toBe(4);
    expect(result.latest?.km).toBe(10);
    expect(result.partial).toBe(true);
    expect(result.deltaPct).toBeCloseTo(-71.4286);
  });

  it('does not invent a comparison for a singleton or zero baseline', () => {
    expect(weeklyVolumeSummary([], 0).average).toBeNull();
    expect(weeklyVolumeSummary([week('2026-08-31', 10)], chartDateTime('2026-09-07')))
      .toMatchObject({ average: null, deltaPct: null, partial: false });
    expect(weeklyVolumeSummary([week('2026-08-24', 0), week('2026-08-31', 10)], 0))
      .toMatchObject({ average: 0, deltaPct: null, comparisonWeeks: 1 });
  });

  it('positions ACWR boundaries proportionally and preserves reported units', () => {
    expect([0, 0.8, 1.3, 1.5, 2].map(acwrRatioToPercent)).toEqual([0, 40, 65, 75, 100]);
    expect([-1, 3, NaN].map(acwrRatioToPercent)).toEqual([0, 100, 0]);
    expect(acwrUnitLabel()).toBe('km');
    expect(acwrUnitLabel('strain')).toBe('strain units');
    expect(acwrUnitLabel('sRPE')).toBe('sRPE units');
  });
});

describe('step observations and goal status', () => {
  it('renders calendar days, preserving a recorded zero and gaps as null', () => {
    const result = stepsCalendarWeek([
      { date: '2026-09-01', value: 0 }, { date: '2026-08-15', value: 10000 },
      { date: '2026-09-04', value: 8200 }, { date: '2026-09-05', value: 9000 },
    ], '2026-09-04');
    expect(result).toHaveLength(7);
    expect(result[0]?.date).toBe('2026-08-29');
    expect(result.find((point) => point.date === '2026-09-01')?.value).toBe(0);
    expect(result.filter((point) => point.value == null)).toHaveLength(5);
    expect(result.at(-1)?.value).toBe(8200);
  });

  it('never grades steps against an absent or invalid goal', () => {
    for (const goal of [null, 0, -1, NaN, Infinity]) {
      expect(stepGoalState(100, goal, false)).toBe('uncompared');
      expect(stepGoalState(100, goal, true)).toBe('uncompared');
    }
    expect(stepGoalState(null, 10000, false)).toBe('uncompared');
    expect(stepGoalState(10000, 10000, false)).toBe('met');
    expect(stepGoalState(100, 10000, false)).toBe('below');
    expect(stepGoalState(100, 10000, true)).toBe('today');
  });
});

describe('time-aligned chart series', () => {
  it('retains real zeros and breaks fitness curves at unobserved dates', () => {
    const input = [
      { date: '2026-09-03', ctl: 10, atl: 12, tsb: -2, load: 5 },
      { date: '2026-09-01', ctl: 0, atl: 0, tsb: 0, load: 0 },
    ];
    const result = fitnessPlotSeries(input);
    expect(result[0]).toMatchObject({ date: '2026-09-01', ctl: 0, atl: 0, tsb: 0 });
    expect(result[1]).toMatchObject({ date: '2026-09-02', ctl: null, atl: null, tsb: null });
    expect(result[2]?.tsb).toBe(-2);
    expect(input[0]?.date).toBe('2026-09-03');
    expect(fitnessPlotSeries([])).toEqual([]);
  });

  it('uses true effort timestamps with a chronological running minimum', () => {
    const result = prPlotSeries([
      { date: '2026-09-04T12:00:00Z', paceSecPerKm: 240, activityId: 3 },
      { date: '2026-01-01T12:00:00Z', paceSecPerKm: 300, activityId: 1 },
      { date: '2026-01-02T12:00:00Z', paceSecPerKm: 330, activityId: 2 },
    ]);
    expect(result.map((point) => point.best)).toEqual([300, 300, 240]);
    expect(result[1]!.timestamp - result[0]!.timestamp).toBe(86_400_000);
    expect(result[2]!.timestamp - result[1]!.timestamp).toBeGreaterThan(200 * 86_400_000);
  });

  it('retains same-day efforts and ignores invalid pace observations', () => {
    expect(prPlotSeries([
      { date: '2026-09-04T12:00:00Z', paceSecPerKm: 300, activityId: 1 },
      { date: '2026-09-04T14:00:00Z', paceSecPerKm: 280, activityId: 2 },
      { date: 'invalid', paceSecPerKm: 270, activityId: 3 },
      { date: '2026-09-04T15:00:00Z', paceSecPerKm: NaN, activityId: 4 },
    ]).map((point) => point.best)).toEqual([300, 280]);
  });

  it('keys yearly comparisons by reported ordinal rather than array position', () => {
    expect(yearComparisonSeries([{ doy: 0, km: 0 }, { doy: 2, km: 12 }], [{ doy: 1, km: 3 }]))
      .toEqual([
        { doy: 0, thisYear: 0, lastYear: null },
        { doy: 1, thisYear: null, lastYear: 3 },
        { doy: 2, thisYear: 12, lastYear: null },
      ]);
    expect(yearComparisonSeries([], [])).toEqual([]);
    expect(yearOrdinalDate(2024, 59)).toBe('2024-02-29');
    expect(yearOrdinalDate(2025, 59)).toBe('2025-03-01');
    expect(yearOrdinalDate(2026, 90)).toBe('2026-04-01');
  });

  it('keeps overnight clock labels valid at midnight and minute rollover', () => {
    expect(formatChartClock(23.999)).toBe('00:00');
    expect(formatChartClock(25.25)).toBe('01:15');
    expect(formatChartClock(31.5)).toBe('07:30');
    expect(formatChartClock(0)).toBe('00:00');
    expect(formatChartClock(NaN)).toBe('—');
  });
});

describe('calendar date navigation', () => {
  const cell = (date: string, minutes: number) => ({ date, minutes, bySport: { Run: minutes } });

  it('distinguishes missing observations from recorded rest and handles singleton data', () => {
    const days = trainingCalendarDays([cell('2026-09-03', 20), cell('2026-09-01', 0)]);
    expect(days.map((day) => day.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(days[0]?.cell?.minutes).toBe(0);
    expect(days[1]?.cell).toBeNull();
    expect(trainingCalendarDays([cell('2026-09-01', 0)])).toHaveLength(1);
    expect(trainingCalendarDays([])).toEqual([]);
  });

  describe('chart presentation markup', () => {
    it('gives each responsive calendar a single entry, never hundreds of tab stops', () => {
      const data = Array.from({ length: 365 }, (_, index) => ({
        date: shiftChartDate('2025-09-05', index), minutes: index % 2 ? 30 : 0, bySport: {},
      }));
      const html = renderToStaticMarkup(createElement(CalendarHeatmap, { data }));
      // Desktop and mobile versions are mutually exclusive through responsive display classes.
      expect(html.match(/role="grid"/g)).toHaveLength(2);
      expect(html.match(/tabindex="0"/g)).toHaveLength(2);
      expect(html).not.toMatch(/<rect[^>]*tabindex/);
      expect(html.match(/aria-activedescendant=/g)).toHaveLength(2);
      expect(html).toContain('Show full year');
      expect(html).toContain('Recent 4 weeks');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('2026');
    });

    it('renders sparse calendar days as missing rather than rest', () => {
      const html = renderToStaticMarkup(createElement(CalendarHeatmap, { data: [
        { date: '2026-09-01', minutes: 0, bySport: {} },
        { date: '2026-09-03', minutes: 30, bySport: { Run: 30 } },
      ] }));
      expect(html).toContain('1 training · 1 rest · 1 missing');
      expect(html).toContain('No record');
      expect(html).toContain('30m');
    });

    it.each(['strain', 'sRPE'] as const)('prints %s measurements with proportionally positioned bounds', (unit) => {
      const html = renderToStaticMarkup(createElement(AcwrGauge, {
        data: { acuteKm: 10, chronicKm: 10, ratio: 1, zone: 'sweet-spot', unit },
      }));
      expect(html).toContain(`${unit} units`);
      expect(html).toContain('left:40%');
      expect(html).toContain('left:65%');
      expect(html).toContain('left:75%');
      expect(html).not.toContain('10.0 km');
    });

    it('shows missing-goal steps without goal grading or palette jargon', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-04T12:00:00'));
      const html = renderToStaticMarkup(createElement(StepsWeekChart, {
        trend: [{ date: '2026-09-04', value: 100 }], goal: null,
      }));
      const text = html.replace(/<[^>]*>/g, '');
      expect(text).toContain('no goal reported');
      expect(text).toContain('Recorded steps');
      expect(text).not.toContain('Below goal');
      expect(text).not.toMatch(/sage|cool|terra/);
      expect(text).toContain('6 days missing');
    });

    it('discloses the partial current week and excludes it from the comparator', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-04T12:00:00Z'));
      const html = renderToStaticMarkup(createElement(VolumeChart, { data: [
        { weekStart: '2026-08-24', km: 20, bySport: {} },
        { weekStart: '2026-08-31', km: 10, bySport: {} },
      ] }));
      expect(html).toContain('so far this week');
      expect(html).toContain('prior 1-week average');
      expect(html).toContain('excluding the latest week');
      expect(html).toContain('20.0 km');
      expect(html).toContain('-50%');
    });

    it('labels overnight clock times without relabeling UTC night dates as local dates', () => {
      const html = renderToStaticMarkup(createElement(SleepRegularityChart, { data: [
        { date: '2026-09-01', bedHourLocal: 23, wakeHourLocal: 31 },
        { date: '2026-09-03', bedHourLocal: 25.25, wakeHourLocal: 31.5 },
        { date: '2026-09-02', bedHourLocal: 24, wakeHourLocal: 32 },
      ] }));
      expect(html).toContain('01:15');
      expect(html).toContain('07:30');
      expect(html).toContain('sleep-start date (UTC)');
      expect(html).toContain('not sleep stages');
    });

    it('labels yearly ordinal comparisons with actual dates across a leap year', () => {
      const html = renderToStaticMarkup(createElement(YearOverYearCard, {
        thisYearNum: 2025,
        data: { thisYear: [{ doy: 59, km: 20 }], lastYear: [{ doy: 59, km: 30 }], ytdKm: 20, ytdKmLastYear: 30 },
      }));
      expect(html).toContain('Mar 1');
      expect(html).toContain('Feb 29');
      expect(html).toContain('aligned by day of year');
      expect(html).not.toContain('text-terra-ink');
    });
  });

  it('limits full history to the latest year without fabricating older observations', () => {
    const days = trainingCalendarDays([cell('2020-01-01', 5), cell('2026-09-04', 5)]);
    expect(days).toHaveLength(365);
    expect(days[0]?.date).toBe('2025-09-05');
    expect(days.at(-1)?.date).toBe('2026-09-04');
  });

  it('supports day/week arrows and clamps keyboard navigation to visible dates', () => {
    const first = '2026-08-08';
    const last = '2026-09-04';
    expect(calendarArrowDate('2026-08-31', 'ArrowLeft', first, last)).toBe('2026-08-24');
    expect(calendarArrowDate('2026-08-31', 'ArrowUp', first, last)).toBe('2026-08-30');
    expect(calendarArrowDate('2026-08-31', 'ArrowDown', first, last)).toBe('2026-09-01');
    expect(calendarArrowDate('2026-08-31', 'ArrowRight', first, last)).toBe(last);
    expect(calendarArrowDate(first, 'ArrowUp', first, last)).toBe(first);
    expect(calendarArrowDate('2026-08-31', 'Home', first, last)).toBe(first);
    expect(calendarArrowDate(first, 'End', first, last)).toBe(last);
    expect(shiftChartDate('2026-03-08', 1)).toBe('2026-03-09');
  });
});
