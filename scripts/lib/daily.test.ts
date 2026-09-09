import { describe, expect, it } from 'vitest';
import {
  computeAgreement,
  computeAnomalyEscalation,
  computeDailyAnalytics,
  computeGarminDailyBlock,
  computeSleepRegularity,
  computeTodaysCall,
  detectAnomalies,
} from './daily.js';
import type {
  AcwrResult,
  AnomalyFlag,
  GarminDaily,
  GarminHrvPoint,
  RecoveryBlock,
  SleepBlock,
  StravaActivity,
  WhoopRecovery,
  WhoopSleep,
  WhoopWorkout,
} from './types.js';

const NOW = new Date('2026-08-31T12:00:00Z');
const HOUR = 3_600_000;

function recovery(date: string, score: Partial<NonNullable<WhoopRecovery['score']>> = {}): WhoopRecovery {
  return {
    cycle_id: 1,
    sleep_id: date,
    created_at: `${date}T10:00:00Z`,
    updated_at: `${date}T10:00:00Z`,
    score_state: 'SCORED',
    score: {
      recovery_score: 90,
      resting_heart_rate: 50,
      hrv_rmssd_milli: 100,
      skin_temp_celsius: 33,
      user_calibrating: false,
      ...score,
    },
  };
}

function sleep(date: string, hours = 8, over: Partial<WhoopSleep> = {}): WhoopSleep {
  return {
    id: date,
    cycle_id: 1,
    start: `${date}T03:00:00Z`,
    end: `${date}T11:30:00Z`,
    timezone_offset: '-04:00',
    nap: false,
    score_state: 'SCORED',
    score: {
      stage_summary: {
        total_in_bed_time_milli: (hours + 0.5) * HOUR,
        total_awake_time_milli: 0.5 * HOUR,
        total_light_sleep_time_milli: (hours - 3) * HOUR,
        total_slow_wave_sleep_time_milli: 1.5 * HOUR,
        total_rem_sleep_time_milli: 1.5 * HOUR,
        sleep_cycle_count: 4,
        disturbance_count: 1,
      },
      sleep_needed: {
        baseline_milli: 8 * HOUR,
        need_from_sleep_debt_milli: HOUR,
        need_from_recent_strain_milli: 0.5 * HOUR,
        need_from_recent_nap_milli: -0.5 * HOUR,
      },
      respiratory_rate: 15,
      sleep_performance_percentage: 90,
      sleep_consistency_percentage: 80,
      sleep_efficiency_percentage: 94,
    },
    ...over,
  };
}

function recoveryBlock(over: Partial<RecoveryBlock> = {}): RecoveryBlock {
  return {
    score: 90,
    state: 'optimal',
    hrvMs: 100,
    hrvDeltaPct: null,
    hrvStatus: 'unknown',
    rhrBpm: 50,
    rhrDeltaPct: null,
    spo2Pct: null,
    skinTempC: 33,
    skinTempDeltaC: null,
    ...over,
  };
}

function sleepBlock(hours: number): SleepBlock {
  return {
    asleepHours: hours,
    performancePct: 90,
    efficiencyPct: 94,
    stages: { light: 4, deep: 1, rem: 2, awake: 0.5 },
    neededHours: 8,
    neededBreakdown: {
      baselineHours: 8,
      fromSleepDebtHours: 0,
      fromRecentStrainHours: 0,
      fromRecentNapHours: 0,
    },
    respiratoryRate: 15,
  };
}

function acwr(ratio: number): AcwrResult {
  return { acuteKm: 100, chronicKm: 100 / ratio, ratio, zone: 'sweet-spot', unit: 'sRPE' };
}

