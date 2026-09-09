/**
 * Pure functions that compute derived analytics from raw activity data.
 *
 * Everything here is deterministic — same inputs always produce the same
 * outputs. No I/O, no Date.now(). The orchestrator passes `now` so the
 * pipeline is testable and reproducible.
 *
 * Convention: distances in metres internally, but exported analytics use
 * km because that's what the dashboard renders.
 */

import type {
  AcwrResult,
  AllTimeStats,
  CyclingAnalytics,
  CyclingProfile,
  DailyTrainingCell,
  FitnessPoint,
  FtpEntry,
  GearInfo,
  RideStreamMetrics,
  Intensity,
  IntensityDistribution,
  LongTermAnalytics,
  PrEffort,
  PrSeries,
  RacePrediction,
  RecentActivity,
  SessionRpeEntry,
  StravaActivity,
  StravaGearSummary,
  WeeklyAnalytics,
  WeeklyVolume,
  WeeklyZoneMix,
  WhoopCycle,
  WhoopWorkout,
  YearCumulativePoint,
  YearProgressBlock,
} from './types.js';
import {
  cogganTier,
  efficiencyFactor,
  ftpRetestDue,
  hasRealPower,
  hrLooksImplausible,
  intensityFactor,
  isCommute,
  isIndoorRide,
  isRide,
  normalizedPower,
  powerZones,
  rideTss,
  rpeFromIntensityFactor,
  sessionStress,
  sweetSpotWatts,
  variabilityIndex,
  wattsPerKg,
  zoneForWatts,
} from './cycling.js';
import { dateKey as dayKey, DAY_MS, utcDateTime } from '../../utils/date.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Monday 00:00 UTC of the week containing d. */
function startOfWeekUTC(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = out.getUTCDay() || 7; // Sun = 0 → 7
  out.setUTCDate(out.getUTCDate() - day + 1);
  return out;
}

function daysAgo(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() - days);
  return out;
}

function metersToKm(m: number): number {
  return m / 1000;
}

/**
 * Classify activity intensity, in descending order of evidence quality.
 *
 *  1. Power against FTP zones — ground truth, rides with a real meter only
 *  2. Heart rate against LTHR — physiologically anchored, sport-agnostic
 *  3. Heart rate against estimated max — when no LTHR is on record
 *  4. Run pace — still a fair proxy for running specifically
 *  5. Sport-type defaults
 *
 * ── Why speed is gone ──────────────────────────────────────────────────────
 * Rides used to be bucketed on raw average speed: ≥25 km/h hard, ≥20 moderate.
 * Speed is a function of draft, gradient, wind and surface, not effort. Sitting
 * in a group paceline at 27 km/h was scored "hard" while grinding up a climb at
 * 15 km/h scored "easy" — exactly inverted. On a trainer, where speed is
 * synthetic, it was meaningless in both directions. Every downstream consumer
 * inherited that error: the intensity donut, the pseudo-RPE in load ACWR, the
 * fitness curve, and every AI prompt built on top of them.
 */
export function classifyIntensity(a: StravaActivity, profile?: CyclingProfile | null): Intensity {
  const sport = a.sport_type ?? '';

  // Type-only cases where physiological signals mislead. Heated yoga drives
  // heart rate through thermal load rather than training stress, and heart rate
  // during resistance work reflects neither the metabolic nor the neuromuscular
  // cost of the session — a heavy set of five barely moves an average.
  if (sport === 'Yoga' || sport === 'Walk') return 'easy';
  if (sport === 'WeightTraining' || sport === 'Workout') return 'moderate';

  // 1. Power zones — the only direct measure of external work.
  if (profile && hasRealPower(a)) {
    const np = normalizedPower(a);
    const zone = np == null ? null : zoneForWatts(np, profile.ftpWatts);
    if (zone != null) {
      if (zone <= 2) return 'easy';
      if (zone === 3) return 'moderate';
      return 'hard';
    }
  }

  // 2/3. Heart rate. Measured against heart-rate RESERVE, not raw bpm, so this
  //      agrees with hrTss — which uses (HR − rest) / (LTHR − rest). Comparing
  //      raw average HR to LTHR can understate effort by ignoring resting HR.
  //
  //      The thresholds are calibrated for a session AVERAGE rather than an
  //      instantaneous reading: interval sessions average down across their
  //      recoveries, so a whole ride averaging 85% of reserve is a hard day.
  const hr = a.average_heartrate;
  if (a.has_heartrate && hr && !hrLooksImplausible(a, profile?.restingHr ?? 50, profile?.maxHr ?? 190)) {
    const rest = profile?.restingHr ?? null;
    if (profile?.lthr && rest != null && profile.lthr > rest) {
      const ifHr = (hr - rest) / (profile.lthr - rest);
      if (ifHr >= 0.85) return 'hard';
      if (ifHr >= 0.7) return 'moderate';
      return 'easy';
    }
    const frac = hr / (profile?.maxHr ?? 190);
    if (frac >= 0.85) return 'hard';
    if (frac >= 0.75) return 'moderate';
    return 'easy';
  }

  // 4. Run-family by pace (seconds per km).
  if (/Run/.test(sport) && a.distance > 0 && a.moving_time > 0) {
    const pace = a.moving_time / metersToKm(a.distance);
    if (pace >= 420) return 'easy'; // ≥ 7:00 /km
    if (pace >= 390) return 'moderate'; // 6:30–7:00 /km
    return 'hard';
  }

  // 5. Defaults. A ride with neither power nor heart rate tells us nothing, so
  //    utility trips are called easy and anything longer is assumed moderate
  //    rather than being flattered into a hard session by its average speed.
  if (isRide(sport)) return isCommute(a) ? 'easy' : 'moderate';
  if (sport === 'Hike' || sport === 'Swim') return 'moderate';

  return 'moderate';
}

function paceFor(a: StravaActivity): number | null {
  if (!a.distance || !a.moving_time) return null;
  return a.moving_time / metersToKm(a.distance); // s per km
}

// ─── Aggregations ───────────────────────────────────────────────────────────

