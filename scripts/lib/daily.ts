/**
 * Daily Glance analytics — turn raw Whoop records into the precomputed
 * snapshot.daily block the React app consumes.
 *
 * Pure functions. `now` is passed in so the pipeline is deterministic.
 */

import type {
  AcwrResult,
  AgreementMatch,
  AnomalyEscalation,
  AnomalyFlag,
  CallContributor,
  DailyAnalytics,
  DailyTrendPoint,
  DayStrainBlock,
  GarminDaily,
  GarminDailyBlock,
  GarminHrvPoint,
  GarminLatestMetrics,
  HrvStatus,
  RecoveryBlock,
  RecoveryState,
  SleepBlock,
  SleepRegularityPoint,
  StravaActivity,
  TodaysCall,
  WhoopCycle,
  WhoopRecovery,
  WhoopSleep,
  WhoopWorkout,
} from './types.js';
import { dateKey as dayKey, DAY_MS, utcDateTime } from '../../utils/date.js';
import { mean } from '../../utils/statistics.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const MS_PER_HOUR = 3_600_000;

function avg(xs: number[]): number {
  return mean(xs) ?? NaN;
}

function pctDelta(value: number, baseline: number): number | null {
  if (!isFinite(baseline) || baseline === 0) return null;
  return ((value - baseline) / baseline) * 100;
}

function recoveryState(score: number | null): RecoveryState {
  if (score == null) return 'unscored';
  if (score >= 85) return 'optimal';
  if (score >= 67) return 'good';
  if (score >= 34) return 'adequate';
  return 'pay-attention';
}

// ─── Recovery + trends ──────────────────────────────────────────────────────

/** Pull the latest scored recovery and its 30-day baseline-relative deltas. */
function buildRecovery(
  recoveries: WhoopRecovery[],
  baselineDays = 30,
): RecoveryBlock | null {
  if (recoveries.length === 0) return null;

  const scored = recoveries.filter((r) => r.score_state === 'SCORED' && r.score);
  const latest = [...scored].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!latest || !latest.score) return null;

  // 30-day baseline (excluding the latest day so the delta is meaningful)
  const cutoff = new Date(new Date(latest.created_at).getTime() - baselineDays * DAY_MS);
  const baseline = scored.filter((r) => {
    const t = new Date(r.created_at);
    return t >= cutoff && r.sleep_id !== latest.sleep_id;
  });
  const baselineHrv = avg(baseline.map((r) => r.score!.hrv_rmssd_milli));
  const baselineRhr = avg(baseline.map((r) => r.score!.resting_heart_rate));
  const baselineSkinTemp = avg(
    baseline.map((r) => r.score!.skin_temp_celsius).filter((v): v is number => v != null),
  );

  return {
    score: latest.score.recovery_score,
    state: recoveryState(latest.score.recovery_score),
    hrvMs: latest.score.hrv_rmssd_milli,
    hrvDeltaPct: pctDelta(latest.score.hrv_rmssd_milli, baselineHrv),
    // Filled in later from the 30-day HRV trend (we don't have it here).
    hrvStatus: 'unknown',
    rhrBpm: latest.score.resting_heart_rate,
    rhrDeltaPct: pctDelta(latest.score.resting_heart_rate, baselineRhr),
    spo2Pct: latest.score.spo2_percentage ?? null,
    skinTempC: latest.score.skin_temp_celsius ?? null,
    skinTempDeltaC:
      latest.score.skin_temp_celsius != null && isFinite(baselineSkinTemp)
        ? latest.score.skin_temp_celsius - baselineSkinTemp
        : null,
  };
}

/**
 * Garmin-style HRV status, computed from Whoop's 30-day overnight HRV trend.
 *
 * Compares the last 7 nights' mean against the prior 23-night baseline.
 * Heuristic — Garmin's classifier uses learned per-user range; we approximate
 * with % delta which is close enough for cross-checking. Returns 'unknown'
 * when there isn't enough data to be meaningful (e.g. early in a backfill).
 */
