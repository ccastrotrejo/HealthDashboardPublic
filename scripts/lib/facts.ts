/**
 * Deterministic facts for the AI generators.
 *
 * The single most important module in the AI pipeline, and the answer to its
 * worst failure mode.
 *
 * Every generator used to ask the model to do arithmetic: score program
 * adherence, compute week-over-week CTL/ATL/TSB deltas, derive bedtime drift in
 * minutes, pick the week's standout session, decide which research branch
 * applied. Language models approximate arithmetic, and the approximations were
 * written to `private/data/` as fact — a weekly review whose "actual" column was
 * a verbatim copy of "planned", a sleep-drift figure that appeared nowhere in
 * the input, a "recovery debt" branch taken at a positive TSB.
 *
 * So: compute everything computable here, hand it to the model as
 * authoritative, and merge it back over the reply. The model narrates and
 * interprets physiology — which is what it is actually good at — and never gets
 * the chance to invent a number.
 */
import type {
  AdherenceFacts,
  AgreementMatch,
  CyclingFacts,
  DayAdherence,
  DailyTrendPoint,
  Facts,
  FitnessDeltaFacts,
  InsightHighlight,
  InsightLens,
  LiftProgression,
  LiftProgressPoint,
  LiftSession,
  RecentActivity,
  SleepFacts,
  Snapshot,
  StandoutFacts,
  TrendFact,
} from './types.js';
import { ROTATING_LENSES } from './types.js';
import { sanitize } from './sanitize.js';
import type { DayKey } from '../../src/lib/program.js';
import { addDays as shiftIso, DAY_MS, utcDateTime } from '../../utils/date.js';
import { mean as arithmeticMean } from '../../utils/statistics.js';

