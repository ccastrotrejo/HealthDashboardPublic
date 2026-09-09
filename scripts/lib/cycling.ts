/**
 * Cycling-specific analytics: power zones, TSS/IF/VI, hrTSS, and the data
 * hygiene rules that have to run before any of it means anything.
 *
 * Pure functions only — same inputs always produce the same outputs, no I/O,
 * no Date.now(). Same contract as analytics.ts.
 *
 * ── Why this module exists separately ──────────────────────────────────────
 * Power math is only valid under conditions the rest of the pipeline has no
 * reason to care about: the activity must be a ride, the watts must come from
 * a real meter rather than Strava's estimator, and the same physical session
 * must not have been recorded twice. Those guards live here so that no caller
 * can accidentally compute a Training Stress Score from a running power meter.
 */

import type { CyclingProfile, PowerZone, StravaActivity } from './types.js';
import { DAY_MS, utcDateTime } from '../../utils/date.js';

// ─── Sport predicates ───────────────────────────────────────────────────────

/** Ride-family sports. Deliberately excludes EBikeRide — assisted watts aren't training watts. */
export function isRide(sportType: string): boolean {
  return /^(Ride|VirtualRide|MountainBikeRide|GravelRide|Handcycle|Velomobile)$/.test(sportType);
}

export function isRun(sportType: string): boolean {
  return /Run/.test(sportType);
}

/** Trainer or Zwift — the sessions where power is trustworthy and speed is meaningless. */
export function isIndoorRide(a: StravaActivity): boolean {
  return isRide(a.sport_type) && (a.sport_type === 'VirtualRide' || a.trainer === true);
}

/**
 * True only when watts came from a real power meter or smart trainer.
 *
 * Strava sets `device_watts: false` for its own estimated power, which carries
 * ±20–40% error and is not computed with the 30-second rolling algorithm that
 * Normalized Power requires. Estimated power is displayable but must never
 * reach TSS, IF, FTP or the power curve.
 *
 * Running and cycling power are not interchangeable, so the sport guard must
 * prevent running efforts from being ranked as cycling records.
 */
export function hasRealPower(a: StravaActivity): boolean {
  return isRide(a.sport_type) && a.device_watts === true && (a.average_watts ?? 0) > 0;
}

// ─── Data hygiene ───────────────────────────────────────────────────────────

const COMMUTE_MAX_SECONDS = 20 * 60;
const COMMUTE_MAX_METERS = 8_000;

/**
 * Utility riding rather than training.
 *
 * Short point-to-point trips can lack Strava's `commute` flag. They still
 * contribute training stress to load totals, but counting each utility trip
 * as a training session can overstate adherence.
 */
export function isCommute(a: StravaActivity): boolean {
  if (!isRide(a.sport_type)) return false;
  if (a.commute === true) return true;
  if (isIndoorRide(a)) return false;
  return (a.moving_time ?? 0) <= COMMUTE_MAX_SECONDS && (a.distance ?? 0) <= COMMUTE_MAX_METERS;
}

/** A ride that counts as a training session. */
export function isTrainingRide(a: StravaActivity): boolean {
  return isRide(a.sport_type) && !isCommute(a);
}

/**
 * Heart rate that is not physically plausible for the work performed.
 *
 * Optical wrist and arm sensors drop out under vibration and grip pressure on
 * the bike. Left unflagged, an artefact reading gets classified "easy" and
 * produces an hrTSS near zero, quietly erasing a real session from the load
 * model.
 *
 * The threshold is deliberately conservative and scales with heart-rate
 * reserve rather than being a fixed offset. Genuine easy rides must not be
 * flagged, so only readings barely above resting trip it.
 */
export function hrLooksImplausible(a: StravaActivity, restingHr = 50, maxHr = 190): boolean {
  const hr = a.average_heartrate;
  if (!a.has_heartrate || !hr) return false;
  if ((a.moving_time ?? 0) < 20 * 60) return false;
  const reserve = maxHr - restingHr;
  if (reserve <= 0) return false;
  return hr < restingHr + 0.15 * reserve;
}

