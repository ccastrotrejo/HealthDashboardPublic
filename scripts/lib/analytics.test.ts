/**
 * Regression tests for the Strava↔Whoop merge.
 *
 * The bug these exist to prevent: `mergeStravaAndWhoop` matched on
 * `RecentActivity.startDateLocal`, which for Strava rows is `start_date_local` —
 * local wall-clock time that the Strava API serialises with a misleading `Z`
 * suffix. Whoop's `start` is genuinely UTC. Comparing the two failed by exactly
 * the timezone offset, so the ±10-minute window never matched, `source: 'both'`
 * never occurred, and every session appeared twice in the data the AI generators
 * read — once from each vendor.
 *
 * `computeAgreement` did the same match on `start_date` and matched everything,
 * which is what proved it was a bug rather than genuinely unmatchable data.
 */
import { describe, expect, it } from 'vitest';
import {
  attachSessionRpe,
  classifyIntensity,
  computeLoadAcwr,
  computeWeeklyAnalytics,
  mergeStravaAndWhoop,
  pickRecentActivities,
} from './analytics.js';
import type { RecentActivity, StravaActivity, WhoopWorkout } from './types.js';

const NOW = new Date('2024-02-18T20:00:00Z');

/** Fictional ride at 12:30 UTC = 08:30 local (UTC-4). */
function stravaRide(): StravaActivity {
  return {
    id: 101,
    name: 'Synthetic ride',
    sport_type: 'Ride',
    type: 'Ride',
    start_date: '2024-02-18T12:30:00Z',
    // The Strava quirk: local time, `Z` suffix.
    start_date_local: '2024-02-18T08:30:00Z',
    timezone: '(GMT-04:00) America/Puerto_Rico',
    distance: 30000,
    moving_time: 5400,
    elapsed_time: 5400,
    total_elevation_gain: 120,
    average_speed: 5.55,
    max_speed: 11,
    has_heartrate: true,
    average_heartrate: 128,
    max_heartrate: 165,
    suffer_score: 50,
  } as unknown as StravaActivity;
}

function whoopCycling(): WhoopWorkout {
  return {
    id: 'synthetic-workout-1',
    start: '2024-02-18T12:29:00Z',
    end: '2024-02-18T14:00:00Z',
    sport_id: 1,
    sport_name: 'cycling',
    timezone_offset: '-04:00',
    score_state: 'SCORED',
    score: {
      strain: 10.4,
      average_heart_rate: 122,
      max_heart_rate: 160,
      kilojoule: 1800,
      percent_recorded: 1,
      zone_durations: {
        zone_zero_milli: 1200000,
        zone_one_milli: 2400000,
        zone_two_milli: 1800000,
        zone_three_milli: 60000,
        zone_four_milli: 0,
        zone_five_milli: 0,
      },
    },
  } as unknown as WhoopWorkout;
}