const DAY_KEYS: DayKey[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Small numeric helpers ──────────────────────────────────────────────────

function mean(xs: number[]): number | null {
  return arithmeticMean(xs.filter((x) => isFinite(x)));
}

function stdev(xs: number[]): number {
  const m = mean(xs);
  if (m == null || xs.length < 2) return 0;
  const variance = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/** Least-squares slope of y over its index, i.e. change per step. */
function slope(ys: number[]): number | null {
  const n = ys.length;
  if (n < 3) return null;
  const xm = (n - 1) / 2;
  const ym = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (ys[i]! - ym);
    den += (i - xm) ** 2;
  }
  return den === 0 ? null : num / den;
}

const round = (n: number, dp = 1) => +n.toFixed(dp);

function values(series: DailyTrendPoint[] | undefined): number[] {
  return (series ?? []).map((p) => p.value).filter((v): v is number => v != null && isFinite(v));
}

// ─── Sport ↔ program-session mapping ────────────────────────────────────────

/**
 * Sessions that are movement, recovery or noise but not training — never count
 * toward adherence. These use provider sport names; anything unrecognised is
 * treated as real training, so under-listing can mark a rest day as "modified".
 */
const INCIDENTAL = new Set([
  'walking',
  'walk',
  'sauna',
  'cleaning',
  'cooking',
  'meditation',
  'commuting',
  'watching-sports',
  'air-compression-normatec',
  'massage-therapy',
  'other',
]);

type SessionType = 'swim' | 'lift' | 'yoga' | 'bike' | 'run' | 'rest';

/**
 * Map a Strava `sport_type` or a Whoop `sport_name` onto the program's own
 * session vocabulary. Both vendors are represented because the merged activity
 * list carries rows from each.
 */
export function sessionTypeForSport(sport: string): SessionType | 'incidental' | 'unknown' {
  const s = sport.toLowerCase();
  if (INCIDENTAL.has(s)) return 'incidental';
  if (/swim/.test(s)) return 'swim';
  if (/yoga|pilates|stretch/.test(s)) return 'yoga';
  if (/ride|cycl|bike|spin/.test(s)) return 'bike';
  if (/run|jog/.test(s)) return 'run';
  if (
    /weight|strength|functional-fitness|barrys|lifting|crossfit|highintensityintervaltraining|hiit|workout/.test(
      s,
    )
  ) {
    return 'lift';
  }
  return 'unknown';
}

// ─── Adherence ──────────────────────────────────────────────────────────────

export interface AdherenceInput {
  /** Mon→Sun program template with session labels and types. */
  template: Array<{ day: DayKey; session: string; sessionType: SessionType }>;
  activities: RecentActivity[];
  /** Monday (ISO date) of the week being scored. */
  weekStart: string;
  /** Today, so days that haven't happened yet aren't counted as skipped. */
  today: string;
}

/**
 * Score program adherence day by day.
 *
 * Rest days count as adherent when nothing (beyond incidental movement) was
 * logged. Days in the future are excluded from the denominator entirely, so a
 * mid-week run doesn't report 40% purely because Thursday hasn't happened.
 */
export function computeAdherence(input: AdherenceInput): AdherenceFacts {
  const days: DayAdherence[] = [];
  let hits = 0;
  let modified = 0;
  let skipped = 0;
  let future = 0;
  let restDays = 0;

  for (let i = 0; i < 7; i++) {
    const tpl = input.template[i];
    if (!tpl) continue;
    const date = shiftIso(input.weekStart, i);

    if (date > input.today) {
      future++;
      days.push({
        weekday: tpl.day,
        date,
        planned: tpl.session,
        actual: '—',
        status: 'future',
      });
      continue;
    }

    const onDay = input.activities.filter((a) => a.startDateLocal.slice(0, 10) === date);
    const real = onDay.filter((a) => sessionTypeForSport(a.sportType) !== 'incidental');
    // Activity names are athlete- and third-party-app-controlled free text, and
    // this string is interpolated into the block the prompt calls authoritative
    // — and copied into the committed artifact history by the template path,
    // with no model involvement at all. Sanitise here, not just on the snapshot.
    const actual = real.length
      ? real
          .map(
            (a) =>
              `${sanitize(a.name, 80)} (${Math.round(a.movingTimeSeconds / 60)}m${
                a.sessionRpe != null ? `, RPE ${a.sessionRpe}` : ''
              })`,
          )
          .join(' + ')
      : '—';

    let status: DayAdherence['status'];
    if (tpl.sessionType === 'rest' && !real.length) {
      status = 'rest-day';
      restDays++;
    } else if (tpl.sessionType === 'rest') {
      // Training on a scheduled rest day is a real deviation. Crediting it as
      // full adherence let a hard unplanned session read as a perfect week.
      status = 'modified';
      modified++;
    } else if (!real.length) {
      status = 'skipped';
      skipped++;
    } else if (real.some((a) => sessionTypeForSport(a.sportType) === tpl.sessionType)) {
      status = 'hit';
      hits++;
    } else {
      status = 'modified';
      modified++;
    }

    days.push({ weekday: tpl.day, date, planned: tpl.session, actual, status });
  }

  const scored = 7 - future;
  // Modified sessions are half credit: the athlete trained, just not the plan.
  const score = scored > 0 ? Math.round(((hits + restDays + modified * 0.5) / scored) * 100) : 0;

  return { days, score, hits, modified, skipped, future };
}

// ─── Sleep ──────────────────────────────────────────────────────────────────

/**
 * Bedtime drift and duration variance as actual standard deviations, plus the
 * short-night count and mean sleep debt.
 */
export function computeSleepFacts(snapshot: Snapshot, windowNights = 14): SleepFacts {
  const reg = (snapshot.daily?.sleepRegularity ?? []).slice(-windowNights);
  const asleep = values(snapshot.daily?.trends.asleepHours).slice(-windowNights);

  const bedHours = reg.map((p) => p.bedHourLocal).filter((v) => isFinite(v));
  const needed = snapshot.daily?.sleep?.neededHours ?? null;
  const meanAsleep = mean(asleep);

  return {
    bedtimeDriftMin: Math.round(stdev(bedHours) * 60),
    durationVarianceMin: Math.round(stdev(asleep) * 60),
    meanAsleepHours: meanAsleep != null ? round(meanAsleep, 2) : null,
    shortNights: asleep.filter((h) => h < 7).length,
    nights: asleep.length,
    meanDebtHours:
      needed != null && meanAsleep != null ? round(needed - meanAsleep, 2) : null,
  };
}

// ─── Fitness curve ──────────────────────────────────────────────────────────

/**
 * Week-over-week CTL/ATL/TSB, plus how many easy days it takes to climb back to
 * a neutral TSB. ATL decays on a ~7-day half-life, so with zero further load
 * `ATL(t) = ATL0 · e^(−t/7)` and TSB recovers as ATL falls toward CTL.
 */
export function computeFitnessDelta(snapshot: Snapshot): FitnessDeltaFacts {
  const curve = snapshot.longTerm?.fitnessCurve ?? [];
  const last = curve[curve.length - 1];
  const weekAgo = curve[curve.length - 8];

  if (!last) {
    return {
      ctlChange: 0,
      atlChange: 0,
      tsbChange: 0,
      ctlNow: 0,
      atlNow: 0,
      tsbNow: 0,
      daysToNeutralTsb: 0,
    };
  }

  let daysToNeutral = 0;
  if (last.tsb < -10) {
    let atl = last.atl;
    const ctl = last.ctl;
    // Simulate rest days until form recovers, capped so a pathological curve
    // can't spin here.
    while (ctl - atl < -10 && daysToNeutral < 60) {
      atl = atl + (0 - atl) / 7;
      daysToNeutral++;
    }
  }

  return {
    ctlChange: weekAgo ? round(last.ctl - weekAgo.ctl, 2) : 0,
    atlChange: weekAgo ? round(last.atl - weekAgo.atl, 2) : 0,
    tsbChange: weekAgo ? round(last.tsb - weekAgo.tsb, 2) : 0,
    ctlNow: round(last.ctl, 1),
    atlNow: round(last.atl, 1),
    tsbNow: round(last.tsb, 1),
    daysToNeutralTsb: daysToNeutral,
  };
}

// ─── Trends ─────────────────────────────────────────────────────────────────

function trendFact(label: string, series: DailyTrendPoint[] | undefined, dp = 1): TrendFact {
  const v = values(series);
  const latest = v.length ? v[v.length - 1]! : null;
  const m7 = mean(v.slice(-7));
  const m30 = mean(v);
  const sl = slope(v.slice(-14));
  const deltaPct = latest != null && m30 != null && m30 !== 0 ? ((latest - m30) / m30) * 100 : null;

  let direction: TrendFact['direction'] = 'unknown';
  if (sl != null && m30 != null && m30 !== 0) {
    const relative = (sl * 7) / Math.abs(m30); // weekly change as a share of level
    direction = relative > 0.02 ? 'up' : relative < -0.02 ? 'down' : 'flat';
  }

  return {
    label,
    latest: latest != null ? round(latest, dp) : null,
    mean7: m7 != null ? round(m7, dp) : null,
    mean30: m30 != null ? round(m30, dp) : null,
    deltaPct: deltaPct != null ? round(deltaPct, 1) : null,
    slopePerDay: sl != null ? round(sl, 3) : null,
    direction,
  };
}

export function computeTrendFacts(snapshot: Snapshot): TrendFact[] {
  const t = snapshot.daily?.trends;
  if (!t) return [];
  const out: TrendFact[] = [
    trendFact('HRV (ms)', t.hrv, 0),
    trendFact('RHR (bpm)', t.rhr, 0),
    trendFact('Recovery (%)', t.recoveryScore, 0),
    trendFact('Sleep (h)', t.asleepHours, 2),
    trendFact('Sleep efficiency (%)', t.sleepEfficiency, 1),
    trendFact('Respiratory rate (br/min)', t.respiratoryRate, 2),
    trendFact('Skin temp (°C)', t.skinTempC, 2),
    trendFact('Day strain', t.dayStrain, 1),
  ];
  const garmin = snapshot.garmin;
  if (garmin) {
    out.push(trendFact('Training readiness', garmin.trainingReadinessTrend, 0));
    out.push(trendFact('Body battery high', garmin.bodyBatteryTrend, 0));
  }
  // Drop series with no data at all so the prompt isn't padded with nulls.
  return out.filter((f) => f.latest != null || f.mean30 != null);
}

// ─── Standout session ───────────────────────────────────────────────────────

/**
 * Rank the week's sessions and return the winner with the metric that won.
 * Preference order mirrors how much the number can be trusted: an athlete's own
 * RPE-weighted load first, then Whoop strain, then plain duration.
 */
export function pickStandout(
  activities: RecentActivity[],
  /** Only consider sessions on or after this ISO date. */
  sinceIso?: string,
): StandoutFacts | null {
  // `recentActivities` spans 14 days so a Sunday review can see the whole
  // calendar week. Without this filter the "standout session of the week" could
  // be drawn from the week before it.
  const real = activities.filter(
    (a) =>
      sessionTypeForSport(a.sportType) !== 'incidental' &&
      (!sinceIso || a.startDateLocal.slice(0, 10) >= sinceIso),
  );
  if (!real.length) return null;

  const byRpe = real.filter((a) => a.sRpeLoad != null);
  if (byRpe.length) {
    const top = byRpe.reduce((a, b) => (a.sRpeLoad! >= b.sRpeLoad! ? a : b));
    return {
      activity: sanitize(top.name, 80),
      date: top.startDateLocal.slice(0, 10),
      metric: 'sRPE load',
      value: `${Math.round(top.sRpeLoad!)} (RPE ${top.sessionRpe} × ${Math.round(top.movingTimeSeconds / 60)}m)`,
    };
  }

  const byStrain = real.filter((a) => a.whoopStrain != null);
  if (byStrain.length) {
    const top = byStrain.reduce((a, b) => (a.whoopStrain! >= b.whoopStrain! ? a : b));
    return {
      activity: sanitize(top.name, 80),
      date: top.startDateLocal.slice(0, 10),
      metric: 'Whoop strain',
      value: top.whoopStrain!.toFixed(1),
    };
  }

  const top = real.reduce((a, b) => (a.movingTimeSeconds >= b.movingTimeSeconds ? a : b));
  return {
    activity: sanitize(top.name, 80),
    date: top.startDateLocal.slice(0, 10),
    metric: 'duration',
    value: `${Math.round(top.movingTimeSeconds / 60)} min`,
  };
}

// ─── Highlights with real baselines ─────────────────────────────────────────

function fmtHours(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}h ${mm}m`;
}

function signed(n: number, dp = 0, unit = ''): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(dp)}${unit}`;
}