/**
 * Collapse the same indoor session recorded by two devices.
 *
 * Zwift writes a VirtualRide per route while a head unit records the whole
 * trainer session as one continuous `Ride` with `trainer: true`. Keeping both
 * sources would count overlapping efforts twice.
 *
 * The Zwift records are kept because they preserve workout structure; the head
 * unit's umbrella recording is dropped. Days with only VirtualRides are left
 * alone, since consecutive Zwift routes are genuinely separate efforts.
 */
export function dedupeIndoorRides(activities: StravaActivity[]): StravaActivity[] {
  const byDay = new Map<string, StravaActivity[]>();
  for (const a of activities) {
    if (!isIndoorRide(a)) continue;
    const day = (a.start_date_local ?? a.start_date).slice(0, 10);
    const list = byDay.get(day);
    if (list) list.push(a);
    else byDay.set(day, [a]);
  }

  const drop = new Set<number>();
  for (const sameDay of byDay.values()) {
    const virtual = sameDay.filter((a) => a.sport_type === 'VirtualRide');
    const umbrella = sameDay.filter((a) => a.sport_type !== 'VirtualRide' && a.trainer === true);
    if (!virtual.length || !umbrella.length) continue;

    for (const u of umbrella) {
      const uStart = new Date(u.start_date).getTime();
      const uEnd = uStart + (u.elapsed_time ?? u.moving_time ?? 0) * 1000;
      const overlaps = virtual.some((v) => {
        const vStart = new Date(v.start_date).getTime();
        const vEnd = vStart + (v.elapsed_time ?? v.moving_time ?? 0) * 1000;
        return vStart < uEnd && vEnd > uStart;
      });
      if (overlaps) drop.add(u.id);
    }
  }

  return drop.size ? activities.filter((a) => !drop.has(a.id)) : activities;
}

// ─── Power zones (Coggan 7-zone model) ──────────────────────────────────────

/**
 * Coggan zone boundaries as fractions of FTP. Upper bound of Z7 is open-ended.
 * Sweet spot (88–94%) sits inside Z4 rather than being its own zone, which is
 * how Coggan defines it.
 */
const ZONE_TABLE: { zone: PowerZone['zone']; label: string; minPct: number; maxPct: number | null }[] =
  [
    { zone: 1, label: 'Active Recovery', minPct: 0, maxPct: 0.55 },
    { zone: 2, label: 'Endurance', minPct: 0.56, maxPct: 0.75 },
    { zone: 3, label: 'Tempo', minPct: 0.76, maxPct: 0.87 },
    { zone: 4, label: 'Threshold', minPct: 0.88, maxPct: 1.05 },
    { zone: 5, label: 'VO₂max', minPct: 1.06, maxPct: 1.2 },
    { zone: 6, label: 'Anaerobic', minPct: 1.21, maxPct: 1.5 },
    { zone: 7, label: 'Neuromuscular', minPct: 1.51, maxPct: null },
  ];

export function powerZones(ftpWatts: number): PowerZone[] {
  return ZONE_TABLE.map((z) => ({
    zone: z.zone,
    label: z.label,
    minWatts: Math.round(z.minPct * ftpWatts),
    maxWatts: z.maxPct == null ? null : Math.round(z.maxPct * ftpWatts),
    minPctFtp: z.minPct,
    maxPctFtp: z.maxPct,
  }));
}

/** Sweet spot is the highest-yield zone per hour for a time-crunched rider. */
export function sweetSpotWatts(ftpWatts: number): { minWatts: number; maxWatts: number } {
  return { minWatts: Math.round(0.88 * ftpWatts), maxWatts: Math.round(0.94 * ftpWatts) };
}

export function zoneForWatts(watts: number, ftpWatts: number): PowerZone['zone'] | null {
  if (!(ftpWatts > 0) || !(watts > 0)) return null;
  const pct = watts / ftpWatts;
  for (const z of ZONE_TABLE) {
    if (z.maxPct == null) return z.zone;
    if (pct <= z.maxPct) return z.zone;
  }
  return 7;
}

// ─── Power metrics ──────────────────────────────────────────────────────────

/**
 * Normalized Power.
 *
 * Strava's `weighted_average_watts` IS Coggan's Normalized Power — the 30-second
 * rolling average raised to the 4th power, averaged, then 4th-rooted. It comes
 * free on the activity summary, so no stream fetching is needed for TSS.
 */
