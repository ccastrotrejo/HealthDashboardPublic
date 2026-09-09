#!/usr/bin/env tsx
/**
 * One-time local OAuth helper.
 *
 *  $ pnpm auth whoop    # walks Whoop's PKCE flow, saves refresh token
 *  $ pnpm auth strava   # walks Strava's flow, saves refresh token
 *
 * What it does, security-wise:
 *  - Spins up a localhost HTTP server on 127.0.0.1:8765 (loopback only)
 *  - Generates a cryptographically random `state` (CSRF protection)
 *  - For Whoop, generates a PKCE code_verifier + S256 code_challenge
 *  - Opens your browser to the vendor's authorize URL
 *  - Receives the callback, validates state, exchanges the code for tokens
 *  - Writes the resulting token directly to .env.local with mode 0600.
 *  - Preserves existing credentials for other providers.
 *
 * What it deliberately does NOT do:
 *  - It does NOT print the refresh token to stdout (logs / CI / terminal scrollback).
 *  - It does NOT keep the token in your shell history.
 *  - It does NOT call GitHub's secrets API automatically — you do that step
 *    by hand for the initial provisioning, so you can SEE what's being stored.
 */

import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { exec } from 'node:child_process';
import { assertLocalEnvWritable, updateEnvLocal } from './lib/local-env.js';

import * as whoop from './lib/whoop.js';
import * as strava from './lib/strava.js';
import garminConnectModule from 'garmin-connect';

const { GarminConnect } = garminConnectModule;

const PORT = 8765;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

type Vendor = 'whoop' | 'strava' | 'garmin';