/**
 * Build the highlight tiles with comparisons computed against real baselines.
 * The model used to write these itself and produced comparisons like
 * "slightly unbalanced" and "higher than usual" against no baseline at all.
 */
export function buildHighlights(snapshot: Snapshot, trends: TrendFact[]): InsightHighlight[] {
  const d = snapshot.daily;
  const out: InsightHighlight[] = [];
  const find = (label: string) => trends.find((t) => t.label === label);

  if (d?.recovery?.score != null) {
    const t = find('Recovery (%)');
    out.push({
      label: 'Recovery',
      value: `${d.recovery.score}%`,
      comparison: t?.mean30 != null ? `vs ${t.mean30.toFixed(0)}% 30d avg` : undefined,
      tone: d.recovery.score >= 67 ? 'good' : d.recovery.score >= 34 ? 'neutral' : 'flag',
    });
  }

  if (d?.sleep?.asleepHours != null) {
    const needed = d.sleep.neededHours;
    const debt = needed != null ? d.sleep.asleepHours - needed : null;
    out.push({
      label: 'Sleep',
      value: fmtHours(d.sleep.asleepHours),
      comparison: debt != null ? `${signed(debt * 60, 0)} min vs needed` : undefined,
      tone: debt == null ? 'neutral' : debt >= -0.5 ? 'good' : debt >= -1.5 ? 'warn' : 'flag',
    });
  }

  if (d?.recovery?.hrvMs != null) {
    const t = find('HRV (ms)');
    out.push({
      label: 'HRV',
      value: `${d.recovery.hrvMs.toFixed(0)} ms`,
      comparison: t?.deltaPct != null ? `${signed(t.deltaPct, 0, '%')} vs 30d` : undefined,
      tone:
        t?.deltaPct == null ? 'neutral' : t.deltaPct >= -5 ? 'good' : t.deltaPct >= -12 ? 'warn' : 'flag',
    });
  }

  if (d?.recovery?.rhrBpm != null) {
    const t = find('RHR (bpm)');
    out.push({
      label: 'RHR',
      value: `${d.recovery.rhrBpm.toFixed(0)} bpm`,
      comparison: t?.deltaPct != null ? `${signed(t.deltaPct, 0, '%')} vs 30d` : undefined,
      tone:
        t?.deltaPct == null ? 'neutral' : t.deltaPct <= 3 ? 'good' : t.deltaPct <= 7 ? 'warn' : 'flag',
    });
  }

  if (d?.dayStrain?.strain != null) {
    const t = find('Day strain');
    out.push({
      label: 'Day strain',
      value: d.dayStrain.strain.toFixed(1),
      comparison: t?.mean7 != null ? `vs ${t.mean7.toFixed(1)} 7d avg` : undefined,
      tone: 'neutral',
    });
  }

  return out;
}

