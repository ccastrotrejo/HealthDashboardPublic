/**
 * Shared TypeScript types between the pipeline (scripts/) and the React app (src/).
 *
 * Keep this file lean — only fields the client actually reads should be here.
 * The pipeline writes a fuller record into the per-source JSON files.
 */

export interface Snapshot {
  /** ISO timestamp of when the pipeline last wrote this file */
  syncedAt: string;
  /** Pipeline version that produced this snapshot */
  pipelineVersion: string;
  counts: {
    recoveries: number;
    sleeps: number;
    workouts: number;
    cycles: number;
    activities: number;
    garminDays: number;
  };
  /** Today's snapshot from Whoop (recovery, sleep, strain, today's call). */
  daily: DailyAnalytics | null;
  /** Pre-computed weekly analytics (Phase 3). null until enough Strava data exists. */
  weekly: WeeklyAnalytics | null;
  /** Long-term analytics — fitness curve + future trends. */
  longTerm: LongTermAnalytics | null;
  /**
   * Power-based cycling analytics. null until there is at least one ride.
   * Optional so snapshots written before this field existed still parse.
   */
  cycling?: CyclingAnalytics | null;
  /** Today's Garmin passive metrics (steps, body battery, stress). null until Garmin is configured. */
  garmin: GarminDailyBlock | null;
  /**
   * Per-source sync health. Lets the UI surface a silently-failing vendor
   * (e.g. a Garmin login failure that drops today's cards) instead of the
   * dashboard just showing gaps. Only configured sources appear here.
   * Optional so snapshots written before this field existed still parse.
   */
  sources?: SourceHealthMap;
}

/** A configured data source in the pipeline. */
export type SourceKey = 'whoop' | 'strava' | 'garmin';

/** Sync health for a single source. */
export interface SourceHealth {
  /** Whether this source's most recent sync attempt succeeded. */
  ok: boolean;
  /** ISO timestamp of the last successful sync, or null if it never succeeded. */
  lastSuccess: string | null;
}

/** Per-source health keyed by source. Only configured sources are present. */
export type SourceHealthMap = Partial<Record<SourceKey, SourceHealth>>;

// ─── Daily Glance (Phase 2 — Whoop-fed) ─────────────────────────────────────

export type RecoveryState = 'optimal' | 'good' | 'adequate' | 'pay-attention' | 'unscored';

export interface DailyTrendPoint {
  /** YYYY-MM-DD (UTC) */
  date: string;
  /** null if no measurement that day. */
  value: number | null;
}

export interface RecoveryBlock {
  /** Whoop recovery score 0–100. null if not yet scored. */
  score: number | null;
  state: RecoveryState;
  hrvMs: number | null;
  /** Δ from 30-day baseline, as a percentage (e.g. -8 means 8% below baseline). */
  hrvDeltaPct: number | null;
  /** Garmin-style HRV status, computed from Whoop's 30-day HRV trend. See
   *  computeHrvStatus() — 'balanced' / 'unbalanced' / 'low' / 'poor' / 'unknown'. */
  hrvStatus: HrvStatus;
  rhrBpm: number | null;
  rhrDeltaPct: number | null;
  spo2Pct: number | null;
  skinTempC: number | null;
  /** Δ from 30-day baseline, °C. */
  skinTempDeltaC: number | null;
}

/** Whoop-derived HRV status — parallel to Garmin's enum so the two are comparable. */
export type HrvStatus = 'balanced' | 'unbalanced' | 'low' | 'poor' | 'unknown';

export interface SleepBlock {
  /** Hours actually asleep (in_bed minus awake). */
  asleepHours: number;
  /** Whoop sleep_performance_percentage — asleep / needed. */
  performancePct: number;
  /** asleep / in_bed. */
  efficiencyPct: number;
  /** Stage breakdown in hours. */
  stages: {
    light: number;
    deep: number;
    rem: number;
    awake: number;
  };
  /** Hours of sleep Whoop says you needed. */
  neededHours: number;
  /** Breakdown of where that need came from. */
  neededBreakdown: {
    baselineHours: number;
    fromSleepDebtHours: number;
    fromRecentStrainHours: number;
    fromRecentNapHours: number; // can be negative if you napped
  };
  /** Respiratory rate, breaths/min. */
  respiratoryRate: number | null;
}

export interface DayStrainBlock {
  strain: number; // 0–21
  kilojoule: number;
  avgHr: number;
  maxHr: number;
}

/**
 * A single rule/factor that fed into Today's Call. Lets the UI surface the
 * EXACT thresholds that produced the verdict (e.g. "HRV -18% vs -7% threshold
 * → downgrade") rather than only a summary sentence.
 */
export interface CallContributor {
  /** Metric label, e.g. "HRV", "Sleep", "Skin temp", "Training load". */
  label: string;
  /** Current value as displayed, e.g. "-18%", "5.4h", "+0.6°C", "1.62". */
  value: string;
  /** The threshold that triggered this factor, e.g. "≤ -7%", "< 6h", "> 1.5". */
  threshold: string;
  /** Which way the metric moved relative to baseline / neutral. */
  direction: 'up' | 'down' | 'neutral';
  /** How this factor affected the verdict. */
  effect: 'base' | 'downgrade' | 'cap';
  /** Full-sentence reasoning (mirrors the matching entry in `reasons`). */
  detail: string;
}

export interface TodaysCall {
  intensity: 'rest' | 'easy' | 'moderate' | 'hard';
  title: string;
  /** Short bullet list of why we're recommending this. */
  reasons: string[];
  /**
   * Structured breakdown of the rules/contributors behind the verdict.
   * Optional so snapshots written before this field existed still parse.
   */
  contributors?: CallContributor[];
}

export interface DailyAnalytics {
  /** YYYY-MM-DD of the most recent cycle. */
  date: string;
  recovery: RecoveryBlock | null;
  sleep: SleepBlock | null;
  dayStrain: DayStrainBlock | null;
  todaysCall: TodaysCall;
  /** Last 30 days, oldest first. Used for sparklines + baseline lines. */
  trends: {
    hrv: DailyTrendPoint[];
    rhr: DailyTrendPoint[];
    asleepHours: DailyTrendPoint[];
    /** Day-strain over last 30 days (Whoop cycles). null on days with no scored cycle. */
    dayStrain: DailyTrendPoint[];
    /**
     * Whoop recovery score (0–100) over the last 30 days. Optional so snapshots
     * written before this field existed still parse.
     *
     * This is the single most volatile signal in the dataset and was previously
     * only ever exposed as today's scalar — which made multi-day recovery
     * patterns structurally invisible to the AI generators.
     */
    recoveryScore?: DailyTrendPoint[];
    /** Whoop sleep efficiency % over the last 30 days. */
    sleepEfficiency?: DailyTrendPoint[];
    /** Whoop respiratory rate (breaths/min) over the last 30 days. */
    respiratoryRate?: DailyTrendPoint[];
    /** Whoop skin temperature (°C) over the last 30 days. */
    skinTempC?: DailyTrendPoint[];
    /** Whoop sleep-performance % (asleep vs needed) over the last 30 days. */
    sleepPerformance?: DailyTrendPoint[];
  };
  /** Active anomaly flags (skin temp / RHR / respiration / HRV trending). */
  anomalies: AnomalyFlag[];
  /**
   * High-severity escalation computed from the anomaly combination (e.g.
   * elevated skin temp + elevated RHR = early-illness signal). Optional/null so
   * snapshots written before this field existed still parse and the UI can
   * degrade gracefully.
   */
  anomalyEscalation?: AnomalyEscalation | null;
  /** Last 30 days of bed/wake times (local clock), one entry per night with data. */
  sleepRegularity: SleepRegularityPoint[];
  /** Most recent Strava↔Whoop activity matches with HR comparison. */
  agreement: AgreementMatch[];
}

