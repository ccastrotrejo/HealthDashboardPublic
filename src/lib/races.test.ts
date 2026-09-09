import { describe, expect, it } from 'vitest';
import { fuelingFor, guidanceForPhase, phaseFor, phaseLabel, projectFitness } from './races';
import type { FitnessPoint, RaceEvent } from './types';

const race: RaceEvent = {
  id: 'test-race', name: 'Test event', date: '2026-09-06', type: 'race',
  sport: 'run', priority: 'A', status: 'planned',
};

describe('race periodization', () => {
  it.each([
    [-1, 'past'], [0, 'race-day'], [1, 'race-week'], [7, 'race-week'],
    [8, 'taper'], [21, 'taper'], [22, 'peak'], [28, 'peak'],
    [29, 'build'], [70, 'build'], [71, 'base'],
  ] as const)('maps an A race %i days away to %s', (days, phase) => {
    expect(phaseFor(days, 'A')).toBe(phase);
    expect(guidanceForPhase(phase)).toMatchObject({ phase, label: phaseLabel(phase) });
  });

  it.each(['B', 'C'] as const)('shortens the taper for %s priority', (priority) => {
    expect(phaseFor(14, priority)).toBe('taper');
    expect(phaseFor(15, priority)).toBe('peak');
    expect(phaseFor(21, priority)).toBe('peak');
  });
});

describe('fitness projection', () => {
  const curve: FitnessPoint[] = [
    { date: '2026-09-01', load: 15, ctl: 10, atl: 12, tsb: -2 },
    { date: '2026-09-02', load: 15, ctl: 12, atl: 13, tsb: -1 },
    { date: '2026-09-03', load: 15, ctl: 14, atl: 14, tsb: 0 },
  ];

  it('does not fabricate values without historical observations', () => {
    expect(projectFitness([], race.date)).toEqual({
      series: [], current: null, raceDay: null, raceDate: race.date,
    });
  });

  it('projects the measured slope and leaves historical input intact', () => {
    const before = structuredClone(curve);
    const projection = projectFitness(curve, '2026-09-05');
    expect(projection.current).toEqual({ ctl: 14, atl: 14, tsb: 0 });
    expect(projection.series.map((point) => point.ctl)).toEqual([10, 12, 14, 16, 18]);
    expect(projection.series.map((point) => point.projected)).toEqual([false, false, false, true, true]);
    expect(projection.series.at(-1)?.date).toBe('2026-09-05');
    expect(projection.raceDay?.atl).toBeCloseTo(16.2);
    expect(projection.raceDay?.tsb).toBeCloseTo(1.8);
    expect(curve).toEqual(before);
  });

  it('uses a zero slope for a single observation', () => {
    const projection = projectFitness(curve.slice(0, 1), '2026-09-03');
    expect(projection.series.map((point) => point.ctl)).toEqual([10, 10, 10]);
    expect(projection.raceDay).toEqual({ ctl: 10, atl: 9, tsb: 1 });
  });

  it('never projects negative CTL as a declining trend reaches zero', () => {
    const descending = curve.map((point, index) => ({ ...point, ctl: 4 - index * 2 }));
    expect(projectFitness(descending, '2026-09-05').raceDay).toEqual({ ctl: 0, atl: 0, tsb: 0 });
  });

  it('returns observed race-day values without adding forecasts for past dates', () => {
    const projection = projectFitness(curve, '2026-09-02');
    expect(projection.series).toHaveLength(curve.length);
    expect(projection.raceDay).toEqual({ ctl: 12, atl: 13, tsb: -1 });
  });

  it('uses only the latest 28 samples to estimate the slope', () => {
    const history = Array.from({ length: 30 }, (_, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, '0')}`,
      load: 20, ctl: index < 2 ? 1000 : 20, atl: 20, tsb: 0,
    }));
    expect(projectFitness(history, '2026-09-01').raceDay).toEqual({ ctl: 20, atl: 18, tsb: 2 });
  });
});

describe('race fueling heuristics', () => {
  it('requires an estimated duration of at least half an hour', () => {
    expect(fuelingFor(race)).toBeNull();
    for (const hours of [0, -1, 0.49]) {
      expect(fuelingFor({ ...race, duration: { hours } })).toBeNull();
    }
  });

  it.each([
    [0.5, 0, 500], [0.99, 0, 500], [1, 30, 500], [1.99, 30, 500],
    [2, 60, 500], [2.01, 60, 700], [3, 75, 700],
  ])('computes totals and thresholds for %s hours', (hours, carbs, fluids) => {
    const plan = fuelingFor({ ...race, duration: { hours } }, 70);
    expect(plan).toMatchObject({
      durationHours: hours, carbsPerHour: carbs, fluidsPerHourMl: fluids,
      totalCarbsG: Math.round(hours * carbs), totalFluidsMl: Math.round(hours * fluids),
      preRaceCarbsG: 70, sodiumPerHourMg: hours > 2 ? 500 : 300,
    });
  });

  it.each([
    ['run', 9000, 1], ['ride', 25000, 1], ['swim', 2500, 1],
    ['tri', 25000, 1.5], ['tri', 60000, 3], ['tri', 100000, 6], ['other', 8000, 1],
  ] as const)('estimates %s duration from distance', (sport, meters, hours) => {
    expect(fuelingFor({ ...race, sport, distance: { meters, label: 'Test' } })?.durationHours).toBe(hours);
  });

  it('prefers explicit duration over distance and includes multisport context', () => {
    const plan = fuelingFor({
      ...race, sport: 'tri', duration: { hours: 2.5 },
      distance: { meters: 25000, label: 'Test' },
    });
    expect(plan?.durationHours).toBe(2.5);
    expect(plan?.notes.some((note) => note.includes('bike'))).toBe(true);
  });
});