// ─── Research-lens selection ────────────────────────────────────────────────

/**
 * Pick the research lens deterministically.
 *
 * The prompt used to tell the model to "pick ONE lens and rotate day to day" —
 * an instruction it structurally could not follow, having no memory of
 * yesterday's choice. It also let the model take the recovery-debt branch at a
 * positive TSB. Both decisions belong here, where the branch conditions can
 * actually be evaluated and the recent history is available.
 */
export function selectLens(
  snapshot: Snapshot,
  fitness: FitnessDeltaFacts,
  recentLenses: InsightLens[],
): { lens: InsightLens; reason: string } {
  if ((snapshot.daily?.anomalies ?? []).length > 0) {
    const titles = snapshot.daily!.anomalies.map((a) => a.title).join(', ');
    return { lens: 'anomaly', reason: `Active anomalies: ${titles}.` };
  }
  if (fitness.tsbNow < -20) {
    return {
      lens: 'recovery-debt',
      reason: `TSB ${fitness.tsbNow} is below −20; ${fitness.daysToNeutralTsb} easy days to reach −10.`,
    };
  }
  // Rotate: first lens not used in the recent window, else the oldest.
  const unused = ROTATING_LENSES.filter((l) => !recentLenses.includes(l));
  const lens = unused[0] ?? ROTATING_LENSES[recentLenses.length % ROTATING_LENSES.length]!;
  return { lens, reason: `Rotating lens; last ${recentLenses.length} runs used: ${recentLenses.join(', ') || 'none'}.` };
}

