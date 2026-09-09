#!/usr/bin/env tsx
/**
 * Daily sync orchestrator.
 *
 *  Phase 1: pull last 7 days of Whoop + Strava data, write JSON to private/data/.
 *  Future phases extend this with all-time history, derived analytics, AI sections.
 *
 * Security posture:
 *  - Tokens stay in GitHub Secrets in CI; local rotations update .env.local (0600).
 *  - Rotating Whoop refresh token is updated atomically: we prove GitHub
 *    Secrets is writable BEFORE asking Whoop for a new token pair (a refresh
 *    kills the old token, so a failure discovered afterwards is unrecoverable),
 *    then write the NEW token back before making any API calls with it. If a
 *    downstream failure happens, the new token is safely stored for next run.
 *  - All access tokens are masked from Actions logs via ::add-mask::.
 *  - Errors thrown by the API clients carry only status codes; never tokens.
 *  - JSON is written atomically (write to .tmp then rename) so a crash mid-write
 *    can't leave the repo with truncated data.
 *  - DRY_RUN=1 skips data writes; rotated tokens still persist both locally and in CI.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { dataPath } from './lib/storage.js';
import { assertLocalEnvWritable, updateEnvLocal } from './lib/local-env.js';

import * as whoop from './lib/whoop.js';
import * as strava from './lib/strava.js';
import { pullGarmin } from './lib/garmin.js';
import { maskInActionsLog, preflightSecretWrites, putSecret } from './lib/tokens.js';
import {
  computeCyclingAnalytics,
  computeLongTermAnalytics,
  computeWeeklyAnalytics,
} from './lib/analytics.js';
import {
  computeDecoupling,
  dedupeIndoorRides,
  hasRealPower,
  isCommute,
  isRide,
  meanMaximalPower,
  normalizedPowerFromStream,
  resolveCyclingProfile,
  wattsPerKg,
} from './lib/cycling.js';
import { cyclingProfileDefaults } from '../src/lib/program.js';
import { computeDailyAnalytics, computeGarminDailyBlock } from './lib/daily.js';
import { notifyEscalation } from './lib/notify.js';
import { DAY_MS, utcDateTime } from '../utils/date.js';
import type {
  CyclingProfile,
  FtpEntry,
  RideStreamMetrics,
  GarminDaily,
  GarminHrvPoint,
  GarminLatestMetrics,
  SessionRpeEntry,
  SessionsData,
  SourceHealthMap,
  SourceKey,
  SyncMeta,
  Snapshot,
  StravaActivity,
  WhoopCycle,
  WhoopRecovery,
  WhoopSleep,
  WhoopWorkout,
} from './lib/types.js';

const PIPELINE_VERSION = '0.3.0-cycling-power';
const DRY_RUN = process.env.DRY_RUN === '1';
/**
 * Rebuild every derived artifact from the raw vendor JSON already in the repo,
 * with no network calls and no credentials.
 *
 * Needed whenever the analytics change shape: the committed snapshot is stale
 * relative to the new code until a cron happens to run, and MAINTENANCE.md's
 * advice for a card that won't render ("trigger Daily sync manually to
 * regenerate snapshot.json against current code") is not actionable without
 * vendor secrets. This makes it a one-liner.
 */
const RECOMPUTE = process.env.RECOMPUTE === '1';
const META_PATH = dataPath('sync-meta.json');
const SNAPSHOT_PATH = dataPath('snapshot.json');

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`missing env: ${name}`);
  }
  return v;
}

/** Returns true iff all of these env vars are set & non-empty. */
function hasAll(names: string[]): boolean {
  return names.every((n) => !!process.env[n]);
}

/**
 * Gate a vendor sync on our ability to persist the token it is about to rotate.
 *
 * Called BEFORE the vendor refresh, never after: once the vendor mints a new
 * refresh token the old one is dead, so this is the last moment where failing
 * is cheap. Throws to skip the vendor for this run, leaving the stored token
 * untouched and valid for the next one.
 */
async function assertCanPersistRotation(vendor: string): Promise<void> {
  if (!process.env.GITHUB_ACTIONS) {
    assertLocalEnvWritable();
    return;
  }
  try {
    await preflightSecretWrites();
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'unknown error';
    console.error(
      `::warning title=${vendor} sync skipped::GitHub Secrets is not writable ` +
        `(${reason}). Skipping the refresh so the stored token stays valid — ` +
        `the next run picks it up.`,
    );
    throw new Error(`cannot persist rotated token: ${reason}`);
  }
}