describe('mergeStravaAndWhoop', () => {
  it('matches a Strava activity to its Whoop twin across the timezone offset', () => {
    const strava = pickRecentActivities([stravaRide()], NOW, 14);
    const merged = mergeStravaAndWhoop(strava, [whoopCycling()], NOW, 14);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe('both');
    expect(merged[0]!.whoopStrain).toBeCloseTo(10.4, 2);
    // Zone data only reaches the activity via a successful match.
    expect(merged[0]!.zoneDurationsMs?.z2).toBe(1800000);
    // The Strava record wins on distance — Whoop reports none for cycling.
    expect(merged[0]!.distanceMeters).toBe(30000);
  });

  it('does not duplicate a session that both sources recorded', () => {
    const strava = pickRecentActivities([stravaRide()], NOW, 14);
    const merged = mergeStravaAndWhoop(strava, [whoopCycling()], NOW, 14);
    const cyclingRows = merged.filter((a) => /ride|cycling/i.test(a.sportType));
    expect(cyclingRows).toHaveLength(1);
  });

  it('keeps a Whoop-only session that Strava never saw', () => {
    const lift: WhoopWorkout = {
      ...whoopCycling(),
      id: 'lift-1',
      sport_name: 'functional-fitness',
      start: '2024-02-17T10:00:00Z',
      end: '2024-02-17T11:00:00Z',
    };
    const strava = pickRecentActivities([stravaRide()], NOW, 14);
    const merged = mergeStravaAndWhoop(strava, [whoopCycling(), lift], NOW, 14);

    expect(merged).toHaveLength(2);
    expect(merged.find((a) => a.sportType === 'functional-fitness')?.source).toBe('whoop');
  });

  it('renders Whoop-only rows in the local clock so both sources sort together', () => {
    const walk: WhoopWorkout = {
      ...whoopCycling(),
      id: 'walk-1',
      sport_name: 'walking',
      start: '2024-02-18T23:15:00Z',
      end: '2024-02-18T23:45:00Z',
      timezone_offset: '-04:00',
    };
    const merged = mergeStravaAndWhoop([], [walk], NOW, 14);
    // 23:15 UTC is 19:15 local — the row must not claim it happened at 23:15.
    expect(merged[0]!.startDateLocal).toBe('2024-02-18T19:15:00Z');
    expect(merged[0]!.startDateUtc).toBe('2024-02-18T23:15:00Z');
  });

  it('falls back to startDateLocal for legacy rows without startDateUtc', () => {
    const legacy: RecentActivity = {
      id: 1,
      name: 'Legacy',
      sportType: 'Ride',
      startDateLocal: '2024-02-18T12:29:00Z',
      distanceMeters: 1000,
      movingTimeSeconds: 600,
      averagePaceSecPerKm: null,
      averageHeartrate: null,
      intensity: 'easy',
      source: 'strava',
    };
    const merged = mergeStravaAndWhoop([legacy], [whoopCycling()], NOW, 14);
    expect(merged[0]!.source).toBe('both');
  });
});

describe('attachSessionRpe', () => {
  const base: RecentActivity = {
    id: 42,
    name: 'Synthetic afternoon ride',
    sportType: 'Ride',
    startDateLocal: '2024-02-18T08:30:00Z',
    startDateUtc: '2024-02-18T12:30:00Z',
    distanceMeters: 30000,
    movingTimeSeconds: 5400,
    averagePaceSecPerKm: null,
    averageHeartrate: 128,
    intensity: 'moderate',
    source: 'strava',
  };

  it('matches on explicit activity id and computes sRPE load', () => {
    const [out] = attachSessionRpe([base], [{ date: '2024-02-18', activityId: 42, rpe: 6 }]);
    expect(out!.sessionRpe).toBe(6);
    expect(out!.sRpeLoad).toBe(540); // 6 × 90 min
  });

  it('matches on day + sport when no id is given', () => {
    const [out] = attachSessionRpe([base], [{ date: '2024-02-18', sport: 'ride', rpe: 8 }]);
    expect(out!.sessionRpe).toBe(8);
  });

  it('leaves an ambiguous day unmatched rather than guessing', () => {
    const second: RecentActivity = { ...base, id: 43, name: 'Evening Ride' };
    const out = attachSessionRpe([base, second], [{ date: '2024-02-18', rpe: 9 }]);
    expect(out.every((a) => a.sessionRpe == null)).toBe(true);
  });
});

