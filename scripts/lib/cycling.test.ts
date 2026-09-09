import { describe, expect, it } from 'vitest';

import {
  cogganTier,
  computeDecoupling,
  meanMaximalPower,
  normalizedPowerFromStream,
  dedupeIndoorRides,
  efficiencyFactor,
  ftpFrom20Min,
  ftpFromRamp,
  ftpRetestDue,
  hasRealPower,
  hrLooksImplausible,
  hrTss,
  intensityFactor,
  isCommute,
  isIndoorRide,
  isRide,
  normalizedPower,
  powerZones,
  resolveCyclingProfile,
  rideTss,
  rpeFromIntensityFactor,
  sweetSpotWatts,
  variabilityIndex,
  wattsPerKg,
  zoneForWatts,
} from './cycling.js';
import type { CyclingProfile, StravaActivity } from './types.js';

function ride(over: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 1,
    name: 'Ride',
    sport_type: 'Ride',
    start_date: '2026-08-01T10:00:00Z',
    start_date_local: '2026-08-01T06:00:00Z',
    distance: 30_000,
    moving_time: 3600,
    elapsed_time: 3600,
    total_elevation_gain: 200,
    average_speed: 8.3,
    max_speed: 14,
    has_heartrate: true,
    average_heartrate: 140,
    ...over,
  };
}

const profile: CyclingProfile = {
  ftpWatts: 200,
  ftpSource: '20min-test',
  ftpTestedOn: '2026-06-01',
  weightKg: 79,
  lthr: 170,
  maxHr: 190,
  restingHr: 50,
};

describe('sport predicates', () => {
  it('recognises ride-family sports but not e-bikes', () => {
    expect(isRide('Ride')).toBe(true);
    expect(isRide('VirtualRide')).toBe(true);
    expect(isRide('GravelRide')).toBe(true);
    expect(isRide('EBikeRide')).toBe(false);
    expect(isRide('Run')).toBe(false);
  });

  it('treats trainer and virtual rides as indoor', () => {
    expect(isIndoorRide(ride({ trainer: true }))).toBe(true);
    expect(isIndoorRide(ride({ sport_type: 'VirtualRide' }))).toBe(true);
    expect(isIndoorRide(ride())).toBe(false);
  });
});

describe('hasRealPower', () => {
  it('accepts a ride with a power meter', () => {
    expect(hasRealPower(ride({ device_watts: true, average_watts: 180 }))).toBe(true);
  });

  it('rejects Strava estimated power', () => {
    expect(hasRealPower(ride({ device_watts: false, average_watts: 180 }))).toBe(false);
  });

  it('rejects running power from cycling efforts', () => {
    const run = ride({ sport_type: 'Run', device_watts: true, average_watts: 300 });
    expect(hasRealPower(run)).toBe(false);
  });
});

describe('commute detection', () => {
  it('flags short utility rides', () => {
    expect(isCommute(ride({ moving_time: 840, distance: 4_500 }))).toBe(true);
  });

  it('does not flag a long ride', () => {
    expect(isCommute(ride({ moving_time: 5400, distance: 45_000 }))).toBe(false);
  });

  it('honours Strava\u2019s own flag', () => {
    expect(isCommute(ride({ moving_time: 5400, distance: 45_000, commute: true }))).toBe(true);
  });

  it('never treats a trainer session as a commute', () => {
    expect(isCommute(ride({ moving_time: 600, distance: 3_000, trainer: true }))).toBe(false);
  });
});