export type AnomalySeverity = 'info' | 'caution' | 'warning';

export const ANOMALY_IDS = [
  'skin-temp-elevated',
  'rhr-elevated',
  'respiration-elevated',
  'hrv-dropping',
  'sleep-debt',
] as const;

export type AnomalyId = (typeof ANOMALY_IDS)[number];

export interface AnomalyFlag {
  /** Stable id so the UI can key off it. */
  id: AnomalyId;
  severity: AnomalySeverity;
  title: string;
  body: string;
  /** When the flag first started firing (ISO date). */
  since: string;
}

/**
 * Overall escalation state derived from the active anomaly combination. Fires
 * only when a high-severity pattern is present (early-illness combo, a
 * warning-level flag alongside another, or several anomalies at once) so the UI
 * can render a distinct critical banner and the pipeline can send a notification.
 */
export interface AnomalyEscalation {
  /** True when a high-severity combination fired. */
  active: boolean;
  /** Short human reasons the escalation triggered. */
  reasons: string[];
  /** The anomaly ids that combined to trigger escalation. */
  triggeredBy: AnomalyId[];
}

export interface SleepRegularityPoint {
  /** YYYY-MM-DD of the night (the date you fell asleep). */
  date: string;
  /** Bed time as decimal hour 0–24 in LOCAL clock (e.g. 23.5 = 23:30, 1.25 = 01:15 next day). */
  bedHourLocal: number;
  /** Wake time as decimal hour 0–24 in LOCAL clock. */
  wakeHourLocal: number;
}

export interface AgreementMatch {
  /** Strava activity id (for deep-linking later) */
  stravaId: number;
  stravaName: string;
  startDateLocal: string;
  sportType: string;
  durationMinutes: number;
  /** Strava-reported avg/max HR. */
  stravaAvgHr: number | null;
  stravaMaxHr: number | null;
  /** Whoop-reported avg/max HR for the matched workout. */
  whoopAvgHr: number | null;
  whoopMaxHr: number | null;
  /** % difference, signed (whoop - strava) / strava * 100. null when either side missing. */
  avgHrDeltaPct: number | null;
  maxHrDeltaPct: number | null;
  /** Whether the delta is large enough to flag for the user. */
  flagged: boolean;
}

// ─── Analytics shapes (Phase 3) ──────────────────────────────────────────────
// These are written into snapshot.json by scripts/lib/analytics.ts and
// consumed by React components without further computation.

export interface WeeklyVolume {
  /** ISO date, Monday 00:00 UTC of that week */
  weekStart: string;
  /** Total distance for the week, km */
  km: number;
  /** Per-sport breakdown, km */
  bySport: Record<string, number>;
}

export interface AcwrResult {
  acuteKm: number;
  chronicKm: number;
  ratio: number;
  zone: 'detraining' | 'sweet-spot' | 'caution' | 'injury-risk' | 'undefined';
  /**
   * What the acute/chronic figures actually measure. `acuteKm`/`chronicKm` are
   * historical field names — for the strain and sRPE variants the values are
   * strain units and sRPE (RPE × minutes) respectively, not kilometres.
   * Optional so older snapshots still parse.
   */
  unit?: 'km' | 'strain' | 'sRPE';
  /**
   * Share of the acute window's load contributed by each sport, 0–1. Lets the
   * UI and the AI generators tell "1.6 because of one long ride" apart from
   * "1.6 across the whole program".
   */
  bySportShare?: Record<string, number>;
}

export interface IntensityDistribution {
  easySeconds: number;
  moderateSeconds: number;
  hardSeconds: number;
}

export type Intensity = 'easy' | 'moderate' | 'hard';

export interface RecentActivity {
  /** Strava activity id when source includes 'strava', else a synthetic numeric id from the Whoop UUID. */
  id: number;
  name: string;
  sportType: string;
  /**
   * Display timestamp in the athlete's local clock.
   *
   * CAUTION: for Strava-sourced rows this is `start_date_local`, which the
   * Strava API serialises with a `Z` suffix even though it is *not* UTC. Never
   * use this field for cross-source time matching — use `startDateUtc`.
   */
  startDateLocal: string;
  /**
   * True UTC instant the session started. This is the only field safe to use
   * when matching a Strava activity against a Whoop workout.
   *
   * Optional so snapshots written before this field existed still parse; the
   * merge falls back to `startDateLocal` in that case.
   */
  startDateUtc?: string;
  distanceMeters: number;
  movingTimeSeconds: number;
  averagePaceSecPerKm: number | null;
  averageHeartrate: number | null;
  intensity: Intensity;
  /** Whoop strain (0–21) for the matched workout, if any. */
  whoopStrain?: number;
  /** Where this activity record came from. 'both' = recorded by Strava and Whoop, matched by time. */
  source: 'strava' | 'whoop' | 'both';
  /** Time in each Whoop HR zone (milliseconds). Only present when matched to a Whoop workout. */
  zoneDurationsMs?: {
    z0: number;
    z1: number;
    z2: number;
    z3: number;
    z4: number;
    z5: number;
  };
  /**
   * Id of the Whoop workout this row represents (either as a match for a Strava
   * activity or as a Whoop-only session).
   *
   * Exists so load accounting can key on identity rather than re-deriving the
   * pairing from timestamps. The two sources' start instants differ by up to the
   * ±10-minute match window and Whoop reports milliseconds where Strava does
   * not, so any second attempt at timestamp matching would silently miss and
   * double-count the session.
   */
  whoopWorkoutId?: string;
  /**
   * One-line plain-English comparison vs the most recent similar prior session
   * (same sport, ±10% distance, last 90 days). Computed in analytics.ts, not
   * AI — templates handle numbers more reliably than LLMs.
   */
  priorComparison?: string;
  /** Athlete-reported session RPE (1–10), from public/data/sessions.json. */
  sessionRpe?: number;
  /** sRPE internal load = RPE × minutes. Present only when `sessionRpe` is. */
  sRpeLoad?: number;
  /** Free-text note the athlete attached to the session. */
  sessionNote?: string;
  /** Power analytics. Present only on rides recorded with a real power meter. */
  power?: PowerMetrics;
  /** Stress score in TSS-equivalent units, from power when available, else heart rate. */
  stressScore?: number;
  /** How `stressScore` was derived, so the UI never implies more precision than exists. */
  stressSource?: 'power' | 'heart-rate' | 'rpe';
  /** Total elevation climbed, metres. Meaningful for rides in a way distance alone is not. */
  elevationGainMeters?: number;
  /** Recorded on a trainer or in Zwift. */
  indoor?: boolean;
  /** Utility riding rather than a training session. */
  commute?: boolean;
  /** Average heart rate was rejected as a sensor artefact — see hrLooksImplausible. */
  heartrateSuspect?: boolean;
}

// Re-exported above so it's available before WeeklyAnalytics uses it.