export function normalizedPower(a: StravaActivity): number | null {
  if (!hasRealPower(a)) return null;
  return a.weighted_average_watts ?? a.average_watts ?? null;
}

/** IF = NP / FTP. 1.0 is a maximal one-hour effort by definition. */
export function intensityFactor(a: StravaActivity, ftpWatts: number): number | null {
  const np = normalizedPower(a);
  if (np == null || !(ftpWatts > 0)) return null;
  return +(np / ftpWatts).toFixed(3);
}

/** Variability Index = NP / average power. >1.05 means a surgy, non-steady ride. */
export function variabilityIndex(a: StravaActivity): number | null {
  const np = normalizedPower(a);
  const avg = a.average_watts;
  if (np == null || !avg || avg <= 0) return null;
  return +(np / avg).toFixed(2);
}

/**
 * Training Stress Score.
 *
 *   TSS = (t_sec × NP × IF) / (FTP × 3600) × 100
 *       = t_sec × NP² / (FTP² × 36)
 *
 * 100 TSS is one hour at FTP. Returns null unless real power is present —
 * a TSS derived from estimated watts is worse than no TSS, because it looks
 * authoritative while carrying 20–40% error.
 */
export function rideTss(a: StravaActivity, ftpWatts: number): number | null {
  const np = normalizedPower(a);
  const seconds = a.moving_time ?? 0;
  if (np == null || !(ftpWatts > 0) || seconds <= 0) return null;
  return +((seconds * np * np) / (ftpWatts * ftpWatts * 36)).toFixed(1);
}

/**
 * Heart-rate TSS, for every session without a power meter — outdoor rides,
 * swims, yoga and gym.
 *
 *   IF_HR = (HR_avg − HR_rest) / (LTHR − HR_rest)
 *   hrTSS = hours × IF_HR² × 100
 *
 * Calibrated so an hour at threshold HR scores 100, matching power TSS. It
 * overestimates strength work (heart rate rises without matching metabolic
 * cost) so callers should prefer logged session RPE for lifting when present.
 */
export function hrTss(
  a: StravaActivity,
  profile: Pick<CyclingProfile, 'lthr' | 'restingHr' | 'maxHr'>,
): number | null {
  const { lthr, restingHr } = profile;
  const hr = a.average_heartrate;
  const seconds = a.moving_time ?? 0;
  if (!hr || !lthr || restingHr == null || seconds <= 0) return null;
  if (lthr <= restingHr) return null;
  if (hrLooksImplausible(a, restingHr, profile.maxHr ?? 190)) return null;
  const ifHr = (hr - restingHr) / (lthr - restingHr);
  if (!(ifHr > 0)) return null;
  return +(((seconds / 3600) * ifHr * ifHr * 100).toFixed(1));
}

/**
 * The best available stress score for one activity, in TSS-equivalent units.
 * Power first, heart rate second, null when neither is usable.
 */
export function sessionStress(a: StravaActivity, profile: CyclingProfile): number | null {
  return rideTss(a, profile.ftpWatts) ?? hrTss(a, profile);
}

// ─── Efficiency ─────────────────────────────────────────────────────────────

/**
 * Efficiency Factor = NP / average HR, in watts per beat.
 *
 * Tracked across comparable steady Z2 rides, a rising EF is direct evidence the
 * aerobic engine is improving, and it moves weeks before FTP does. Only
 * meaningful on steady rides, so surgy efforts are rejected on Variability
 * Index rather than silently producing a misleading number.
 */
export function efficiencyFactor(a: StravaActivity): number | null {
  const np = normalizedPower(a);
  const hr = a.average_heartrate;
  if (np == null || !hr || hr <= 0) return null;
  const vi = variabilityIndex(a);
  if (vi != null && vi > 1.15) return null;
  return +(np / hr).toFixed(3);
}

// ─── FTP ────────────────────────────────────────────────────────────────────