// ─── Lift progressions ──────────────────────────────────────────────────────

/** Epley estimated 1RM. Reasonable up to ~10 reps, which is the program's range. */
function e1rm(kg: number, reps: number): number {
  return kg * (1 + reps / 30);
}

/**
 * Per-exercise progression over the supplied sessions. This is the only view of
 * strength progress the system has: no wearable reports barbell load, so
 * without the hand-logged file every claim about lifting is unfalsifiable.
 */
export function computeLiftProgressions(
  sessions: LiftSession[],
  sinceIso: string,
): LiftProgression[] {
  const byExercise = new Map<string, LiftProgressPoint[]>();

  for (const s of sessions) {
    if (s.date < sinceIso) continue;
    for (const entry of s.entries) {
      const working = entry.sets.filter((set) => set.reps > 0);
      if (!working.length) continue;
      const top = working.reduce((a, b) => (e1rm(a.kg, a.reps) >= e1rm(b.kg, b.reps) ? a : b));
      const volume = working.reduce((acc, set) => acc + set.reps * set.kg, 0);
      const list = byExercise.get(entry.exercise) ?? [];
      list.push({
        date: s.date,
        topSetKg: top.kg,
        topSetReps: top.reps,
        e1rmKg: round(e1rm(top.kg, top.reps), 1),
        volumeKg: round(volume, 0),
      });
      byExercise.set(entry.exercise, list);
    }
  }

  const out: LiftProgression[] = [];
  for (const [exercise, points] of byExercise) {
    points.sort((a, b) => a.date.localeCompare(b.date));
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last || points.length < 2) {
      out.push({ exercise, points, e1rmDeltaKg: 0, status: 'insufficient-data' });
      continue;
    }
    const delta = last.e1rmKg - first.e1rmKg;
    const pct = first.e1rmKg > 0 ? (delta / first.e1rmKg) * 100 : 0;
    const spanDays =
      (utcDateTime(last.date) - utcDateTime(first.date)) / DAY_MS;

    let status: LiftProgression['status'];
    if (pct > 2) status = 'progressing';
    else if (pct < -2) status = 'regressing';
    else if (points.length >= 3 && spanDays >= 14) status = 'plateau';
    else status = 'insufficient-data';

    out.push({ exercise, points, e1rmDeltaKg: round(delta, 1), status });
  }

  return out.sort((a, b) => a.exercise.localeCompare(b.exercise));
}