/**
 * Aggregated Whoop HR-zone time across the last 7 days. Comes free with
 * `WhoopWorkout.score.zone_durations` — we already fetch it per-workout for
 * the inline ZoneBar in ActivitiesList. This rolls it up for the week so we
 * can render a polarized-training-distribution view against the 80/10/10
 * target many endurance coaches advocate.
 */
export interface WeeklyZoneMix {
  /** Total seconds spent in each HR zone over the last 7 days. */
  z0Seconds: number;
  z1Seconds: number;
  z2Seconds: number;
  z3Seconds: number;
  z4Seconds: number;
  z5Seconds: number;
  /** Sum of z0..z5 (in seconds). */
  totalSeconds: number;
  /** Pre-computed percentages — easy = z1+z2, moderate = z3, hard = z4+z5. */
  easyPct: number;
  moderatePct: number;
  hardPct: number;
  /** How close the mix is to the polarized 80/10/10 target (0-1, higher = closer). */
  polarizationScore: number;
}

export interface WeeklyAnalytics {
  /** Last 8 weeks, oldest first. */
  weeklyVolume: WeeklyVolume[];
  /**
   * Distance-based ACWR. Retained for continuity and for run-specific context,
   * but it is NOT the primary load signal: zero-distance work (lifting, yoga,
   * HIIT, soccer) contributes nothing to it, and summing km across swim/bike/run
   * treats wildly different mechanical loads as equivalent. Prefer `loadAcwr`.
   */
  acwr: AcwrResult;
  /** Same as `acwr` but uses Whoop strain as the load metric instead of km.
   *  Captures cross-training (yoga, strength) that distance-based ACWR misses. */
  strainAcwr: AcwrResult | null;
  /**
   * The authoritative cross-sport ACWR. Uses session RPE × minutes (sRPE) where
   * a logged RPE exists, and falls back to Whoop strain × minutes otherwise, so
   * every session contributes regardless of whether it covers distance.
   *
   * Optional so snapshots written before this field existed still parse.
   */
  loadAcwr?: AcwrResult | null;
  /** Which ACWR variant downstream consumers (rules engine, AI) should treat as authoritative. */
  primaryLoadMetric?: 'loadAcwr' | 'strainAcwr' | 'acwr';
  /** Last 28 days. */
  intensity: IntensityDistribution;
  /** Last 7 days, newest first. */
  recentActivities: RecentActivity[];
  /** Last-7-day Whoop HR-zone roll-up. Null when no zone data available. */
  zoneMix: WeeklyZoneMix | null;
}

// ─── Long-term analytics (Phase 5) ──────────────────────────────────────────

export interface FitnessPoint {
  /** ISO date for this day (UTC). */
  date: string;
  /** Daily training load (Strava suffer_score when present, else duration × intensity factor). */
  load: number;
  /** Chronic Training Load — 42-day EWMA. "Fitness." */
  ctl: number;
  /** Acute Training Load — 7-day EWMA. "Fatigue." */
  atl: number;
  /** Training Stress Balance = CTL − ATL. "Form." Positive = fresh, negative = fatigued. */
  tsb: number;
}

export interface LongTermAnalytics {
  /** Last 90 days, oldest first. Warm-up days are computed but trimmed from output. */
  fitnessCurve: FitnessPoint[];
  /** Personal-record progression per standard run distance. */
  prSeries: PrSeries[];
  /** YTD vs same period last year (cumulative km curves + headline stats). */
  yearProgress: YearProgressBlock;
  /** Lifetime headline stats. */
  allTime: AllTimeStats;
  /** Last 365 days, one cell per day. Empty days are present with minutes=0. */
  trainingMap: DailyTrainingCell[];
  /** Gear (shoes/bikes) with rolled-up mileage and shoe-wear warnings. */
  gear: GearInfo[];
  /** Race-time predictions from your best recent PR, via Riegel's formula. */
  racePredictions: RacePrediction[];
}

export interface GearInfo {
  id: string;
  name: string;
  /** Heuristic: anything used primarily in Run activities is a "shoe". */
  kind: 'shoe' | 'bike' | 'other';
  /** Km accumulated from activities tagged with this gear in our dataset. */
  km: number;
  /** Lifetime km Strava itself reports (may be higher than ours if old data isn't in the activity set). */
  lifetimeKm: number;
  /** Recommended retirement threshold in km. null for non-shoes. */
  warnKm: number | null;
  /** 'ok' | 'caution' | 'replace' based on shoe wear. */
  status: 'ok' | 'caution' | 'replace';
}

export interface RacePrediction {
  /** Display label: "5k", "10k", "Half", "Marathon" */
  bucket: string;
  /** Distance in metres */
  distanceMeters: number;
  /** Predicted finish time in seconds */
  predictedSeconds: number;
  /** Implied pace in seconds per km */
  paceSecPerKm: number;
}

export interface DailyTrainingCell {
  /** YYYY-MM-DD (UTC) */
  date: string;
  /** Total moving minutes across all activities that day. 0 = rest day. */
  minutes: number;
  /** Per-sport breakdown for tooltip detail. */
  bySport: Record<string, number>;
}

export interface AllTimeStats {
  /** Total recorded activities (any sport). */
  activityCount: number;
  /** Lifetime km across all sports. */
  totalKm: number;
  /** Longest single activity in km. */
  longestActivityKm: number;
  /** Longest consecutive-day training streak ever. */
  longestStreakDays: number;
  /** Current consecutive-day streak (counts back from today or yesterday). */
  currentStreakDays: number;
  /** First-activity year — how long you've been logging. */
  firstYear: number | null;
}

/** A single near-distance effort attempted on a particular date. */
export interface PrEffort {
  /** ISO timestamp of the activity. */
  date: string;
  /** Avg pace for the effort in seconds-per-km. */
  paceSecPerKm: number;
  /** Strava activity ID for deep-linking later. */
  activityId: number;
}

export interface PrSeries {
  /** Display label for the bucket: "1k", "5k", "10k", "Half", "Marathon". */
  bucket: string;
  /** Nominal distance in metres. */
  distanceMeters: number;
  /** Every effort that fell into this bucket, oldest first. */
  efforts: PrEffort[];
  /** Best effort ever recorded in this bucket, null if none. */
  best: PrEffort | null;
}

export interface YearCumulativePoint {
  /** Day-of-year ordinal (0 = Jan 1). Allows aligning years on the x-axis. */
  doy: number;
  /** Cumulative km from Jan 1 up to this day. */
  km: number;
}

export interface YearProgressBlock {
  thisYear: YearCumulativePoint[];
  lastYear: YearCumulativePoint[];
  /** Cumulative km YTD this year. */
  ytdKm: number;
  /** Cumulative km last year through the same calendar date. */
  ytdKmLastYear: number;
}

// ─── Coach (Phase 4) ────────────────────────────────────────────────────────

export interface CoachDay {
  /** Mon / Tue / ... / Sun. */
  weekday: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  /** Short label, e.g. "Easy run", "Tempo intervals", "Rest". */
  type: string;
  intensity: Intensity | 'rest';
  durationMinutes: number;
  /** One-sentence justification tied to current state. */
  reason: string;
}

export interface CoachNutrition {
  dailyAnchors: string;
  preAndPostFueling: string;
  mealIdea: string;
  groceryItem: string;
}

// ─── AI artifact provenance (shared by every generated block) ───────────────