/**
 * Map Intensity Factor onto the Borg CR10 scale.
 *
 * Lets a power-bearing ride contribute a properly graded session-RPE to the
 * cross-sport load model instead of collapsing to one of three coarse buckets.
 * Anchored on the definition of IF: 1.0 is a maximal one-hour effort, which is
 * an RPE 9–10 experience.
 */
export function rpeFromIntensityFactor(iF: number): number {
  if (iF < 0.55) return 2;
  if (iF < 0.65) return 3;
  if (iF < 0.75) return 4;
  if (iF < 0.85) return 5;
  if (iF < 0.9) return 6;
  if (iF < 0.95) return 7;
  if (iF < 1.0) return 8;
  return 9;
}

/**
 * Build the working cycling profile from the program defaults, whatever Strava
 * knows, and observed heart-rate history.
 *
 * Strava's athlete FTP wins when set, because it is what the athlete last
 * entered or what a test wrote back. It was already being fetched by the sync
 * and thrown away.
 */
export function resolveCyclingProfile(
  defaults: {
    ftpWatts: number;
    ftpSource: CyclingProfile['ftpSource'];
    ftpTestedOn: string | null;
    weightKg: number;
    lthr: number | null;
    maxHr: number | null;
    restingHr: number | null;
  },
  opts: { stravaFtp?: number | null; restingHr?: number | null } = {},
): CyclingProfile {
  const stravaFtp = opts.stravaFtp && opts.stravaFtp > 0 ? opts.stravaFtp : null;

  const ftpWatts = stravaFtp ?? defaults.ftpWatts;
  const ftpSource: CyclingProfile['ftpSource'] = stravaFtp ? 'strava' : defaults.ftpSource;

  // LTHR is the anchor for every heart-rate-derived number. Without a measured
  // threshold effort, approximate from max HR — 90% is the midpoint of the
  // 88–93% range typical for trained athletes. Flagged by ftpSource staying an
  // estimate so nothing downstream implies it was measured.
  const lthr = defaults.lthr ?? (defaults.maxHr ? Math.round(defaults.maxHr * 0.9) : null);

  return {
    ftpWatts,
    ftpSource,
    ftpTestedOn: defaults.ftpTestedOn,
    weightKg: defaults.weightKg,
    lthr,
    maxHr: defaults.maxHr,
    restingHr: opts.restingHr ?? defaults.restingHr,
  };
}

/** FTP from a 20-minute maximal effort. The 0.95 removes the anaerobic contribution. */
export function ftpFrom20Min(avgWatts: number): number {
  return Math.round(avgWatts * 0.95);
}

/** FTP from a ramp test: 75% of best 1-minute power at failure. */
export function ftpFromRamp(bestOneMinWatts: number): number {
  return Math.round(bestOneMinWatts * 0.75);
}

export function wattsPerKg(ftpWatts: number, weightKg: number): number | null {
  if (!(ftpWatts > 0) || !(weightKg > 0)) return null;
  return +(ftpWatts / weightKg).toFixed(2);
}

/**
 * Coggan power-profile tier for a 60-minute effort, male.
 * Used to give an FTP number context rather than leaving it as a bare watt count.
 */
export function cogganTier(wkg: number): string {
  if (wkg >= 5.0) return 'World class';
  if (wkg >= 4.4) return 'Exceptional';
  if (wkg >= 3.9) return 'Excellent (Cat 1–2)';
  if (wkg >= 3.4) return 'Very good (Cat 3)';
  if (wkg >= 2.9) return 'Good (Cat 4)';
  if (wkg >= 2.4) return 'Fair (Cat 5)';
  if (wkg >= 1.9) return 'Novice';
  return 'Untrained';
}

/**
 * Whether an FTP retest is warranted.
 *
 * Six to eight weeks is the standard cadence, and a test taken while buried
 * measures fatigue rather than fitness — hence the form gate.
 */
export function ftpRetestDue(
  lastTestedOn: string | null,
  now: Date,
  tsb: number | null,
): { due: boolean; reason: string } {
  if (!lastTestedOn) return { due: true, reason: 'No FTP test on record — establish a baseline.' };
  const days = Math.floor((now.getTime() - utcDateTime(lastTestedOn)) / DAY_MS);
  if (days < 42) return { due: false, reason: `Last tested ${days}d ago — retest at 6–8 weeks.` };
  if (tsb != null && tsb < -20) {
    return { due: false, reason: `Due at ${days}d, but form is ${tsb.toFixed(0)} — test after a deload.` };
  }
  return { due: true, reason: `Last tested ${days}d ago — retest due.` };
}