/** Returns the last `weeks` ISO-week buckets (oldest first), padded with zeros. */
export function computeWeeklyVolume(
  activities: StravaActivity[],
  now: Date,
  weeks = 8,
): WeeklyVolume[] {
  const thisWeekStart = startOfWeekUTC(now);
  const buckets = new Map<string, WeeklyVolume>();

  // Pre-seed all `weeks` buckets so empty weeks still appear
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(thisWeekStart);
    ws.setUTCDate(ws.getUTCDate() - i * 7);
    const key = ws.toISOString().slice(0, 10);
    buckets.set(key, { weekStart: key, km: 0, bySport: {} });
  }

  for (const a of activities) {
    const start = new Date(a.start_date);
    const ws = startOfWeekUTC(start);
    const key = ws.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue; // outside the window
    const km = metersToKm(a.distance ?? 0);
    bucket.km += km;
    bucket.bySport[a.sport_type] = (bucket.bySport[a.sport_type] ?? 0) + km;
  }

  return Array.from(buckets.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export function computeAcwr(activities: StravaActivity[], now: Date): AcwrResult {
  const cutoff7 = daysAgo(now, 7);
  const cutoff28 = daysAgo(now, 28);

  let acuteM = 0;
  let chronicM = 0;
  const acuteBySport = new Map<string, number>();
  for (const a of activities) {
    const t = new Date(a.start_date);
    const m = a.distance ?? 0;
    if (t >= cutoff28) chronicM += m;
    if (t >= cutoff7) {
      acuteM += m;
      acuteBySport.set(a.sport_type, (acuteBySport.get(a.sport_type) ?? 0) + m);
    }
  }
  const acuteKm = metersToKm(acuteM);
  const chronicKm = metersToKm(chronicM) / 4; // 28d → comparable weekly avg
  const ratio = chronicKm > 0 ? acuteKm / chronicKm : NaN;

  return {
    acuteKm,
    chronicKm,
    ratio,
    zone: acwrZone(ratio),
    unit: 'km',
    bySportShare: shareOf(acuteBySport, acuteM),
  };
}

/** Shared banding so every ACWR variant is read against the same thresholds. */
function acwrZone(ratio: number): AcwrResult['zone'] {
  if (!isFinite(ratio)) return 'undefined';
  if (ratio < 0.8) return 'detraining';
  if (ratio <= 1.3) return 'sweet-spot';
  if (ratio <= 1.5) return 'caution';
  return 'injury-risk';
}

/** Normalise a per-sport tally into 0–1 shares, dropping zero contributors. */
function shareOf(bySport: Map<string, number>, total: number): Record<string, number> {
  if (total <= 0) return {};
  const out: Record<string, number> = {};
  for (const [sport, v] of bySport) {
    if (v <= 0) continue;
    out[sport] = +(v / total).toFixed(3);
  }
  return out;
}

export function computeIntensityDistribution(
  activities: StravaActivity[],
  now: Date,
  windowDays = 28,
  whoopWorkouts: WhoopWorkout[] = [],
  profile?: CyclingProfile | null,
): IntensityDistribution {
  const cutoff = daysAgo(now, windowDays);
  const result: IntensityDistribution = {
    easySeconds: 0,
    moderateSeconds: 0,
    hardSeconds: 0,
  };

  // Strava-side, also collect matched-whoop ids
  const matchedWhoop = new Set<string>();
  const WINDOW_MS = 10 * 60 * 1000;
  for (const a of activities) {
    if (new Date(a.start_date) < cutoff) continue;
    const cls = classifyIntensity(a, profile);
    const sec = a.moving_time ?? 0;
    if (cls === 'easy') result.easySeconds += sec;
    else if (cls === 'moderate') result.moderateSeconds += sec;
    else result.hardSeconds += sec;

    // Mark matching Whoop workout as already counted
    const at = new Date(a.start_date).getTime();
    for (const w of whoopWorkouts) {
      if (matchedWhoop.has(w.id)) continue;
      if (Math.abs(new Date(w.start).getTime() - at) < WINDOW_MS) {
        matchedWhoop.add(w.id);
        break;
      }
    }
  }

  // Whoop-only sessions (functional fitness, walking logged in Whoop, etc.)
  for (const w of whoopWorkouts) {
    if (matchedWhoop.has(w.id)) continue;
    if (w.score_state !== 'SCORED' || !w.score) continue;
    if (new Date(w.start) < cutoff) continue;
    const sec = (new Date(w.end).getTime() - new Date(w.start).getTime()) / 1000;
    const cls = classifyByStrain(w.score.strain);
    if (cls === 'easy') result.easySeconds += sec;
    else if (cls === 'moderate') result.moderateSeconds += sec;
    else result.hardSeconds += sec;
  }

  return result;
}

export function pickRecentActivities(
  activities: StravaActivity[],
  now: Date,
  windowDays = 7,
  profile?: CyclingProfile | null,
): RecentActivity[] {
  const cutoff = daysAgo(now, windowDays);
  return activities
    .filter((a) => new Date(a.start_date) >= cutoff)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
    .map((a) => {
      const suspectHr = hrLooksImplausible(a, profile?.restingHr ?? 50, profile?.maxHr ?? 190);
      const stress = profile ? sessionStress(a, profile) : null;
      const np = profile ? normalizedPower(a) : null;
      const tss = profile ? rideTss(a, profile.ftpWatts) : null;

      return {
        id: a.id,
        name: a.name,
        sportType: a.sport_type,
        startDateLocal: a.start_date_local,
        // Strava serialises `start_date_local` with a `Z` suffix even though it is
        // local wall-clock time. Carrying the true UTC instant separately is what
        // makes cross-source matching against Whoop possible at all.
        startDateUtc: a.start_date,
        distanceMeters: a.distance ?? 0,
        movingTimeSeconds: a.moving_time ?? 0,
        averagePaceSecPerKm: paceFor(a),
        averageHeartrate: a.average_heartrate ?? null,
        intensity: classifyIntensity(a, profile),
        source: 'strava' as const,
        elevationGainMeters: a.total_elevation_gain ?? 0,
        ...(isIndoorRide(a) ? { indoor: true } : {}),
        ...(isCommute(a) ? { commute: true } : {}),
        ...(suspectHr ? { heartrateSuspect: true } : {}),
        ...(stress != null
          ? {
              stressScore: stress,
              stressSource: (tss != null ? 'power' : 'heart-rate') as 'power' | 'heart-rate',
            }
          : {}),
        ...(np != null && tss != null && profile
          ? {
              power: {
                np,
                averageWatts: a.average_watts ?? np,
                maxWatts: a.max_watts ?? null,
                intensityFactor: intensityFactor(a, profile.ftpWatts) ?? 0,
                tss,
                variabilityIndex: variabilityIndex(a),
                kilojoules: a.kilojoules ?? null,
                efficiencyFactor: efficiencyFactor(a),
              },
            }
          : {}),
        // Compare each in-window activity against the FULL history (last 90d).
        // The full activities array is in scope here.
        priorComparison: buildPriorComparison(
          {
            sport_type: a.sport_type,
            start_date: a.start_date,
            distance: a.distance ?? 0,
            moving_time: a.moving_time ?? 0,
            average_heartrate: a.average_heartrate,
          },
          activities,
        ),
      };
    });
}

/** Classify Whoop-only workouts by strain — proxy when no Strava sport/pace data exists. */
function classifyByStrain(strain: number): Intensity {
  if (strain >= 14) return 'hard';
  if (strain >= 10) return 'moderate';
  return 'easy';
}

/**
 * Find the most recent similar prior session and produce a plain-English
 * one-liner comparing today's effort. Similar = same sportType, distance
 * within ±10%, completed before this one. Looks back 90 days.
 *
 * Returns undefined if no good match — the UI hides the line in that case.
 */
function buildPriorComparison(
  current: { sport_type: string; start_date: string; distance: number; moving_time: number; average_heartrate?: number | null },
  history: StravaActivity[],
): string | undefined {
  const currentTime = new Date(current.start_date).getTime();
  const ninetyDaysAgo = currentTime - 90 * DAY_MS;
  const minDist = current.distance * 0.9;
  const maxDist = current.distance * 1.1;
  if (current.distance < 500) return undefined; // skip very short sessions

  let best: StravaActivity | null = null;
  let bestTime = -Infinity;
  for (const h of history) {
    const t = new Date(h.start_date).getTime();
    if (t >= currentTime) continue; // must be strictly before
    if (t < ninetyDaysAgo) continue;
    if (h.sport_type !== current.sport_type) continue;
    if (!h.distance || h.distance < minDist || h.distance > maxDist) continue;
    if (t > bestTime) {
      bestTime = t;
      best = h;
    }
  }
  if (!best) return undefined;

  // Compute deltas. We compare pace (sec/km) and HR.
  const curPaceSec = current.moving_time / (current.distance / 1000);
  const prevPaceSec = best.moving_time / (best.distance / 1000);
  const paceDelta = curPaceSec - prevPaceSec; // negative = faster

  const curHr = current.average_heartrate ?? null;
  const prevHr = best.average_heartrate ?? null;

  const daysAgoCount = Math.floor((currentTime - bestTime) / DAY_MS);
  const ago =
    daysAgoCount < 1 ? 'earlier today' : daysAgoCount === 1 ? 'yesterday' : `${daysAgoCount} days ago`;

  // Build the headline phrase
  function fmtPace(seconds: number): string {
    const abs = Math.abs(seconds);
    const sign = seconds < 0 ? '−' : '+';
    if (abs < 60) return `${sign}${abs.toFixed(0)}s/km`;
    const m = Math.floor(abs / 60);
    const s = Math.round(abs - m * 60);
    return `${sign}${m}m ${s}s/km`;
  }

  // Cyclists read speed, not pace. Reporting a ride as "−59s/km" is the running
  // framing of a number nobody on a bike uses, and it inverts the sign
  // convention people expect: faster is a bigger km/h, not a smaller one.
  const usesSpeed = isRide(current.sport_type);

  const parts: string[] = [];
  if (usesSpeed) {
    const curKmh = current.distance / 1000 / (current.moving_time / 3600);
    const prevKmh = best.distance / 1000 / (best.moving_time / 3600);
    const kmhDelta = curKmh - prevKmh;
    if (Math.abs(kmhDelta) >= 0.3) {
      parts.push(`${kmhDelta < 0 ? '−' : '+'}${Math.abs(kmhDelta).toFixed(1)} km/h vs ${ago}`);
    } else {
      parts.push(`same speed as ${ago}`);
    }
  } else if (Math.abs(paceDelta) >= 3) {
    parts.push(`${fmtPace(paceDelta)} vs ${ago}`);
  } else {
    parts.push(`same pace as ${ago}`);
  }
  // HR delta
  if (curHr != null && prevHr != null) {
    const hrDelta = curHr - prevHr;
    if (Math.abs(hrDelta) >= 2) {
      const arrow = hrDelta < 0 ? '↓' : '↑';
      parts.push(`HR ${arrow}${Math.abs(hrDelta).toFixed(0)} bpm`);
    } else {
      parts.push('same HR');
    }
  }

  // Interpretive tail — only fire when signal is clean
  let tail: string | null = null;
  if (curHr != null && prevHr != null) {
    const hrDelta = curHr - prevHr;
    if (paceDelta <= -3 && hrDelta <= 1) {
      tail = 'aerobic adaptation 📈';
    } else if (paceDelta >= 3 && hrDelta >= 3) {
      tail = 'feeling heavier — recovery?';
    } else if (Math.abs(paceDelta) < 3 && hrDelta <= -3) {
      tail = 'same effort, lower HR — improving';
    } else if (paceDelta <= -3 && hrDelta >= 3) {
      tail = 'faster but harder — pushed';
    }
  }

  const head = parts.join(' · ');
  return tail ? `${head} — ${tail}` : head;
}

/** Convert a Whoop UUID into a stable numeric id for React keying. */
function uuidToNumericId(uuid: string): number {
  let h = 0;
  for (let i = 0; i < uuid.length; i++) {
    h = (h * 31 + uuid.charCodeAt(i)) | 0;
  }
  // Keep positive; we just need uniqueness within the merged list.
  return Math.abs(h);
}

// ─── Whoop matching + strain-based ACWR ─────────────────────────────────────

/**
 * Merge Strava recent activities with Whoop workouts:
 * - For each Strava activity, attach matched Whoop strain (mark `source: 'both'`).
 * - For each Whoop workout with no Strava counterpart, include it as a
 *   standalone entry (`source: 'whoop'`) — covers functional fitness, walking
 *   logged in Whoop, anything you don't ALSO have on a watch that pushes to
 *   Strava. Match window: ±10 min.
 *
 * MATCHING CONTRACT: both sides must be compared as true UTC instants.
 * `RecentActivity.startDateLocal` is Strava's `start_date_local`, which is local
 * wall-clock time serialised with a misleading `Z` suffix. Comparing it against
 * Whoop's genuinely-UTC `start` fails by exactly the timezone offset, so every
 * match misses and every session appears twice — once from each source. Use
 * `startDateUtc`, falling back to `startDateLocal` only for legacy rows.
 */
export function mergeStravaAndWhoop(
  stravaRecent: RecentActivity[],
  whoopWorkouts: WhoopWorkout[],
  now: Date,
  windowDays = 7,
): RecentActivity[] {
  const WINDOW_MS = 10 * 60 * 1000;
  const cutoff = daysAgo(now, windowDays);
  const recentWhoop = whoopWorkouts.filter(
    (w) => w.score_state === 'SCORED' && w.score && new Date(w.start) >= cutoff,
  );

  // Track which Whoop workouts get matched to a Strava activity
  const matched = new Set<string>();
  const enrichedStrava: RecentActivity[] = stravaRecent.map((a) => {
    const at = new Date(a.startDateUtc ?? a.startDateLocal).getTime();
    let best: WhoopWorkout | null = null;
    let bestDelta = Infinity;
    for (const w of recentWhoop) {
      if (matched.has(w.id)) continue;
      const delta = Math.abs(new Date(w.start).getTime() - at);
      if (delta < bestDelta && delta < WINDOW_MS) {
        bestDelta = delta;
        best = w;
      }
    }
    if (best?.score) {
      matched.add(best.id);
      const zd = best.score.zone_durations;
      return {
        ...a,
        whoopStrain: best.score.strain,
        source: 'both',
        whoopWorkoutId: best.id,
        zoneDurationsMs: {
          z0: zd.zone_zero_milli,
          z1: zd.zone_one_milli,
          z2: zd.zone_two_milli,
          z3: zd.zone_three_milli,
          z4: zd.zone_four_milli,
          z5: zd.zone_five_milli,
        },
      };
    }
    return a;
  });

  // Whoop-only entries (no matching Strava activity)
  const whoopOnly: RecentActivity[] = recentWhoop
    .filter((w) => !matched.has(w.id))
    .map((w) => {
      const dur = (new Date(w.end).getTime() - new Date(w.start).getTime()) / 1000;
      const dist = w.score?.distance_meter ?? 0;
      const zd = w.score?.zone_durations;
      return {
        id: uuidToNumericId(w.id),
        name: w.sport_name || 'Workout',
        sportType: w.sport_name || 'Workout',
        // Whoop `start` is UTC; render it in the athlete's local clock so it
        // lines up with Strava rows in the UI.
        startDateLocal: toLocalIso(w.start, w.timezone_offset),
        startDateUtc: w.start,
        distanceMeters: dist,
        movingTimeSeconds: dur,
        averagePaceSecPerKm: dist > 0 ? dur / (dist / 1000) : null,
        averageHeartrate: w.score?.average_heart_rate ?? null,
        intensity: classifyByStrain(w.score?.strain ?? 0),
        whoopStrain: w.score?.strain,
        source: 'whoop',
        whoopWorkoutId: w.id,
        zoneDurationsMs: zd
          ? {
              z0: zd.zone_zero_milli,
              z1: zd.zone_one_milli,
              z2: zd.zone_two_milli,
              z3: zd.zone_three_milli,
              z4: zd.zone_four_milli,
              z5: zd.zone_five_milli,
            }
          : undefined,
      };
    });

  // Merge and sort by true start time descending
  return [...enrichedStrava, ...whoopOnly].sort((a, b) =>
    (b.startDateUtc ?? b.startDateLocal).localeCompare(a.startDateUtc ?? a.startDateLocal),
  );
}

/**
 * Render a UTC instant in the athlete's local clock, matching Strava's
 * `start_date_local` convention (local wall-clock time with a trailing `Z`) so
 * both sources sort and display identically.
 */
function toLocalIso(utcIso: string, offset: string | undefined): string {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset ?? '');
  if (!m) return utcIso;
  const sign = m[1] === '-' ? -1 : 1;
  const minutes = sign * (parseInt(m[2]!, 10) * 60 + parseInt(m[3]!, 10));
  return new Date(new Date(utcIso).getTime() + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * ACWR using Whoop daily strain instead of km. Acute = sum of last 7 days,
 * Chronic = sum of last 28 days / 4. Same zone bands as distance-based ACWR.
 */
export function computeStrainAcwr(cycles: WhoopCycle[], now: Date): AcwrResult {
  const cutoff7 = daysAgo(now, 7);
  const cutoff28 = daysAgo(now, 28);

  let acute = 0;
  let chronic = 0;
  for (const c of cycles) {
    if (c.score_state !== 'SCORED' || !c.score) continue;
    const t = new Date(c.start);
    const s = c.score.strain;
    if (t >= cutoff28) chronic += s;
    if (t >= cutoff7) acute += s;
  }

  const chronicWeekly = chronic / 4;
  const ratio = chronicWeekly > 0 ? acute / chronicWeekly : NaN;

  // Reuse the same shape — but "km" here actually means "strain units"
  return { acuteKm: acute, chronicKm: chronicWeekly, ratio, zone: acwrZone(ratio), unit: 'strain' };
}

/**
 * The authoritative cross-sport ACWR.
 *
 * Distance-based ACWR is structurally blind to zero-distance work: lifting,
 * yoga, HIIT and soccer all contribute exactly nothing, which for a hybrid
 * strength + triathlon program means three of seven training days are invisible.
 * It also treats a swim kilometre, a bike kilometre and a run kilometre as
 * equivalent, so the ratio moves whenever the sport mix moves even if the actual
 * load is flat.
 *
 * This variant expresses every session in one unit that every session can
 * produce — RPE × minutes:
 *   1. The athlete's own session RPE, where they logged one. Best-validated
 *      internal-load measure available without lab equipment.
 *   2. Whoop strain rescaled into the same band, where a Whoop workout exists.
 *   3. A pseudo-RPE from the intensity classification, so a Strava-only session
 *      during a Whoop outage still contributes rather than vanishing.
 *
 * Accounting is keyed on session IDENTITY, never on timestamps. Whoop and Strava
 * disagree on a session's start by up to the ±10-minute match window, and Whoop
 * reports milliseconds where Strava does not — so re-deriving the pairing from
 * start times here would miss every match and count each session twice, which is
 * the exact failure this pipeline already had once in `mergeStravaAndWhoop`.
 */
export function computeLoadAcwr(
  merged: RecentActivity[],
  stravaActivities: StravaActivity[],
  whoopWorkouts: WhoopWorkout[],
  now: Date,
  profile?: CyclingProfile | null,
): AcwrResult {
  const cutoff7 = daysAgo(now, 7);
  const cutoff28 = daysAgo(now, 28);
  const WINDOW_MS = 10 * 60 * 1000;

  /** One entry per real session, keyed so it can be overridden, never doubled. */
  const sessions = new Map<string, { at: Date; load: number; sport: string }>();

  // 1. Whoop workouts across the full chronic window.
  const scoredWhoop = whoopWorkouts.filter(
    (w) => w.score_state === 'SCORED' && w.score && new Date(w.start) >= cutoff28,
  );
  for (const w of scoredWhoop) {
    const at = new Date(w.start);
    const minutes = (new Date(w.end).getTime() - at.getTime()) / 60_000;
    if (minutes <= 0) continue;
    // Whoop strain is 0–21 on a logarithmic cardiovascular scale; halving lands
    // it in the same 1–10 band as Borg CR10 so the two load sources are
    // interchangeable rather than one dominating the sum.
    sessions.set(`w:${w.id}`, {
      at,
      load: (w.score!.strain / 2) * minutes,
      sport: w.sport_name || 'other',
    });
  }

  // 2. Strava activities with no Whoop counterpart. Matching here IS by
  //    timestamp, but against `start_date` — true UTC on both sides, the same
  //    comparison `computeAgreement` uses successfully.
  const claimed = new Set<string>();
  for (const a of stravaActivities) {
    const at = new Date(a.start_date);
    if (at < cutoff28) continue;
    const minutes = (a.moving_time ?? 0) / 60;
    if (minutes <= 0) continue;

    let twin: WhoopWorkout | null = null;
    for (const w of scoredWhoop) {
      if (claimed.has(w.id)) continue;
      if (Math.abs(new Date(w.start).getTime() - at.getTime()) < WINDOW_MS) {
        twin = w;
        break;
      }
    }
    if (twin) {
      // Already accounted for under its Whoop key — Whoop's strain is the better
      // internal-load reading than anything derivable from Strava alone.
      claimed.add(twin.id);
      continue;
    }

    // Intensity Factor gives a graded RPE on power-bearing rides; everything
    // else falls back to the three-bucket classification.
    const iF = profile ? intensityFactor(a, profile.ftpWatts) : null;
    const cls = classifyIntensity(a, profile);
    const pseudoRpe =
      iF != null ? rpeFromIntensityFactor(iF) : cls === 'hard' ? 8 : cls === 'moderate' ? 5 : 3;
    sessions.set(`s:${a.id}`, { at, load: pseudoRpe * minutes, sport: a.sport_type });
  }

  // 3. Athlete-logged RPE overrides whichever estimate stood in for it.
  for (const a of merged) {
    if (a.sRpeLoad == null) continue;
    const key = a.whoopWorkoutId ? `w:${a.whoopWorkoutId}` : `s:${a.id}`;
    const at = new Date(a.startDateUtc ?? a.startDateLocal);
    if (at < cutoff28) continue;
    const existing = sessions.get(key);
    sessions.set(key, {
      at: existing?.at ?? at,
      load: a.sRpeLoad,
      sport: existing?.sport ?? a.sportType,
    });
  }

  let acute = 0;
  let chronic = 0;
  const acuteBySport = new Map<string, number>();
  for (const { at, load, sport } of sessions.values()) {
    if (!isFinite(load) || load <= 0) continue;
    chronic += load;
    if (at >= cutoff7) {
      acute += load;
      acuteBySport.set(sport, (acuteBySport.get(sport) ?? 0) + load);
    }
  }

  const chronicWeekly = chronic / 4;
  const ratio = chronicWeekly > 0 ? acute / chronicWeekly : NaN;

  return {
    acuteKm: +acute.toFixed(1),
    chronicKm: +chronicWeekly.toFixed(1),
    ratio,
    zone: acwrZone(ratio),
    unit: 'sRPE',
    bySportShare: shareOf(acuteBySport, acute),
  };
}

/**
 * Roll up Whoop HR-zone time across the last-7-day activities. Returns null
 * if no activity in the window had `zoneDurationsMs` (e.g. Strava-only
 * activities with no matched Whoop workout). The data is free — we already
 * pull and persist zone_durations per workout.
 *
 * Polarized-training target (Seiler et al.): ~80% Z1+Z2 (easy aerobic),
 * ~10% Z3, ~10% Z4+Z5. The `polarizationScore` measures the L1 distance
 * between actual and target, normalized to 0-1 (1 = perfectly polarized).
 */
function computeWeeklyZoneMix(activities: RecentActivity[]): WeeklyZoneMix | null {
  let z0Ms = 0,
    z1Ms = 0,
    z2Ms = 0,
    z3Ms = 0,
    z4Ms = 0,
    z5Ms = 0;
  let hasAny = false;
  for (const a of activities) {
    if (!a.zoneDurationsMs) continue;
    hasAny = true;
    z0Ms += a.zoneDurationsMs.z0;
    z1Ms += a.zoneDurationsMs.z1;
    z2Ms += a.zoneDurationsMs.z2;
    z3Ms += a.zoneDurationsMs.z3;
    z4Ms += a.zoneDurationsMs.z4;
    z5Ms += a.zoneDurationsMs.z5;
  }
  if (!hasAny) return null;

  // z0 is "below zone 1" — recovery/rest minutes. Exclude from the polarized
  // calculation since it's not training time; include in the raw seconds.
  const trainingMs = z1Ms + z2Ms + z3Ms + z4Ms + z5Ms;
  const totalMs = z0Ms + trainingMs;
  if (trainingMs === 0) return null;

  const easy = (z1Ms + z2Ms) / trainingMs;
  const moderate = z3Ms / trainingMs;
  const hard = (z4Ms + z5Ms) / trainingMs;

  // L1 distance from polarized target (0.80, 0.10, 0.10), scaled to 0-1.
  // Max L1 distance is 2.0 (all-in on one zone), so divide by 2 and invert.
  const l1 = Math.abs(easy - 0.8) + Math.abs(moderate - 0.1) + Math.abs(hard - 0.1);
  const polarizationScore = Math.max(0, 1 - l1 / 2);

  return {
    z0Seconds: Math.round(z0Ms / 1000),
    z1Seconds: Math.round(z1Ms / 1000),
    z2Seconds: Math.round(z2Ms / 1000),
    z3Seconds: Math.round(z3Ms / 1000),
    z4Seconds: Math.round(z4Ms / 1000),
    z5Seconds: Math.round(z5Ms / 1000),
    totalSeconds: Math.round(totalMs / 1000),
    easyPct: easy,
    moderatePct: moderate,
    hardPct: hard,
    polarizationScore,
  };
}

/**
 * Attach athlete-reported session RPE to merged activities and derive sRPE
 * internal load (RPE × minutes).
 *
 * Matching is by explicit `activityId` first, then by same-day + same-sport,
 * then by same-day when the day has exactly one session. Ambiguous days are
 * left unmatched rather than guessed — a wrong RPE is worse than none.
 */
export function attachSessionRpe(
  activities: RecentActivity[],
  entries: SessionRpeEntry[],
): RecentActivity[] {
  if (!entries.length) return activities;

  const byId = new Map<number, SessionRpeEntry>();
  for (const e of entries) if (e.activityId != null) byId.set(e.activityId, e);

  const dayCount = new Map<string, number>();
  for (const a of activities) {
    const d = a.startDateLocal.slice(0, 10);
    dayCount.set(d, (dayCount.get(d) ?? 0) + 1);
  }
  const used = new Set<SessionRpeEntry>();

  return activities.map((a) => {
    const day = a.startDateLocal.slice(0, 10);
    let hit = byId.get(a.id);
    if (!hit) {
      hit = entries.find(
        (e) =>
          !used.has(e) &&
          e.activityId == null &&
          e.date === day &&
          e.sport != null &&
          e.sport.toLowerCase() === a.sportType.toLowerCase(),
      );
    }
    if (!hit && dayCount.get(day) === 1) {
      hit = entries.find((e) => !used.has(e) && e.activityId == null && e.date === day && !e.sport);
    }
    if (!hit) return a;
    used.add(hit);
    const minutes = a.movingTimeSeconds / 60;
    return {
      ...a,
      sessionRpe: hit.rpe,
      sRpeLoad: +(hit.rpe * minutes).toFixed(1),
      ...(hit.note ? { sessionNote: hit.note } : {}),
    };
  });
}

export function computeWeeklyAnalytics(
  activities: StravaActivity[],
  now: Date,
  opts: {
    whoopCycles?: WhoopCycle[];
    whoopWorkouts?: WhoopWorkout[];
    sessionRpe?: SessionRpeEntry[];
    cyclingProfile?: CyclingProfile | null;
  } = {},
): WeeklyAnalytics {
  const profile = opts.cyclingProfile ?? null;
  // 14 days rather than 7: the weekly review runs on Sunday and needs the whole
  // Mon→Sun calendar week regardless of what time it fires, and the extra week
  // gives week-over-week comparisons something to compare against. The UI still
  // renders only the trailing 7 days.
  const stravaRecent = pickRecentActivities(activities, now, 14, profile);
  const merged = opts.whoopWorkouts
    ? mergeStravaAndWhoop(stravaRecent, opts.whoopWorkouts, now, 14)
    : stravaRecent;
  const mergedRecent = attachSessionRpe(merged, opts.sessionRpe ?? []);

  const loadAcwr = computeLoadAcwr(
    mergedRecent,
    activities,
    opts.whoopWorkouts ?? [],
    now,
    profile,
  );
  const strainAcwr = opts.whoopCycles ? computeStrainAcwr(opts.whoopCycles, now) : null;

  // A metric with no inputs must never be promoted over one that has them. An
  // empty Whoop feed — the failure MAINTENANCE.md calls the most common in this
  // system — used to yield a fully-formed loadAcwr of zeros with a NaN ratio,
  // which then silently disabled the injury-risk cap because `NaN > 1.5` is
  // false, while the distance ratio that did have data was demoted and hidden.
  const covers = (a: AcwrResult | null): a is AcwrResult =>
    a != null && isFinite(a.ratio) && a.chronicKm > 0;

  return {
    weeklyVolume: computeWeeklyVolume(activities, now, 8),
    acwr: computeAcwr(activities, now),
    strainAcwr,
    loadAcwr,
    primaryLoadMetric: covers(loadAcwr) ? 'loadAcwr' : covers(strainAcwr) ? 'strainAcwr' : 'acwr',
    intensity: computeIntensityDistribution(activities, now, 28, opts.whoopWorkouts ?? [], profile),
    recentActivities: mergedRecent,
    // Zone mix stays a 7-day view — it answers "how polarized was this week".
    zoneMix: computeWeeklyZoneMix(
      mergedRecent.filter((a) => new Date(a.startDateUtc ?? a.startDateLocal) >= daysAgo(now, 7)),
    ),
  };
}

// ─── Long-term analytics ────────────────────────────────────────────────────

/**
 * The cycling block: FTP context, this week's riding, and the two progress
 * markers that move before FTP does (CTL ramp and Efficiency Factor).
 */
export function computeCyclingAnalytics(
  activities: StravaActivity[],
  now: Date,
  profile: CyclingProfile,
  ftpHistory: FtpEntry[],
  fitnessCurve: FitnessPoint[],
  streamMetrics: RideStreamMetrics[] = [],
): CyclingAnalytics {
  const cutoff7 = daysAgo(now, 7);
  const rides = activities.filter((a) => isRide(a.sport_type));
  const weekRides = rides.filter((a) => new Date(a.start_date) >= cutoff7);

  let seconds = 0;
  let indoorSeconds = 0;
  let poweredSeconds = 0;
  let tss = 0;
  let trainingRides = 0;
  let commutes = 0;

  for (const a of weekRides) {
    const sec = a.moving_time ?? 0;
    seconds += sec;
    if (isIndoorRide(a)) indoorSeconds += sec;
    if (hasRealPower(a)) poweredSeconds += sec;
    if (isCommute(a)) commutes += 1;
    else trainingRides += 1;
    // dailyLoad rather than sessionStress: when heart rate is rejected as an
    // artefact this still falls through to suffer_score, so a real ride is
    // never silently worth zero.
    tss += dailyLoad(a, profile);
  }

  // CTL ramp across the last week of the curve. Guards against a short curve.
  let ctlRampPerWeek: number | null = null;
  if (fitnessCurve.length >= 8) {
    const last = fitnessCurve[fitnessCurve.length - 1]!;
    const weekAgo = fitnessCurve[fitnessCurve.length - 8]!;
    ctlRampPerWeek = +(last.ctl - weekAgo.ctl).toFixed(1);
  }

  // Efficiency Factor over the last 90 days of steady power rides.
  const efCutoff = daysAgo(now, 90);
  const efTrend: { date: string; ef: number }[] = [];
  for (const a of rides) {
    if (new Date(a.start_date) < efCutoff) continue;
    const ef = efficiencyFactor(a);
    if (ef == null) continue;
    efTrend.push({ date: a.start_date_local.slice(0, 10), ef });
  }
  efTrend.sort((a, b) => a.date.localeCompare(b.date));

  const lastTsb = fitnessCurve.length ? fitnessCurve[fitnessCurve.length - 1]!.tsb : null;
  const wkg = wattsPerKg(profile.ftpWatts, profile.weightKg);

  // Decoupling and the power curve come from per-second streams, which only
  // exist for rides that have been fetched and derived. Both stay empty rather
  // than being approximated from summary data — a made-up decoupling number
  // would gate a training phase on noise.
  const streamCutoff = daysAgo(now, 90);
  const inWindow = streamMetrics.filter((m) => new Date(m.date) >= streamCutoff);

  const decouplingTrend = inWindow
    .filter((m) => m.decouplingPct != null)
    .map((m) => ({
      date: m.date.slice(0, 10),
      decouplingPct: m.decouplingPct!,
      minutes: Math.round(m.movingTimeSeconds / 60),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const powerCurve: Record<string, number> = {};
  const powerBlocks: NonNullable<CyclingAnalytics['powerBlocks']> = {
    asOf: now.toISOString().slice(0, 10),
    recent: {},
    preceding: {},
  };
  // Cache dates are activity-local, not UTC instants. Use their calendar day
  // against the supplied snapshot day so host timezone cannot move a boundary.
  const firstPowerDay = daysAgo(now, 89).toISOString().slice(0, 10);
  const firstRecentDay = daysAgo(now, 29).toISOString().slice(0, 10);
  for (const m of streamMetrics) {
    const day = m.date.slice(0, 10);
    const timestamp = Date.parse(`${day}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== day
      || day < firstPowerDay || day > powerBlocks.asOf) continue;
    const block = day >= firstRecentDay ? powerBlocks.recent : powerBlocks.preceding;
    for (const [dur, w] of Object.entries(m.meanMaximalPower)) {
      const seconds = Number(dur);
      if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(w) || w < 0) continue;
      const key = String(seconds);
      if (powerCurve[key] == null || w > powerCurve[key]!) powerCurve[key] = w;
      const previous = block[key];
      // Equal watts keep the earlier activity, then lower ID, independent of
      // cache order. The source is one attaining effort, not every tied ride.
      if (!previous || w > previous.watts
        || (w === previous.watts && (m.date < previous.date
          || (m.date === previous.date && m.activityId < previous.activityId)))) {
        block[key] = { watts: w, activityId: m.activityId, date: m.date };
      }
    }
  }

  // The gate reads the longest qualifying ride rather than the most recent:
  // decoupling only means something over duration, and a 45-minute spin
  // clearing 5% says nothing about durability on a three-hour ride.
  const gateCandidates = inWindow.filter((m) => m.decouplingPct != null && m.movingTimeSeconds >= 3600);
  let baseGate: CyclingAnalytics['baseGate'] = null;
  if (gateCandidates.length) {
    const longest = gateCandidates.reduce((a, b) =>
      b.movingTimeSeconds > a.movingTimeSeconds ? b : a,
    );
    const pct = longest.decouplingPct!;
    const mins = Math.round(longest.movingTimeSeconds / 60);
    baseGate = {
      passing: pct < 5,
      reason:
        pct < 5
          ? `Decoupling ${pct}% over ${mins} min — under the 5% gate, aerobic base is holding.`
          : `Decoupling ${pct}% over ${mins} min — above the 5% gate. Hold volume and stay in Z2 before adding intensity.`,
    };
  }

  return {
    profile,
    decouplingTrend,
    powerCurve,
    powerBlocks,
    baseGate,
    zones: powerZones(profile.ftpWatts),
    sweetSpot: sweetSpotWatts(profile.ftpWatts),
    wattsPerKg: wkg,
    tier: wkg == null ? 'Unknown' : cogganTier(wkg),
    ftpHistory,
    retest: ftpRetestDue(profile.ftpTestedOn, now, lastTsb),
    week: {
      tss: +tss.toFixed(0),
      rides: trainingRides,
      commutes,
      hours: +(seconds / 3600).toFixed(1),
      indoorHours: +(indoorSeconds / 3600).toFixed(1),
      outdoorHours: +((seconds - indoorSeconds) / 3600).toFixed(1),
      powerCoveragePct: seconds > 0 ? Math.round((poweredSeconds / seconds) * 100) : 0,
    },
    ctlRampPerWeek,
    efTrend,
  };
}

/**
 * Daily training load for a single activity, in TSS-equivalent units.
 *
 * Power TSS first, then heart-rate TSS, then Strava's suffer_score, then a
 * duration × intensity approximation. The ordering matters: the first two are
 * calibrated so an hour at threshold scores 100, which makes the CTL/ATL curve
 * below comparable to every other power-based training system.
 */
export function dailyLoad(a: StravaActivity, profile?: CyclingProfile | null): number {
  if (profile) {
    const stress = sessionStress(a, profile);
    if (stress != null && stress > 0) return stress;
  }
  if (a.suffer_score != null && a.suffer_score > 0) return a.suffer_score;
  const minutes = (a.moving_time ?? 0) / 60;
  const cls = classifyIntensity(a, profile);
  const factor = cls === 'hard' ? 4 : cls === 'moderate' ? 2 : 1;
  return minutes * factor;
}

/**
 * CTL/ATL/TSB curve over the last `days` days.
 *
 * - CTL_today = CTL_yesterday + (load_today - CTL_yesterday) / 42
 * - ATL_today = ATL_yesterday + (load_today - ATL_yesterday) / 7
 * - TSB_today = CTL_today − ATL_today
 *
 * We compute over a window that begins 42 days before the visible range so the
 * EWMAs have time to warm up before the output starts. With sparse data
 * (few activities) the curve will hug zero — that's correct, not a bug.
 */
export function computeFitnessCurve(
  activities: StravaActivity[],
  now: Date,
  days = 90,
  profile?: CyclingProfile | null,
): FitnessPoint[] {
  const warmupDays = 42;
  const start = daysAgo(now, days + warmupDays);

  // Pre-aggregate load per UTC day
  const byDay = new Map<string, number>();
  for (const a of activities) {
    const t = new Date(a.start_date);
    if (t < start) continue;
    const key = t.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + dailyLoad(a, profile));
  }

  const out: FitnessPoint[] = [];
  let ctl = 0;
  let atl = 0;
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  const visibleCutoff = daysAgo(now, days);

  while (cursor <= now) {
    const key = cursor.toISOString().slice(0, 10);
    const load = byDay.get(key) ?? 0;
    ctl = ctl + (load - ctl) / 42;
    atl = atl + (load - atl) / 7;
    if (cursor >= visibleCutoff) {
      out.push({ date: key, load, ctl, atl, tsb: ctl - atl });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return out;
}

// ─── PR progression ─────────────────────────────────────────────────────────

/**
 * Standard distance buckets. We treat any RUN whose total distance falls
 * inside the tolerance window as an "effort" at that nominal distance. This
 * is an approximation — true PR splits would require Strava's best_efforts
 * field, which only comes from /activities/{id} detail and would burn a lot
 * of rate-limit budget. The proxy is good enough for almost-round-distance
 * training runs.
 */
const PR_BUCKETS: { label: string; meters: number; tolPct: number }[] = [
  { label: '1k', meters: 1_000, tolPct: 0.05 },
  { label: '5k', meters: 5_000, tolPct: 0.05 },
  { label: '10k', meters: 10_000, tolPct: 0.05 },
  { label: 'Half', meters: 21_097, tolPct: 0.03 },
  { label: 'Marathon', meters: 42_195, tolPct: 0.03 },
];

function isRun(sportType: string): boolean {
  return /Run/.test(sportType);
}

function bucketFor(distanceMeters: number): (typeof PR_BUCKETS)[number] | null {
  for (const b of PR_BUCKETS) {
    const lo = b.meters * (1 - b.tolPct);
    const hi = b.meters * (1 + b.tolPct);
    if (distanceMeters >= lo && distanceMeters <= hi) return b;
  }
  return null;
}

export function computePrSeries(activities: StravaActivity[]): PrSeries[] {
  // bucketLabel → list of efforts
  const byBucket = new Map<string, PrEffort[]>();
  for (const b of PR_BUCKETS) byBucket.set(b.label, []);

  for (const a of activities) {
    if (!isRun(a.sport_type) || !a.distance || !a.moving_time) continue;
    const b = bucketFor(a.distance);
    if (!b) continue;
    const paceSecPerKm = a.moving_time / (a.distance / 1000);
    byBucket.get(b.label)!.push({
      date: a.start_date,
      paceSecPerKm,
      activityId: a.id,
    });
  }

  return PR_BUCKETS.map((b) => {
    const efforts = (byBucket.get(b.label) ?? []).sort((x, y) =>
      x.date.localeCompare(y.date),
    );
    const best = efforts.reduce<PrEffort | null>(
      (best, e) => (best == null || e.paceSecPerKm < best.paceSecPerKm ? e : best),
      null,
    );
    return {
      bucket: b.label,
      distanceMeters: b.meters,
      efforts,
      best,
    };
  });
}

// ─── Year-over-year cumulative progress ─────────────────────────────────────

/** 0-indexed day-of-year (Jan 1 = 0). */
function dayOfYearUTC(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((cur - start) / DAY_MS);
}

/** Cumulative km series for a single calendar year up to `throughDoy`. */
function cumulativeForYear(
  activities: StravaActivity[],
  year: number,
  throughDoy: number,
): YearCumulativePoint[] {
  // Pre-aggregate per day
  const byDoy = new Map<number, number>();
  for (const a of activities) {
    const t = new Date(a.start_date);
    if (t.getUTCFullYear() !== year) continue;
    const doy = dayOfYearUTC(t);
    if (doy > throughDoy) continue;
    byDoy.set(doy, (byDoy.get(doy) ?? 0) + (a.distance ?? 0) / 1000);
  }
  const out: YearCumulativePoint[] = [];
  let running = 0;
  for (let doy = 0; doy <= throughDoy; doy++) {
    running += byDoy.get(doy) ?? 0;
    out.push({ doy, km: running });
  }
  return out;
}

export function computeYearProgress(
  activities: StravaActivity[],
  now: Date,
): YearProgressBlock {
  const thisYearN = now.getUTCFullYear();
  const lastYearN = thisYearN - 1;
  const throughDoy = dayOfYearUTC(now);
  const thisYear = cumulativeForYear(activities, thisYearN, throughDoy);
  const lastYear = cumulativeForYear(activities, lastYearN, throughDoy);
  return {
    thisYear,
    lastYear,
    ytdKm: thisYear.at(-1)?.km ?? 0,
    ytdKmLastYear: lastYear.at(-1)?.km ?? 0,
  };
}

// ─── All-time headline stats ────────────────────────────────────────────────

/** YYYY-MM-DD → epoch days (rough — good enough for adjacency comparisons). */
function dayKeyToEpoch(key: string): number {
  return Math.floor(utcDateTime(key) / DAY_MS);
}

export function computeAllTimeStats(
  activities: StravaActivity[],
  now: Date,
  whoopWorkouts: WhoopWorkout[] = [],
): AllTimeStats {
  if (activities.length === 0 && whoopWorkouts.length === 0) {
    return {
      activityCount: 0,
      totalKm: 0,
      longestActivityKm: 0,
      longestStreakDays: 0,
      currentStreakDays: 0,
      firstYear: null,
    };
  }

  let totalM = 0;
  let longestM = 0;
  let firstTs = Infinity;
  const trainingDays = new Set<string>();
  const matchedWhoop = new Set<string>();
  const WINDOW_MS = 10 * 60 * 1000;

  for (const a of activities) {
    const dist = a.distance ?? 0;
    totalM += dist;
    if (dist > longestM) longestM = dist;
    const t = new Date(a.start_date).getTime();
    if (t < firstTs) firstTs = t;
    trainingDays.add(dayKey(new Date(a.start_date)));

    for (const w of whoopWorkouts) {
      if (matchedWhoop.has(w.id)) continue;
      if (Math.abs(new Date(w.start).getTime() - t) < WINDOW_MS) {
        matchedWhoop.add(w.id);
        break;
      }
    }
  }

  // Count Whoop-only sessions toward activityCount + training days
  let whoopOnlyCount = 0;
  for (const w of whoopWorkouts) {
    if (matchedWhoop.has(w.id)) continue;
    if (w.score_state !== 'SCORED') continue;
    whoopOnlyCount += 1;
    const t = new Date(w.start);
    if (t.getTime() < firstTs) firstTs = t.getTime();
    trainingDays.add(dayKey(t));
    // Use Whoop's distance_meter if present (e.g. walks)
    const dist = w.score?.distance_meter ?? 0;
    totalM += dist;
    if (dist > longestM) longestM = dist;
  }

  // Compute longest consecutive-day streak
  const sortedDays = Array.from(trainingDays).sort();
  const epochDays = sortedDays.map(dayKeyToEpoch);
  let longestStreak = 0;
  let cur = 0;
  for (let i = 0; i < epochDays.length; i++) {
    if (i === 0 || epochDays[i]! - epochDays[i - 1]! === 1) {
      cur += 1;
    } else if (epochDays[i]! - epochDays[i - 1]! === 0) {
      // duplicate (multiple activities same day) — no change
    } else {
      cur = 1;
    }
    if (cur > longestStreak) longestStreak = cur;
  }

  // Current streak — count back from today or yesterday
  const todayEpoch = Math.floor(now.getTime() / 86400000);
  let currentStreak = 0;
  for (let probe = todayEpoch; probe >= todayEpoch - 365 * 50; probe -= 1) {
    const key = new Date(probe * 86400000).toISOString().slice(0, 10);
    if (trainingDays.has(key)) {
      currentStreak += 1;
    } else if (probe === todayEpoch) {
      // allow today off — start counting from yesterday
      continue;
    } else {
      break;
    }
  }

  return {
    activityCount: activities.length + whoopOnlyCount,
    totalKm: totalM / 1000,
    longestActivityKm: longestM / 1000,
    longestStreakDays: longestStreak,
    currentStreakDays: currentStreak,
    firstYear: isFinite(firstTs) ? new Date(firstTs).getUTCFullYear() : null,
  };
}

// ─── Daily training map (calendar heatmap) ──────────────────────────────────

/**
 * One cell per day for the last `days` days, oldest first. Empty days are
 * preserved with minutes=0 so the calendar grid renders contiguously.
 * Includes Whoop-only workouts so Whoop-app sessions (functional fitness,
 * walking) show up rather than appearing as rest days.
 */
export function computeDailyTrainingMap(
  activities: StravaActivity[],
  now: Date,
  days = 365,
  whoopWorkouts: WhoopWorkout[] = [],
): DailyTrainingCell[] {
  const start = daysAgo(now, days);

  // Pre-aggregate per UTC day
  const byDay = new Map<string, { minutes: number; bySport: Record<string, number> }>();
  const ensure = (key: string) => {
    let b = byDay.get(key);
    if (!b) {
      b = { minutes: 0, bySport: {} };
      byDay.set(key, b);
    }
    return b;
  };

  const matchedWhoop = new Set<string>();
  const WINDOW_MS = 10 * 60 * 1000;

  for (const a of activities) {
    const t = new Date(a.start_date);
    if (t < start) continue;
    const key = dayKey(t);
    const minutes = (a.moving_time ?? 0) / 60;
    const b = ensure(key);
    b.minutes += minutes;
    b.bySport[a.sport_type] = (b.bySport[a.sport_type] ?? 0) + minutes;

    const at = t.getTime();
    for (const w of whoopWorkouts) {
      if (matchedWhoop.has(w.id)) continue;
      if (Math.abs(new Date(w.start).getTime() - at) < WINDOW_MS) {
        matchedWhoop.add(w.id);
        break;
      }
    }
  }

  // Whoop-only entries
  for (const w of whoopWorkouts) {
    if (matchedWhoop.has(w.id)) continue;
    if (w.score_state !== 'SCORED' || !w.score) continue;
    const t = new Date(w.start);
    if (t < start) continue;
    const key = dayKey(t);
    const minutes = (new Date(w.end).getTime() - t.getTime()) / 60_000;
    const sport = w.sport_name || 'Whoop session';
    const b = ensure(key);
    b.minutes += minutes;
    b.bySport[sport] = (b.bySport[sport] ?? 0) + minutes;
  }

  // Walk every day from start → now so empty days appear
  const out: DailyTrainingCell[] = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor <= now) {
    const key = dayKey(cursor);
    const cell = byDay.get(key) ?? { minutes: 0, bySport: {} };
    out.push({ date: key, minutes: cell.minutes, bySport: cell.bySport });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

// ─── Gear mileage ───────────────────────────────────────────────────────────

const SHOE_WARN_KM = 600; // standard rule of thumb
const SHOE_REPLACE_KM = 800;

export function computeGearInfo(
  activities: StravaActivity[],
  bikes: StravaGearSummary[] = [],
  shoes: StravaGearSummary[] = [],
): GearInfo[] {
  // Aggregate km per gear_id from activities
  const kmByGear = new Map<string, number>();
  const sportsByGear = new Map<string, Set<string>>();
  for (const a of activities) {
    if (!a.gear_id) continue;
    kmByGear.set(a.gear_id, (kmByGear.get(a.gear_id) ?? 0) + (a.distance ?? 0) / 1000);
    let set = sportsByGear.get(a.gear_id);
    if (!set) {
      set = new Set();
      sportsByGear.set(a.gear_id, set);
    }
    set.add(a.sport_type);
  }

  const out: GearInfo[] = [];

  // Shoes from /athlete first (so we know definitively which IDs are shoes)
  for (const s of shoes) {
    const km = kmByGear.get(s.id) ?? 0;
    const lifetimeKm = (s.distance ?? 0) / 1000;
    const effectiveKm = Math.max(km, lifetimeKm);
    let status: GearInfo['status'] = 'ok';
    if (effectiveKm >= SHOE_REPLACE_KM) status = 'replace';
    else if (effectiveKm >= SHOE_WARN_KM) status = 'caution';
    out.push({
      id: s.id,
      name: s.name,
      kind: 'shoe',
      km,
      lifetimeKm,
      warnKm: SHOE_WARN_KM,
      status,
    });
  }

  for (const b of bikes) {
    const km = kmByGear.get(b.id) ?? 0;
    const lifetimeKm = (b.distance ?? 0) / 1000;
    out.push({
      id: b.id,
      name: b.name,
      kind: 'bike',
      km,
      lifetimeKm,
      warnKm: null,
      status: 'ok',
    });
  }

  return out
    .sort((a, b) => Math.max(b.lifetimeKm, b.km) - Math.max(a.lifetimeKm, a.km));
}

// ─── Race predictions (Riegel's formula) ────────────────────────────────────

/**
 * Riegel's race-time prediction: T2 = T1 * (D2/D1)^1.06
 *
 * Anchor on whichever run distance bucket has the best (lowest) pace in your
 * PR series. Predict the standard distances from that.
 */
const RACE_DISTANCES = [
  { label: '5k', meters: 5_000 },
  { label: '10k', meters: 10_000 },
  { label: 'Half', meters: 21_097 },
  { label: 'Marathon', meters: 42_195 },
];

const RIEGEL_EXPONENT = 1.06;

export function computeRacePredictions(prSeries: PrSeries[]): RacePrediction[] {
  // Pick the best PR (any bucket) as the anchor
  let anchor: { distance: number; seconds: number } | null = null;
  for (const series of prSeries) {
    if (!series.best) continue;
    const seconds = series.best.paceSecPerKm * (series.distanceMeters / 1000);
    if (!anchor || series.best.paceSecPerKm < anchor.seconds / (anchor.distance / 1000)) {
      anchor = { distance: series.distanceMeters, seconds };
    }
  }
  if (!anchor) return [];

  return RACE_DISTANCES.map(({ label, meters }) => {
    const predictedSeconds =
      anchor!.seconds * Math.pow(meters / anchor!.distance, RIEGEL_EXPONENT);
    return {
      bucket: label,
      distanceMeters: meters,
      predictedSeconds,
      paceSecPerKm: predictedSeconds / (meters / 1000),
    };
  });
}

export function computeLongTermAnalytics(
  activities: StravaActivity[],
  now: Date,
  opts: {
    bikes?: StravaGearSummary[];
    shoes?: StravaGearSummary[];
    whoopWorkouts?: WhoopWorkout[];
    cyclingProfile?: CyclingProfile | null;
  } = {},
): LongTermAnalytics {
  const prSeries = computePrSeries(activities);
  const whoop = opts.whoopWorkouts ?? [];
  return {
    fitnessCurve: computeFitnessCurve(activities, now, 90, opts.cyclingProfile ?? null),
    prSeries,
    yearProgress: computeYearProgress(activities, now),
    allTime: computeAllTimeStats(activities, now, whoop),
    trainingMap: computeDailyTrainingMap(activities, now, 365, whoop),
    gear: computeGearInfo(activities, opts.bikes, opts.shoes),
    racePredictions: computeRacePredictions(prSeries),
  };
}
