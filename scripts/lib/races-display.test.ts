import { describe, expect, it } from 'vitest';
import type { FitnessProjection } from '../../src/lib/races';
import type { RaceEvent } from '../../src/lib/types';
import {
  formatRaceTime,
  orderRaceDisplay,
  raceDaysUntil,
  raceTsbZeroOffset,
  segmentRaceForecast,
} from '../../src/components/Races/raceDisplay';

function race(id: string, date: string, result = false): RaceEvent {
  return {
    id,
    name: id,
    date,
    type: 'race',
    sport: 'run',
    priority: 'A',
    status: 'planned',
    ...(result ? { result: { finishSeconds: 1500 } } : {}),
  };
}

describe('race display ordering', () => {
  const now = new Date('2026-09-04T21:00:00Z');

  it('leads with the nearest upcoming race regardless of input order', () => {
    const races = [race('later', '2026-10-01'), race('past', '2026-08-31', true), race('next', '2026-09-05')];
    const { primary, upcoming, past } = orderRaceDisplay(races, now);
    expect(primary?.id).toBe('next');
    expect(upcoming.map((item) => item.id)).toEqual(['next', 'later']);
    expect(past.map((item) => item.id)).toEqual(['past']);
    expect(races.map((item) => item.id)).toEqual(['later', 'past', 'next']);
  });

  it('keeps race day upcoming, with a zero-day countdown before and after noon', () => {
    for (const time of ['00:00:00', '11:59:59', '12:00:01', '23:59:59']) {
      const raceDay = new Date(`2026-09-04T${time}Z`);
      expect(raceDaysUntil('2026-09-04', raceDay)).toBe(0);
      expect(orderRaceDisplay([race('today', '2026-09-04')], raceDay).upcoming).toHaveLength(1);
    }
    expect(raceDaysUntil('2026-09-05', now)).toBe(1);
    expect(raceDaysUntil('2026-09-03', now)).toBe(-1);
  });

  it('shows the newest recorded result when all events are past, keeping unscored events', () => {
    const races = [
      race('recent-no-result', '2026-08-23'),
      race('old-result', '2024-08-24', true),
      race('latest-result', '2025-08-24', true),
    ];
    const { primary, upcoming, past } = orderRaceDisplay(races, now);
    expect(upcoming).toEqual([]);
    expect(primary?.id).toBe('latest-result');
    expect(past.map((item) => item.id)).toEqual(['recent-no-result', 'latest-result', 'old-result']);
  });

  it('falls back to the newest past event if no result is recorded', () => {
    const result = orderRaceDisplay([race('older', '2025-01-01'), race('newest', '2026-09-01')], now);
    expect(result.primary?.id).toBe('newest');
  });

  it('represents an empty calendar without a primary race', () => {
    expect(orderRaceDisplay([], now)).toEqual({ upcoming: [], past: [], primary: null });
  });

  it('retains the entire past-race archive', () => {
    const races = Array.from({ length: 14 }, (_, index) => race(`race-${index}`, `2025-01-${String(index + 1).padStart(2, '0')}`, true));
    expect(orderRaceDisplay(races, now).past).toHaveLength(14);
  });
});

describe('race forecast display', () => {
  const series: FitnessProjection['series'] = [
    { date: '2026-09-01', ctl: 30, atl: 35, tsb: -5, projected: false },
    { date: '2026-09-02', ctl: 32, atl: 34, tsb: -2, projected: false },
    { date: '2026-09-03', ctl: 34, atl: 30.6, tsb: 3.4, projected: true },
    { date: '2026-09-04', ctl: 36, atl: 32.4, tsb: 3.6, projected: true },
  ];

  it('stops solid CTL at the observed boundary and starts the dashed line there', () => {
    const { rows, boundaryDate } = segmentRaceForecast(series);
    expect(boundaryDate).toBe('2026-09-02');
    expect(rows.map((point) => point.observedCtl)).toEqual([30, 32, null, null]);
    expect(rows.map((point) => point.forecastCtl)).toEqual([null, 32, 34, 36]);
    expect(rows.map((point) => point.tsb)).toEqual([-5, -2, 3.4, 3.6]);
    expect(series[0]).not.toHaveProperty('observedCtl');
  });

  describe('race timing display', () => {
    it('keeps seconds in finishes, splits and rounded estimates', () => {
      expect(formatRaceTime(4500)).toBe('1:15:00');
      expect(formatRaceTime(3601)).toBe('1:00:01');
      expect(formatRaceTime(1531)).toBe('25:31');
      expect(formatRaceTime(59.5)).toBe('1:00');
      expect(formatRaceTime(0)).toBe('0:00');
      expect(formatRaceTime(Number.NaN)).toBe('—');
      expect(formatRaceTime(-1)).toBe('—');
    });

    it('preserves official hundredths without adding precision to estimates or older results', () => {
      expect(formatRaceTime(4200.03, 2)).toBe('1:10:00.03');
      expect(formatRaceTime(900.12, 2)).toBe('15:00.12');
      expect(formatRaceTime(100.23, 2)).toBe('1:40.23');
      expect(formatRaceTime(1800.34, 2)).toBe('30:00.34');
      expect(formatRaceTime(80.45, 2)).toBe('1:20.45');
      expect(formatRaceTime(1318.86, 2)).toBe('21:58.86');
      expect(formatRaceTime(4500, 2)).toBe('1:15:00');
      expect(formatRaceTime(1509.288315)).toBe('25:09');
    });

    it('carries hundredth rounding across minute and hour boundaries', () => {
      expect(formatRaceTime(59.5, 2)).toBe('0:59.50');
      expect(formatRaceTime(59.999, 2)).toBe('1:00');
      expect(formatRaceTime(3599.999, 2)).toBe('1:00:00');
      expect(formatRaceTime(0.01, 2)).toBe('0:00.01');
      expect(formatRaceTime(0, 2)).toBe('0:00');
      expect(formatRaceTime(Infinity, 2)).toBe('—');
      expect(formatRaceTime(-1, 2)).toBe('—');
    });
  });

  it('does not fabricate a forecast when every point is observed', () => {
    const { rows, boundaryDate } = segmentRaceForecast(series.slice(0, 2));
    expect(boundaryDate).toBe('2026-09-02');
    expect(rows.every((point) => point.forecastCtl == null)).toBe(true);
  });

  it('handles an empty series or missing observed boundary honestly', () => {
    expect(segmentRaceForecast([])).toEqual({ rows: [], boundaryDate: null });
    const result = segmentRaceForecast(series.slice(2));
    expect(result.boundaryDate).toBeNull();
    expect(result.rows.every((point) => point.observedCtl == null)).toBe(true);
  });

  it('places the TSB fill transition exactly at zero', () => {
    expect(raceTsbZeroOffset([-20, -5, 10])).toBeCloseTo(1 / 3);
    expect(raceTsbZeroOffset([5, 10])).toBe(1);
    expect(raceTsbZeroOffset([-10, -5])).toBe(0);
    expect(raceTsbZeroOffset([0])).toBe(1);
    expect(raceTsbZeroOffset([])).toBe(1);
  });
});
