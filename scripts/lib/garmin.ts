/**
 * Garmin Connect client.
 *
 * Unlike Whoop/Strava, Garmin doesn't offer an OAuth API usable for personal
 * projects, so we use the unofficial `garmin-connect` package which logs in
 * with email+password via the same SSO flow as the Garmin Connect website,
 * minting OAuth1 + OAuth2 tokens for the session.
 *
 * Security notes:
 *  - Credentials live in env vars (GARMIN_EMAIL / GARMIN_PASSWORD) and are
 *    handed once to the library; never logged or written to disk by this code.
 *  - Tokens (OAuth1/2) are kept in memory only — we never call exportToken().
 *  - Errors are stripped of response bodies (which can echo back URLs and IDs).
 *  - MFA support depends on the unofficial library. Keep account protection
 *    enabled and omit this optional integration if login cannot complete.
 *
 * Endpoint stability:
 *  - `usersummary-service` / `hrv-service` paths are the workhorse and have
 *    been stable for years across community libraries.
 *  - Newer per-day endpoints (training readiness, SpO2) and "latest" endpoints
 *    (race predictions, training status) are wrapped in their own try/catches
 *    so an outage or path-change in one of them can't take down the rest.
 */
// `garmin-connect` is CommonJS and exposes GarminConnect via
// Object.defineProperty, which Node's cjs-module-lexer doesn't detect as a
// named ESM export. Default-import the whole module and destructure at
// runtime — that path works for both `tsx` (Node ESM) and any future bundler.
import garminConnectModule from 'garmin-connect';
const { GarminConnect } = garminConnectModule;
type GarminConnectInstance = InstanceType<typeof GarminConnect>;
import type {
  GarminDaily,
  GarminHrvPoint,
  GarminLatestMetrics,
  GarminRacePrediction,
} from './types.js';
import { dateKey as toDateString, DAY_MS, utcDateTime } from '../../utils/date.js';
import athleteConfig from './athlete-config.js';

/**
 * Format a Date as YYYY-MM-DD in the configured IANA timezone.
 * Used for "today" only; historical dates already arrive as ISO strings.
 *
 * The bug this fixes: at 8–11 PM ET, UTC has already rolled to the next
 * calendar day. `toDateString(new Date())` returned tomorrow's date and
 * Garmin replied with null/empty for every field because that day hasn't
 * started yet in any populated timezone.
 *
 * Set USER_TIMEZONE in env to override.
 */
