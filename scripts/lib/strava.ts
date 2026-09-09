/**
 * Strava v3 API client.
 *
 * Security notes:
 *  - Refresh tokens DO NOT rotate on Strava (unlike Whoop), so the write-back
 *    path is only exercised on the rare occasion Strava issues a new one.
 *  - Access tokens last 6 hours and live in memory only.
 *  - We never request `activity:write` or `profile:write` scopes — read only.
 *  - Errors do not echo token material.
 *  - Strava's rate limit: 100 non-upload requests / 15 minutes, 1000 / day.
 *    The pipeline implements exponential backoff on 429.
 */

const STRAVA_BASE = 'https://www.strava.com';
const STRAVA_API = `${STRAVA_BASE}/api/v3`;
const STRAVA_AUTHZ_URL = `${STRAVA_BASE}/oauth/authorize`;
const STRAVA_TOKEN_URL = `${STRAVA_BASE}/oauth/token`;

export const STRAVA_SCOPES = ['read', 'activity:read_all', 'profile:read_all'] as const;

interface StravaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  token_type: 'Bearer';
}

interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

interface ClientCreds {
  clientId: string;
  clientSecret: string;
}

export async function refreshAccessToken(
  creds: ClientCreds,
  refreshToken: string,
): Promise<RefreshResult> {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
    redirect: 'error',
  });

  if (!res.ok) {
    throw new Error(`strava token refresh failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as StravaTokens;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at * 1000,
  };
}

export async function exchangeAuthCode(
  creds: ClientCreds,
  code: string,
): Promise<RefreshResult> {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code,
    grant_type: 'authorization_code',
  });

  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
    redirect: 'error',
  });

  if (!res.ok) {
    throw new Error(`strava auth code exchange failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as StravaTokens;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at * 1000,
  };
}

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: 'code',
    redirect_uri: opts.redirectUri,
    approval_prompt: 'force', // ensure we re-prompt for scopes
    scope: STRAVA_SCOPES.join(','),
    state: opts.state,
  });
  return `${STRAVA_AUTHZ_URL}?${params}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// REST calls with rate-limit-aware retry
// ─────────────────────────────────────────────────────────────────────────────

async function stravaGet<T>(accessToken: string, path: string, attempt = 0): Promise<T> {
  const res = await fetch(`${STRAVA_API}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    redirect: 'error',
  });

  if (res.status === 429) {
    if (attempt >= 3) throw new Error(`strava ${path}: rate limited after 3 retries`);
    // Strava resets on natural quarter-hours. Wait until the next boundary.
    const now = new Date();
    const waitMs = (15 - (now.getUTCMinutes() % 15)) * 60_000 - now.getUTCSeconds() * 1000 + 1000;
    console.error(`[strava] rate limited, waiting ${Math.round(waitMs / 1000)}s`);
    await new Promise((r) => setTimeout(r, waitMs));
    return stravaGet<T>(accessToken, path, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`strava ${path}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function listActivities(
  accessToken: string,
  since?: number, // unix seconds
  perPage = 100,
): Promise<import('./types.js').StravaActivity[]> {
  const out: import('./types.js').StravaActivity[] = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({ per_page: String(perPage), page: String(page) });
    if (since) params.set('after', String(since));
    const batch = await stravaGet<import('./types.js').StravaActivity[]>(
      accessToken,
      `/athlete/activities?${params}`,
    );
    if (batch.length === 0) break;
    out.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }
  return out;
}

export async function getAthlete(accessToken: string) {
  return stravaGet<{
    id: number;
    firstname: string;
    lastname: string;
    ftp?: number;
    bikes?: import('./types.js').StravaGearSummary[];
    shoes?: import('./types.js').StravaGearSummary[];
  }>(accessToken, '/athlete');
}

/**
 * Per-second streams for one activity.
 *
 * This is the only endpoint in the pipeline that costs a request *per
 * activity*, so callers must budget it — see `RideStreamCache` in sync.ts,
 * which derives its metrics once and never re-fetches an activity.
 *
 * Returns null on 404: activities recorded without a power meter simply have
 * no `watts` stream, and Strava answers that with a 404 rather than an empty
 * series. That is an expected outcome here, not an error.
 */
export async function getActivityStreams(
  accessToken: string,
  activityId: number,
  keys: string[] = ['time', 'watts', 'heartrate'],
): Promise<Record<string, { data: number[] }> | null> {
  const params = new URLSearchParams({ keys: keys.join(','), key_by_type: 'true' });
  try {
    return await stravaGet<Record<string, { data: number[] }>>(
      accessToken,
      `/activities/${activityId}/streams?${params}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('HTTP 404')) return null;
    throw err;
  }
}
