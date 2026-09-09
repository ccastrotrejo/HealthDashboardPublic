/**
 * Write rotating refresh tokens back to GitHub Actions Secrets via the REST API.
 *
 * Security notes:
 *  - Uses libsodium sealed-box encryption (NaCl) — GitHub's required scheme.
 *  - The fine-grained PAT used (GH_PAT secret) MUST be scoped to this repo only,
 *    with `Actions: read/write` permission. Nothing else.
 *  - The PAT is non-expiring by choice (see MAINTENANCE.md); revoke by hand if
 *    exposure is suspected. If it is ever given an expiry, this module warns
 *    for its last 14 days and the preflight makes a lapse non-destructive.
 *  - If the PAT is missing, we log a clear error and exit non-zero so the
 *    next sync inherits a known-bad token rather than silently using a stale one.
 *  - We NEVER print the secret value or the encryption nonce. Errors include
 *    only status codes.
 */

// Sealed-box encryption for the GitHub Actions Secrets REST API.
//
// GitHub requires the libsodium "sealed box" format: ephemeral X25519 keypair
// + crypto_box(message, nonce, recipient_pk, ephemeral_sk) where the nonce is
// derived from blake2b(ephemeral_pk || recipient_pk).
//
// We previously tried `libsodium-wrappers` 0.7.16 — its ESM build is broken
// (the .mjs entry imports a sibling file that isn't actually packaged) and
// no amount of lazy-loading worked around it in tsx + Node 20. The pure-JS
// `tweetnacl-sealedbox-js` library is ~5 KB, pure CommonJS+ESM compatible,
// and exactly implements what GitHub asks for. No async ready-step.
import sealedbox from 'tweetnacl-sealedbox-js';
import { DAY_MS } from '../../utils/date.js';

// Transient GitHub API failures. A rotated refresh token exists in exactly one
// place — this process's memory — and the vendor has already invalidated the
// previous one, so a single 503 here permanently bricks the vendor until the
// OAuth flow is re-run by hand. Retry hard before giving up.
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;

/** 1s, 2s, 4s, 8s, plus jitter so parallel vendor rotations don't retry in lockstep. */
function backoffMs(attempt: number): number {
  return 2 ** (attempt - 1) * 1000 + Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * `fetch` with bounded exponential backoff on transient failures.
 *
 * Only retries 5xx/408/429 and network-level errors — a 401/403/404 means the
 * PAT is wrong or expired, and retrying that just delays the real error. Never
 * logs the error object or URL, which carry the Authorization header context.
 */
async function fetchWithRetry(label: string, url: string, init: RequestInit): Promise<Response> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`tokens: ${label} network error after ${MAX_ATTEMPTS} attempts`);
      }
      console.error(`tokens: ${label} network error — retry ${attempt}/${MAX_ATTEMPTS - 1}`);
      await sleep(backoffMs(attempt));
      continue;
    }

    if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) return res;

    lastStatus = res.status;
    // Release the socket: we're discarding this response body.
    await res.body?.cancel().catch(() => {});
    console.error(
      `tokens: ${label} HTTP ${lastStatus} — retry ${attempt}/${MAX_ATTEMPTS - 1}`,
    );
    await sleep(backoffMs(attempt));
  }
  throw new Error(`tokens: ${label} exhausted retries (last HTTP ${lastStatus})`);
}

interface RepoCoords {
  owner: string;
  repo: string;
  pat: string;
}

interface PublicKey {
  key_id: string;
  key: string;
}

function getRepoCoordsOrThrow(): RepoCoords {
  // In CI, GITHUB_REPOSITORY is "owner/repo"
  const repoEnv = process.env.GITHUB_REPOSITORY;
  let owner = process.env.GH_OWNER ?? '';
  let repo = process.env.GH_REPO ?? '';
  if (repoEnv && (!owner || !repo)) {
    const [o, r] = repoEnv.split('/');
    owner = owner || o || '';
    repo = repo || r || '';
  }
  const pat = process.env.GH_PAT ?? '';
  if (!owner || !repo || !pat) {
    throw new Error(
      'tokens: GH_OWNER, GH_REPO, GH_PAT all required for write-back. Missing one of them.',
    );
  }
  return { owner, repo, pat };
}

async function getPublicKey(coords: RepoCoords): Promise<PublicKey> {
  const { owner, repo, pat } = coords;
  const res = await fetchWithRetry(
    'get public-key',
    `https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`,
    {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'error',
    },
  );
  if (!res.ok) {
    throw new Error(`tokens: get public-key failed HTTP ${res.status}`);
  }
  warnIfPatExpiringSoon(res);
  return (await res.json()) as PublicKey;
}

/** Warn this many days before the PAT dies. Long enough to act on a weekend. */
const PAT_EXPIRY_WARNING_DAYS = 14;

/**
 * Nag while there's still time to rotate the PAT.
 *
 * An expired GH_PAT is the scheduled version of the same outage: the write-back
 * starts failing, and without this the first symptom is a vendor going dark.
 * GitHub returns the expiry on every authenticated request, so reading it here
 * is free. Only the date is logged — never the PAT.
 */