/**
 * Vendors whose rotated refresh token could NOT be persisted this run.
 *
 * Whoop (and Strava) issue a new refresh token on every refresh and invalidate
 * the old one immediately. If the write-back fails, the only valid token dies
 * with this process and every later run fails auth until the OAuth flow is
 * re-run by hand — exactly what a transient GitHub 503 did on 2026-08-17. This
 * list turns that into a red run instead of a green one with a quiet log line.
 */
const tokenRotationFailures: string[] = [];

/**
 * Persist a rotated refresh token: GitHub Secrets in CI, .env.local elsewhere.
 *
 * A CI write-back failure is recorded in `tokenRotationFailures`
 * rather than aborting the vendor sync — the access token we already hold is
 * still valid for this run, so we may as well pull today's data before the
 * credential goes dead.
 */
async function rotateRefreshToken(
  vendor: string,
  secretName: string,
  oldToken: string,
  newToken: string,
): Promise<void> {
  if (newToken === oldToken) return;

  if (!process.env.GITHUB_ACTIONS) {
    updateEnvLocal(secretName, newToken);
    console.error(`[${vendor}] updated ${secretName} in .env.local`);
    return;
  }
  console.error(`[${vendor}] rotating ${secretName} in GitHub Secrets…`);
  try {
    await putSecret(secretName, newToken);
  } catch (e) {
    tokenRotationFailures.push(vendor);
    const reason = e instanceof Error ? e.message : 'unknown error';
    console.error(
      `::error title=${secretName} rotation failed::${reason}. The previous ` +
        `refresh token is already invalid, so ${vendor} sync will fail from now ` +
        `on. Re-authorize with 'pnpm auth ${vendor}' and update ${secretName}.`,
    );
  }
}

/**
 * Hand the token-rotation verdict to the workflow so a later step can fail the
 * job AFTER the data commit has run. Writing an output is a no-op outside CI.
 */
function reportTokenRotationOutcome(): void {
  if (tokenRotationFailures.length === 0) return;
  console.error(
    `[token] rotation failed for: ${tokenRotationFailures.join(', ')} — manual re-auth required`,
  );
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  try {
    appendFileSync(
      outputPath,
      `token_rotation_failed=true\ntoken_rotation_vendors=${tokenRotationFailures.join(',')}\n`,
    );
  } catch {
    console.error('[token] could not write GITHUB_OUTPUT — job will not be marked failed');
  }
}

function readMeta(): SyncMeta {
  if (!existsSync(META_PATH)) {
    return {
      lastSuccessAt: '1970-01-01T00:00:00Z',
      whoopCursor: null,
      stravaCursor: null,
      garminCursor: null,
      pipelineVersion: PIPELINE_VERSION,
      sources: {},
    };
  }
  const raw = JSON.parse(readFileSync(META_PATH, 'utf8')) as Partial<SyncMeta>;
  // Backfill garminCursor for snapshots written before Garmin was wired in.
  return {
    lastSuccessAt: raw.lastSuccessAt ?? '1970-01-01T00:00:00Z',
    whoopCursor: raw.whoopCursor ?? null,
    stravaCursor: raw.stravaCursor ?? null,
    garminCursor: raw.garminCursor ?? null,
    pipelineVersion: raw.pipelineVersion ?? PIPELINE_VERSION,
    sources: raw.sources ?? {},
  };
}

/** `syncedAt` from the snapshot already on disk, so a recompute can preserve it. */
function readPrevSyncedAt(): string | null {
  if (!existsSync(SNAPSHOT_PATH)) return null;
  try {
    return (JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Partial<Snapshot>).syncedAt ?? null;
  } catch {
    return null;
  }
}

/**
 * Read athlete-logged session RPE. This file is written by `pnpm rpe` and is
 * never touched by the sync, so hand-entered values survive every run.
 */
function readSessionRpe(): SessionRpeEntry[] {
  const path = dataPath('sessions.json');
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<SessionsData>;
    return Array.isArray(raw.sessions) ? raw.sessions : [];
  } catch {
    console.error('[sync] sessions.json is unreadable — continuing without session RPE');
    return [];
  }
}