/**
 * Fields every AI-generated artifact carries so the UI can judge whether the
 * content in front of the user is trustworthy.
 *
 * Previously a generator that fell back to its deterministic template wrote
 * `model: "template"` and nothing else, and the UI rendered the placeholder
 * prose in exactly the same treatment as real analysis. These fields make
 * degraded output self-describing.
 */
export interface AiProvenance {
  /** ISO timestamp the generation ran. */
  generatedAt: string;
  /** `llm:<model>` when a model produced this, `template` when it fell back. */
  model: string;
  /** True when this artifact is the deterministic fallback, not model output. */
  isTemplate?: boolean;
  /** Why the fallback fired (provider missing, HTTP error, schema rejection…). */
  fallbackReason?: string;
  /** `syncedAt` of the snapshot this was generated from. */
  snapshotSyncedAt?: string;
  /** Hours between `snapshotSyncedAt` and generation time. */
  snapshotAgeHours?: number;
  /** True when the snapshot was older than the freshness budget for this task. */
  dataStale?: boolean;
  /** Token usage, when the provider reported it. */
  usage?: { promptTokens: number; completionTokens: number };
}

export type CoachBlock = AiProvenance & {
  /** 1-2 sentence framing of the upcoming week. */
  summary: string;
  /** Monday ISO date of the week this plan covers. */
  forWeek?: string;
  /** Mon→Sun, exactly 7 entries. */
  plan: CoachDay[];
  nutrition: CoachNutrition;
};

// ─── Insights / daily research (AI scheduled task, public/data/insights.json) ───

/** Tone for a highlighted metric — drives the badge color in the UI. */
export type InsightTone = 'good' | 'neutral' | 'warn' | 'flag';

export interface InsightHighlight {
  /** Short label, e.g. "Sleep", "HRV", "Day strain". */
  label: string;
  /** Yesterday's value as a display string, e.g. "6h 12m", "52 ms", "14.3". */
  value: string;
  /** Comparison vs baseline, e.g. "−45 min vs 7d", "+8% vs 30d". May be omitted. */
  comparison?: string;
  /** Visual tone — drives badge color. */
  tone: InsightTone;
}

export type InsightsBlock = AiProvenance & {
  /** The date the analysis covers, ISO yyyy-mm-dd. Usually "yesterday". */
  forDate: string;
  /** One punchy sentence — the headline takeaway from yesterday. */
  headline: string;
  /** 3–6 metric highlights with comparisons. Rendered as a strip of stat tiles. */
  highlights: InsightHighlight[];
  /** Multi-day patterns spotted across the recent window. Bullets. */
  patterns: string[];
  /** Optional deeper-dive section. Title + 2–4 paragraph body. */
  research?: {
    title: string;
    body: string;
    /** Optional source tags, e.g. ["whoop", "strava"]. */
    sources?: string[];
  };
  /**
   * Which analytical lens the research section used. Chosen deterministically
   * (anomaly / recovery-debt / rotating) and persisted so the next run can
   * actually rotate instead of being asked to rotate with no memory.
   */
  lensUsed?: InsightLens;
  /** Things worth watching for today, given yesterday's signals. */
  flags: string[];
};

/** The research lens the daily insight used. */
export type InsightLens =
  | 'anomaly'
  | 'recovery-debt'
  | 'hrv-vs-stimulus'
  | 'sleep-vs-recovery'
  | 'acwr-vs-subjective'
  | 'cross-source-agreement'
  | 'program-adherence'
  | 'zone-polarization';

/** Lenses eligible for the day-to-day rotation (the two priority branches are not). */
export const ROTATING_LENSES: InsightLens[] = [
  'hrv-vs-stimulus',
  'sleep-vs-recovery',
  'acwr-vs-subjective',
  'cross-source-agreement',
  'program-adherence',
  'zone-polarization',
];

// ─── Today debrief (AI scheduled task, 8 PM ET, today-debrief.json) ─────────

export interface TodayAdherence {
  /** What the program / coach said today's session should be. */
  planned: string;
  /** What actually got logged (or "skipped" / "rest-day"). */
  actual: string;
  /** Adherence verdict. */
  status: 'hit' | 'modified' | 'skipped' | 'rest-day';
}

export interface TomorrowSetup {
  /** Tomorrow's program-scheduled session. */
  planned: string;
  /** How recovered / ready you should be given today's load + tonight's projected sleep. */
  readiness: string;
  /** ONE concrete action for tonight to set up tomorrow well. */
  target: string;
}

export type TodayDebriefBlock = AiProvenance & {
  /** Today's ISO yyyy-mm-dd. */
  forDate: string;
  /** One-sentence framing of how today went. */
  headline: string;
  /** 3–5 metric highlights — today's strain, last night's sleep, recovery, etc. */
  highlights: InsightHighlight[];
  /** Program adherence: did today's session match the plan? */
  adherence: TodayAdherence;
  /** Tomorrow setup: planned session + readiness + ONE tonight target. */
  tomorrow: TomorrowSetup;
  /** Optional deeper dive — same shape as the Insights research block. */
  research?: {
    title: string;
    body: string;
    sources?: string[];
  };
  /** Watch-tomorrow flags based on today's signals. */
  flags: string[];
};

// ─── Weekly review (AI scheduled task, Sunday 6 PM ET, weekly-review.json) ───

export interface AdherenceCheck {
  /** Mon→Sun list of program-planned sessions. */
  planned: string[];
  /** Mon→Sun list of what actually happened (matched activities or "—"). */
  actual: string[];
  /** 0–100 — share of planned sessions that materialised. */
  score: number;
  /** Optional one-line gloss on why score is what it is. */
  note?: string;
}

export interface FitnessDelta {
  /** Change in CTL since 7 days ago. */
  ctlChange: number;
  /** Change in ATL since 7 days ago. */
  atlChange: number;
  /** Change in TSB since 7 days ago. */
  tsbChange: number;
  /** 1–2 sentence narrative interpreting the delta. */
  narrative: string;
}

export interface StandoutSession {
  /** Activity name or program label (e.g. "Sat bike — Threshold 6×3min"). */
  activity: string;
  /** 1–2 sentences explaining why this session stood out. */
  why: string;
}

export interface SleepCoachBlock {
  /** Average bedtime drift (variance) in minutes over the past 14 nights. */
  bedtimeDriftMin: number;
  /** Average duration variance in minutes over the past 14 nights. */
  durationVarianceMin: number;
  /** ONE concrete sleep target for next week. No "try to sleep more." */
  target: string;
}

export type WeeklyReviewBlock = AiProvenance & {
  /** Monday ISO date of the week being reviewed. */
  forWeek: string;
  /** 1–2 sentence headline framing of the week. */
  headline: string;
  /** Program-adherence breakdown. */
  adherence: AdherenceCheck;
  /** CTL/ATL/TSB week-over-week. */
  fitnessDelta: FitnessDelta;
  /** The single best session of the week, with why. */
  standout: StandoutSession;
  /** 1–2 sentence multi-week trend observation (4-week lens). */
  trend: string;
  /** Sleep coach recommendation. */
  sleepCoach: SleepCoachBlock;
  /** 1–2 sentence preview of next week's focus given current state. */
  nextWeekFocus: string;
};

// ─── Monthly patterns (AI scheduled task, 1st of month) ─────────────────────

export interface MonthlyPattern {
  /** Short title, e.g. "Saturday rides getting faster". */
  title: string;
  /** 2–3 sentences of analysis. Cite the data. */
  body: string;
  /** Strength of the signal. */
  confidence: 'high' | 'medium' | 'low';
  /** Tags, e.g. ["strava", "whoop"]. */
  sources?: string[];
}