describe('dedupeIndoorRides', () => {
  it('drops the head-unit recording that overlaps Zwift activities', () => {
    // Synthetic 20- and 30-minute routes overlap one hour-long recording.
    const zwiftA = ride({
      id: 1,
      sport_type: 'VirtualRide',
      start_date: '2024-01-15T10:00:00Z',
      start_date_local: '2024-01-15T10:00:00Z',
      moving_time: 1200,
      elapsed_time: 1200,
      device_watts: true,
      average_watts: 150,
    });
    const zwiftB = ride({
      id: 2,
      sport_type: 'VirtualRide',
      start_date: '2024-01-15T10:25:00Z',
      start_date_local: '2024-01-15T10:25:00Z',
      moving_time: 1800,
      elapsed_time: 1800,
      device_watts: true,
      average_watts: 160,
    });
    const headUnit = ride({
      id: 3,
      sport_type: 'Ride',
      trainer: true,
      start_date: '2024-01-15T10:00:00Z',
      start_date_local: '2024-01-15T10:00:00Z',
      moving_time: 3600,
      elapsed_time: 3600,
      device_watts: true,
      average_watts: 140,
    });

    const out = dedupeIndoorRides([zwiftA, zwiftB, headUnit]);
    expect(out.map((a) => a.id)).toEqual([1, 2]);
  });

  it('keeps two genuinely separate Zwift rides on the same day', () => {
    const first = ride({
      id: 1,
      sport_type: 'VirtualRide',
      start_date: '2025-12-05T12:00:00Z',
      start_date_local: '2025-12-05T07:00:00Z',
      moving_time: 720,
      elapsed_time: 720,
    });
    const second = ride({
      id: 2,
      sport_type: 'VirtualRide',
      start_date: '2025-12-05T13:00:00Z',
      start_date_local: '2025-12-05T08:00:00Z',
      moving_time: 4260,
      elapsed_time: 4260,
    });
    expect(dedupeIndoorRides([first, second])).toHaveLength(2);
  });

  it('leaves outdoor rides alone', () => {
    const a = ride({ id: 1 });
    const b = ride({ id: 2, start_date: '2026-08-01T14:00:00Z' });
    expect(dedupeIndoorRides([a, b])).toHaveLength(2);
  });
});

describe('power zones', () => {
  it('places zone boundaries at the Coggan percentages', () => {
    const zones = powerZones(200);
    expect(zones[1]).toMatchObject({ zone: 2, minWatts: 112, maxWatts: 150 });
    expect(zones[3]).toMatchObject({ zone: 4, minWatts: 176, maxWatts: 210 });
    expect(zones[6]!.maxWatts).toBeNull();
  });

  it('puts sweet spot at 88-94% of FTP', () => {
    expect(sweetSpotWatts(200)).toEqual({ minWatts: 176, maxWatts: 188 });
  });

  it('classifies watts into zones', () => {
    expect(zoneForWatts(100, 200)).toBe(1);
    expect(zoneForWatts(140, 200)).toBe(2);
    expect(zoneForWatts(170, 200)).toBe(3);
    expect(zoneForWatts(200, 200)).toBe(4);
    expect(zoneForWatts(230, 200)).toBe(5);
    expect(zoneForWatts(500, 200)).toBe(7);
  });
});

describe('power metrics', () => {
  it('reads Normalized Power from the weighted average', () => {
    const a = ride({ device_watts: true, average_watts: 180, weighted_average_watts: 195 });
    expect(normalizedPower(a)).toBe(195);
  });

  it('returns null when power is only estimated', () => {
    const a = ride({ device_watts: false, average_watts: 180, weighted_average_watts: 195 });
    expect(normalizedPower(a)).toBeNull();
    expect(rideTss(a, 200)).toBeNull();
    expect(intensityFactor(a, 200)).toBeNull();
  });

  it('computes TSS so an hour at FTP scores 100', () => {
    const a = ride({
      moving_time: 3600,
      device_watts: true,
      average_watts: 200,
      weighted_average_watts: 200,
    });
    expect(rideTss(a, 200)).toBeCloseTo(100, 1);
  });

  it('computes TSS for a sub-threshold ride', () => {
    // 90 min at IF 0.9 => 5400 * 180^2 / (200^2 * 36) = 121.5
    const a = ride({
      moving_time: 5400,
      device_watts: true,
      average_watts: 175,
      weighted_average_watts: 180,
    });
    expect(rideTss(a, 200)).toBeCloseTo(121.5, 1);
    expect(intensityFactor(a, 200)).toBeCloseTo(0.9, 2);
  });

  it('computes variability index', () => {
    const a = ride({ device_watts: true, average_watts: 180, weighted_average_watts: 198 });
    expect(variabilityIndex(a)).toBeCloseTo(1.1, 2);
  });

  it('reports efficiency factor on steady rides only', () => {
    const steady = ride({
      device_watts: true,
      average_watts: 180,
      weighted_average_watts: 185,
      average_heartrate: 145,
    });
    expect(efficiencyFactor(steady)).toBeCloseTo(1.276, 2);

    const surgy = ride({
      device_watts: true,
      average_watts: 120,
      weighted_average_watts: 160,
      average_heartrate: 145,
    });
    expect(efficiencyFactor(surgy)).toBeNull();
  });
});