describe('computeTodaysCall', () => {
  it.each([null, recoveryBlock({ score: null })])('defaults to easy without a scored recovery', (r) => {
    const result = computeTodaysCall({ recovery: r, sleep: null, acwr: null });
    expect(result.intensity).toBe('easy');
    expect(result.contributors).toEqual([
      expect.objectContaining({ label: 'Recovery', value: 'n/a', effect: 'base' }),
    ]);
  });

  it.each([
    [64, 'rest'], [65, 'easy'], [74, 'easy'], [75, 'moderate'], [84, 'moderate'], [85, 'hard'],
  ] as const)('classifies recovery %i as %s at the boundary', (score, intensity) => {
    const result = computeTodaysCall({ recovery: recoveryBlock({ score }), sleep: null, acwr: null });
    expect(result.intensity).toBe(intensity);
    expect(result.reasons).toEqual([`Recovery ${score} → base ${intensity}.`]);
  });

  it('accumulates independent cautions without downgrading below rest', () => {
    const result = computeTodaysCall({
      recovery: recoveryBlock({ hrvDeltaPct: -7, skinTempDeltaC: 0.41 }),
      sleep: sleepBlock(5.9),
      acwr: acwr(2),
    });
    expect(result.intensity).toBe('rest');
    expect(result.contributors?.map((c) => c.effect)).toEqual(['base', 'downgrade', 'downgrade', 'downgrade']);
    expect(result.reasons).toHaveLength(4);
  });

  it('does not downgrade just outside the caution thresholds', () => {
    expect(computeTodaysCall({
      recovery: recoveryBlock({ hrvDeltaPct: -6.99, skinTempDeltaC: 0.4 }),
      sleep: sleepBlock(6),
      acwr: acwr(1.5),
    }).intensity).toBe('hard');
  });

  it('caps high internal load at easy and explains the authoritative unit', () => {
    const result = computeTodaysCall({ recovery: recoveryBlock(), sleep: null, acwr: acwr(1.51) });
    expect(result.intensity).toBe('easy');
    expect(result.contributors?.at(-1)).toMatchObject({ label: 'Training load', effect: 'cap' });
    expect(result.reasons.at(-1)).toContain('(sRPE)');
  });
});

describe('computeDailyAnalytics', () => {
  it('represents missing vendor data as nulls rather than measured zeros', () => {
    const result = computeDailyAnalytics([], [], [], null, NOW);
    expect(result).toMatchObject({
      date: '2026-08-31',
      recovery: null,
      sleep: null,
      dayStrain: null,
      anomalies: [],
      agreement: [],
      anomalyEscalation: { active: false, reasons: [], triggeredBy: [] },
    });
    expect(result.trends.hrv.at(-1)).toEqual({ date: '2026-08-31', value: null });
    expect(result.trends.hrv.every((p) => p.value === null)).toBe(true);
  });

  it('chooses the latest scored record and excludes it from the 30-day baseline', () => {
    const rows = [
      recovery('2026-08-31', { hrv_rmssd_milli: 90, resting_heart_rate: 55, skin_temp_celsius: 33.5 }),
      recovery('2026-07-01', { hrv_rmssd_milli: 1000 }),
      recovery('2026-08-30'),
      { ...recovery('2026-09-01'), score_state: 'PENDING_SCORE' as const, score: undefined },
    ];
    const original = structuredClone(rows);
    const result = computeDailyAnalytics(rows, [], [], null, NOW);
    expect(result.recovery).toMatchObject({
      score: 90, state: 'optimal', hrvMs: 90, hrvDeltaPct: -10,
      rhrDeltaPct: 10, skinTempDeltaC: 0.5, hrvStatus: 'unknown',
    });
    expect(rows).toEqual(original);
    expect(result.trends.hrv.at(-2)).toEqual({ date: '2026-08-30', value: 100 });
  });

  it('keeps deltas unknown when there is no previous baseline', () => {
    const result = computeDailyAnalytics([recovery('2026-08-31')], [], [], null, NOW);
    expect(result.recovery).toMatchObject({ hrvDeltaPct: null, rhrDeltaPct: null, skinTempDeltaC: null });
  });

  it('uses night sleep, subtracts awake time, and credits naps against sleep need', () => {
    const result = computeDailyAnalytics([], [
      sleep('2026-08-31'),
      sleep('2026-08-31', 3, { nap: true, start: '2026-08-31T13:00:00Z' }),
      sleep('2026-08-30', 6),
    ], [], null, NOW);
    expect(result.sleep).toMatchObject({
      asleepHours: 8,
      neededHours: 9,
      stages: { light: 5, deep: 1.5, rem: 1.5, awake: 0.5 },
      neededBreakdown: { fromRecentNapHours: -0.5 },
    });
    expect(result.trends.asleepHours.at(-1)?.value).toBe(8);
  });

  it('chooses the latest scored physiological cycle regardless of input order', () => {
    const result = computeDailyAnalytics([], [], [
      { id: 2, start: '2026-08-31T10:00:00Z', end: '', score_state: 'SCORED',
        score: { strain: 12, kilojoule: 1000, average_heart_rate: 65, max_heart_rate: 150 } },
      { id: 3, start: '2026-08-31T11:00:00Z', end: '', score_state: 'PENDING_SCORE' },
      { id: 1, start: '2026-08-30T10:00:00Z', end: '', score_state: 'SCORED',
        score: { strain: 8, kilojoule: 800, average_heart_rate: 60, max_heart_rate: 140 } },
    ], null, NOW);
    expect(result.dayStrain).toEqual({ strain: 12, kilojoule: 1000, avgHr: 65, maxHr: 150 });
  });

  it.each([
    [100, 'balanced'], [95, 'unbalanced'], [90, 'low'], [85, 'poor'], [110, 'unbalanced'],
  ] as const)('classifies a sustained HRV mean of %i against a 100ms baseline as %s', (hrv, status) => {
    const rows = Array.from({ length: 30 }, (_, i) => recovery(
      `2026-08-${String(i + 2).padStart(2, '0')}`,
      { hrv_rmssd_milli: i >= 23 ? hrv : 100 },
    ));
    expect(computeDailyAnalytics(rows, [], [], null, NOW).recovery?.hrvStatus).toBe(status);
  });
});