function computeHrvStatus(trend: DailyTrendPoint[]): HrvStatus {
  if (trend.length < 14) return 'unknown';

  // Trend is oldest-first; last 7 entries are the recent window.
  const recent = trend
    .slice(-7)
    .map((t) => t.value)
    .filter((v): v is number => v != null);
  const baseline = trend
    .slice(0, -7)
    .map((t) => t.value)
    .filter((v): v is number => v != null);

  // Need at least half the recent window + a third of baseline to call it.
  if (recent.length < 3 || baseline.length < 7) return 'unknown';

  const recentMean = avg(recent);
  const baselineMean = avg(baseline);
  if (baselineMean === 0) return 'unknown';

  const deltaPct = ((recentMean - baselineMean) / baselineMean) * 100;

  // Bucketing — symmetric ±5% balanced zone; sustained suppression escalates
  // through 'low' (>10% below) to 'poor' (>15% below). High side stays
  // 'unbalanced' because elevated HRV isn't a concern signal.
  if (deltaPct <= -15) return 'poor';
  if (deltaPct <= -10) return 'low';
  if (Math.abs(deltaPct) < 5) return 'balanced';
  return 'unbalanced';
}

// ─── Sleep ──────────────────────────────────────────────────────────────────

function buildSleep(sleeps: WhoopSleep[]): SleepBlock | null {
  const scoredNightSleeps = sleeps.filter(
    (s) => s.score_state === 'SCORED' && s.score && !s.nap,
  );
  const latest = [...scoredNightSleeps].sort((a, b) => b.start.localeCompare(a.start))[0];
  if (!latest || !latest.score) return null;

  const st = latest.score.stage_summary;
  const inBedH = st.total_in_bed_time_milli / MS_PER_HOUR;
  const awakeH = st.total_awake_time_milli / MS_PER_HOUR;
  const asleepH = inBedH - awakeH;
  const lightH = st.total_light_sleep_time_milli / MS_PER_HOUR;
  const deepH = st.total_slow_wave_sleep_time_milli / MS_PER_HOUR;
  const remH = st.total_rem_sleep_time_milli / MS_PER_HOUR;

  const needed = latest.score.sleep_needed;
  const baselineH = needed.baseline_milli / MS_PER_HOUR;
  const debtH = needed.need_from_sleep_debt_milli / MS_PER_HOUR;
  const strainH = needed.need_from_recent_strain_milli / MS_PER_HOUR;
  const napH = needed.need_from_recent_nap_milli / MS_PER_HOUR;
  const neededH = baselineH + debtH + strainH + napH;

  return {
    asleepHours: asleepH,
    performancePct: latest.score.sleep_performance_percentage,
    efficiencyPct: latest.score.sleep_efficiency_percentage,
    stages: { light: lightH, deep: deepH, rem: remH, awake: awakeH },
    neededHours: neededH,
    neededBreakdown: {
      baselineHours: baselineH,
      fromSleepDebtHours: debtH,
      fromRecentStrainHours: strainH,
      fromRecentNapHours: napH,
    },
    respiratoryRate: latest.score.respiratory_rate ?? null,
  };
}

// ─── Day strain (latest physiological cycle) ────────────────────────────────

function buildDayStrain(cycles: WhoopCycle[]): DayStrainBlock | null {
  const scored = cycles.filter((c) => c.score_state === 'SCORED' && c.score);
  const latest = [...scored].sort((a, b) => b.start.localeCompare(a.start))[0];
  if (!latest || !latest.score) return null;
  return {
    strain: latest.score.strain,
    kilojoule: latest.score.kilojoule,
    avgHr: latest.score.average_heart_rate,
    maxHr: latest.score.max_heart_rate,
  };
}

// ─── Today's Call rules engine ──────────────────────────────────────────────

interface CallInputs {
  recovery: RecoveryBlock | null;
  sleep: SleepBlock | null;
  acwr: AcwrResult | null;
}

const INTENSITY_LADDER = ['rest', 'easy', 'moderate', 'hard'] as const;
type Intensity = (typeof INTENSITY_LADDER)[number];

function downgrade(level: Intensity, steps = 1): Intensity {
  const i = INTENSITY_LADDER.indexOf(level);
  return INTENSITY_LADDER[Math.max(0, i - steps)] ?? 'rest';
}

const TITLES: Record<Intensity, string> = {
  rest: 'Rest day',
  easy: 'Easy session',
  moderate: 'Moderate effort',
  hard: 'Go hard',
};

/**
 * Mika-inspired rules adapted for Whoop. Base intensity from recovery score,
 * downgraded if any caution signal fires. ACWR > 1.5 is a hard cap — anything
 * above easy is unsafe at that load ratio regardless of recovery.
 */