describe('hrTss', () => {
  it('scores an hour at threshold HR as 100', () => {
    const a = ride({ moving_time: 3600, average_heartrate: 170 });
    expect(hrTss(a, profile)).toBeCloseTo(100, 0);
  });

  it('scales with the square of heart-rate intensity', () => {
    // IF_HR = (110-50)/(170-50) = 0.5 => 1h * 0.25 * 100 = 25
    const a = ride({ moving_time: 3600, average_heartrate: 110 });
    expect(hrTss(a, profile)).toBeCloseTo(25, 0);
  });

  it('returns null without a heart-rate reading', () => {
    expect(hrTss(ride({ has_heartrate: false, average_heartrate: undefined }), profile)).toBeNull();
  });
});

describe('hrLooksImplausible', () => {
  it('does not flag a genuinely easy social ride', () => {
    // A real 82 bpm average on a slow group ride must survive: false-flagging
    // easy volume is worse than the artefact it protects against.
    const a = ride({ moving_time: 7680, average_heartrate: 82 });
    expect(hrLooksImplausible(a, 35, 190)).toBe(false);
  });

  it('flags a reading barely above resting', () => {
    const a = ride({ moving_time: 5400, average_heartrate: 52 });
    expect(hrLooksImplausible(a, 45, 190)).toBe(true);
  });

  it('ignores short efforts where a low average is just a warm-up', () => {
    const a = ride({ moving_time: 600, average_heartrate: 55 });
    expect(hrLooksImplausible(a, 50, 190)).toBe(false);
  });
});

describe('FTP helpers', () => {
  it('applies the 0.95 correction to a 20-minute test', () => {
    expect(ftpFrom20Min(200)).toBe(190);
  });

  it('applies the 0.75 correction to a ramp test', () => {
    expect(ftpFromRamp(300)).toBe(225);
  });

  it('computes watts per kilogram', () => {
    expect(wattsPerKg(175, 79)).toBeCloseTo(2.22, 2);
  });

  it('maps watts per kilogram to a Coggan tier', () => {
    expect(cogganTier(2.22)).toBe('Novice');
    expect(cogganTier(2.6)).toBe('Fair (Cat 5)');
    expect(cogganTier(4.5)).toBe('Exceptional');
  });

  it('grades Intensity Factor onto the RPE scale', () => {
    expect(rpeFromIntensityFactor(0.6)).toBe(3);
    expect(rpeFromIntensityFactor(0.91)).toBe(7);
    expect(rpeFromIntensityFactor(1.02)).toBe(9);
  });
});

describe('ftpRetestDue', () => {
  const now = new Date('2026-09-01T00:00:00Z');

  it('asks for a baseline when nothing is on record', () => {
    expect(ftpRetestDue(null, now, null).due).toBe(true);
  });

  it('waits until six weeks have passed', () => {
    expect(ftpRetestDue('2026-08-20', now, 0).due).toBe(false);
  });

  it('defers a due retest while the athlete is buried', () => {
    const out = ftpRetestDue('2026-06-01', now, -25);
    expect(out.due).toBe(false);
    expect(out.reason).toContain('deload');
  });

  it('calls for a retest when rested and overdue', () => {
    expect(ftpRetestDue('2026-06-01', now, -5).due).toBe(true);
  });
});