// ─── Stream-derived metrics ─────────────────────────────────────────────────

/**
 * Normalized Power computed from a raw watt stream.
 *
 * The full Coggan algorithm: 30-second rolling average, raised to the 4th
 * power, averaged, then 4th-rooted. Strava reports NP for whole activities, but
 * computing it here is what makes NP available for the *halves* of a ride,
 * which is what aerobic decoupling needs.
 */
export function normalizedPowerFromStream(watts: number[]): number | null {
  if (watts.length < 30) return null;
  let sum = 0;
  let n = 0;
  let rolling = 0;
  for (let i = 0; i < watts.length; i++) {
    rolling += watts[i] ?? 0;
    if (i >= 30) rolling -= watts[i - 30] ?? 0;
    if (i >= 29) {
      const avg = rolling / 30;
      sum += avg ** 4;
      n += 1;
    }
  }
  if (n === 0) return null;
  return +Math.pow(sum / n, 0.25).toFixed(1);
}

/**
 * Aerobic decoupling (Pw:Hr) — the percentage by which power-per-heartbeat
 * degrades from the first half of a ride to the second.
 *
 *   decoupling = (EF_first − EF_second) / EF_first × 100
 *
 * Under 5% on a long steady ride means the aerobic system can hold its output
 * without cardiac drift, which is the standard gate for advancing out of a base
 * phase. It moves weeks before FTP does, which is why it is worth the extra
 * API call that fetching streams costs.
 *
 * Positive = power faded relative to heart rate (the normal direction).
 */
export function computeDecoupling(
  watts: number[],
  heartrate: number[],
): { decouplingPct: number; efFirst: number; efSecond: number } | null {
  const n = Math.min(watts.length, heartrate.length);
  // Below ~20 minutes the two halves are too short for the comparison to mean
  // anything; drift needs duration to express itself.
  if (n < 1200) return null;

  const mid = Math.floor(n / 2);
  const half = (from: number, to: number) => {
    let w = 0;
    let h = 0;
    let c = 0;
    for (let i = from; i < to; i++) {
      const hr = heartrate[i] ?? 0;
      // Zero/absent heart rate is a dropout, not a real reading — including it
      // would inflate the efficiency factor for that half.
      if (hr <= 0) continue;
      w += watts[i] ?? 0;
      h += hr;
      c += 1;
    }
    if (c === 0) return null;
    const avgHr = h / c;
    if (avgHr <= 0) return null;
    return w / c / avgHr;
  };

  const efFirst = half(0, mid);
  const efSecond = half(mid, n);
  if (efFirst == null || efSecond == null || efFirst <= 0) return null;

  return {
    decouplingPct: +(((efFirst - efSecond) / efFirst) * 100).toFixed(1),
    efFirst: +efFirst.toFixed(3),
    efSecond: +efSecond.toFixed(3),
  };
}

/** Durations tracked on the mean-maximal power curve, in seconds. */
export const MMP_DURATIONS = [5, 15, 30, 60, 300, 1200, 3600] as const;

/**
 * Mean-maximal power: the best rolling average the rider held for each
 * duration. This is the power-duration curve, and its short end (5s–1min)
 * describes sprint capacity while the long end (20min–60min) tracks threshold.
 *
 * Uses a prefix-sum so the whole curve costs one pass per duration rather than
 * a nested scan — a three-hour ride is ~11k samples and this runs for every
 * cached ride.
 */
export function meanMaximalPower(watts: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  const n = watts.length;
  if (n === 0) return out;

  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + (watts[i] ?? 0);

  for (const d of MMP_DURATIONS) {
    if (n < d) continue;
    let best = 0;
    for (let i = d; i <= n; i++) {
      const avg = (prefix[i]! - prefix[i - d]!) / d;
      if (avg > best) best = avg;
    }
    if (best > 0) out[String(d)] = Math.round(best);
  }
  return out;
}