export function computeTodaysCall({ recovery, sleep, acwr }: CallInputs): TodaysCall {
  // No recovery data → conservative default
  if (!recovery || recovery.score == null) {
    return {
      intensity: 'easy',
      title: TITLES.easy,
      reasons: ['No recovery score yet — defaulting to easy.'],
      contributors: [
        {
          label: 'Recovery',
          value: 'n/a',
          threshold: 'scored score required',
          direction: 'neutral',
          effect: 'base',
          detail: 'No recovery score yet — defaulting to easy.',
        },
      ],
    };
  }

  // Base from recovery
  let level: Intensity;
  const s = recovery.score;
  if (s >= 85) level = 'hard';
  else if (s >= 75) level = 'moderate';
  else if (s >= 65) level = 'easy';
  else level = 'rest';

  const reasons: string[] = [];
  const contributors: CallContributor[] = [];

  const baseDetail = `Recovery ${s} → base ${level}.`;
  reasons.push(baseDetail);
  contributors.push({
    label: 'Recovery',
    value: `${s}`,
    threshold: '≥85 hard · ≥75 moderate · ≥65 easy · <65 rest',
    direction: s >= 65 ? 'up' : 'down',
    effect: 'base',
    detail: baseDetail,
  });

  // Downgrade if caution flags
  if (recovery.hrvDeltaPct != null && recovery.hrvDeltaPct <= -7) {
    level = downgrade(level);
    const detail = `HRV ${recovery.hrvDeltaPct.toFixed(0)}% below baseline → downgrade.`;
    reasons.push(detail);
    contributors.push({
      label: 'HRV',
      value: `${recovery.hrvDeltaPct.toFixed(0)}%`,
      threshold: '≤ -7% vs baseline',
      direction: 'down',
      effect: 'downgrade',
      detail,
    });
  }
  if (sleep && sleep.asleepHours < 6) {
    level = downgrade(level);
    const detail = `Only ${sleep.asleepHours.toFixed(1)}h sleep last night → downgrade.`;
    reasons.push(detail);
    contributors.push({
      label: 'Sleep',
      value: `${sleep.asleepHours.toFixed(1)}h`,
      threshold: '< 6h last night',
      direction: 'down',
      effect: 'downgrade',
      detail,
    });
  }
  if (recovery.skinTempDeltaC != null && recovery.skinTempDeltaC > 0.4) {
    level = downgrade(level);
    const detail = `Skin temp +${recovery.skinTempDeltaC.toFixed(2)}°C above baseline → downgrade (illness?)`;
    reasons.push(detail);
    contributors.push({
      label: 'Skin temp',
      value: `+${recovery.skinTempDeltaC.toFixed(2)}°C`,
      threshold: '> +0.4°C vs baseline',
      direction: 'up',
      effect: 'downgrade',
      detail,
    });
  }

  // Hard cap for high training load — overrides everything above easy.
  //
  // `acwr` here is whichever variant the caller marked authoritative. It must
  // NOT be the distance-based one: km-ACWR ignores every zero-distance session
  // (lifts, yoga, HIIT, soccer) and treats swim/bike/run kilometres as
  // interchangeable, so it routinely reads "injury risk" off a single long ride
  // while a cross-sport internal-load ratio sits comfortably in the sweet spot.
  if (acwr && acwr.ratio > 1.5 && (level === 'moderate' || level === 'hard')) {
    level = 'easy';
    const unit = acwr.unit === 'km' ? 'distance' : (acwr.unit ?? 'load');
    const detail = `ACWR ${acwr.ratio.toFixed(2)} (${unit}) = injury risk → cap at easy.`;
    reasons.push(detail);
    contributors.push({
      label: 'Training load',
      value: `ACWR ${acwr.ratio.toFixed(2)}`,
      threshold: '> 1.5 caps at easy',
      direction: 'up',
      effect: 'cap',
      detail,
    });
  }

  return {
    intensity: level,
    title: TITLES[level],
    reasons,
    contributors,
  };
}

// ─── Trend series (last 30 days, oldest first) ──────────────────────────────