/**
 * Append-only FTP log.
 *
 * A new row is written only when the watt value actually changes, so the file
 * records the shape of the athlete's progress rather than one row per sync.
 * Kept out of the snapshot because the snapshot is rebuilt from scratch every
 * run and would lose the history.
 */
function appendFtpHistory(profile: CyclingProfile, now: Date): FtpEntry[] {
  const path = dataPath('ftp-history.json');
  let history: FtpEntry[] = [];
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { entries?: FtpEntry[] };
      if (Array.isArray(raw.entries)) history = raw.entries;
    } catch {
      console.error('[cycling] ftp-history.json is unreadable — starting a new log');
    }
  }

  const last = history[history.length - 1];
  if (!last || last.watts !== profile.ftpWatts) {
    history = [
      ...history,
      {
        date: now.toISOString().slice(0, 10),
        watts: profile.ftpWatts,
        source: profile.ftpSource,
        wattsPerKg: wattsPerKg(profile.ftpWatts, profile.weightKg),
      },
    ];
    writeJsonAtomic(path, { entries: history });
  }

  return history;
}

/**
 * Per-second stream analysis, budgeted and cached.
 *
 * Streams are the only endpoint that costs one request per activity, so this
 * is deliberately conservative: it derives each ride's metrics once, stores
 * only the derived numbers (never the raw series, which run to ~11k samples
 * for a three-hour ride), and never looks at that activity again. A run that
 * hits the budget simply picks up where it left off on the next sync.
 *
 * Only rides with a real power meter are fetched. Decoupling is a power:heart
 * -rate ratio, and outdoor rides here have no power, so fetching them would
 * spend rate limit on activities that cannot produce the metric.
 */