export type MonthlyPatternsBlock = AiProvenance & {
  /** ISO date for the first day of the month being reviewed. */
  forMonth: string;
  /** 1-sentence headline framing of the month. */
  headline: string;
  /** 3–5 spotted patterns. */
  patterns: MonthlyPattern[];
};

// ─── Races / future events (user-edited public/data/races.json) ─────────────

export type RaceType = 'race' | 'event' | 'workout-goal' | 'travel';
export type RaceSport = 'run' | 'ride' | 'swim' | 'tri' | 'other';
export type RacePriority = 'A' | 'B' | 'C';
export type RaceStatus = 'registered' | 'planned' | 'considering';
export type RaceTerrain = 'road' | 'trail' | 'gravel' | 'track' | 'mixed';

export interface RaceGoal {
  /** Target finish time in seconds. */
  timeSeconds?: number;
  /** Target pace in seconds per km (for run events). */
  paceSecPerKm?: number;
  /** Target normalised power for bike events. */
  power?: number;
  /** When the goal is simply to complete the event. */
  finishOnly?: boolean;
}

export interface RaceLocation {
  name: string;
  city?: string;
  country?: string;
  lat?: number;
  lng?: number;
}

export interface RaceLegSplit {
  /** Display name: 'Swim' / 'T1' / 'Bike' / 'T2' / 'Run' / etc. */
  name: string;
  durationSeconds: number;
  /** Optional pace/speed label, e.g. "16.2 mph", "9:00 /mi", "3:11 /100m". */
  paceLabel?: string;
}

export interface RaceResult {
  /** Finish time in seconds. */
  finishSeconds?: number;
  /** Overall placement (1 = won). */
  overallPlace?: number;
  /** Total finishers in the race (for percentile context). */
  overallFinishers?: number;
  /** Placement within age group / division. */
  divisionPlace?: number;
  /** Division name if known, e.g. "M30-34" or "M25-29 (30/35)". */
  division?: string;
  /** Per-leg breakdown — only meaningful for multisport (triathlon/duathlon). */
  legs?: RaceLegSplit[];
  /** Notes about the race — how it felt, conditions, lessons. */
  notes?: string;
}

export interface RaceEvent {
  /** Stable kebab-case slug — used as React key and for deep-linking. */
  id: string;
  name: string;
  /** ISO date YYYY-MM-DD. */
  date: string;
  type: RaceType;
  sport: RaceSport;
  priority: RacePriority;
  status: RaceStatus;
  distance?: { meters: number; label: string };
  duration?: { hours: number };
  location?: RaceLocation;
  goal?: RaceGoal;
  elevationGainMeters?: number;
  terrain?: RaceTerrain;
  url?: string;
  notes?: string;
  /** Populated after the race. Drives the post-race comparison card. */
  result?: RaceResult;
}

export interface RacesData {
  races: RaceEvent[];
}

/** Subset of Whoop recovery we care about. Full record is in whoop-recoveries.json. */
export interface WhoopRecovery {
  cycle_id: number;
  sleep_id: string;
  created_at: string;
  updated_at: string;
  score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  score?: {
    recovery_score: number;
    resting_heart_rate: number;
    hrv_rmssd_milli: number;
    spo2_percentage?: number;
    skin_temp_celsius?: number;
    user_calibrating: boolean;
  };
}

export interface WhoopSleep {
  id: string;
  cycle_id: number;
  start: string;
  end: string;
  /** Local timezone offset for this record, e.g. "-05:00". */
  timezone_offset?: string;
  nap: boolean;
  score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  score?: {
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
      sleep_cycle_count: number;
      disturbance_count: number;
    };
    sleep_needed: {
      baseline_milli: number;
      need_from_sleep_debt_milli: number;
      need_from_recent_strain_milli: number;
      need_from_recent_nap_milli: number;
    };
    respiratory_rate: number;
    sleep_performance_percentage: number;
    sleep_consistency_percentage: number;
    sleep_efficiency_percentage: number;
  };
}

export interface WhoopWorkout {
  id: string;
  start: string;
  end: string;
  sport_id: number;
  sport_name: string;
  /** e.g. "-04:00". Used to render Whoop times in the athlete's local clock. */
  timezone_offset?: string;
  score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  score?: {
    strain: number;
    average_heart_rate: number;
    max_heart_rate: number;
    kilojoule: number;
    percent_recorded: number;
    distance_meter?: number;
    altitude_gain_meter?: number;
    zone_durations: {
      zone_zero_milli: number;
      zone_one_milli: number;
      zone_two_milli: number;
      zone_three_milli: number;
      zone_four_milli: number;
      zone_five_milli: number;
    };
  };
}

export interface WhoopCycle {
  id: number;
  start: string;
  end: string;
  score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  score?: {
    strain: number;
    kilojoule: number;
    average_heart_rate: number;
    max_heart_rate: number;
  };
}

/** Subset of Strava activity. Full record is in strava-activities.json. */
export interface StravaActivity {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  start_date_local: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  average_speed: number;
  max_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
  has_heartrate: boolean;
  average_watts?: number;
  /** Coggan Normalized Power. Strava computes this for us on power-bearing rides. */
  weighted_average_watts?: number;
  max_watts?: number;
  /**
   * True when watts came from a real power meter or smart trainer, false when
   * Strava estimated them. Estimated power carries ±20–40% error and is not
   * computed with the 30-second rolling algorithm NP requires, so every
   * power-derived metric gates on this being `true`.
   */
  device_watts?: boolean;
  kilojoules?: number;
  /** Recorded on a trainer. Speed is meaningless on these; power is not. */
  trainer?: boolean;
  /** Strava's own commute flag. Frequently unset even on genuine commutes. */
  commute?: boolean;
  device_name?: string;
  suffer_score?: number;
  /** ID of the gear used (e.g. shoe or bike). null/undefined if not tagged. */
  gear_id?: string | null;
}

// ─── Cycling (power-based training) ─────────────────────────────────────────

/**
 * The athlete constants every power and heart-rate calculation depends on.
 *
 * Kept as data rather than inferred, because FTP is established by a test and
 * LTHR by observation — guessing either silently rescales TSS, every zone
 * boundary and the whole fitness curve.
 */
export interface CyclingProfile {
  /** Functional Threshold Power in watts. */
  ftpWatts: number;
  /** Where the current FTP number came from, so the UI can show its confidence. */
  ftpSource: 'ramp-test' | '20min-test' | 'strava' | 'manual' | 'estimate';
  /** ISO date of the test that produced it, null when estimated. */
  ftpTestedOn: string | null;
  weightKg: number;
  /** Lactate threshold heart rate — the HR at FTP. Anchors hrTSS and HR zones. */
  lthr: number | null;
  maxHr: number | null;
  restingHr: number | null;
}

export interface FtpEntry {
  date: string;
  watts: number;
  source: CyclingProfile['ftpSource'];
  wattsPerKg: number | null;
}

export interface PowerZone {
  zone: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  label: string;
  minWatts: number;
  maxWatts: number | null;
  minPctFtp: number;
  maxPctFtp: number | null;
}

/**
 * A structured bike session the athlete actually rode.
 *
 * Exists because no wearable reports what a ride was *meant* to be. Strava can
 * say 45 minutes at 180 W; only the athlete can say that was supposed to be
 * 3 × 15 min at 90% FTP and the third interval fell apart. Without that, the
 * coach can describe volume but can never tell whether the prescription was met.
 */