describe('computeLoadAcwr', () => {
  /**
   * The regression this guards: load accounting used to key athlete-logged RPE
   * on Strava's start instant and Whoop coverage on Whoop's. Those never match —
   * the merge window is ±10 minutes and Whoop reports milliseconds where Strava
   * does not — so a rated session was counted once as strain and again as sRPE.
   */
  it('counts a dual-recorded session exactly once when an RPE is logged', () => {
    const strava = pickRecentActivities([stravaRide()], NOW, 14);
    const merged = mergeStravaAndWhoop(strava, [whoopCycling()], NOW, 14);
    const rated = attachSessionRpe(merged, [{ date: '2024-02-18', activityId: 101, rpe: 6 }]);

    expect(rated[0]!.sRpeLoad).toBe(540); // 6 × 90 min
    const acwr = computeLoadAcwr(rated, [stravaRide()], [whoopCycling()], NOW);
    // The logged RPE replaces the strain estimate rather than stacking on it.
    // Do not add the independent Whoop strain estimate to the logged load.
    expect(acwr.acuteKm).toBe(540);
    expect(Object.keys(acwr.bySportShare ?? {})).toHaveLength(1);
  });

  it('uses the Whoop strain estimate when no RPE was logged', () => {
    const strava = pickRecentActivities([stravaRide()], NOW, 14);
    const merged = mergeStravaAndWhoop(strava, [whoopCycling()], NOW, 14);
    const acwr = computeLoadAcwr(merged, [stravaRide()], [whoopCycling()], NOW);
    // Fictional strain and workout duration.
    expect(acwr.acuteKm).toBeCloseTo((10.4 / 2) * 91, 0);
  });

  it('still counts a Strava-only session when Whoop has no data', () => {
    const strava = pickRecentActivities([stravaRide()], NOW, 14);
    const acwr = computeLoadAcwr(strava, [stravaRide()], [], NOW);
    // A Whoop outage must deflate confidence, not silently zero out the load.
    expect(acwr.acuteKm).toBeGreaterThan(0);
  });
});

describe('computeWeeklyAnalytics primary metric', () => {
  it('does not promote a load ratio that has no inputs', () => {
    const weekly = computeWeeklyAnalytics([stravaRide()], NOW, { whoopWorkouts: [] });
    // With Strava present the load ratio still has coverage via pseudo-RPE.
    expect(weekly.primaryLoadMetric).toBe('loadAcwr');
    expect(Number.isFinite(weekly.loadAcwr!.ratio)).toBe(true);
  });

  it('falls back to the distance ratio when nothing else has coverage', () => {
    const weekly = computeWeeklyAnalytics([], NOW, { whoopWorkouts: [], whoopCycles: [] });
    expect(weekly.primaryLoadMetric).toBe('acwr');
  });
});

/**
 * Intensity classification used to be driven by raw average speed for rides:
 * >=25 km/h was "hard", >=20 "moderate". Speed is a function of draft, gradient
 * and wind, so a paceline cruise scored harder than a climb and a trainer ride —
 * where speed is synthetic — was scored on a number that means nothing. Every
 * downstream consumer inherited that error, including the pseudo-RPE that feeds
 * cross-sport load and every AI prompt built on top of it.
 */