// ─── Cross-source caveats ───────────────────────────────────────────────────

/**
 * Turn flagged Strava↔Whoop HR disagreements into prose caveats.
 *
 * Whoop's wrist optical sensor systematically under-reads on the bike (hands on
 * the bars, wrist flexed), so an unqualified "average HR was low" claim about a
 * ride is often a device artifact rather than a fitness signal.
 */
export function buildSourceCaveats(agreement: AgreementMatch[]): string[] {
  const flagged = agreement.filter((m) => m.flagged && m.avgHrDeltaPct != null);
  if (!flagged.length) return [];

  const out: string[] = [];
  const meanDelta = mean(flagged.map((m) => m.avgHrDeltaPct!));
  if (meanDelta != null) {
    out.push(
      `Whoop and Strava disagree on average HR by ${signed(meanDelta, 1, '%')} across ${flagged.length} of the last ${agreement.length} matched sessions — treat single-session HR claims with caution.`,
    );
  }
  for (const m of flagged.slice(0, 2)) {
    out.push(
      `${sanitize(m.stravaName, 80)} (${m.startDateLocal.slice(0, 10)}): Strava ${m.stravaAvgHr ?? '—'} bpm vs Whoop ${m.whoopAvgHr ?? '—'} bpm (${signed(m.avgHrDeltaPct!, 1, '%')}).`,
    );
  }
  return out;
}

// ─── Top level ──────────────────────────────────────────────────────────────

/**
 * Turn the cycling analytics block into prompt-ready facts.
 *
 * The watt ranges are rendered here rather than left for the model to derive:
 * asking a language model to multiply an FTP by a zone percentage is a reliable
 * source of wrong numbers in a prescription the athlete will actually ride.
 */
export function computeCyclingFacts(snapshot: Snapshot): CyclingFacts | null {
  const c = snapshot.cycling;
  if (!c) return null;

  const zonesText = c.zones
    .map((z) => `Z${z.zone} ${z.label} ${z.minWatts}-${z.maxWatts ?? '∞'}W`)
    .join(' · ');

  const coverageNote =
    c.week.powerCoveragePct >= 80
      ? 'Power covers nearly all riding — prescribe in watts throughout.'
      : c.week.powerCoveragePct > 0
        ? `Only ${c.week.powerCoveragePct}% of ride time had a power meter. Indoor sessions are power-measured; outdoor rides are heart-rate only, so give those a heart-rate or perceived-effort target instead of watts.`
        : 'No ride this week had a power meter. Every watt figure below is a target, not a measurement — prescribe outdoor work by heart rate or perceived effort and say so.';

  let rampNote: string | null = null;
  if (c.ctlRampPerWeek != null) {
    if (c.ctlRampPerWeek > 7) {
      rampNote = `Fitness is ramping ${c.ctlRampPerWeek.toFixed(1)} TSS/week, above the 5-7 ceiling for recreational athletes. Hold volume flat rather than adding.`;
    } else if (c.ctlRampPerWeek < 0) {
      rampNote = `Fitness is declining ${Math.abs(c.ctlRampPerWeek).toFixed(1)} TSS/week. Consistency matters more than any single session right now.`;
    }
  }

  // Efficiency Factor is the earliest credible signal of aerobic progress, but
  // only across enough steady rides to be a trend rather than a coincidence.
  let efTrendNote: string | null = null;
  if (c.efTrend.length >= 4) {
    const half = Math.floor(c.efTrend.length / 2);
    const early = mean(c.efTrend.slice(0, half).map((p) => p.ef));
    const late = mean(c.efTrend.slice(half).map((p) => p.ef));
    if (early && late && early > 0) {
      const pct = ((late - early) / early) * 100;
      efTrendNote =
        `Efficiency Factor ${pct >= 0 ? 'up' : 'down'} ${Math.abs(pct).toFixed(1)}% ` +
        `(${early.toFixed(2)} → ${late.toFixed(2)} W/bpm) across ${c.efTrend.length} steady power rides.`;
    }
  }

  // Pre-rendered so the model quotes the curve rather than reasoning about a
  // keyed object and inventing a duration that was never measured.
  const LABELS: Record<string, string> = {
    '5': '5s', '15': '15s', '30': '30s', '60': '1min',
    '300': '5min', '1200': '20min', '3600': '60min',
  };
  const powerCurveText = Object.entries(c.powerCurve)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([d, w]) => `${LABELS[d] ?? d + 's'} ${w}W`)
    .join(' · ');

  return {
    ftpWatts: c.profile.ftpWatts,
    ftpSource: c.profile.ftpSource,
    wattsPerKg: c.wattsPerKg,
    tier: c.tier,
    zonesText,
    sweetSpotText: `${c.sweetSpot.minWatts}-${c.sweetSpot.maxWatts}W (88-94% FTP)`,
    weekTss: c.week.tss,
    weekRides: c.week.rides,
    weekCommutes: c.week.commutes,
    weekHours: c.week.hours,
    powerCoveragePct: c.week.powerCoveragePct,
    coverageNote,
    ctlRampPerWeek: c.ctlRampPerWeek,
    rampNote,
    retestDue: c.retest.due,
    retestReason: c.retest.reason,
    efTrendNote,
    baseGateNote: c.baseGate?.reason ?? null,
    powerCurveText: powerCurveText || null,
  };
}