export interface BikeWorkoutEntry {
  date: string;
  /** Which kind of session this was meant to be. */
  kind:
    | 'z2'
    | 'tempo'
    | 'sweet-spot'
    | 'threshold'
    | 'over-unders'
    | 'vo2max'
    | 'anaerobic'
    | 'sprints'
    | 'test';
  /** The prescription as written, e.g. "3 x 15 min @ 88-94% FTP". */
  prescribed: string;
  /** Target watts for the work intervals, when the session had one. */
  targetWatts?: number;
  /** Average watts actually held across the work intervals. */
  actualWatts?: number;
  /** Whether the prescription was completed as written. */
  completion: 'full' | 'partial' | 'abandoned';
  /** Session RPE, 1–10. */
  rpe?: number;
  indoor?: boolean;
  note?: string;
  /** Strava activity id, when the athlete knows it. */
  activityId?: number;
}

export interface BikeWorkoutsData {
  workouts: BikeWorkoutEntry[];
}
export interface PowerMetrics {
  /** Normalized Power, watts. */
  np: number;
  averageWatts: number;
  maxWatts: number | null;
  /** NP / FTP. */
  intensityFactor: number;
  /** Training Stress Score. 100 = one hour at FTP. */
  tss: number;
  /** NP / average power. >1.05 indicates a surgy ride. */
  variabilityIndex: number | null;
  kilojoules: number | null;
  /** NP per beat per minute. Rises as the aerobic base improves. */
  efficiencyFactor: number | null;
}

/**
 * Metrics derived from one ride's per-second streams.
 *
 * Cached permanently per activity: streams cost one API call each, and a
 * completed ride's numbers never change, so the pipeline derives these once
 * and never fetches that activity again.
 */
export interface RideStreamMetrics {
  activityId: number;
  date: string;
  /** Normalized Power computed from the full watt stream. */
  np: number | null;
  /** Aerobic decoupling (Pw:Hr) as a percentage. Under 5% is the base-phase gate. */
  decouplingPct: number | null;
  efFirst: number | null;
  efSecond: number | null;
  /** Best rolling average power per duration, keyed by seconds. */
  meanMaximalPower: Record<string, number>;
  movingTimeSeconds: number;
}

export interface CyclingPowerEffort {
  watts: number;
  activityId: number;
  /** Activity-local date from the cached ride stream summary. */
  date: string;
}

/**
 * The cycling block of the snapshot — everything a power-based training system
 * needs to describe where the athlete currently is.
 */
export interface CyclingAnalytics {
  profile: CyclingProfile;
  zones: PowerZone[];
  sweetSpot: { minWatts: number; maxWatts: number };
  wattsPerKg: number | null;
  /** Coggan power-profile tier for the current W/kg. */
  tier: string;
  ftpHistory: FtpEntry[];
  retest: { due: boolean; reason: string };
  week: {
    /** Total stress score across all rides in the last 7 days. */
    tss: number;
    /** Training rides, excluding commutes. */
    rides: number;
    commutes: number;
    hours: number;
    indoorHours: number;
    outdoorHours: number;
    /**
     * Share of ride time backed by a real power meter. The honesty gauge: at a
     * low value most cycling metrics are heart-rate inferences, not measurements.
     */
    powerCoveragePct: number;
  };
  /**
   * Change in CTL over the last 7 days. Recreational athletes should stay at or
   * under roughly 5–7 per week; faster ramps track with injury and illness.
   */
  ctlRampPerWeek: number | null;
  /** Efficiency Factor on steady power rides, oldest first. Rising = aerobic gains. */
  efTrend: { date: string; ef: number }[];
  /**
   * Aerobic decoupling per long ride, oldest first. Requires per-second
   * streams, so this is empty until rides with power have been analysed.
   */
  decouplingTrend: { date: string; decouplingPct: number; minutes: number }[];
  /**
   * Best power held for each duration across the tracked window, keyed by
   * seconds ("5", "60", "300", "1200", "3600"). The power-duration curve.
   */
  powerCurve: Record<string, number>;
  /**
   * Optional measured-power comparison; absent in older snapshots.
   * Activity calendar dates are compared to the supplied snapshot's UTC date.
   * Recent includes that day and the prior 29; preceding covers days 31–90.
   */
  powerBlocks?: {
    asOf: string;
    recent: Record<string, CyclingPowerEffort>;
    preceding: Record<string, CyclingPowerEffort>;
  };
  /**
   * Whether decoupling clears the 5% base-phase gate, with the reasoning.
   * null when no qualifying ride has been analysed.
   */
  baseGate: { passing: boolean; reason: string } | null;
}

/** Strava /athlete bike or shoe entry. */
export interface StravaGearSummary {
  id: string;
  name: string;
  primary: boolean;
  /** Lifetime distance Strava reports for this gear, metres. */
  distance: number;
}

/** Pipeline cursor — what we've already synced */
export interface SyncMeta {
  lastSuccessAt: string;
  whoopCursor: string | null;
  stravaCursor: number | null;
  /** YYYY-MM-DD of the most recent Garmin daily we've pulled. */
  garminCursor: string | null;
  pipelineVersion: string;
  /** Per-source sync health, carried across runs so lastSuccess survives a failed run. */
  sources?: SourceHealthMap;
}

// ─── Garmin (Phase 6 — daily passive metrics) ───────────────────────────────
// One row per calendar date. Whoop owns sleep+recovery, Strava owns activities;
// Garmin contributes step count, body battery, stress, intensity minutes —
// the passive-day metrics neither of the others tracks.

export interface GarminDaily {
  /** YYYY-MM-DD (UTC). */
  date: string;
  steps: number | null;
  stepGoal: number | null;
  distanceMeters: number | null;
  floorsClimbed: number | null;
  floorsGoal: number | null;
  intensityMinutesModerate: number | null;
  intensityMinutesVigorous: number | null;
  activeCalories: number | null;
  totalCalories: number | null;
  restingHeartRate: number | null;
  minHeartRate: number | null;
  maxHeartRate: number | null;
  /** 0–100, average across the day. */
  stressAvg: number | null;
  stressMax: number | null;
  /** Body Battery range across the day. */
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  bodyBatteryCharged: number | null;
  bodyBatteryDrained: number | null;
  /** Latest VO2 max estimate from Garmin (running). */
  vo2Max: number | null;
  /** Pulse Ox (SpO2) — averaged across the overnight period. */
  avgSpo2: number | null;
  minSpo2: number | null;
  /** Garmin's morning Training Readiness score (0–100). Newer devices only. */
  trainingReadinessScore: number | null;
  /** LOW / MEDIUM / HIGH / MAXIMUM (Garmin's bucketing). */
  trainingReadinessLevel: string | null;
  /** Hours of recovery still needed before next quality workout. */
  recoveryTimeHours: number | null;
  /** Short narrative Garmin attaches to readiness ("Stay focused", "Push hard", ...). */
  trainingReadinessFeedback: string | null;
}