describe('detectAnomalies', () => {
  const baseline = Array.from({ length: 30 }, (_, i) =>
    recovery(new Date(Date.UTC(2026, 7, 28 - i)).toISOString().slice(0, 10)));

  it('requires three low-HRV records and suppresses redundant elevated-RHR noise', () => {
    const recent = ['2026-08-29', '2026-08-30', '2026-08-31'].map((date) =>
      recovery(date, { hrv_rmssd_milli: 93, resting_heart_rate: 55 }));
    const flags = detectAnomalies([...baseline, ...recent], [], NOW);
    expect(flags.map((f) => f.id)).toEqual(['hrv-dropping']);
    expect(flags[0]?.since).toBe('2026-08-29T10:00:00Z');
    expect(detectAnomalies([...baseline, ...recent.slice(1)], [], NOW).map((f) => f.id))
      .not.toContain('hrv-dropping');
  });

  it('requires two elevated skin-temperature nights, not one isolated reading', () => {
    const elevated = ['2026-08-30', '2026-08-31'].map((date) =>
      recovery(date, { skin_temp_celsius: 33.5 }));
    expect(detectAnomalies([...baseline, ...elevated], [], NOW).map((f) => f.id))
      .toContain('skin-temp-elevated');
    expect(detectAnomalies([...baseline, elevated[1]!], [], NOW)).toEqual([]);
  });

  it('ignores naps and pending scores when counting two short nights', () => {
    const nights = [sleep('2026-08-29', 6), sleep('2026-08-30', 7), sleep('2026-08-31', 6.5)];
    const flags = detectAnomalies([], [
      ...nights,
      sleep('2026-08-31', 1, { nap: true }),
      sleep('2026-08-31', 1, { score_state: 'PENDING_SCORE' }),
    ], NOW);
    expect(flags.map((f) => f.id)).toEqual(['sleep-debt']);
    expect(flags[0]?.body).toContain('2 of last 3');
    expect(detectAnomalies([], nights.slice(1), NOW)).toEqual([]);
  });

  it('requires sufficient sleep history before raising a respiratory-rate flag', () => {
    const nights = Array.from({ length: 30 }, (_, i) => sleep(`2026-08-${String(i + 2).padStart(2, '0')}`));
    nights.at(-1)!.score!.respiratory_rate = 16;
    expect(detectAnomalies([], nights, NOW).map((f) => f.id)).toContain('respiration-elevated');
    expect(detectAnomalies([], nights.slice(1), NOW)).toEqual([]);
  });
});

function flag(id: AnomalyFlag['id'], severity: AnomalyFlag['severity'] = 'caution'): AnomalyFlag {
  return { id, severity, title: id, body: id, since: '2026-08-31' };
}