function buildTrend<T>(
  rows: T[],
  getDate: (r: T) => string,
  getValue: (r: T) => number | undefined | null,
  now: Date,
  days = 30,
): DailyTrendPoint[] {
  const start = new Date(now.getTime() - days * DAY_MS);
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const d = new Date(getDate(r));
    if (d < start) continue;
    const v = getValue(r);
    if (v == null || !isFinite(v)) continue;
    byDay.set(dayKey(d), v);
  }

  const out: DailyTrendPoint[] = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor <= now) {
    const key = dayKey(cursor);
    out.push({ date: key, value: byDay.get(key) ?? null });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

// ─── Anomaly detection ──────────────────────────────────────────────────────

/**
 * Returns flags worth surfacing on the dashboard. Each flag fires only when
 * the signal has persisted long enough to not be noise.
 */
export function detectAnomalies(
  recoveries: WhoopRecovery[],
  sleeps: WhoopSleep[],
  // `now` reserved for future windowed-baseline rules; current rules work off
  // the most recent records directly, so it's unused for the moment.
  _now: Date,
): AnomalyFlag[] {
  const out: AnomalyFlag[] = [];
  const sortedRec = [...recoveries]
    .filter((r) => r.score_state === 'SCORED' && r.score)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const recent = sortedRec.slice(0, 30);

  // Baseline excludes the most recent 3 days so trends are visible
  const baselineSet = sortedRec.slice(3, 33);
  const blHrv = avg(baselineSet.map((r) => r.score!.hrv_rmssd_milli));
  const blRhr = avg(baselineSet.map((r) => r.score!.resting_heart_rate));
  const blSkin = avg(
    baselineSet
      .map((r) => r.score!.skin_temp_celsius)
      .filter((v): v is number => v != null),
  );

  // Skin temp elevated 2+ nights running
  const skinElevated = recent
    .slice(0, 2)
    .every((r) => {
      const v = r.score!.skin_temp_celsius;
      return v != null && isFinite(blSkin) && v - blSkin > 0.4;
    });
  if (skinElevated && recent.length >= 2 && isFinite(blSkin)) {
    const latest = recent[0]!.score!.skin_temp_celsius!;
    out.push({
      id: 'skin-temp-elevated',
      severity: 'caution',
      title: 'Skin temp elevated',
      body: `Skin temp +${(latest - blSkin).toFixed(2)}°C above baseline for 2+ nights. Possible illness brewing — go easier than planned.`,
      since: recent[1]!.created_at,
    });
  }

  // RHR up ≥7% from baseline today
  if (recent[0] && isFinite(blRhr)) {
    const rhr = recent[0].score!.resting_heart_rate;
    const deltaPct = ((rhr - blRhr) / blRhr) * 100;
    if (deltaPct >= 7) {
      out.push({
        id: 'rhr-elevated',
        severity: 'caution',
        title: 'Resting HR elevated',
        body: `RHR ${rhr.toFixed(0)} bpm is ${deltaPct.toFixed(0)}% above your 30-day baseline. Rising RHR is an early under-recovery signal.`,
        since: recent[0].created_at,
      });
    }
  }

  // HRV trending down — ≥3 consecutive days at -7% or worse
  if (isFinite(blHrv)) {
    const lastThree = recent.slice(0, 3);
    if (
      lastThree.length === 3 &&
      lastThree.every((r) => ((r.score!.hrv_rmssd_milli - blHrv) / blHrv) * 100 <= -7)
    ) {
      out.push({
        id: 'hrv-dropping',
        severity: 'warning',
        title: 'HRV trending down',
        body: `HRV has been ≥7% below baseline for 3 nights running. Time to deload — accumulated fatigue is showing.`,
        since: lastThree[2]!.created_at,
      });
    }
  }

  // Respiratory rate elevated by ≥1 bpm from sleep records (illness leading indicator)
  const scoredSleeps = [...sleeps]
    .filter((s) => s.score_state === 'SCORED' && s.score && !s.nap)
    .sort((a, b) => b.start.localeCompare(a.start));
  if (scoredSleeps.length >= 30) {
    const respBaseline = avg(
      scoredSleeps.slice(3, 33).map((s) => s.score!.respiratory_rate),
    );
    const latestResp = scoredSleeps[0]!.score!.respiratory_rate;
    if (isFinite(respBaseline) && latestResp - respBaseline >= 1) {
      out.push({
        id: 'respiration-elevated',
        severity: 'caution',
        title: 'Respiration rate up',
        body: `Last night's respiration rate (${latestResp.toFixed(1)} bpm) is ${(latestResp - respBaseline).toFixed(1)} above your baseline. Often appears 24-48h before symptoms of illness.`,
        since: scoredSleeps[0]!.start,
      });
    }
  }

  // Sleep debt — 2 of last 3 nights <7h
  const lastSleeps = scoredSleeps.slice(0, 3);
  const shortNights = lastSleeps.filter((s) => {
    const inBed = s.score!.stage_summary.total_in_bed_time_milli;
    const awake = s.score!.stage_summary.total_awake_time_milli;
    return (inBed - awake) / 3_600_000 < 7;
  }).length;
  if (shortNights >= 2 && lastSleeps.length >= 2) {
    out.push({
      id: 'sleep-debt',
      severity: 'caution',
      title: 'Sleep debt accumulating',
      body: `${shortNights} of last 3 nights below 7h. Prioritize an early night before pushing intensity.`,
      since: lastSleeps[lastSleeps.length - 1]!.start,
    });
  }

  // Suppress duplicates: ignore "rhr-elevated" if "hrv-dropping" already there
  // (same root cause, less noise)
  if (out.some((a) => a.id === 'hrv-dropping')) {
    return out.filter((a) => a.id !== 'rhr-elevated');
  }
  return out;
}

/**
 * Derive an overall escalation from the active anomaly combination. Escalation
 * is intentionally conservative — a single low-severity flag should NOT trip it.
 * It fires when:
 *   - Early-illness combo: elevated skin temp alongside elevated RHR or
 *     respiration (classic pre-symptomatic infection pattern), or
 *   - A warning-level flag (e.g. HRV trending down) fires alongside any other
 *     anomaly, or
 *   - Three or more anomalies are active at once.
 */
export function computeAnomalyEscalation(flags: AnomalyFlag[]): AnomalyEscalation {
  const has = (id: AnomalyFlag['id']) => flags.some((f) => f.id === id);
  const reasons: string[] = [];
  const triggeredBy = new Set<AnomalyFlag['id']>();

  // Early-illness signal: rising skin temp + rising RHR / respiration together.
  const illnessPartner: AnomalyFlag['id'] | null = has('rhr-elevated')
    ? 'rhr-elevated'
    : has('respiration-elevated')
      ? 'respiration-elevated'
      : null;
  if (has('skin-temp-elevated') && illnessPartner) {
    reasons.push(
      'Elevated skin temp with elevated ' +
        (illnessPartner === 'rhr-elevated' ? 'resting HR' : 'respiration') +
        ' — early-illness signal.',
    );
    triggeredBy.add('skin-temp-elevated');
    triggeredBy.add(illnessPartner);
  }

  // A warning-severity flag alongside any other active anomaly.
  const warning = flags.find((f) => f.severity === 'warning');
  if (warning && flags.length >= 2) {
    reasons.push(`${warning.title} is compounding with other active flags.`);
    for (const f of flags) triggeredBy.add(f.id);
  }

  // Sheer volume of simultaneous anomalies.
  if (flags.length >= 3) {
    reasons.push(`${flags.length} anomalies active at once.`);
    for (const f of flags) triggeredBy.add(f.id);
  }

  return {
    active: reasons.length > 0,
    reasons,
    triggeredBy: [...triggeredBy],
  };
}

// ─── Sleep regularity ───────────────────────────────────────────────────────

/**
 * Bed/wake times for the last `days` days, in LOCAL clock hours (decimal).
 * "Bed" is when the sleep period started; "wake" is when it ended.
 * Times after midnight (early-morning bedtimes) are represented as 24+, so
 * a chart can render them above midnight rather than wrapping around.
 */
export function computeSleepRegularity(
  sleeps: WhoopSleep[],
  now: Date,
  days = 30,
): SleepRegularityPoint[] {
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const nights = [...sleeps]
    .filter((s) => s.score_state === 'SCORED' && !s.nap && new Date(s.start) >= cutoff)
    .sort((a, b) => a.start.localeCompare(b.start));

  return nights.map((s) => {
    const bedUtc = new Date(s.start);
    const wakeUtc = new Date(s.end);
    // Apply Whoop's per-sleep timezone offset to get local clock time
    const offsetMin = parseTimezoneOffsetToMinutes(s.timezone_offset);
    const bedLocal = new Date(bedUtc.getTime() + offsetMin * 60_000);
    const wakeLocal = new Date(wakeUtc.getTime() + offsetMin * 60_000);

    let bedHour = bedLocal.getUTCHours() + bedLocal.getUTCMinutes() / 60;
    let wakeHour = wakeLocal.getUTCHours() + wakeLocal.getUTCMinutes() / 60;

    // If someone went to bed between 18:00-23:59 local, plot at the "low"
    // side. If they went to bed 00:00-06:00 (technically next day), show as 24+.
    if (bedHour < 12) bedHour += 24;
    if (wakeHour < bedHour - 24) wakeHour += 24;
    // Normalize wake into the same "extended day" scale
    if (wakeHour < bedHour) wakeHour += 24;

    return {
      date: s.start.slice(0, 10),
      bedHourLocal: bedHour,
      wakeHourLocal: wakeHour,
    };
  });
}

/** "-05:00" → -300, "+01:30" → 90. Defaults to 0 on bad input. */
function parseTimezoneOffsetToMinutes(off: string | undefined): number {
  if (!off) return 0;
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(off);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (parseInt(m[2]!, 10) * 60 + parseInt(m[3]!, 10));
}

// ─── Cross-source agreement (Strava ↔ Whoop) ────────────────────────────────

const AGREEMENT_FLAG_PCT = 5; // > 5% difference in avg HR = flagged

export function computeAgreement(
  stravaActivities: StravaActivity[],
  whoopWorkouts: WhoopWorkout[],
  now: Date,
  windowDays = 14,
  maxMatches = 5,
): AgreementMatch[] {
  const cutoff = new Date(now.getTime() - windowDays * DAY_MS);
  const scoredWhoop = whoopWorkouts.filter(
    (w) => w.score_state === 'SCORED' && w.score && new Date(w.start) >= cutoff,
  );
  const recentStrava = [...stravaActivities]
    .filter((a) => new Date(a.start_date) >= cutoff && a.has_heartrate)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));

  const WINDOW_MS = 10 * 60 * 1000;
  const matches: AgreementMatch[] = [];

  for (const a of recentStrava) {
    if (matches.length >= maxMatches) break;
    const at = new Date(a.start_date).getTime();
    let best: WhoopWorkout | null = null;
    let bestDelta = Infinity;
    for (const w of scoredWhoop) {
      const delta = Math.abs(new Date(w.start).getTime() - at);
      if (delta < bestDelta && delta < WINDOW_MS) {
        bestDelta = delta;
        best = w;
      }
    }
    if (!best || !best.score) continue;

    const stravaAvg = a.average_heartrate ?? null;
    const stravaMax = a.max_heartrate ?? null;
    const whoopAvg = best.score.average_heart_rate;
    const whoopMax = best.score.max_heart_rate;
    const avgDelta =
      stravaAvg && stravaAvg > 0 ? ((whoopAvg - stravaAvg) / stravaAvg) * 100 : null;
    const maxDelta =
      stravaMax && stravaMax > 0 ? ((whoopMax - stravaMax) / stravaMax) * 100 : null;
    const flagged = avgDelta != null && Math.abs(avgDelta) > AGREEMENT_FLAG_PCT;

    matches.push({
      stravaId: a.id,
      stravaName: a.name,
      startDateLocal: a.start_date_local,
      sportType: a.sport_type,
      durationMinutes: (a.moving_time ?? 0) / 60,
      stravaAvgHr: stravaAvg,
      stravaMaxHr: stravaMax,
      whoopAvgHr: whoopAvg,
      whoopMaxHr: whoopMax,
      avgHrDeltaPct: avgDelta,
      maxHrDeltaPct: maxDelta,
      flagged,
    });
  }
  return matches;
}

