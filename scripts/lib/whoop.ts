/**
 * Whoop v2 API client.
 *
 * Security notes:
 *  - Access tokens are held in memory only. Never logged. Never written to disk.
 *  - Refresh tokens rotate on each refresh — the orchestrator is responsible for
 *    writing the new refresh token back to GitHub Secrets via tokens.ts.
 *  - All requests over HTTPS. We do not follow redirects manually so we can't be
 *    tricked into leaking Authorization headers to an attacker-controlled host.
 *  - Errors include status codes but never request body or token material.
 */

const WHOOP_BASE = 'https://api.prod.whoop.com';
const WHOOP_API = `${WHOOP_BASE}/developer`;
const WHOOP_AUTHZ_URL = `${WHOOP_BASE}/oauth/oauth2/auth`;
const WHOOP_TOKEN_URL = `${WHOOP_BASE}/oauth/oauth2/token`;

// `offline` is required for Whoop to issue a refresh token alongside the
// access token. Without it the access token still works for ~1 hour but the
// flow can't be refreshed silently — which breaks the daily cron.
export const WHOOP_SCOPES = [
  'offline',
  'read:profile',
  'read:body_measurement',
  'read:cycles',
  'read:recovery',
  'read:sleep',
  'read:workout',
] as const;

export interface WhoopTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'bearer';
  scope: string;
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

/** Exchange a refresh token for a fresh access + refresh pair. */
export async function refreshAccessToken(
  creds: ClientCreds,
  refreshToken: string,
): Promise<RefreshResult> {
  // Whoop rejects refresh requests that include a `scope` parameter (HTTP 400)
  // even when the requested scopes match the original grant. Per RFC 6749 §6
  // scope is optional on refresh, so we omit it entirely — the refresh token
  // carries its original scope set internally.
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });

  const res = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
    redirect: 'error',
  });

  if (!res.ok) {
    // Don't echo the response body — it may include error_description with hints
    throw new Error(`whoop token refresh failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as WhoopTokens;
  if (!data.access_token || !data.refresh_token) {
    throw new Error('whoop token refresh: missing tokens in response');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/** Exchange an authorization code (with PKCE verifier) for an initial token pair. */
export async function exchangeAuthCode(
  creds: ClientCreds,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<RefreshResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code_verifier: codeVerifier,
  });

  const res = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
    redirect: 'error',
  });

  if (!res.ok) {
    throw new Error(`whoop auth code exchange failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as WhoopTokens;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: WHOOP_SCOPES.join(' '),
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${WHOOP_AUTHZ_URL}?${params}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// REST calls
// ─────────────────────────────────────────────────────────────────────────────

async function whoopGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${WHOOP_API}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    redirect: 'error',
  });
  if (!res.ok) {
    throw new Error(`whoop ${path}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

interface Paginated<T> {
  records: T[];
  next_token: string | null;
}

/** Pull a paginated collection from Whoop, stopping at `since`. */
async function paginate<T extends { start?: string; created_at?: string }>(
  accessToken: string,
  path: string,
  opts: { since?: string; limit?: number } = {},
): Promise<T[]> {
  const limit = opts.limit ?? 25;
  const out: T[] = [];
  let nextToken: string | null = null;

  do {
    const params = new URLSearchParams({ limit: String(limit) });
    if (opts.since) params.set('start', opts.since);
    if (nextToken) params.set('nextToken', nextToken);

    const page = await whoopGet<Paginated<T>>(accessToken, `${path}?${params}`);
    out.push(...page.records);
    nextToken = page.next_token;
  } while (nextToken);

  return out;
}

export async function listCycles(accessToken: string, since?: string) {
  return paginate<import('./types.js').WhoopCycle>(accessToken, '/v2/cycle', { since });
}
export async function listRecoveries(accessToken: string, since?: string) {
  return paginate<import('./types.js').WhoopRecovery>(accessToken, '/v2/recovery', { since });
}
export async function listSleeps(accessToken: string, since?: string) {
  return paginate<import('./types.js').WhoopSleep>(accessToken, '/v2/activity/sleep', { since });
}
export async function listWorkouts(accessToken: string, since?: string) {
  return paginate<import('./types.js').WhoopWorkout>(accessToken, '/v2/activity/workout', {
    since,
  });
}
