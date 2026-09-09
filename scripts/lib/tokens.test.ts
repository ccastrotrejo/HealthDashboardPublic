/**
 * Refresh tokens rotate on every vendor refresh: once `putSecret` is reached,
 * the OLD token is already dead and the NEW one exists only in this process's
 * memory. On 2026-08-17 a single GitHub 503 dropped it and Whoop sync stayed
 * broken until a manual re-auth. These tests hold the retry path in place.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nacl from 'tweetnacl-sealedbox-js';

import { putSecret, preflightSecretWrites, resetSecretWriteCache } from './tokens.js';

// A syntactically valid X25519 public key — sealedbox.seal rejects anything
// that isn't exactly 32 bytes, and we never touch the network for real.
const FAKE_PUBLIC_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');

function publicKeyResponse(): Response {
  return new Response(JSON.stringify({ key_id: 'kid', key: FAKE_PUBLIC_KEY }), { status: 200 });
}

/** Drive the fake clock far enough past the 1s/2s/4s/8s backoff ladder. */
async function settle<T>(p: Promise<T>): Promise<T> {
  // Attach handlers synchronously: advancing timers lets the rejection land
  // first, and an unattached rejection is reported as an unhandled error.
  const outcome = p.then(
    (value) => () => value,
    (error: unknown) => () => {
      throw error;
    },
  );
  await vi.advanceTimersByTimeAsync(60_000);
  return (await outcome)();
}

describe('putSecret', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSecretWriteCache();
    vi.stubEnv('GH_OWNER', 'owner');
    vi.stubEnv('GH_REPO', 'repo');
    vi.stubEnv('GH_PAT', 'pat');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Guard: seal must never see a short key and silently pass.
    expect(() => nacl.seal(new Uint8Array([1]), new Uint8Array(32))).not.toThrow();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries a transient 503 on the write and eventually succeeds', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(publicKeyResponse())
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(settle(putSecret('WHOOP_REFRESH_TOKEN', 'rotated-token'))).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a transient 503 on the public-key fetch', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(publicKeyResponse())
      .mockResolvedValueOnce(new Response('', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(settle(putSecret('WHOOP_REFRESH_TOKEN', 'rotated-token'))).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a network-level failure', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(publicKeyResponse())
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(settle(putSecret('WHOOP_REFRESH_TOKEN', 'rotated-token'))).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 403 — a bad PAT is not transient', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(publicKeyResponse())
      .mockResolvedValue(new Response('', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(settle(putSecret('WHOOP_REFRESH_TOKEN', 'rotated-token'))).rejects.toThrow(
      /HTTP 403/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt budget and reports only the status', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(publicKeyResponse())
      .mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const err = await settle(putSecret('WHOOP_REFRESH_TOKEN', 'rotated-token')).then(
      () => new Error('expected putSecret to reject'),
      (e: unknown) => e as Error,
    );
    expect(err.message).toMatch(/HTTP 503/);
    expect(err.message).not.toContain('rotated-token');
    expect(err.message).not.toContain('pat');
    // 1 public-key call + 5 write attempts
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('refuses to write an empty value', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await expect(putSecret('WHOOP_REFRESH_TOKEN', '')).rejects.toThrow(/empty value/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('preflightSecretWrites', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSecretWriteCache();
    vi.stubEnv('GH_OWNER', 'owner');
    vi.stubEnv('GH_REPO', 'repo');
    vi.stubEnv('GH_PAT', 'pat');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects when the Secrets API is down, so the caller can skip the vendor', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(settle(preflightSecretWrites())).rejects.toThrow(/HTTP 503/);
  });

  it('rejects on an expired PAT without retrying', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(settle(preflightSecretWrites())).rejects.toThrow(/HTTP 401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects when GH_PAT is missing rather than assuming the write will work', async () => {
    vi.stubEnv('GH_PAT', '');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await expect(preflightSecretWrites()).rejects.toThrow(/GH_PAT/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not cache a failure — a later attempt gets a fresh request', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(publicKeyResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(settle(preflightSecretWrites())).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetches the key once and reuses it for the write', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(publicKeyResponse())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await settle(preflightSecretWrites());
    await expect(settle(putSecret('WHOOP_REFRESH_TOKEN', 'rotated-token'))).resolves.toBeUndefined();
    // One public-key fetch total, not one per call.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one request between the two vendors running in parallel', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(publicKeyResponse());
    vi.stubGlobal('fetch', fetchMock);

    await settle(Promise.all([preflightSecretWrites(), preflightSecretWrites()]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('GH_PAT expiry warning', () => {
  const EXPIRY_HEADER = 'github-authentication-token-expiration';

  function keyResponseExpiringIn(days: number): Response {
    const at = new Date(Date.now() + days * 86_400_000);
    // GitHub's format: "2026-11-24 17:39:48 UTC"
    const formatted = at.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
    return new Response(JSON.stringify({ key_id: 'kid', key: FAKE_PUBLIC_KEY }), {
      status: 200,
      headers: { [EXPIRY_HEADER]: formatted },
    });
  }

  let logged: string[];

  beforeEach(() => {
    resetSecretWriteCache();
    logged = [];
    vi.stubEnv('GH_OWNER', 'owner');
    vi.stubEnv('GH_REPO', 'repo');
    vi.stubEnv('GH_PAT', 'pat');
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('warns when the PAT expires inside the window', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(keyResponseExpiringIn(5)));

    await preflightSecretWrites();

    const warning = logged.find((l) => l.includes('GH_PAT expiring'));
    expect(warning).toBeDefined();
    expect(warning).toContain('::warning');
    expect(warning).not.toContain('pat');
  });

  it('stays quiet when the PAT has plenty of life left', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(keyResponseExpiringIn(60)));

    await preflightSecretWrites();

    expect(logged.some((l) => l.includes('GH_PAT expiring'))).toBe(false);
  });

  it('ignores a missing or unparseable expiry header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ key_id: 'kid', key: FAKE_PUBLIC_KEY }), {
          status: 200,
          headers: { [EXPIRY_HEADER]: 'not a date' },
        }),
      ),
    );

    await expect(preflightSecretWrites()).resolves.toBeUndefined();
    expect(logged.some((l) => l.includes('GH_PAT expiring'))).toBe(false);
  });
});