/** Latest single-value Garmin metrics — not per-date. Pulled once per sync. */
export interface GarminLatestMetrics {
  /** ISO timestamp of when this snapshot was last refreshed. */
  fetchedAt: string;
  trainingStatus: {
    /** Human label: Productive / Maintaining / Detraining / Overreaching / Unproductive / Peaking / Recovery. */
    label: string;
    /** Garmin's short feedback phrase. */
    feedback: string | null;
    /** Rolling 7-day training load (EPOC-derived). */
    weeklyLoad: number | null;
    /** Lower bound of Garmin's "optimal load tunnel" for your current fitness. */
    loadTunnelMin: number | null;
    /** Upper bound. */
    loadTunnelMax: number | null;
    /** Acute (7d) and chronic (28d) training load values. */
    acuteLoad: number | null;
    chronicLoad: number | null;
  } | null;
  /** Garmin's predictor for standard race distances (5k/10k/half/marathon). */
  racePredictions: GarminRacePrediction[] | null;
}

export interface GarminRacePrediction {
  bucket: string; // "5k" | "10k" | "Half" | "Marathon"
  distanceMeters: number;
  predictedSeconds: number;
}

export interface GarminHrvPoint {
  /** YYYY-MM-DD of the overnight measurement. */
  date: string;
  /** 7-day rolling average HRV (RMSSD, ms). */
  weeklyAvgMs: number | null;
  lastNightAvgMs: number | null;
  lastNight5MinHighMs: number | null;
  /** Garmin's HRV status label: BALANCED, UNBALANCED, LOW, POOR, etc. */
  status: string | null;
}

/** Today's Garmin snapshot — surfaced in the daily glance. */
export interface GarminDailyBlock {
  date: string;
  steps: number | null;
  stepGoal: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  restingHeartRate: number | null;
  stressAvg: number | null;
  intensityMinutesWeek: number | null;
  intensityMinutesGoal: number;
  vo2Max: number | null;
  /** Last 30 days of step counts for sparkline. */
  stepsTrend: DailyTrendPoint[];
  /** Last 30 days of body-battery high values. */
  bodyBatteryTrend: DailyTrendPoint[];

  // ─── Tier 1 additions (data already on per-row GarminDaily / GarminHrv) ───

  /** Floors climbed today + goal. */
  floorsToday: number | null;
  floorsGoal: number | null;
  /** Garmin's HRV status label for the most recent night (BALANCED / UNBALANCED / LOW / POOR / NO_STATUS). */
  hrvStatus: string | null;
  /** 7-day rolling overnight HRV average, ms (most recent reading). */
  hrvWeeklyAvgMs: number | null;
  /** VO₂ max series over the last 90 days, oldest first (one point per day VO₂ max changed). */
  vo2MaxTrend: DailyTrendPoint[];
  /** Per-day moderate-equivalent intensity minutes for the last 8 weeks, oldest first. */
  intensityMinutesTrend: DailyTrendPoint[];

  // ─── Tier 2 additions (require dedicated endpoint pulls) ─────────────────

  /** Most recent Training Readiness score (0–100). */
  trainingReadinessScore: number | null;
  trainingReadinessLevel: string | null;
  /** Hours of recovery still needed before the next quality session. */
  recoveryTimeHours: number | null;
  trainingReadinessFeedback: string | null;
  /** Last 30 days of training-readiness scores. */
  trainingReadinessTrend: DailyTrendPoint[];

  /** Pulse Ox / SpO₂ from the most recent overnight reading. */
  avgSpo2: number | null;
  minSpo2: number | null;
  /** Last 30 days of average SpO₂ for the sparkline. */
  spo2Trend: DailyTrendPoint[];

  /** Garmin's training-status label (Productive, Detraining, etc) — see GarminLatestMetrics. */
  trainingStatus: GarminLatestMetrics['trainingStatus'];

  /** Garmin's race predictions (5k/10k/half/marathon). */
  racePredictions: GarminRacePrediction[] | null;
}

// ─── Athlete-logged inputs ──────────────────────────────────────────────────
// Everything above this line is passively collected from Whoop / Strava /
// Garmin. The three files below are the only ones the athlete writes by hand,
// and they close the pipeline's biggest blind spots: what was actually lifted,
// how hard a session felt, and whether the AI's analysis was any good.

/** One set of one exercise. */
export interface LiftSet {
  reps: number;
  /** Load in kilograms. 0 for bodyweight movements. */
  kg: number;
  /** Reps in reserve / RPE for this set, 1–10. Optional. */
  rpe?: number;
}

export interface LiftEntry {
  /** Exercise name. Validated against src/lib/program.ts on write. */
  exercise: string;
  sets: LiftSet[];
  notes?: string;
}

export interface LiftSession {
  /** ISO yyyy-mm-dd. */
  date: string;
  /** Which program lift this was: 'A' | 'B' | 'C', or a free label for one-offs. */
  liftId: string;
  entries: LiftEntry[];
  /** Session RPE 1–10 for the whole lift. */
  sessionRpe?: number;
  notes?: string;
}

export interface LiftsData {
  sessions: LiftSession[];
}

/** Best working set of an exercise on a given day, plus its estimated 1RM. */
export interface LiftProgressPoint {
  date: string;
  /** Heaviest set × reps performed that day. */
  topSetKg: number;
  topSetReps: number;
  /** Epley estimated 1RM: kg × (1 + reps/30). */
  e1rmKg: number;
  /** Total volume load for the exercise that day (Σ reps × kg). */
  volumeKg: number;
}

export interface LiftProgression {
  exercise: string;
  points: LiftProgressPoint[];
  /** e1RM change from the first to the last point, kg. */
  e1rmDeltaKg: number;
  /**
   * 'progressing' — e1RM up >2% over the window
   * 'plateau'     — within ±2% across 3+ sessions spanning 14+ days
   * 'regressing'  — e1RM down >2%
   * 'insufficient-data' — fewer than 2 sessions
   */
  status: 'progressing' | 'plateau' | 'regressing' | 'insufficient-data';
}

/** Athlete-reported RPE for a non-lift session, keyed to an activity. */
export interface SessionRpeEntry {
  /** ISO yyyy-mm-dd of the session. */
  date: string;
  /**
   * Strava activity id or Whoop-derived synthetic id. When absent, the RPE is
   * matched to the day's single session (or ignored when the day is ambiguous).
   */
  activityId?: number;
  /** Sport label, used for matching when no id is given. */
  sport?: string;
  /** Borg CR10 session RPE, 1–10. */
  rpe: number;
  /** How the athlete felt, free text. Surfaced to the AI verbatim. */
  note?: string;
}

export interface SessionsData {
  sessions: SessionRpeEntry[];
}

/** Which AI artifact a piece of feedback refers to. */
export type AiArtifactKind =
  | 'insights'
  | 'today-debrief'
  | 'coach'
  | 'weekly-review'
  | 'monthly-patterns'
  | 'race-week'
  | 'post-race'
  | 'calibration';

export interface AiFeedbackEntry {
  /** ISO timestamp the feedback was recorded. */
  at: string;
  artifact: AiArtifactKind;
  /** `generatedAt` of the artifact being rated, so feedback pins to a version. */
  artifactGeneratedAt: string;
  rating: 'up' | 'down';
  /** Optional free-text correction. Fed back to the model as a negative example. */
  note?: string;
}

export interface AiFeedbackData {
  entries: AiFeedbackEntry[];
}

// ─── Race week / post-race / calibration (AI) ───────────────────────────────

export interface RaceWeekDay {
  weekday: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  /** ISO date for this day of race week. */
  date: string;
  session: string;
  intensity: Intensity | 'rest';
  durationMinutes: number;
  /** What this day is *for* in taper terms. */
  purpose: string;
}