function todayInUserTz(): string {
  const tz = process.env.USER_TIMEZONE || athleteConfig.timezone;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Inclusive list of YYYY-MM-DD strings between two dates (UTC). */
function dateRange(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const from = utcDateTime(fromIso);
  const to = utcDateTime(toIso);
  for (let t = from; t <= to; t += DAY_MS) {
    out.push(toDateString(new Date(t)));
  }
  return out;
}

/** Garmin's daily summary response. We tolerate missing fields. */
interface GarminDailySummaryRaw {
  calendarDate?: string;
  totalSteps?: number | null;
  dailyStepGoal?: number | null;
  totalDistanceMeters?: number | null;
  floorsAscended?: number | null;
  userFloorsAscendedGoal?: number | null;
  moderateIntensityMinutes?: number | null;
  vigorousIntensityMinutes?: number | null;
  activeKilocalories?: number | null;
  totalKilocalories?: number | null;
  restingHeartRate?: number | null;
  minHeartRate?: number | null;
  maxHeartRate?: number | null;
  averageStressLevel?: number | null;
  maxStressLevel?: number | null;
  bodyBatteryHighestValue?: number | null;
  bodyBatteryLowestValue?: number | null;
  bodyBatteryChargedValue?: number | null;
  bodyBatteryDrainedValue?: number | null;
  vO2MaxValue?: number | null;
  averageSpo2?: number | null;
  lowestSpo2?: number | null;
}

interface GarminHrvRaw {
  hrvSummary?: {
    weeklyAvg?: number | null;
    lastNightAvg?: number | null;
    lastNight5MinHigh?: number | null;
    status?: string | null;
    feedbackPhrase?: string | null;
  } | null;
}

interface GarminTrainingReadinessRaw {
  score?: number | null;
  level?: string | null; // LOW | MEDIUM | MAXIMUM | HIGH | etc
  recoveryTime?: number | null; // hours
  sleepScore?: number | null;
  sleepScoreFactorFeedback?: string | null;
  hrvWeeklyAverage?: number | null;
  acuteLoad?: number | null;
  feedbackLong?: string | null;
  feedbackShort?: string | null;
}

interface GarminSpo2Raw {
  averageSpO2?: number | null;
  lowestSpO2?: number | null;
  latestSpO2?: number | null;
}

interface GarminTrainingStatusRaw {
  // Garmin returns a "mostRecent*" wrapper with the latest day's data.
  mostRecentTrainingStatus?: {
    latestTrainingStatusData?: Record<
      string,
      {
        trainingStatus?: number | null;
        trainingStatusFeedbackPhrase?: string | null;
        weeklyTrainingLoad?: number | null;
        loadTunnelMin?: number | null;
        loadTunnelMax?: number | null;
        acuteTrainingLoadDTO?: {
          acuteTrainingLoad?: number | null;
          chronicTrainingLoad?: number | null;
          acwrPercent?: number | null;
        } | null;
      }
    > | null;
  } | null;
  mostRecentVO2Max?: {
    generic?: { vo2MaxValue?: number | null } | null;
    cycling?: { vo2MaxValue?: number | null } | null;
  } | null;
}

interface GarminRacePredictionsRaw {
  time5K?: number | null; // seconds
  time10K?: number | null;
  timeHalfMarathon?: number | null;
  timeMarathon?: number | null;
}

/** Map Garmin's numeric trainingStatus code to its label. */
function trainingStatusLabel(code: number | null | undefined): string | null {
  if (code == null) return null;
  // From Garmin Connect IQ docs / community reverse-engineering.
  const map: Record<number, string> = {
    0: 'No status',
    1: 'Detraining',
    2: 'Recovery',
    3: 'Maintaining',
    4: 'Productive',
    5: 'Peaking',
    6: 'Overreaching',
    7: 'Unproductive',
  };
  return map[code] ?? null;
}

export interface GarminAuth {
  /** Preferred: base64-encoded JSON of { oauth1, oauth2 } from `pnpm auth garmin`. */
  tokenJson?: string;
  /** Fallback (triggers SSO + occasional 429s): plain email/password. */
  email?: string;
  password?: string;
}

/**
 * Connect to Garmin Connect, preferring the OAuth-token path.
 *
 * Two auth modes, in order of preference:
 *
 *   1. **Token load** — `GARMIN_TOKEN_JSON` env contains base64-encoded
 *      `{ oauth1, oauth2 }` from a prior `pnpm auth garmin` run. We hand them
 *      to `gc.loadToken()` and skip SSO entirely. OAuth2 auto-refreshes from
 *      OAuth1 in-memory if it's expired. This avoids the 429 rate-limit that
 *      Garmin slaps on repeated SSO logins from cloud IPs.
 *
 *   2. **Password login** — `GARMIN_EMAIL` + `GARMIN_PASSWORD` env. Does the
 *      full SSO handshake on every run. Subject to 429 cool-downs. Use for
 *      bootstrapping (the one-time login that mints the OAuth tokens for
 *      mode 1) and as a fallback if the OAuth1 token expires.
 */
async function connect(auth: GarminAuth): Promise<GarminConnectInstance> {
  if (auth.tokenJson) {
    let parsed: { oauth1?: unknown; oauth2?: unknown };
    try {
      parsed = JSON.parse(Buffer.from(auth.tokenJson, 'base64').toString('utf8'));
    } catch (e) {
      throw new Error(
        `garmin token-json is not valid base64-JSON: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
    if (!parsed.oauth1 || !parsed.oauth2) {
      throw new Error('garmin token-json missing oauth1 or oauth2 field');
    }
    // Constructor still needs *something* for credentials — pass dummies; the
    // library only uses them if a re-login is forced, and loadToken() is what
    // actually authenticates.
    const gc = new GarminConnect({ username: '', password: '' });
    // The library's loadToken signature: (oauth1, oauth2) — both required.
    gc.loadToken(parsed.oauth1 as never, parsed.oauth2 as never);
    return gc;
  }

  if (!auth.email || !auth.password) {
    throw new Error(
      'garmin auth: provide GARMIN_TOKEN_JSON (preferred) or GARMIN_EMAIL+GARMIN_PASSWORD',
    );
  }

  // Constructor doesn't make network calls; only login() does.
  const gc = new GarminConnect({ username: auth.email, password: auth.password });
  try {
    await gc.login();
  } catch (e) {
    // Strip body — the underlying axios error can include the full HTML of
    // Garmin's login page in its message, which is huge and could leak the
    // value of any pre-filled query params in the redirect chain.
    const msg = e instanceof Error ? e.message.slice(0, 200) : 'unknown';
    throw new Error(`garmin login failed: ${msg}`);
  }
  return gc;
}

const GC_API = 'https://connectapi.garmin.com';

/** Pull the consolidated daily summary for one date. */
async function fetchDailySummary(
  gc: GarminConnectInstance,
  displayName: string,
  date: string,
): Promise<GarminDailySummaryRaw | null> {
  try {
    const url = `${GC_API}/usersummary-service/usersummary/daily/${encodeURIComponent(
      displayName,
    )}?calendarDate=${date}`;
    return await gc.client.get<GarminDailySummaryRaw>(url);
  } catch (e) {
    // Common case: Garmin returns 404 for dates with no device data. Treat as
    // a missing-day rather than a hard error so one bad day doesn't kill the
    // whole sync.
    console.error(
      `[garmin] daily summary ${date} skipped:`,
      e instanceof Error ? e.message.slice(0, 120) : 'unknown',
    );
    return null;
  }
}

/** Pull HRV detail for one date. Optional — older devices don't have HRV status. */
async function fetchHrv(gc: GarminConnectInstance, date: string): Promise<GarminHrvRaw | null> {
  try {
    const url = `${GC_API}/hrv-service/hrv/${date}`;
    return await gc.client.get<GarminHrvRaw>(url);
  } catch {
    return null; // expected on dates with no HRV recording
  }
}

/** Pull Training Readiness for one date. Newer Garmin devices only (Forerunner 255+, Fenix 7+, etc). */
async function fetchTrainingReadiness(
  gc: GarminConnectInstance,
  date: string,
): Promise<GarminTrainingReadinessRaw | null> {
  try {
    const url = `${GC_API}/metrics-service/metrics/trainingreadiness/${date}`;
    const data = await gc.client.get<GarminTrainingReadinessRaw[]>(url);
    // Endpoint returns an array (multiple readings per day possible) — pick the
    // latest, which is the last element.
    if (Array.isArray(data) && data.length > 0) return data[data.length - 1]!;
    return null;
  } catch {
    return null; // expected on devices without training readiness support
  }
}

/** Pull Pulse Ox (SpO2) detail for one date. Optional — device must support pulse ox. */
async function fetchSpo2(
  gc: GarminConnectInstance,
  date: string,
): Promise<GarminSpo2Raw | null> {
  try {
    const url = `${GC_API}/wellness-service/wellness/dailySpo2/${date}`;
    return await gc.client.get<GarminSpo2Raw>(url);
  } catch {
    return null;
  }
}

/**
 * Pull latest training-status + VO₂ max snapshot. One call gives the current
 * status label, weekly load, and acute/chronic training load values.
 *
 * Endpoint takes today's date (YYYY-MM-DD), not the user's displayName.
 * Garmin returns the aggregated training-status as of that date.
 */
async function fetchTrainingStatus(
  gc: GarminConnectInstance,
  date: string,
): Promise<GarminTrainingStatusRaw | null> {
  try {
    const url = `${GC_API}/metrics-service/metrics/trainingstatus/aggregated/${date}`;
    return await gc.client.get<GarminTrainingStatusRaw>(url);
  } catch (e) {
    console.error(
      '[garmin] training status skipped:',
      e instanceof Error ? e.message.slice(0, 120) : 'unknown',
    );
    return null;
  }
}

/** Pull latest race predictions. */
async function fetchRacePredictions(
  gc: GarminConnectInstance,
  displayName: string,
): Promise<GarminRacePredictionsRaw | null> {
  try {
    const url = `${GC_API}/metrics-service/metrics/racepredictions/latest/${encodeURIComponent(
      displayName,
    )}`;
    return await gc.client.get<GarminRacePredictionsRaw>(url);
  } catch {
    return null;
  }
}

function normalizeDaily(
  raw: GarminDailySummaryRaw,
  date: string,
  readiness: GarminTrainingReadinessRaw | null,
  spo2: GarminSpo2Raw | null,
): GarminDaily {
  return {
    date,
    steps: raw.totalSteps ?? null,
    stepGoal: raw.dailyStepGoal ?? null,
    distanceMeters: raw.totalDistanceMeters ?? null,
    floorsClimbed: raw.floorsAscended ?? null,
    floorsGoal: raw.userFloorsAscendedGoal ?? null,
    intensityMinutesModerate: raw.moderateIntensityMinutes ?? null,
    intensityMinutesVigorous: raw.vigorousIntensityMinutes ?? null,
    activeCalories: raw.activeKilocalories ?? null,
    totalCalories: raw.totalKilocalories ?? null,
    restingHeartRate: raw.restingHeartRate ?? null,
    minHeartRate: raw.minHeartRate ?? null,
    maxHeartRate: raw.maxHeartRate ?? null,
    stressAvg: raw.averageStressLevel ?? null,
    stressMax: raw.maxStressLevel ?? null,
    bodyBatteryHigh: raw.bodyBatteryHighestValue ?? null,
    bodyBatteryLow: raw.bodyBatteryLowestValue ?? null,
    bodyBatteryCharged: raw.bodyBatteryChargedValue ?? null,
    bodyBatteryDrained: raw.bodyBatteryDrainedValue ?? null,
    vo2Max: raw.vO2MaxValue ?? null,
    // SpO2: prefer the SpO2-specific endpoint when available, fall back to the
    // values some user-summary responses include directly.
    avgSpo2: spo2?.averageSpO2 ?? raw.averageSpo2 ?? null,
    minSpo2: spo2?.lowestSpO2 ?? raw.lowestSpo2 ?? null,
    // Training readiness — only present on supported devices.
    trainingReadinessScore: readiness?.score ?? null,
    trainingReadinessLevel: readiness?.level ?? null,
    recoveryTimeHours: readiness?.recoveryTime ?? null,
    trainingReadinessFeedback: readiness?.feedbackShort ?? readiness?.feedbackLong ?? null,
  };
}

function normalizeHrv(raw: GarminHrvRaw, date: string): GarminHrvPoint | null {
  const s = raw.hrvSummary;
  if (!s) return null;
  return {
    date,
    weeklyAvgMs: s.weeklyAvg ?? null,
    lastNightAvgMs: s.lastNightAvg ?? null,
    lastNight5MinHighMs: s.lastNight5MinHigh ?? null,
    status: s.status ?? null,
  };
}

/**
 * Pick the most recent entry out of the trainingStatus "latestTrainingStatusData"
 * map. Garmin keys the inner map by deviceId (or sometimes by date string),
 * so we just take whichever entry has the largest acuteTrainingLoad value
 * (a stable proxy for "most recently updated").
 */
function normalizeTrainingStatus(
  raw: GarminTrainingStatusRaw | null,
): GarminLatestMetrics['trainingStatus'] {
  if (!raw?.mostRecentTrainingStatus?.latestTrainingStatusData) return null;
  const entries = Object.values(raw.mostRecentTrainingStatus.latestTrainingStatusData);
  if (entries.length === 0) return null;
  // Use the entry with the highest acute load — heuristic for most-recent device.
  const latest = entries.reduce((best, cur) =>
    (cur.acuteTrainingLoadDTO?.acuteTrainingLoad ?? -1) >
    (best.acuteTrainingLoadDTO?.acuteTrainingLoad ?? -1)
      ? cur
      : best,
  );
  const label = trainingStatusLabel(latest.trainingStatus);
  if (!label) return null;
  return {
    label,
    feedback: latest.trainingStatusFeedbackPhrase ?? null,
    weeklyLoad: latest.weeklyTrainingLoad ?? null,
    loadTunnelMin: latest.loadTunnelMin ?? null,
    loadTunnelMax: latest.loadTunnelMax ?? null,
    acuteLoad: latest.acuteTrainingLoadDTO?.acuteTrainingLoad ?? null,
    chronicLoad: latest.acuteTrainingLoadDTO?.chronicTrainingLoad ?? null,
  };
}

function normalizeRacePredictions(
  raw: GarminRacePredictionsRaw | null,
): GarminRacePrediction[] | null {
  if (!raw) return null;
  const out: GarminRacePrediction[] = [];
  if (raw.time5K) out.push({ bucket: '5k', distanceMeters: 5000, predictedSeconds: raw.time5K });
  if (raw.time10K)
    out.push({ bucket: '10k', distanceMeters: 10000, predictedSeconds: raw.time10K });
  if (raw.timeHalfMarathon)
    out.push({
      bucket: 'Half',
      distanceMeters: 21097,
      predictedSeconds: raw.timeHalfMarathon,
    });
  if (raw.timeMarathon)
    out.push({
      bucket: 'Marathon',
      distanceMeters: 42195,
      predictedSeconds: raw.timeMarathon,
    });
  return out.length > 0 ? out : null;
}

export interface GarminPullResult {
  daily: GarminDaily[];
  hrv: GarminHrvPoint[];
  /** Latest "single-value" metrics — training status, race predictions, etc. Null if all sub-pulls failed. */
  latest: GarminLatestMetrics | null;
}

/**
 * Pull Garmin daily data between `since` and today (inclusive).
 * `since` is YYYY-MM-DD UTC. To stay within the cron's 10-minute timeout
 * the caller should cap the range to ~90 days on first-run.
 */
export async function pullGarmin(
  auth: GarminAuth,
  since: string,
): Promise<GarminPullResult> {
  const gc = await connect(auth);

  // displayName is the URL-safe id Garmin uses in summary paths. It is NOT
  // your email or your "social" display label; it's a stable hash.
  const profile = await gc.getUserProfile();
  const displayName = profile.displayName;
  if (!displayName) {
    throw new Error('garmin profile missing displayName');
  }

  // "Today" is the user's LOCAL today (Eastern by default), not UTC today.
  // UTC rolls over at 8 PM ET so using UTC here asks Garmin for tomorrow,
  // which has no data yet — all fields come back null. See todayInUserTz().
  const today = todayInUserTz();
  const dates = dateRange(since, today);

  // Pull each day's four endpoints in parallel, with a small concurrency cap
  // across days so we don't burst Garmin's edge and earn a 429. Each "slot"
  // fires 4 in-flight requests (summary + hrv + readiness + spo2), so cap
  // GARMIN_CONCURRENCY=3 = up to 12 in-flight requests at any time. A
  // 90-day cold start drops from ~25 s serial to ~3 s without bursting.
  const concurrency = Math.max(
    1,
    Math.min(8, Number(process.env.GARMIN_CONCURRENCY) || 3),
  );
  const dailyResults: Array<{ daily: GarminDaily | null; hrv: GarminHrvPoint | null }> =
    new Array(dates.length);

  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= dates.length) return;
      const date = dates[i]!;
      const [summary, hrvRaw, readiness, spo2] = await Promise.all([
        fetchDailySummary(gc, displayName, date),
        fetchHrv(gc, date),
        fetchTrainingReadiness(gc, date),
        fetchSpo2(gc, date),
      ]);
      dailyResults[i] = {
        daily: summary ? normalizeDaily(summary, date, readiness, spo2) : null,
        hrv: hrvRaw ? normalizeHrv(hrvRaw, date) : null,
      };
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, dates.length) }, () => worker()),
  );

  const daily: GarminDaily[] = [];
  const hrv: GarminHrvPoint[] = [];
  for (const r of dailyResults) {
    if (!r) continue;
    if (r.daily) daily.push(r.daily);
    if (r.hrv) hrv.push(r.hrv);
  }

  // "Latest" metrics — single call regardless of date range. These endpoints
  // return the most-recent snapshot Garmin has, not a per-day series.
  const [statusRaw, racePredRaw] = await Promise.all([
    fetchTrainingStatus(gc, today),
    fetchRacePredictions(gc, displayName),
  ]);

  const trainingStatus = normalizeTrainingStatus(statusRaw);
  const racePredictions = normalizeRacePredictions(racePredRaw);
  const latest: GarminLatestMetrics | null =
    trainingStatus || racePredictions
      ? { trainingStatus, racePredictions, fetchedAt: new Date().toISOString() }
      : null;

  return { daily, hrv, latest };
}
