import { describe, expect, it } from 'vitest';
import { computeCyclingAnalytics, computeFitnessCurve, dailyLoad } from './analytics.js';
import { computeCyclingFacts } from './facts.js';
import type { CyclingProfile, RideStreamMetrics, Snapshot, StravaActivity } from './types.js';

const NOW = new Date('2026-08-31T12:00:00Z');
const PROFILE: CyclingProfile = {
  ftpWatts: 200, ftpSource: 'manual', ftpTestedOn: '2026-08-01', weightKg: 80,
  lthr: 170, maxHr: 190, restingHr: 50,
};

function ride(over: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 1, name: 'Synthetic ride', sport_type: 'Ride',
    start_date: '2026-08-31T10:00:00Z', start_date_local: '2026-08-31T06:00:00Z',
    distance: 30000, moving_time: 3600, elapsed_time: 3600, total_elevation_gain: 0,
    average_speed: 8.3, max_speed: 12, has_heartrate: true, average_heartrate: 110,
    device_watts: true, average_watts: 200, weighted_average_watts: 200,
    ...over,
  };
}

function stream(over: Partial<RideStreamMetrics> = {}): RideStreamMetrics {
  return {
    activityId: 1, date: '2026-08-31T10:00:00Z', np: 200, decouplingPct: 3,
    efFirst: 1.8, efSecond: 1.7, meanMaximalPower: { '60': 300, '1200': 200 },
    movingTimeSeconds: 3600, ...over,
  };
}

describe('dailyLoad and fitness propagation', () => {
  it('prefers calibrated power over HR and suffer score, then falls back to HR', () => {
    expect(dailyLoad(ride({ suffer_score: 500 }), PROFILE)).toBe(100);
    expect(dailyLoad(ride({ device_watts: false, suffer_score: 500 }), PROFILE)).toBe(25);
  });

  it('falls back to suffer score after rejecting implausible HR, then to duration and intensity', () => {
    const invalidHr = ride({ device_watts: false, average_heartrate: 60, suffer_score: 42 });
    expect(dailyLoad(invalidHr, PROFILE)).toBe(42);
    expect(dailyLoad(ride({ device_watts: false, has_heartrate: false, average_heartrate: undefined }), PROFILE))
      .toBe(120);
  });

  it('adds same-day loads, updates both EWMAs, and decays fitness during a rest day', () => {
    const activities = [
      ride({ start_date: '2026-08-30T10:00:00Z', suffer_score: 70 }),
      ride({ id: 2, start_date: '2026-08-30T14:00:00Z', suffer_score: 30 }),
    ];
    const curve = computeFitnessCurve(activities, NOW, 2);
    expect(curve).toHaveLength(2);
    const [loaded, rested] = curve;
    expect(loaded).toMatchObject({ date: '2026-08-30', load: 100 });
    expect(loaded!.ctl).toBeCloseTo(100 / 42);
    expect(loaded!.atl).toBeCloseTo(100 / 7);
    expect(rested!.load).toBe(0);
    expect(rested!.ctl).toBeCloseTo(loaded!.ctl * 41 / 42);
    expect(rested!.atl).toBeCloseTo(loaded!.atl * 6 / 7);
    expect(rested!.tsb).toBeCloseTo(rested!.ctl - rested!.atl);
  });

  it('warms up before the visible range instead of dropping earlier training load', () => {
    const curve = computeFitnessCurve([ride({ start_date: '2026-08-25T10:00:00Z', suffer_score: 100 })], NOW, 2);
    expect(curve[0]!.load).toBe(0);
    expect(curve[0]!.ctl).toBeGreaterThan(0);
    expect(curve[0]!.atl).toBeGreaterThan(curve[0]!.ctl);
  });
});

