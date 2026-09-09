import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callback: undefined as ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | undefined,
  server: {
    listen: vi.fn((_port: number, _host: string, ready: () => void) => ready()),
    close: vi.fn(),
    on: vi.fn(),
  },
  browser: vi.fn(),
  preflight: vi.fn(),
  persist: vi.fn(),
  whoopAuthorize: vi.fn(() => 'https://example.invalid/whoop'),
  stravaAuthorize: vi.fn(() => 'https://example.invalid/strava'),
  whoopExchange: vi.fn(),
  stravaExchange: vi.fn(),
  garminLogin: vi.fn(),
  garminTokens: vi.fn(),
}));

vi.mock('node:http', () => ({
  createServer: (callback: typeof mocks.callback) => {
    mocks.callback = callback;
    return mocks.server;
  },
}));
vi.mock('node:child_process', () => ({ exec: mocks.browser }));
vi.mock('./lib/local-env.js', () => ({
  assertLocalEnvWritable: mocks.preflight,
  updateEnvLocal: mocks.persist,
}));
vi.mock('./lib/whoop.js', () => ({
  buildAuthorizeUrl: mocks.whoopAuthorize,
  exchangeAuthCode: mocks.whoopExchange,
}));
vi.mock('./lib/strava.js', () => ({
  buildAuthorizeUrl: mocks.stravaAuthorize,
  exchangeAuthCode: mocks.stravaExchange,
}));
vi.mock('garmin-connect', () => ({
  default: {
    GarminConnect: class {
      login = mocks.garminLogin;
      exportToken = mocks.garminTokens;
    },
  },
}));

const argv = process.argv;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.callback = undefined;
  mocks.preflight.mockReset();
  mocks.persist.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  vi.stubEnv('GITHUB_ACTIONS', '');
  for (const vendor of ['WHOOP', 'STRAVA']) {
    vi.stubEnv(`${vendor}_CLIENT_ID`, 'synthetic-client');
    vi.stubEnv(`${vendor}_CLIENT_SECRET`, 'synthetic-secret');
  }
  vi.stubEnv('GARMIN_EMAIL', 'example@example.invalid');
  vi.stubEnv('GARMIN_PASSWORD', 'synthetic-password');
});

afterEach(() => {
  process.argv = argv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function begin(vendor: string): Promise<void> {
  process.argv = ['node', 'scripts/auth.ts', vendor];
  await import('./auth.js');
}

async function callback(query: string) {
  const response = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
  await mocks.callback!(
    { url: `/callback?${query}` } as IncomingMessage,
    response as unknown as ServerResponse,
  );
  return response;
}

function stateFor(vendor: 'whoop' | 'strava'): string {
  const authorize = vendor === 'whoop' ? mocks.whoopAuthorize : mocks.stravaAuthorize;
  const args = authorize.mock.calls[0] as unknown as [{ state: string }];
  return args[0].state;
}

describe('local account authorization', () => {
  it.each(['whoop', 'strava'] as const)('persists %s tokens before acknowledging success without printing secrets', async (vendor) => {
    const exchange = vendor === 'whoop' ? mocks.whoopExchange : mocks.stravaExchange;
    exchange.mockResolvedValue({ refreshToken: 'synthetic-refresh', accessToken: 'synthetic-access' });
    await begin(vendor);
    expect(mocks.preflight).toHaveBeenCalledOnce();
    expect(mocks.server.listen).toHaveBeenCalledWith(8765, '127.0.0.1', expect.any(Function));
    const response = await callback(`state=${stateFor(vendor)}&code=synthetic-code`);
    expect(mocks.persist).toHaveBeenCalledWith(`${vendor.toUpperCase()}_REFRESH_TOKEN`, 'synthetic-refresh');
    expect(response.statusCode).toBe(200);
    expect(mocks.persist.mock.invocationCallOrder[0]).toBeLessThan(response.end.mock.invocationCallOrder[0]!);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('synthetic-refresh');
    expect(JSON.stringify(response.end.mock.calls)).not.toContain('synthetic-refresh');
  });

  it('persists Garmin OAuth tokens directly instead of requiring a temporary-token handoff', async () => {
    const tokens = { oauth1: { synthetic: 'one' }, oauth2: { synthetic: 'two' } };
    mocks.garminLogin.mockResolvedValue(undefined);
    mocks.garminTokens.mockReturnValue(tokens);
    await begin('garmin');
    await vi.waitFor(() => expect(mocks.persist).toHaveBeenCalledWith(
      'GARMIN_TOKEN_JSON', Buffer.from(JSON.stringify(tokens)).toString('base64'),
    ));
    expect(mocks.preflight.mock.invocationCallOrder[0]).toBeLessThan(mocks.garminLogin.mock.invocationCallOrder[0]!);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(Buffer.from(JSON.stringify(tokens)).toString('base64'));
    expect(mocks.browser).not.toHaveBeenCalled();
  });

  it('fails before opening the browser when local credential storage is malformed', async () => {
    mocks.preflight.mockImplementation(() => { throw new Error('Malformed environment'); });
    await begin('whoop');
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
    expect(mocks.browser).not.toHaveBeenCalled();
    expect(mocks.whoopExchange).not.toHaveBeenCalled();
  });

  it('retains CSRF protection and does not exchange a code for the wrong state', async () => {
    await begin('whoop');
    const response = await callback('state=incorrect&code=synthetic-code');
    expect(response.statusCode).toBe(400);
    expect(mocks.whoopExchange).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('does not report success or reveal provider response bodies if storage fails', async () => {
    mocks.whoopExchange.mockResolvedValue({ refreshToken: 'synthetic-refresh' });
    mocks.persist.mockImplementation(() => { throw new Error('synthetic-sensitive-error'); });
    await begin('whoop');
    const response = await callback(`state=${stateFor('whoop')}&code=synthetic-code`);
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));
    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('synthetic-sensitive-error');
    expect(JSON.stringify(response.end.mock.calls)).not.toContain('synthetic-sensitive-error');
  });
});