describe('computeAnomalyEscalation', () => {
  it.each([
    { flags: [] },
    { flags: [flag('sleep-debt')] },
    { flags: [flag('hrv-dropping', 'warning')] },
  ])(
    'does not escalate an isolated anomaly', ({ flags }) => {
      expect(computeAnomalyEscalation(flags)).toEqual({ active: false, reasons: [], triggeredBy: [] });
    },
  );

  it('escalates the skin-temperature/respiration combination', () => {
    expect(computeAnomalyEscalation([flag('skin-temp-elevated'), flag('respiration-elevated')]))
      .toMatchObject({ active: true, triggeredBy: ['skin-temp-elevated', 'respiration-elevated'] });
  });

  it('combines triggers without duplicating contributing flag ids', () => {
    const flags = [flag('skin-temp-elevated'), flag('rhr-elevated'), flag('hrv-dropping', 'warning')];
    const result = computeAnomalyEscalation(flags);
    expect(result.active).toBe(true);
    expect(result.reasons).toHaveLength(3);
    expect(result.triggeredBy).toEqual(flags.map((f) => f.id));
  });
});

describe('computeSleepRegularity', () => {
  it('uses each record’s offset and aligns wake time after a pre-midnight bedtime', () => {
    expect(computeSleepRegularity([sleep('2026-08-31')], NOW)).toEqual([
      { date: '2026-08-31', bedHourLocal: 23, wakeHourLocal: 31.5 },
    ]);
  });

  it('supports half-hour offsets and early-morning bedtimes on the extended day scale', () => {
    expect(computeSleepRegularity([sleep('2026-08-30', 8, {
      start: '2026-08-30T19:00:00Z', end: '2026-08-31T02:30:00Z', timezone_offset: '+05:30',
    })], NOW)[0]).toMatchObject({ bedHourLocal: 24.5, wakeHourLocal: 32 });
  });

  it('excludes old, unscored, and nap records and sorts the remainder oldest first', () => {
    const result = computeSleepRegularity([
      sleep('2026-08-31'), sleep('2026-07-01'), sleep('2026-08-30'),
      sleep('2026-08-31', 1, { nap: true }),
      sleep('2026-08-31', 8, { score_state: 'UNSCORABLE' }),
    ], NOW);
    expect(result.map((p) => p.date)).toEqual(['2026-08-30', '2026-08-31']);
  });
});

function ride(over: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 1, name: 'Synthetic ride', sport_type: 'Ride',
    start_date: '2026-08-31T10:00:00Z', start_date_local: '2026-08-31T06:00:00Z',
    distance: 20_000, moving_time: 3600, elapsed_time: 3600, total_elevation_gain: 0,
    average_speed: 5.5, max_speed: 8, has_heartrate: true, average_heartrate: 100, max_heartrate: 150,
    ...over,
  };
}

function workout(over: Partial<WhoopWorkout> = {}): WhoopWorkout {
  return {
    id: 'synthetic-workout', start: '2026-08-31T10:01:00Z', end: '2026-08-31T11:01:00Z',
    sport_id: 1, sport_name: 'cycling', score_state: 'SCORED',
    score: {
      strain: 8, average_heart_rate: 95, max_heart_rate: 147, kilojoule: 500, percent_recorded: 1,
      zone_durations: { zone_zero_milli: 0, zone_one_milli: 0, zone_two_milli: HOUR,
        zone_three_milli: 0, zone_four_milli: 0, zone_five_milli: 0 },
    },
    ...over,
  };
}

describe('computeAgreement', () => {
  it('matches by UTC instant, chooses the closest record, and keeps exactly 5% unflagged', () => {
    const farther = workout({ id: 'farther', start: '2026-08-31T10:05:00Z' });
    farther.score!.average_heart_rate = 80;
    const [result] = computeAgreement([ride()], [farther, workout()], NOW);
    expect(result).toMatchObject({ whoopAvgHr: 95, avgHrDeltaPct: -5, maxHrDeltaPct: -2, flagged: false });
  });

  it('does not match at the exclusive ten-minute boundary or against unscored data', () => {
    expect(computeAgreement([ride()], [
      workout({ start: '2026-08-31T10:10:00Z' }),
      workout({ score_state: 'PENDING_SCORE' }),
    ], NOW)).toEqual([]);
  });

  it('flags a greater-than-5% average HR difference without dividing by missing/zero HR', () => {
    const w = workout();
    w.score!.average_heart_rate = 94;
    expect(computeAgreement([ride()], [w], NOW)[0]?.flagged).toBe(true);
    expect(computeAgreement([ride({ average_heartrate: 0, max_heartrate: undefined })], [w], NOW)[0])
      .toMatchObject({ avgHrDeltaPct: null, maxHrDeltaPct: null, flagged: false });
  });

  it('returns newest first, applies the match limit, and excludes records without heart rate', () => {
    const rows = [ride({ id: 2, start_date: '2026-08-30T10:00:00Z' }), ride(), ride({ id: 3, has_heartrate: false })];
    const result = computeAgreement(rows, [workout(), workout({ start: '2026-08-30T10:00:00Z' })], NOW, 14, 1);
    expect(result.map((r) => r.stravaId)).toEqual([1]);
  });
});