export interface FactsInput {
  snapshot: Snapshot;
  template: Array<{ day: DayKey; session: string; sessionType: SessionType }>;
  /** Monday of the week to score adherence for. */
  weekStart: string;
  today: string;
  /** Date adherence-for-today should describe (today for the debrief, yesterday for insights). */
  forDate: string;
  lifts: LiftSession[];
  /** Lenses used by the most recent insight runs, newest first. */
  recentLenses: InsightLens[];
}

export function computeFacts(input: FactsInput): Facts {
  const { snapshot } = input;
  const activities = snapshot.weekly?.recentActivities ?? [];

  const trends = computeTrendFacts(snapshot);
  const fitness = computeFitnessDelta(snapshot);
  const adherenceWeek = computeAdherence({
    template: input.template,
    activities,
    weekStart: input.weekStart,
    today: input.today,
  });
  const { lens, reason } = selectLens(snapshot, fitness, input.recentLenses);

  const adherenceToday =
    adherenceWeek.days.find((d) => d.date === input.forDate) ??
    ({
      weekday: DAY_KEYS[(new Date(utcDateTime(input.forDate)).getUTCDay() + 6) % 7]!,
      date: input.forDate,
      planned: 'unknown',
      actual: '—',
      status: 'skipped',
    } satisfies DayAdherence);

  // Which ACWR is authoritative, and whether the variants disagree enough to
  // be worth saying out loud.
  const weekly = snapshot.weekly;
  const primary = weekly?.primaryLoadMetric ?? 'acwr';
  const primaryAcwr =
    primary === 'loadAcwr'
      ? weekly?.loadAcwr
      : primary === 'strainAcwr'
        ? weekly?.strainAcwr
        : weekly?.acwr;
  let disagreement: string | null = null;
  if (weekly?.acwr && primaryAcwr && primary !== 'acwr') {
    const gap = Math.abs(weekly.acwr.ratio - primaryAcwr.ratio);
    if (isFinite(gap) && gap > 0.3) {
      disagreement =
        `Distance ACWR reads ${weekly.acwr.ratio.toFixed(2)} (${weekly.acwr.zone}) but cross-sport load ACWR reads ` +
        `${primaryAcwr.ratio.toFixed(2)} (${primaryAcwr.zone}). The load ratio is authoritative — distance ignores ` +
        `every zero-distance session. Say which one you are using.`;
    }
  }

  return {
    forDate: input.forDate,
    lens,
    lensReason: reason,
    adherenceWeek,
    adherenceToday,
    sleep: computeSleepFacts(snapshot),
    fitness,
    trends,
    standout: pickStandout(activities, input.weekStart),
    highlights: buildHighlights(snapshot, trends),
    load: {
      primary,
      ratio: primaryAcwr && isFinite(primaryAcwr.ratio) ? round(primaryAcwr.ratio, 2) : null,
      zone: primaryAcwr?.zone ?? 'undefined',
      disagreement,
    },
    lifts: computeLiftProgressions(input.lifts, shiftIso(input.today, -56)),
    cycling: computeCyclingFacts(snapshot),
    sourceCaveats: buildSourceCaveats(snapshot.daily?.agreement ?? []),
  };
}