async function main() {
  const vendor = process.argv[2] as Vendor | undefined;
  if (vendor !== 'whoop' && vendor !== 'strava' && vendor !== 'garmin') {
    console.error('usage: pnpm auth whoop | strava | garmin');
    process.exit(2);
  }

  if (process.env.GITHUB_ACTIONS) {
    throw new Error('Account authorization must run locally, not in GitHub Actions');
  }
  assertLocalEnvWritable();

  // Garmin uses a completely different auth shape — username+password SSO
  // → OAuth1/OAuth2 tokens. No browser callback needed. Handle separately so
  // the OAuth helper paths below don't get warped to fit two flows.
  if (vendor === 'garmin') {
    await garminExport();
    return;
  }

  const env = readEnv(vendor);

  const state = randomBytes(32).toString('base64url');
  let codeVerifier: string | null = null;
  let authorizeUrl: string;

  if (vendor === 'whoop') {
    codeVerifier = randomBytes(64).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    authorizeUrl = whoop.buildAuthorizeUrl({
      clientId: env.clientId,
      redirectUri: REDIRECT_URI,
      state,
      codeChallenge,
    });
  } else {
    authorizeUrl = strava.buildAuthorizeUrl({
      clientId: env.clientId,
      redirectUri: REDIRECT_URI,
      state,
    });
  }

  // Loopback server — bound to 127.0.0.1 only, NOT 0.0.0.0
  await new Promise<void>((resolveTok, rejectTok) => {
    const server = createServer(async (req, res) => {
      try {
        if (!req.url) {
          res.statusCode = 400;
          res.end('bad request');
          return;
        }
        const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
        if (u.pathname !== '/callback') {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        const returnedState = u.searchParams.get('state');
        const code = u.searchParams.get('code');
        const error = u.searchParams.get('error');
        if (error) throw new Error('Vendor declined authorization');
        if (returnedState !== state) throw new Error('state mismatch — possible CSRF');
        if (!code) throw new Error('no code in callback');

        const tokens =
          vendor === 'whoop'
            ? await whoop.exchangeAuthCode(
                { clientId: env.clientId, clientSecret: env.clientSecret },
                code,
                REDIRECT_URI,
                codeVerifier!,
              )
            : await strava.exchangeAuthCode(
                { clientId: env.clientId, clientSecret: env.clientSecret },
                code,
              );

        if (!tokens.refreshToken) {
          throw new Error(
            'no refresh_token in token response — vendor probably needs the ' +
              '"offline" scope. Re-register the app with that scope or check ' +
              'scripts/lib/' + vendor + '.ts WHOOP_SCOPES/STRAVA_SCOPES.',
          );
        }

        updateEnvLocal(`${vendor.toUpperCase()}_REFRESH_TOKEN`, tokens.refreshToken);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(
          `<!doctype html><meta charset=utf-8><title>OK</title>
          <body style="font-family:system-ui;padding:48px;max-width:680px;line-height:1.5">
          <h1>${vendor} connected</h1>
          <p>Credentials saved to <code>.env.local</code> with file mode 600.</p>
          <p>Run <code>pnpm sync</code> to fetch your data. You can close this tab.</p></body>`,
        );
        server.close();
        resolveTok();
      } catch (e) {
        res.statusCode = 400;
        res.end('auth failed — see terminal');
        server.close();
        rejectTok(e);
      }
    });

    server.listen(PORT, '127.0.0.1', () => {
      console.error(`listening on ${REDIRECT_URI}`);
      console.error(`opening browser to ${vendor} authorize URL…`);
      openBrowser(authorizeUrl);
    });

    server.on('error', rejectTok);
  });

  console.error(`\n✓ ${vendor} connected. Credentials saved to .env.local (mode 600).`);
  console.error('  Run pnpm sync to fetch your data.');
}

function readEnv(vendor: 'whoop' | 'strava'): { clientId: string; clientSecret: string } {
  const id = process.env[`${vendor.toUpperCase()}_CLIENT_ID`];
  const secret = process.env[`${vendor.toUpperCase()}_CLIENT_SECRET`];
  if (!id || !secret) {
    console.error(`Missing ${vendor.toUpperCase()}_CLIENT_ID or _SECRET in env.`);
    console.error(`Set them in .env.local then re-run: pnpm auth ${vendor}`);
    process.exit(2);
  }
  return { clientId: id, clientSecret: secret };
}

/**
 * One-time Garmin login → OAuth1+OAuth2 tokens → .env.local.
 *
 * Why this path exists:
 *  - Garmin's SSO is anti-bot-heavy and 429s when called repeatedly from
 *    cloud IPs (GitHub Actions, Vercel functions, etc).
 *  - The `garmin-connect` library mints OAuth1 + OAuth2 tokens once and can
 *    reuse them on subsequent runs via `loadToken()` — no SSO call needed.
 *  - OAuth1 lasts ~1 year, OAuth2 refreshes hourly from OAuth1 in-memory.
 *  - We bundle both into a single JSON, base64-encode, and store as the
 *    `GARMIN_TOKEN_JSON` secret. CI loads + uses; no password sees the wire
 *    after this one-time bootstrap.
 *
 * Run this locally (NOT in CI) when:
 *  - First-time Garmin setup
 *  - The annual OAuth1 expiry rolls around (cron starts failing with 401)
 *  - You've rotated your Garmin password
 */
async function garminExport() {
  const email = process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD;
  if (!email || !password) {
    console.error('Missing GARMIN_EMAIL or GARMIN_PASSWORD in env.');
    console.error('Set them in .env.local then re-run with:');
    console.error('  pnpm auth garmin');
    process.exit(2);
  }

  const gc = new GarminConnect({ username: email, password });
  try {
    console.error('[garmin] logging in (one-time SSO)…');
    await gc.login();
  } catch (e) {
    console.error('Garmin login failed. Check your credentials and account settings.');
    if (e instanceof Error && e.message.includes('429')) {
      console.error(
        '\n→ Garmin is currently rate-limiting your account from this IP.\n' +
          '  This usually means too many login attempts in a short window.\n' +
          '  Wait 2–6 hours (or 24h to be safe) and try again. Once you have the\n' +
          '  token JSON it will not happen again.',
      );
    }
    process.exit(1);
  }

  const tokens = gc.exportToken();
  if (!tokens.oauth1 || !tokens.oauth2) {
    throw new Error('garmin login returned, but exportToken() produced no oauth1/oauth2');
  }

  // Base64(JSON) so the user can paste it into a GitHub Secret as a single
  // opaque value. (Multi-line secrets work but make copy-paste error-prone.)
  const encoded = Buffer.from(JSON.stringify(tokens), 'utf8').toString('base64');

  updateEnvLocal('GARMIN_TOKEN_JSON', encoded);

  console.error('\n✓ Garmin connected. Credentials saved to .env.local (mode 600).');
  console.error('  Run pnpm sync to fetch your data.');
  console.error(
    '\n  You can now clear GARMIN_EMAIL and GARMIN_PASSWORD from .env.local;\n' +
      '  sync reuses GARMIN_TOKEN_JSON instead.\n',
  );
}

function openBrowser(url: string) {
  const cmd =
    process.platform === 'darwin'
      ? `open '${url.replace(/'/g, "'\\''")}'`
      : process.platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open '${url.replace(/'/g, "'\\''")}'`;
  exec(cmd, () => undefined);
}

main().catch(() => {
  console.error('Authorization failed. Check provider settings and that .env.local is valid and writable, then retry.');
  process.exit(1);
});