function garminDay(date: string, over: Partial<GarminDaily> = {}): GarminDaily {
  return {
    date, steps: null, stepGoal: null, distanceMeters: null, floorsClimbed: null, floorsGoal: null,
    intensityMinutesModerate: null, intensityMinutesVigorous: null,
    activeCalories: null, totalCalories: null, restingHeartRate: null, minHeartRate: null, maxHeartRate: null,
    stressAvg: null, stressMax: null, bodyBatteryHigh: null, bodyBatteryLow: null,
    bodyBatteryCharged: null, bodyBatteryDrained: null, vo2Max: null, avgSpo2: null, minSpo2: null,
    trainingReadinessScore: null, trainingReadinessLevel: null, recoveryTimeHours: null,
    trainingReadinessFeedback: null, ...over,
  };
}

describe('computeGarminDailyBlock', () => {
  it('returns null if Garmin has no daily records', () => {
    expect(computeGarminDailyBlock([], [], null, NOW)).toBeNull();
  });

  it('counts vigorous minutes twice, excludes days outside the week, and preserves measured zero', () => {
    const rows = [
      garminDay('2026-08-31', { steps: 0, intensityMinutesModerate: 0 }),
      garminDay('2026-08-24', { intensityMinutesModerate: 999 }),
      garminDay('2026-08-25', { intensityMinutesModerate: 20, intensityMinutesVigorous: 10 }),
    ];
    const result = computeGarminDailyBlock(rows, [], null, NOW)!;
    expect(result).toMatchObject({ date: '2026-08-31', steps: 0, intensityMinutesWeek: 40, intensityMinutesGoal: 150 });
    expect(result.stepsTrend).toHaveLength(30);
    expect(result.stepsTrend.at(-2)?.value).toBeNull();
    expect(result.stepsTrend.at(-1)?.value).toBe(0);
    expect(result.intensityMinutesTrend).toHaveLength(56);
    expect(result.intensityMinutesTrend.at(-1)?.value).toBe(0);
  });

  it('distinguishes no intensity measurements from a measured zero week', () => {
    expect(computeGarminDailyBlock([garminDay('2026-08-31')], [], null, NOW)?.intensityMinutesWeek).toBeNull();
    expect(computeGarminDailyBlock([
      garminDay('2026-08-31', { intensityMinutesVigorous: 0 }),
    ], [], null, NOW)?.intensityMinutesWeek).toBe(0);
  });

  it('carries VO2 max forward only after a measurement and uses independent latest HRV fields', () => {
    const hrv: GarminHrvPoint[] = [
      { date: '2026-08-31', status: null, weeklyAvgMs: 60, lastNightAvgMs: null, lastNight5MinHighMs: null },
      { date: '2026-08-30', status: 'BALANCED', weeklyAvgMs: 55, lastNightAvgMs: null, lastNight5MinHighMs: null },
    ];
    const result = computeGarminDailyBlock([
      garminDay('2026-08-31'), garminDay('2026-08-29', { vo2Max: 48 }),
    ], hrv, { fetchedAt: NOW.toISOString(), trainingStatus: null, racePredictions: [] }, NOW)!;
    expect(result.vo2Max).toBe(48);
    expect(result.vo2MaxTrend).toHaveLength(90);
    expect(result.vo2MaxTrend.slice(-4).map((p) => p.value)).toEqual([null, 48, 48, 48]);
    expect(result).toMatchObject({ hrvStatus: 'BALANCED', hrvWeeklyAvgMs: 60, racePredictions: [] });
  });
});