describe('resolveCyclingProfile', () => {
  const defaults = {
    ftpWatts: 175,
    ftpSource: 'estimate' as const,
    ftpTestedOn: null,
    weightKg: 79,
    lthr: null,
    maxHr: 190,
    restingHr: 50,
  };

  it('prefers the FTP Strava already knows about', () => {
    const out = resolveCyclingProfile(defaults, { stravaFtp: 205 });
    expect(out.ftpWatts).toBe(205);
    expect(out.ftpSource).toBe('strava');
  });

  it('falls back to the program estimate', () => {
    const out = resolveCyclingProfile(defaults, { stravaFtp: null });
    expect(out.ftpWatts).toBe(175);
    expect(out.ftpSource).toBe('estimate');
  });

  it('approximates LTHR from max HR when it has never been measured', () => {
    expect(resolveCyclingProfile(defaults).lthr).toBe(171);
  });

  it('takes resting heart rate from live data when available', () => {
    expect(resolveCyclingProfile(defaults, { restingHr: 38 }).restingHr).toBe(38);
  });
});

describe('normalizedPowerFromStream', () => {
  it('equals average power on a perfectly steady effort', () => {
    // NP converges on AP when there is no variability — the 4th-power
    // weighting only diverges when the effort surges.
    expect(normalizedPowerFromStream(new Array(1200).fill(200))).toBeCloseTo(200, 0);
  });

  it('exceeds average power on a surging effort', () => {
    // Alternating 100/300W averages 200W, but costs more physiologically.
    const surgy = Array.from({ length: 1200 }, (_, i) => (Math.floor(i / 60) % 2 === 0 ? 100 : 300));
    const np = normalizedPowerFromStream(surgy)!;
    expect(np).toBeGreaterThan(200);
  });

  it('returns null on a stream too short to have a 30s window', () => {
    expect(normalizedPowerFromStream([200, 200, 200])).toBeNull();
  });
});

describe('computeDecoupling', () => {
  it('reports zero drift when power and heart rate hold together', () => {
    const n = 3600;
    const out = computeDecoupling(new Array(n).fill(200), new Array(n).fill(140))!;
    expect(out.decouplingPct).toBeCloseTo(0, 1);
  });

  it('reports positive drift when heart rate climbs at the same power', () => {
    // Textbook cardiac drift: same watts, higher HR in the second half.
    const n = 3600;
    const watts = new Array(n).fill(200);
    const hr = Array.from({ length: n }, (_, i) => (i < n / 2 ? 140 : 154));
    const out = computeDecoupling(watts, hr)!;
    // EF drops from 200/140=1.429 to 200/154=1.299 => ~9.1% decoupling.
    expect(out.decouplingPct).toBeCloseTo(9.1, 0);
    expect(out.decouplingPct).toBeGreaterThan(5); // would fail the base gate
  });

  it('ignores heart-rate dropouts rather than treating them as zero', () => {
    const n = 3600;
    const watts = new Array(n).fill(200);
    const hr = new Array(n).fill(140);
    for (let i = 100; i < 200; i++) hr[i] = 0; // sensor dropout
    const out = computeDecoupling(watts, hr)!;
    expect(out.decouplingPct).toBeCloseTo(0, 1);
  });

  it('returns null for rides too short for drift to mean anything', () => {
    expect(computeDecoupling(new Array(600).fill(200), new Array(600).fill(140))).toBeNull();
  });
});

describe('meanMaximalPower', () => {
  it('finds the best rolling average at each duration', () => {
    // 3600s at 150W with a 60s spike to 400W.
    const watts = new Array(3600).fill(150);
    for (let i = 1000; i < 1060; i++) watts[i] = 400;
    const mmp = meanMaximalPower(watts);
    expect(mmp['5']).toBe(400);
    expect(mmp['60']).toBe(400);
    // Over 5 minutes the spike is diluted: (60*400 + 240*150) / 300 = 200.
    expect(mmp['300']).toBe(200);
    expect(mmp['3600']).toBeGreaterThanOrEqual(154);
  });

  it('omits durations longer than the ride', () => {
    const mmp = meanMaximalPower(new Array(120).fill(200));
    expect(mmp['60']).toBe(200);
    expect(mmp['300']).toBeUndefined();
    expect(mmp['3600']).toBeUndefined();
  });
});