async function analyseRideStreams(
  activities: StravaActivity[],
  accessToken: string | null,
  now: Date,
): Promise<RideStreamMetrics[]> {
  const path = dataPath('ride-streams.json');
  let cache: RideStreamMetrics[] = [];
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { rides?: RideStreamMetrics[] };
      if (Array.isArray(raw.rides)) cache = raw.rides;
    } catch {
      console.error('[cycling] ride-streams.json is unreadable — rebuilding');
    }
  }

  if (!accessToken || RECOMPUTE) return cache;

  const known = new Set(cache.map((r) => r.activityId));
  const cutoff = new Date(now.getTime() - 90 * DAY_MS);

  const eligible = activities.filter(
    (a) =>
      isRide(a.sport_type) &&
      !isCommute(a) &&
      hasRealPower(a) &&
      (a.moving_time ?? 0) >= 20 * 60 &&
      new Date(a.start_date) >= cutoff &&
      !known.has(a.id),
  );

  if (!eligible.length) return cache;

  // Strava allows 100 requests per 15 minutes. The daily sync already spends
  // some of that on the activity list, so this leaves ample headroom and lets
  // a backlog drain across runs instead of tripping the limit once.
  const BUDGET = 25;
  const batch = eligible.slice(0, BUDGET);
  console.error(
    `[cycling] fetching streams for ${batch.length} ride(s)` +
      (eligible.length > BUDGET ? ` (${eligible.length - BUDGET} deferred to the next run)` : ''),
  );

  for (const a of batch) {
    try {
      const streams = await strava.getActivityStreams(accessToken, a.id);
      const watts = streams?.watts?.data ?? [];
      const hr = streams?.heartrate?.data ?? [];
      if (!watts.length) {
        // Record the miss so the next run does not retry an activity that has
        // no power stream to give.
        cache.push({
          activityId: a.id,
          date: a.start_date_local,
          np: null,
          decouplingPct: null,
          efFirst: null,
          efSecond: null,
          meanMaximalPower: {},
          movingTimeSeconds: a.moving_time ?? 0,
        });
        continue;
      }
      const decoupling = hr.length ? computeDecoupling(watts, hr) : null;
      cache.push({
        activityId: a.id,
        date: a.start_date_local,
        np: normalizedPowerFromStream(watts),
        decouplingPct: decoupling?.decouplingPct ?? null,
        efFirst: decoupling?.efFirst ?? null,
        efSecond: decoupling?.efSecond ?? null,
        meanMaximalPower: meanMaximalPower(watts),
        movingTimeSeconds: a.moving_time ?? 0,
      });
    } catch (err) {
      // One bad activity must not fail the whole sync; it retries next run.
      console.error(`[cycling] streams for ${a.id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  cache.sort((x, y) => x.date.localeCompare(y.date));
  writeJsonAtomic(path, { rides: cache });
  return cache;
}

/**
 * Write JSON atomically: tmp → rename.
 *
 * `pretty` defaults true so vendor data files (cycles, activities) stay
 * git-diff-readable. Set false for files the browser fetches over the wire
 * (snapshot.json) — minified is ~30–40% smaller and the JSON is opaque to
 * humans either way.
 */
function writeJsonAtomic(path: string, data: unknown, pretty = true): void {
  if (DRY_RUN) {
    console.error(`[dry-run] would write ${path}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
  renameSync(tmp, path);
}

async function syncWhoop(since: string) {
  const creds = {
    clientId: readEnv('WHOOP_CLIENT_ID'),
    clientSecret: readEnv('WHOOP_CLIENT_SECRET'),
  };
  const refreshToken = readEnv('WHOOP_REFRESH_TOKEN');

  // Whoop invalidates this token the moment it issues its replacement, so
  // check we can store the replacement while backing out is still free.
  await assertCanPersistRotation('whoop');

  console.error('[whoop] refreshing access token…');
  const tok = await whoop.refreshAccessToken(creds, refreshToken);
  maskInActionsLog(tok.accessToken);
  maskInActionsLog(tok.refreshToken);

  // Whoop rotates refresh tokens on every call. Persist the new one
  // immediately, BEFORE making any other API call — if the upcoming pulls
  // fail, at least the next run has a valid refresh token. In CI we write
  // to GitHub Secrets; locally we update .env.local. Even in DRY_RUN this
  // must happen because the Whoop API has already invalidated the old one.
  await rotateRefreshToken('whoop', 'WHOOP_REFRESH_TOKEN', refreshToken, tok.refreshToken);

  console.error('[whoop] pulling cycles, recoveries, sleeps, workouts since', since);
  const [cycles, recoveries, sleeps, workouts] = await Promise.all([
    whoop.listCycles(tok.accessToken, since),
    whoop.listRecoveries(tok.accessToken, since),
    whoop.listSleeps(tok.accessToken, since),
    whoop.listWorkouts(tok.accessToken, since),
  ]);

  return { cycles, recoveries, sleeps, workouts };
}

async function syncStrava(sinceEpoch: number) {
  const creds = {
    clientId: readEnv('STRAVA_CLIENT_ID'),
    clientSecret: readEnv('STRAVA_CLIENT_SECRET'),
  };
  const refreshToken = readEnv('STRAVA_REFRESH_TOKEN');

  await assertCanPersistRotation('strava');

  console.error('[strava] refreshing access token…');
  const tok = await strava.refreshAccessToken(creds, refreshToken);
  maskInActionsLog(tok.accessToken);
  maskInActionsLog(tok.refreshToken);

  await rotateRefreshToken('strava', 'STRAVA_REFRESH_TOKEN', refreshToken, tok.refreshToken);

  console.error('[strava] pulling activities since epoch', sinceEpoch);
  const activities = await strava.listActivities(tok.accessToken, sinceEpoch);

  // Pull athlete once per run for gear info. Cheap (one request).
  let athlete: Awaited<ReturnType<typeof strava.getAthlete>> | null = null;
  try {
    athlete = await strava.getAthlete(tok.accessToken);
  } catch (e) {
    console.error('[strava] athlete fetch failed (gear info skipped):', e instanceof Error ? e.message : 'unknown');
  }

  return { activities, athlete, accessToken: tok.accessToken };
}

function mergeById<T extends { id: string | number }>(existing: T[], incoming: T[]): T[] {
  const map = new Map<string | number, T>();
  for (const r of existing) map.set(r.id, r);
  for (const r of incoming) map.set(r.id, r);
  return Array.from(map.values());
}

/** Merge by YYYY-MM-DD `date` key — incoming wins for same-date conflicts. */
function mergeByDate<T extends { date: string }>(existing: T[], incoming: T[]): T[] {
  const map = new Map<string, T>();
  for (const r of existing) map.set(r.date, r);
  for (const r of incoming) map.set(r.date, r);
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

async function syncGarmin(sinceIso: string) {
  // Prefer the OAuth-token path — minted once via `pnpm auth garmin`, stored
  // as a single base64 GitHub Secret. Avoids SSO 429s.
  const tokenJson = process.env.GARMIN_TOKEN_JSON;
  const email = process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD;

  const auth = tokenJson
    ? { tokenJson }
    : { email: email ?? '', password: password ?? '' };

  // Defensive masking. The token-json is opaque so we mask the whole thing,
  // and the email/password pair if it's being used.
  if (tokenJson) maskInActionsLog(tokenJson);
  if (email) maskInActionsLog(email);
  if (password) maskInActionsLog(password);

  // Garmin's daily endpoint takes YYYY-MM-DD. Cap first-run to 90 days —
  // Garmin keeps far older data but pulling 5+ years day-by-day at 200ms each
  // would blow past the 10-minute Action timeout.
  const earliest = new Date(Date.now() - 90 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const since = sinceIso.slice(0, 10) < earliest ? earliest : sinceIso.slice(0, 10);

  console.error(
    `[garmin] pulling daily + HRV since ${since} (auth: ${tokenJson ? 'oauth-token' : 'password'})`,
  );
  return pullGarmin(auth, since);
}

function readArr<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T[];
  } catch {
    return [];
  }
}

async function main() {
  console.error(`health-dashboard sync v${PIPELINE_VERSION} ${DRY_RUN ? '(dry-run)' : ''}`);

  const meta = readMeta();
  const firstRun =
    meta.lastSuccessAt === '1970-01-01T00:00:00Z' || process.env.FORCE_FIRST_RUN === '1';

  // First run: pull all-time. Subsequent runs: incremental from last cursor,
  // with a 24h overlap to catch anything that was still un-scored at the time.
  // (Whoop scores recoveries asynchronously; Strava activities can be edited.)
  const since = firstRun
    ? '2010-01-01T00:00:00Z' // before Strava existed; effectively all-time
    : new Date(utcDateTime(meta.lastSuccessAt) - DAY_MS).toISOString();
  const stravaSince = Math.floor(new Date(since).getTime() / 1000);

  console.error(firstRun ? '[mode] first run — pulling all-time' : `[mode] incremental since ${since}`);

  // Vendor-optional: only sync sources whose env vars are configured. Lets you
  // bring vendors online one at a time. The other side just preserves whatever
  // data is already in private/data/ (or stays empty).
  const whoopEnabled =
    !RECOMPUTE &&
    hasAll(['WHOOP_CLIENT_ID', 'WHOOP_CLIENT_SECRET', 'WHOOP_REFRESH_TOKEN']);
  const stravaEnabled =
    !RECOMPUTE &&
    hasAll(['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'STRAVA_REFRESH_TOKEN']);
  // Garmin: either the OAuth-token secret (preferred, no SSO calls) OR
  // email+password (bootstrap / fallback path).
  const garminEnabled =
    !RECOMPUTE &&
    (!!process.env.GARMIN_TOKEN_JSON || hasAll(['GARMIN_EMAIL', 'GARMIN_PASSWORD']));

  if (RECOMPUTE) {
    console.error('[mode] recompute — rebuilding derived data from committed raw files, no network');
  } else {
    if (!whoopEnabled) console.error('[whoop] skipped — env not configured');
    if (!stravaEnabled) console.error('[strava] skipped — env not configured');
    if (!garminEnabled) console.error('[garmin] skipped — env not configured');

    if (!whoopEnabled && !stravaEnabled && !garminEnabled) {
      throw new Error(
        'no vendors configured — set at least one of WHOOP_*, STRAVA_* or GARMIN_*',
      );
    }
  }

  // Garmin uses a separate cursor — daily endpoints are stable so we resume
  // from yesterday on incremental runs instead of re-pulling 90 days. Re-pulls
  // the cursor date itself (mergeByDate dedupes) in case it was partial.
  const garminSince =
    !firstRun && meta.garminCursor
      ? new Date(utcDateTime(meta.garminCursor)).toISOString()
      : since;

  // Run the three vendor syncs in parallel. They share no state and each owns
  // its own token refresh. Garmin's promise has its own .catch — a failure in
  // the unofficial API can't take down Whoop + Strava alongside it.
  // Track per-source success so a silently-failing vendor (Garmin login
  // failure, expired Whoop token) surfaces in the UI instead of just leaving
  // gaps. Each enabled source's outcome is recorded below.
  const sourceOk: Partial<Record<SourceKey, boolean>> = {};
  const emptyWhoop: {
    cycles: WhoopCycle[];
    recoveries: WhoopRecovery[];
    sleeps: WhoopSleep[];
    workouts: WhoopWorkout[];
  } = { cycles: [], recoveries: [], sleeps: [], workouts: [] };
  const emptyStrava: {
    activities: StravaActivity[];
    athlete: Awaited<ReturnType<typeof strava.getAthlete>> | null;
    accessToken: string | null;
  } = { activities: [], athlete: null, accessToken: null };
  const emptyGarmin: {
    daily: GarminDaily[];
    hrv: GarminHrvPoint[];
    latest: GarminLatestMetrics | null;
  } = { daily: [], hrv: [], latest: null };
  const [whoopData, stravaData, garminData] = await Promise.all([
    whoopEnabled
      ? syncWhoop(since)
          .then((d) => {
            sourceOk.whoop = true;
            return d;
          })
          .catch((e: unknown) => {
            sourceOk.whoop = false;
            console.error(
              '[whoop] sync failed, continuing without it:',
              e instanceof Error ? e.message : 'unknown',
            );
            return emptyWhoop;
          })
      : Promise.resolve(emptyWhoop),
    stravaEnabled
      ? syncStrava(stravaSince)
          .then((d) => {
            sourceOk.strava = true;
            return d;
          })
          .catch((e: unknown) => {
            sourceOk.strava = false;
            console.error(
              '[strava] sync failed, continuing without it:',
              e instanceof Error ? e.message : 'unknown',
            );
            return emptyStrava;
          })
      : Promise.resolve(emptyStrava),
    garminEnabled
      ? syncGarmin(garminSince)
          .then((d) => {
            sourceOk.garmin = true;
            return d;
          })
          .catch((e: unknown) => {
            sourceOk.garmin = false;
            console.error(
              '[garmin] sync failed, continuing without it:',
              e instanceof Error ? e.message : 'unknown',
            );
            return emptyGarmin;
          })
      : Promise.resolve(emptyGarmin),
  ]);

  // Merge with existing arrays so we accumulate over time
  const recoveries = mergeById(
    readArr<{ sleep_id: string } & { id?: string | number }>(
      dataPath('whoop-recoveries.json'),
    ).map((r) => ({ ...r, id: r.sleep_id })),
    whoopData.recoveries.map((r) => ({ ...r, id: r.sleep_id })),
  );
  const sleeps = mergeById(
    readArr<{ id: string }>(dataPath('whoop-sleeps.json')),
    whoopData.sleeps,
  );
  const workouts = mergeById(
    readArr<{ id: string }>(dataPath('whoop-workouts.json')),
    whoopData.workouts,
  );
  const cycles = mergeById(
    readArr<{ id: number }>(dataPath('whoop-cycles.json')),
    whoopData.cycles,
  );
  const activities = mergeById(
    readArr<{ id: number }>(dataPath('strava-activities.json')),
    stravaData.activities,
  );
  const garminDaily = mergeByDate(
    readArr<GarminDaily>(dataPath('garmin-daily.json')),
    garminData.daily,
  );
  const garminHrv = mergeByDate(
    readArr<GarminHrvPoint>(dataPath('garmin-hrv.json')),
    garminData.hrv,
  );

  // Only rewrite files for vendors that actually ran — otherwise we'd zero-out
  // any data from a prior run that's still in the repo.
  if (whoopEnabled) {
    writeJsonAtomic(dataPath('whoop-recoveries.json'), recoveries);
    writeJsonAtomic(dataPath('whoop-sleeps.json'), sleeps);
    writeJsonAtomic(dataPath('whoop-workouts.json'), workouts);
    writeJsonAtomic(dataPath('whoop-cycles.json'), cycles);
  }
  if (stravaEnabled) {
    writeJsonAtomic(dataPath('strava-activities.json'), activities);
  }
  // Only rewrite Garmin files when we actually got data back. A failed login
  // returns 0 daily rows; without this guard we'd wipe the prior snapshot.
  if (garminEnabled && garminData.daily.length > 0) {
    writeJsonAtomic(dataPath('garmin-daily.json'), garminDaily);
    writeJsonAtomic(dataPath('garmin-hrv.json'), garminHrv);
  }
  // "Latest" metrics get their own file so they can be refreshed independently
  // of the per-day pulls. Only write when we successfully fetched something.
  if (garminEnabled && garminData.latest) {
    writeJsonAtomic(dataPath('garmin-latest.json'), garminData.latest);
  }

  // Load latest from disk on incremental runs where the current sync didn't
  // refresh it (e.g. transient training-status endpoint failure). Keeps the
  // dashboard from going blank during a flaky 24h window.
  const garminLatest: GarminLatestMetrics | null =
    garminData.latest ??
    (existsSync(dataPath('garmin-latest.json'))
      ? (JSON.parse(
          readFileSync(dataPath('garmin-latest.json'), 'utf8'),
        ) as GarminLatestMetrics)
      : null);

  // Pre-compute analytics so the React app doesn't have to.
  // Needs ≥1 Strava activity to be meaningful; otherwise the snapshot carries
  // nulls and the UI gracefully falls back to placeholders.
  const now = new Date();
  const sessionRpe = readSessionRpe();

  // Zwift and the head unit both record the same trainer session, so the raw
  // feed double-counts every indoor ride. Collapse before anything is derived —
  // load, intensity and the fitness curve all read from this array.
  const analysisActivities = dedupeIndoorRides(activities as StravaActivity[]);
  const duplicatesDropped = activities.length - analysisActivities.length;
  if (duplicatesDropped > 0) {
    console.error(`[cycling] dropped ${duplicatesDropped} duplicate indoor ride recording(s)`);
  }

  // Resting HR from the most recent Whoop recovery beats the program default,
  // and it anchors every heart-rate-derived stress score.
  const latestRhr = (recoveries as unknown as WhoopRecovery[])
    .filter((r) => r.score?.resting_heart_rate)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.score?.resting_heart_rate;

  const cyclingProfile = resolveCyclingProfile(cyclingProfileDefaults, {
    stravaFtp: stravaData.athlete?.ftp ?? null,
    restingHr: latestRhr ?? null,
  });

  const weekly =
    analysisActivities.length > 0
      ? computeWeeklyAnalytics(analysisActivities, now, {
          whoopCycles: cycles as unknown as WhoopCycle[],
          whoopWorkouts: workouts as unknown as WhoopWorkout[],
          sessionRpe,
          cyclingProfile,
        })
      : null;
  const longTerm =
    analysisActivities.length > 0 || workouts.length > 0
      ? computeLongTermAnalytics(analysisActivities, now, {
          bikes: stravaData.athlete?.bikes ?? [],
          shoes: stravaData.athlete?.shoes ?? [],
          whoopWorkouts: workouts as unknown as WhoopWorkout[],
          cyclingProfile,
        })
      : null;

  // FTP history is append-only and lives outside the snapshot so a resync never
  // rewrites the record of what FTP was on a given date.
  const ftpHistory = appendFtpHistory(cyclingProfile, now);

  const streamMetrics = await analyseRideStreams(
    analysisActivities,
    stravaData.accessToken,
    now,
  );

  const cycling =
    analysisActivities.length > 0
      ? computeCyclingAnalytics(
          analysisActivities,
          now,
          cyclingProfile,
          ftpHistory,
          longTerm?.fitnessCurve ?? [],
          streamMetrics,
        )
      : null;
  // Feed the rules engine the cross-sport load ratio, not the distance one.
  // Distance-based ACWR sees none of the lifting, yoga or field sport in this
  // program, so capping today's call off it produced false "injury risk" days.
  const primaryAcwr = weekly ? (weekly.loadAcwr ?? weekly.strainAcwr ?? weekly.acwr) : null;
  const daily =
    recoveries.length + sleeps.length + cycles.length > 0
      ? computeDailyAnalytics(
          recoveries as unknown as WhoopRecovery[],
          sleeps as unknown as WhoopSleep[],
          cycles as unknown as WhoopCycle[],
          primaryAcwr,
          now,
          analysisActivities,
          workouts as unknown as WhoopWorkout[],
        )
      : null;

  // Note: AI coach data lives in its own file (private/data/coach.json) so the
  // sync NEVER touches it. Manually-generated plans persist across sync runs.
  // See COACH.md for the manual-via-Claude.ai workflow.

  const garmin = computeGarminDailyBlock(
    garminDaily as GarminDaily[],
    garminHrv as GarminHrvPoint[],
    garminLatest,
    now,
  );

  // Per-source health. Only configured sources are recorded; unconfigured ones
  // are omitted so the UI renders nothing for them. lastSuccess advances to now
  // on success, otherwise carries forward the prior run's timestamp from meta.
  const nowIso = now.toISOString();
  const prevSources = meta.sources ?? {};
  const buildSource = (key: SourceKey): SourceHealthMap => {
    const ok = sourceOk[key] === true;
    return {
      [key]: {
        ok,
        lastSuccess: ok ? nowIso : (prevSources[key]?.lastSuccess ?? null),
      },
    };
  };
  // A recompute made no vendor calls, so it has nothing new to say about vendor
  // health — carry the previous verdicts through untouched.
  const sources: SourceHealthMap = RECOMPUTE
    ? prevSources
    : {
        ...(whoopEnabled ? buildSource('whoop') : {}),
        ...(stravaEnabled ? buildSource('strava') : {}),
        ...(garminEnabled ? buildSource('garmin') : {}),
      };

  // A recompute pulled nothing, so the DATA is exactly as old as it was — only
  // the derived view is new. Stamping `nowIso` here would make a stale snapshot
  // look freshly synced and silently defeat the AI staleness guard, which is the
  // one thing standing between a failed vendor sync and days of confident
  // analysis of old numbers.
  const prevSyncedAt = RECOMPUTE
    ? (readPrevSyncedAt() ?? meta.lastSuccessAt)
    : nowIso;

  const snapshot: Snapshot = {
    syncedAt: prevSyncedAt,
    pipelineVersion: PIPELINE_VERSION,
    counts: {
      recoveries: recoveries.length,
      sleeps: sleeps.length,
      workouts: workouts.length,
      cycles: cycles.length,
      activities: activities.length,
      garminDays: garminDaily.length,
    },
    daily,
    weekly,
    longTerm,
    cycling,
    garmin,
    sources,
  };
  // snapshot.json is the largest browser-fetched file; minify to cut wire bytes.
  writeJsonAtomic(SNAPSHOT_PATH, snapshot, false);

  // Escalation notification hook. Fires ONLY when the anomaly combination
  // escalated (see computeAnomalyEscalation). Reads its webhook URL from
  // process.env and no-ops when unset, so this is safe in every environment.
  const escalation = daily?.anomalyEscalation ?? null;
  if (escalation?.active) {
    const anomalyTitles = (daily?.anomalies ?? [])
      .filter((a) => escalation.triggeredBy.includes(a.id))
      .map((a) => a.title);
    console.error('[notify] anomaly escalation active:', escalation.reasons.join(' '));
    await notifyEscalation(escalation, { date: daily!.date, anomalyTitles });
  }

  // A recompute must not advance the cursors — it fetched nothing, and moving
  // them would make the next real sync skip the window it never pulled.
  const newMeta: SyncMeta = {
    lastSuccessAt: RECOMPUTE ? meta.lastSuccessAt : new Date().toISOString(),
    whoopCursor: RECOMPUTE ? meta.whoopCursor : whoopEnabled ? since : null,
    stravaCursor: RECOMPUTE ? meta.stravaCursor : stravaEnabled ? stravaSince : null,
    garminCursor: RECOMPUTE
      ? meta.garminCursor
      : garminEnabled && garminDaily.length > 0
        ? garminDaily[garminDaily.length - 1]!.date
        : null,
    pipelineVersion: PIPELINE_VERSION,
    sources,
  };
  writeJsonAtomic(META_PATH, newMeta);

  console.error('✓ sync complete');
  console.error(JSON.stringify(snapshot.counts, null, 2));

  // Last, so it runs only once every file is on disk: a lost refresh token must
  // fail the job, but not before the data this run did pull gets committed.
  reportTokenRotationOutcome();
}

main().catch((e: unknown) => {
  // Log the message but not the full error (which can contain headers / urls)
  console.error('sync failed:', e instanceof Error ? e.message : 'unknown error');
  process.exit(1);
});