// ─── Top-level ──────────────────────────────────────────────────────────────

export function computeDailyAnalytics(
  recoveries: WhoopRecovery[],
  sleeps: WhoopSleep[],
  cycles: WhoopCycle[],
  acwr: AcwrResult | null,
  now: Date,
  stravaActivities: StravaActivity[] = [],
  whoopWorkouts: WhoopWorkout[] = [],
): DailyAnalytics {
  const recovery = buildRecovery(recoveries);
  const sleep = buildSleep(sleeps);
  const dayStrain = buildDayStrain(cycles);
  const todaysCall = computeTodaysCall({ recovery, sleep, acwr });

  const trends = {
    hrv: buildTrend(
      recoveries.filter((r) => r.score_state === 'SCORED'),
      (r) => r.created_at,
      (r) => r.score?.hrv_rmssd_milli,
      now,
    ),
    rhr: buildTrend(
      recoveries.filter((r) => r.score_state === 'SCORED'),
      (r) => r.created_at,
      (r) => r.score?.resting_heart_rate,
      now,
    ),
    asleepHours: buildTrend(
      sleeps.filter((s) => s.score_state === 'SCORED' && !s.nap),
      (s) => s.start,
      (s) => {
        if (!s.score) return null;
        return (
          (s.score.stage_summary.total_in_bed_time_milli -
            s.score.stage_summary.total_awake_time_milli) /
          MS_PER_HOUR
        );
      },
      now,
    ),
    dayStrain: buildTrend(
      cycles.filter((c) => c.score_state === 'SCORED'),
      (c) => c.start,
      (c) => c.score?.strain,
      now,
    ),
    // The four series below exist because the AI generators were being asked to
    // describe multi-week physiological patterns while receiving only today's
    // scalar for each of these signals. Recovery score in particular is the most
    // volatile number in the dataset and was entirely invisible over time.
    recoveryScore: buildTrend(
      recoveries.filter((r) => r.score_state === 'SCORED'),
      (r) => r.created_at,
      (r) => r.score?.recovery_score,
      now,
    ),
    sleepEfficiency: buildTrend(
      sleeps.filter((s) => s.score_state === 'SCORED' && !s.nap),
      (s) => s.start,
      (s) => s.score?.sleep_efficiency_percentage,
      now,
    ),
    sleepPerformance: buildTrend(
      sleeps.filter((s) => s.score_state === 'SCORED' && !s.nap),
      (s) => s.start,
      (s) => s.score?.sleep_performance_percentage,
      now,
    ),
    respiratoryRate: buildTrend(
      sleeps.filter((s) => s.score_state === 'SCORED' && !s.nap),
      (s) => s.start,
      (s) => s.score?.respiratory_rate,
      now,
    ),
    skinTempC: buildTrend(
      recoveries.filter((r) => r.score_state === 'SCORED'),
      (r) => r.created_at,
      (r) => r.score?.skin_temp_celsius,
      now,
    ),
  };

  // Fill in HRV status now that we have the 30-day trend. Computed AFTER
  // buildRecovery because the function only has access to recoveries; the
  // trend builder lives here.
  if (recovery) {
    recovery.hrvStatus = computeHrvStatus(trends.hrv);
  }

  const anomalies = detectAnomalies(recoveries, sleeps, now);

  return {
    date: now.toISOString().slice(0, 10),
    recovery,
    sleep,
    dayStrain,
    todaysCall,
    trends,
    anomalies,
    anomalyEscalation: computeAnomalyEscalation(anomalies),
    sleepRegularity: computeSleepRegularity(sleeps, now, 30),
    agreement: computeAgreement(stravaActivities, whoopWorkouts, now, 14, 5),
  };
}