function warnIfPatExpiringSoon(res: Response): void {
  const raw = res.headers.get('github-authentication-token-expiration');
  if (!raw) return; // PAT has no expiry, or GitHub stopped sending the header
  // Format is "2026-11-24 17:39:48 UTC", which Date can't parse reliably.
  const expiresAt = new Date(raw.replace(' UTC', 'Z').replace(' ', 'T'));
  if (Number.isNaN(expiresAt.getTime())) return;

  const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / DAY_MS);
  if (daysLeft > PAT_EXPIRY_WARNING_DAYS) return;

  const when = expiresAt.toISOString().slice(0, 10);
  console.error(
    `::warning title=GH_PAT expiring::The token used to write rotated refresh ` +
      `tokens expires in ${daysLeft} day(s), on ${when}. Once it lapses, vendor ` +
      `syncs stop rather than rotate. Generate a new fine-grained PAT and update ` +
      `the GH_PAT secret.`,
  );
}

/**
 * Public key from the preflight, reused by `putSecret`.
 *
 * Held as the in-flight promise rather than the resolved value so the two
 * vendor syncs — which run in parallel — share one request instead of racing
 * two, and so the second caller inherits the first one's retries.
 */
let publicKeyOnce: Promise<PublicKey> | null = null;

/** Fetch-once wrapper. A rejection is never cached — the next caller retries. */
function getPublicKeyOnce(coords: RepoCoords): Promise<PublicKey> {
  publicKeyOnce ??= getPublicKey(coords).catch((e: unknown) => {
    publicKeyOnce = null;
    throw e;
  });
  return publicKeyOnce;
}

/**
 * Prove the Secrets API is reachable and usable BEFORE the caller spends a
 * single-use refresh token.
 *
 * This ordering is the actual fix. A vendor refresh kills the old token the
 * instant it mints the new one, so any failure discovered *after* that point
 * destroys the credential: there is nowhere left to put the replacement and no
 * way back to the original. Checking first inverts the cost — a GitHub outage,
 * an expired PAT, or a revoked repo permission becomes one skipped sync with
 * the existing token still valid, and the next run recovers on its own.
 *
 * Fetching the public key is the natural probe: same host, same PAT, same
 * `Actions: read/write` permission the write needs, and its result is exactly
 * what the write requires next — so the check costs no extra round trip.
 * Throws with a status code on failure. Never logs key material.
 */
export async function preflightSecretWrites(): Promise<void> {
  await getPublicKeyOnce(getRepoCoordsOrThrow());
}

/** Test seam: drop the cached public key between cases. */
export function resetSecretWriteCache(): void {
  publicKeyOnce = null;
}

function encryptForGitHub(publicKeyBase64: string, value: string): string {
  // GitHub returns the public key as standard base64
  const publicKey = new Uint8Array(Buffer.from(publicKeyBase64, 'base64'));
  // Plaintext as UTF-8 bytes
  const messageBytes = new TextEncoder().encode(value);
  // Sealed box: ephemeral X25519 + crypto_box, returns ephemeral_pk || ciphertext
  const sealed = sealedbox.seal(messageBytes, publicKey);
  // GitHub wants standard base64 back
  return Buffer.from(sealed).toString('base64');
}

/**
 * Write a secret value to GitHub Actions Secrets, creating or updating in place.
 * Returns nothing on success; throws with status code on failure.
 */
export async function putSecret(name: string, value: string): Promise<void> {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    throw new Error(`tokens: secret name '${name}' is invalid (must be UPPER_SNAKE)`);
  }
  if (!value) {
    throw new Error(`tokens: refusing to write empty value to secret '${name}'`);
  }
  const coords = getRepoCoordsOrThrow();
  // Reuses the key the preflight already fetched, so the write is a single
  // request against an API we've just seen answer correctly.
  const publicKey = await getPublicKeyOnce(coords);
  const encrypted = encryptForGitHub(publicKey.key, value);

  const res = await fetchWithRetry(
    `put secret '${name}'`,
    `https://api.github.com/repos/${coords.owner}/${coords.repo}/actions/secrets/${name}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${coords.pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        encrypted_value: encrypted,
        key_id: publicKey.key_id,
      }),
      redirect: 'error',
    },
  );

  if (res.status !== 201 && res.status !== 204) {
    throw new Error(`tokens: put secret '${name}' failed HTTP ${res.status}`);
  }
}

/**
 * Mask a value so it never appears in GitHub Actions logs.
 * Call this on any access/refresh token immediately after you receive it.
 */
export function maskInActionsLog(value: string): void {
  if (!process.env.GITHUB_ACTIONS) return;
  if (!value) return;
  // GitHub Actions reads ::add-mask:: from stdout and redacts the value
  // from all subsequent log lines in the same job.
  // eslint-disable-next-line no-console
  console.log(`::add-mask::${value}`);
}