describe('computeCyclingAnalytics', () => {
  it('weights power coverage by duration and separates training rides, commutes, and non-cycling sports', () => {
    const result = computeCyclingAnalytics([
      ride({ trainer: true }),
      ride({ id: 2, moving_time: 1800, device_watts: false }),
      ride({ id: 3, moving_time: 600, distance: 3000, commute: true, device_watts: false }),
      ride({ id: 4, sport_type: 'Run', moving_time: 7200 }),
      ride({ id: 5, start_date: '2026-08-01T10:00:00Z' }),
    ], NOW, PROFILE, [], []);
    expect(result.week).toMatchObject({
      rides: 2, commutes: 1, hours: 1.7, indoorHours: 1, outdoorHours: 0.7, powerCoveragePct: 60,
    });
    expect(result.ctlRampPerWeek).toBeNull();
    expect(result.baseGate).toBeNull();
    expect(result.powerCurve).toEqual({});
  });

  it('chooses the longest qualifying ride for the base gate, not the latest or easiest', () => {
    const result = computeCyclingAnalytics([], NOW, PROFILE, [], [], [
      stream({ activityId: 1, date: '2026-08-29T10:00:00Z', movingTimeSeconds: 7200, decouplingPct: 6 }),
      stream({ activityId: 2, date: '2026-08-30T10:00:00Z', movingTimeSeconds: 3600, decouplingPct: 1 }),
      stream({ activityId: 3, movingTimeSeconds: 1800, decouplingPct: 0 }),
    ]);
    expect(result.baseGate).toMatchObject({ passing: false });
    expect(result.baseGate?.reason).toContain('6% over 120 min');
    expect(result.decouplingTrend.map((point) => point.date)).toEqual(['2026-08-29', '2026-08-30', '2026-08-31']);
  });

  it.each([[4.99, true], [5, false]] as const)('uses a strict 5%% decoupling gate for %s', (decouplingPct, passing) => {
    const result = computeCyclingAnalytics([], NOW, PROFILE, [], [], [stream({ decouplingPct })]);
    expect(result.baseGate?.passing).toBe(passing);
  });

  it('aggregates measured duration maxima only within the 90-day stream window', () => {
    const result = computeCyclingAnalytics([], NOW, PROFILE, [], [], [
      stream({ meanMaximalPower: { '60': 300, '1200': 200 } }),
      stream({ activityId: 2, meanMaximalPower: { '60': 290, '1200': 220, '3600': 180 } }),
      stream({ activityId: 3, date: '2026-01-01', meanMaximalPower: { '60': 999, '5': 1200 } }),
    ]);
    expect(result.powerCurve).toEqual({ '60': 300, '1200': 220, '3600': 180 });
  });
});

describe('computeCyclingFacts', () => {
  function snapshot(): Snapshot {
    return {
      syncedAt: NOW.toISOString(), pipelineVersion: 'test',
      counts: { recoveries: 0, sleeps: 0, cycles: 0, workouts: 0, activities: 0, garminDays: 0 },
      daily: null, weekly: null, longTerm: null, garmin: null,
      cycling: computeCyclingAnalytics([], NOW, PROFILE, [], []),
    };
  }

  it('does not invent cycling facts without a cycling block', () => {
    expect(computeCyclingFacts({ ...snapshot(), cycling: null })).toBeNull();
  });

  it.each([
    [0, 'target, not a measurement'],
    [79, 'heart-rate or perceived-effort target'],
    [80, 'prescribe in watts throughout'],
  ])('qualifies watt prescriptions at %i%% measured-power coverage', (coverage, note) => {
    const input = snapshot();
    input.cycling!.week.powerCoveragePct = Number(coverage);
    expect(computeCyclingFacts(input)?.coverageNote).toContain(String(note));
  });

  it('requires four steady rides for an EF trend and renders measured power durations in numeric order', () => {
    const input = snapshot();
    input.cycling!.efTrend = [
      { date: '2026-08-01', ef: 1 }, { date: '2026-08-08', ef: 1 },
      { date: '2026-08-15', ef: 1.2 }, { date: '2026-08-22', ef: 1.2 },
    ];
    input.cycling!.powerCurve = { '1200': 200, '60': 300, '5': 600 };
    input.cycling!.ctlRampPerWeek = 7.1;
    const result = computeCyclingFacts(input);
    expect(result?.efTrendNote).toContain('up 20.0%');
    expect(result?.powerCurveText).toBe('5s 600W · 1min 300W · 20min 200W');
    expect(result?.rampNote).toContain('above the 5-7 ceiling');
    input.cycling!.efTrend.pop();
    input.cycling!.ctlRampPerWeek = 7;
    expect(computeCyclingFacts(input)).toMatchObject({ efTrendNote: null, rampNote: null });
  });
});