// ─── Garmin daily glance ────────────────────────────────────────────────────

/** Garmin's default weekly intensity-minutes goal — 150 moderate-equivalent. */
const GARMIN_WEEKLY_INTENSITY_GOAL = 150;

/**
 * Build the GarminDailyBlock surfaced in the Daily Glance.
 *
 * The "today" entry is the most recent date in `daily` — Garmin's daily summary
 * for the current calendar day rolls in throughout the day, so this is always
 * the freshest snapshot we have. Returns null if there's no Garmin data at all.
 */
export function computeGarminDailyBlock(
  daily: GarminDaily[],
  hrv: GarminHrvPoint[],
  latest: GarminLatestMetrics | null,
  now: Date,
): GarminDailyBlock | null {
  if (daily.length === 0) return null;
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const latestDay = sorted[sorted.length - 1]!;

  // Last 30 days, oldest first, with nulls for gaps so the sparkline x-axis
  // stays evenly spaced.
  const stepsTrend: DailyTrendPoint[] = [];
  const bodyBatteryTrend: DailyTrendPoint[] = [];
  const trainingReadinessTrend: DailyTrendPoint[] = [];
  const spo2Trend: DailyTrendPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    const key = dayKey(d);
    const entry = byDate.get(key) ?? null;
    stepsTrend.push({ date: key, value: entry?.steps ?? null });
    bodyBatteryTrend.push({ date: key, value: entry?.bodyBatteryHigh ?? null });
    trainingReadinessTrend.push({
      date: key,
      value: entry?.trainingReadinessScore ?? null,
    });
    spo2Trend.push({ date: key, value: entry?.avgSpo2 ?? null });
  }

  // Intensity minutes — 8 weeks of daily moderate-equivalent values.
  const intensityMinutesTrend: DailyTrendPoint[] = [];
  for (let i = 55; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    const key = dayKey(d);
    const entry = byDate.get(key);
    const value =
      entry &&
      (entry.intensityMinutesModerate != null || entry.intensityMinutesVigorous != null)
        ? (entry.intensityMinutesModerate ?? 0) + (entry.intensityMinutesVigorous ?? 0) * 2
        : null;
    intensityMinutesTrend.push({ date: key, value });
  }

  // VO₂ max — 90 days. Carries forward the last known value within the window
  // because Garmin updates it only after qualifying outdoor runs (often >1 week gaps).
  const vo2MaxTrend: DailyTrendPoint[] = [];
  let lastKnownVo2: number | null = null;
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    const key = dayKey(d);
    const entry = byDate.get(key);
    if (entry?.vo2Max != null) lastKnownVo2 = entry.vo2Max;
    vo2MaxTrend.push({ date: key, value: lastKnownVo2 });
  }

  // Garmin counts vigorous minutes double toward the goal — match that here so
  // the displayed total mirrors what the watch and app show.
  const weekCutoff = new Date(now.getTime() - 7 * DAY_MS);
  let weeklyIntensity = 0;
  let hasIntensityData = false;
  for (const d of sorted) {
    if (utcDateTime(d.date) < weekCutoff.getTime()) continue;
    if (d.intensityMinutesModerate != null) {
      weeklyIntensity += d.intensityMinutesModerate;
      hasIntensityData = true;
    }
    if (d.intensityMinutesVigorous != null) {
      weeklyIntensity += d.intensityMinutesVigorous * 2;
      hasIntensityData = true;
    }
  }

  // Find the most recent non-null VO2 max across the whole dataset — Garmin
  // only updates VO2 max after a qualifying outdoor run, so it's sticky.
  let vo2Max: number | null = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i]!.vo2Max != null) {
      vo2Max = sorted[i]!.vo2Max;
      break;
    }
  }

  // Latest HRV status — pick the most recent non-null entry.
  const sortedHrv = [...hrv].sort((a, b) => a.date.localeCompare(b.date));
  let hrvStatus: string | null = null;
  let hrvWeeklyAvgMs: number | null = null;
  for (let i = sortedHrv.length - 1; i >= 0; i--) {
    const h = sortedHrv[i]!;
    if (h.status && hrvStatus == null) hrvStatus = h.status;
    if (h.weeklyAvgMs != null && hrvWeeklyAvgMs == null) hrvWeeklyAvgMs = h.weeklyAvgMs;
    if (hrvStatus != null && hrvWeeklyAvgMs != null) break;
  }

  return {
    date: latestDay.date,
    steps: latestDay.steps,
    stepGoal: latestDay.stepGoal,
    bodyBatteryHigh: latestDay.bodyBatteryHigh,
    bodyBatteryLow: latestDay.bodyBatteryLow,
    restingHeartRate: latestDay.restingHeartRate,
    stressAvg: latestDay.stressAvg,
    intensityMinutesWeek: hasIntensityData ? weeklyIntensity : null,
    intensityMinutesGoal: GARMIN_WEEKLY_INTENSITY_GOAL,
    vo2Max,
    stepsTrend,
    bodyBatteryTrend,

    // Tier 1
    floorsToday: latestDay.floorsClimbed,
    floorsGoal: latestDay.floorsGoal,
    hrvStatus,
    hrvWeeklyAvgMs,
    vo2MaxTrend,
    intensityMinutesTrend,

    // Tier 2
    trainingReadinessScore: latestDay.trainingReadinessScore,
    trainingReadinessLevel: latestDay.trainingReadinessLevel,
    recoveryTimeHours: latestDay.recoveryTimeHours,
    trainingReadinessFeedback: latestDay.trainingReadinessFeedback,
    trainingReadinessTrend,
    avgSpo2: latestDay.avgSpo2,
    minSpo2: latestDay.minSpo2,
    spo2Trend,
    trainingStatus: latest?.trainingStatus ?? null,
    racePredictions: latest?.racePredictions ?? null,
  };
}