describe('classifyIntensity', () => {
  const profile = {
    ftpWatts: 200,
    ftpSource: '20min-test' as const,
    ftpTestedOn: '2026-06-01',
    weightKg: 75,
    lthr: 170,
    maxHr: 190,
    restingHr: 50,
  };

  function base(over: Partial<StravaActivity> = {}): StravaActivity {
    return {
      id: 1,
      name: 'Session',
      sport_type: 'Ride',
      start_date: '2026-08-01T10:00:00Z',
      start_date_local: '2026-08-01T06:00:00Z',
      distance: 40_000,
      moving_time: 5400,
      elapsed_time: 5400,
      total_elevation_gain: 200,
      average_speed: 7.4,
      max_speed: 14,
      has_heartrate: false,
      ...over,
    } as StravaActivity;
  }

  it('does not call a fast group ride hard when the heart rate says otherwise', () => {
    // 28 km/h — the old speed rule called this "hard". Sitting in a paceline at
    // 118 bpm against a 170 LTHR is an easy aerobic ride.
    const a = base({ average_speed: 7.8, has_heartrate: true, average_heartrate: 118 });
    expect(classifyIntensity(a, profile)).toBe('easy');
  });

  it('does not call a hard climb easy just because it was slow', () => {
    // 14 km/h at 165 bpm — the old speed rule called this "easy".
    const a = base({ average_speed: 3.9, has_heartrate: true, average_heartrate: 165 });
    expect(classifyIntensity(a, profile)).toBe('hard');
  });

  it('prefers power over heart rate when a real meter is present', () => {
    const a = base({
      device_watts: true,
      average_watts: 190,
      weighted_average_watts: 196,
      has_heartrate: true,
      average_heartrate: 110,
    });
    expect(classifyIntensity(a, profile)).toBe('hard');
  });

  it('ignores Strava estimated power and falls back to heart rate', () => {
    const a = base({
      device_watts: false,
      average_watts: 190,
      weighted_average_watts: 196,
      has_heartrate: true,
      average_heartrate: 110,
    });
    expect(classifyIntensity(a, profile)).toBe('easy');
  });

  it('treats a trainer ride on synthetic speed as moderate rather than hard', () => {
    const a = base({ sport_type: 'VirtualRide', trainer: true, average_speed: 11 });
    expect(classifyIntensity(a, profile)).toBe('moderate');
  });

  it('keeps resistance training at moderate regardless of heart rate', () => {
    // Heart rate reflects neither the metabolic nor the neuromuscular cost of a
    // heavy set, so it must not be allowed to downgrade a lift to "easy".
    const a = base({
      sport_type: 'WeightTraining',
      has_heartrate: true,
      average_heartrate: 105,
      distance: 0,
      average_speed: 0,
    });
    expect(classifyIntensity(a, profile)).toBe('moderate');
  });

  it('keeps heated yoga easy despite a thermally elevated heart rate', () => {
    const a = base({
      sport_type: 'Yoga',
      has_heartrate: true,
      average_heartrate: 150,
      distance: 0,
      average_speed: 0,
    });
    expect(classifyIntensity(a, profile)).toBe('easy');
  });

  it('still classifies runs by pace', () => {
    // 7:30/km — easy.
    const easy = base({ sport_type: 'Run', distance: 10_000, moving_time: 4500 });
    expect(classifyIntensity(easy, profile)).toBe('easy');
    // 5:00/km — hard.
    const hard = base({ sport_type: 'Run', distance: 10_000, moving_time: 3000 });
    expect(classifyIntensity(hard, profile)).toBe('hard');
  });

  it('calls a ride with no power and no heart rate moderate, not hard', () => {
    const a = base({ average_speed: 8.3 });
    expect(classifyIntensity(a, profile)).toBe('moderate');
  });
});

/**
 * The prior-session comparison used to report every sport in seconds per
 * kilometre. On a bike that is both the wrong unit and the wrong sign
 * convention — riders read speed, and faster means a bigger number, not a
 * smaller one.
 */
describe('prior-session comparison units', () => {
  function rideAt(id: number, iso: string, meters: number, seconds: number): StravaActivity {
    return {
      id,
      name: 'Ride',
      sport_type: 'Ride',
      start_date: iso,
      start_date_local: iso,
      distance: meters,
      moving_time: seconds,
      elapsed_time: seconds,
      total_elevation_gain: 0,
      average_speed: meters / seconds,
      max_speed: 0,
      has_heartrate: false,
    } as StravaActivity;
  }

  it('reports rides in km/h, with faster reading positive', () => {
    // 30 km in 1h30 (20 km/h), then 30 km in 1h15 (24 km/h) a week later.
    const prior = rideAt(1, '2026-08-01T10:00:00Z', 30_000, 5400);
    const faster = rideAt(2, '2026-08-08T10:00:00Z', 30_000, 4500);
    const [latest] = pickRecentActivities([prior, faster], new Date('2026-08-09T10:00:00Z'), 30);
    expect(latest?.priorComparison).toContain('+4.0 km/h');
    expect(latest?.priorComparison).not.toContain('s/km');
  });

  it('still reports runs in pace', () => {
    const prior = { ...rideAt(1, '2026-08-01T10:00:00Z', 10_000, 3000), sport_type: 'Run' };
    const slower = { ...rideAt(2, '2026-08-08T10:00:00Z', 10_000, 3300), sport_type: 'Run' };
    const [latest] = pickRecentActivities([prior, slower], new Date('2026-08-09T10:00:00Z'), 30);
    expect(latest?.priorComparison).toContain('s/km');
  });
});