export type RaceWeekBlock = AiProvenance & {
  /** Slug of the race this covers. */
  raceId: string;
  raceName: string;
  raceDate: string;
  daysOut: number;
  headline: string;
  /** Taper plan from today through race day. */
  days: RaceWeekDay[];
  /** Pacing / effort strategy grounded in current fitness. */
  pacing: {
    target: string;
    /** Per-leg or per-split guidance. */
    splits: string[];
    /** What to do if it goes wrong. */
    contingency: string;
  };
  /** Fuelling + hydration plan for the 48h before and during. */
  fuelling: { before: string; during: string; after: string };
  /** Logistics checklist — gear, timings, travel. */
  checklist: string[];
  /** Readiness read on current CTL/ATL/TSB vs where they should be. */
  readiness: string;
};

export type PostRaceBlock = AiProvenance & {
  raceId: string;
  raceName: string;
  raceDate: string;
  headline: string;
  /** Goal vs actual, computed deterministically then narrated. */
  outcome: {
    goalSeconds: number | null;
    actualSeconds: number | null;
    deltaSeconds: number | null;
    /** 'beat' | 'met' | 'missed' | 'no-goal' */
    verdict: 'beat' | 'met' | 'missed' | 'no-goal';
    narrative: string;
  };
  /** Per-leg analysis for multisport, or per-split for single-sport. */
  legs: Array<{ name: string; durationSeconds: number; note: string }>;
  /** What the build-up predicted vs what happened. */
  executionVsBuildUp: string;
  /** 2–4 concrete lessons for the next block. */
  lessons: string[];
  /** Recommended recovery window before the next quality session. */
  recovery: { restDays: number; guidance: string };
};

/** One scored prediction: what we said, what happened. */
export interface PredictionScore {
  raceId: string;
  raceName: string;
  raceDate: string;
  /** Distance bucket the prediction was made for. */
  bucket: string;
  /** Our Riegel-derived prediction at the time, seconds. */
  predictedSeconds: number | null;
  /** Garmin's own prediction, seconds. */
  garminPredictedSeconds: number | null;
  /** What was actually run, seconds. */
  actualSeconds: number;
  /** (actual − predicted) / predicted × 100. Negative = we were pessimistic. */
  errorPct: number | null;
  garminErrorPct: number | null;
}

export type CalibrationBlock = AiProvenance & {
  headline: string;
  scores: PredictionScore[];
  /** Mean signed error across all scored races, %. */
  meanErrorPct: number | null;
  garminMeanErrorPct: number | null;
  /** Which source has been more accurate so far. */
  betterSource: 'riegel' | 'garmin' | 'tie' | 'insufficient-data';
  /** How to read the current predictions given the observed bias. */
  guidance: string;
};

// ─── Deterministic facts injected into every AI prompt ──────────────────────

/**
 * Everything below is computed in TypeScript from the snapshot and handed to
 * the model as authoritative. The model narrates; it never recomputes.
 *
 * This exists because asking an LLM for arithmetic produced measurably wrong
 * artifacts — fabricated week-over-week deltas, invented adherence scores, and
 * sleep statistics that did not appear anywhere in its input.
 */
export interface DayAdherence {
  weekday: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  date: string;
  planned: string;
  /** Matched sessions for that date, or '—'. */
  actual: string;
  status: 'hit' | 'modified' | 'skipped' | 'rest-day' | 'future';
}

export interface AdherenceFacts {
  days: DayAdherence[];
  /** 0–100. Rest days count as hit when nothing was logged. */
  score: number;
  hits: number;
  modified: number;
  skipped: number;
  /** Days not yet reached at generation time — excluded from the score. */
  future: number;
}

export interface SleepFacts {
  /** Standard deviation of bedtime across the window, minutes. */
  bedtimeDriftMin: number;
  /** Standard deviation of sleep duration across the window, minutes. */
  durationVarianceMin: number;
  meanAsleepHours: number | null;
  /** Nights below 7h in the window. */
  shortNights: number;
  nights: number;
  /** Mean sleep debt (needed − asleep) across the window, hours. */
  meanDebtHours: number | null;
}

export interface FitnessDeltaFacts {
  ctlChange: number;
  atlChange: number;
  tsbChange: number;
  ctlNow: number;
  atlNow: number;
  tsbNow: number;
  /** Easy days at ~7-day ATL half-life until TSB ≥ −10. 0 when already above. */
  daysToNeutralTsb: number;
}

export interface TrendFact {
  label: string;
  /** Most recent non-null value. */
  latest: number | null;
  mean7: number | null;
  mean30: number | null;
  /** (latest − mean30) / mean30 × 100. */
  deltaPct: number | null;
  /** Least-squares slope per day across the window. */
  slopePerDay: number | null;
  direction: 'up' | 'down' | 'flat' | 'unknown';
}

export interface StandoutFacts {
  activity: string;
  date: string;
  /** Why it ranked first — the actual metric that won. */
  metric: string;
  value: string;
}

export interface Facts {
  /** ISO date the facts describe. */
  forDate: string;
  /** Deterministic research-lens selection for the daily insight. */
  lens: InsightLens;
  lensReason: string;
  adherenceWeek: AdherenceFacts;
  adherenceToday: DayAdherence;
  sleep: SleepFacts;
  fitness: FitnessDeltaFacts;
  trends: TrendFact[];
  standout: StandoutFacts | null;
  /** Pre-formatted highlight tiles with real baseline comparisons. */
  highlights: InsightHighlight[];
  /** The load metric the rules engine and the model should treat as primary. */
  load: {
    primary: 'loadAcwr' | 'strainAcwr' | 'acwr';
    ratio: number | null;
    zone: string;
    /** Set when the km-based and load-based ACWRs materially disagree. */
    disagreement: string | null;
  };
  /** Lift progressions over the last 8 weeks, when lifts.json has data. */
  lifts: LiftProgression[];
  /**
   * Power-based cycling facts. Null when the snapshot predates the cycling
   * block or there are no rides.
   */
  cycling: CyclingFacts | null;
  /** Cross-source HR disagreements worth caveating in prose. */
  sourceCaveats: string[];
}

/**
 * The cycling numbers a prompt is allowed to reason over.
 *
 * Every field here is computed, never generated. `zonesText` and `coverageNote`
 * are pre-rendered because a model asked to derive watt ranges from an FTP and
 * a percentage table gets the arithmetic wrong often enough to matter.
 */
export interface CyclingFacts {
  ftpWatts: number;
  ftpSource: string;
  wattsPerKg: number | null;
  tier: string;
  /** Human-readable watt ranges for every zone, ready to quote in a prescription. */
  zonesText: string;
  sweetSpotText: string;
  weekTss: number;
  weekRides: number;
  weekCommutes: number;
  weekHours: number;
  /** Share of ride time backed by a real power meter, 0–100. */
  powerCoveragePct: number;
  /** Warns the model when its watt targets cannot actually be verified. */
  coverageNote: string;
  ctlRampPerWeek: number | null;
  rampNote: string | null;
  retestDue: boolean;
  retestReason: string;
  /** Efficiency Factor change across the tracked window, when there is enough data. */
  efTrendNote: string | null;
  /** Aerobic decoupling against the 5% base-phase gate, when a long power ride exists. */
  baseGateNote: string | null;
  /** Best power by duration, pre-rendered. Empty until streams have been analysed. */
  powerCurveText: string | null;
}
