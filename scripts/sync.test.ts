import { mkdirSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as whoop from './lib/whoop.js';
import * as strava from './lib/strava.js';
import { preflightSecretWrites, putSecret } from './lib/tokens.js';

vi.mock('./lib/storage.js', () => ({ dataPath: (name: string) => `/synthetic/data/${name}` }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    existsSync: (path: string) => path.startsWith('/synthetic/data/') ? false : fs.existsSync(path),
    mkdirSync: vi.fn(), renameSync: vi.fn(), writeFileSync: vi.fn(), appendFileSync: vi.fn(),
  };
});
vi.mock('./lib/local-env.js', () => ({ assertLocalEnvWritable: vi.fn(), updateEnvLocal: vi.fn() }));
vi.mock('./lib/garmin.js', () => ({ pullGarmin: vi.fn() }));
vi.mock('./lib/notify.js', () => ({ notifyEscalation: vi.fn() }));
vi.mock('./lib/tokens.js', () => ({
  maskInActionsLog: vi.fn(), preflightSecretWrites: vi.fn(), putSecret: vi.fn(),
}));
vi.mock('./lib/whoop.js', () => ({
  refreshAccessToken: vi.fn(), listCycles: vi.fn(), listRecoveries: vi.fn(),
  listSleeps: vi.fn(), listWorkouts: vi.fn(),
}));
vi.mock('./lib/strava.js', () => ({
  refreshAccessToken: vi.fn(), listActivities: vi.fn(), getAthlete: vi.fn(),
}));

const newRefresh = ['synthetic', 'rotated', 'credential'].join('-');

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('GITHUB_ACTIONS', 'true');
  vi.stubEnv('DRY_RUN', '1');
  vi.stubEnv('RECOMPUTE', '');
  vi.stubEnv('GITHUB_OUTPUT', '/synthetic/data/github-output');
  for (const name of [
    'WHOOP_CLIENT_ID', 'WHOOP_CLIENT_SECRET', 'WHOOP_REFRESH_TOKEN',
    'STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'STRAVA_REFRESH_TOKEN',
    'GARMIN_TOKEN_JSON', 'GARMIN_EMAIL', 'GARMIN_PASSWORD', 'HEALTH_ESCALATION_WEBHOOK_URL',
  ]) vi.stubEnv(name, '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('Unexpected sync exit'); });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Tests must not make network requests'); }));
  vi.mocked(preflightSecretWrites).mockResolvedValue(undefined);
  vi.mocked(putSecret).mockResolvedValue(undefined);
  vi.mocked(whoop.refreshAccessToken).mockResolvedValue({
    accessToken: ['synthetic', 'access'].join('-'), refreshToken: newRefresh, expiresAt: 1,
  });
  vi.mocked(strava.refreshAccessToken).mockResolvedValue({
    accessToken: ['synthetic', 'access'].join('-'), refreshToken: newRefresh, expiresAt: 1,
  });
  for (const method of [whoop.listCycles, whoop.listRecoveries, whoop.listSleeps, whoop.listWorkouts, strava.listActivities]) {
    vi.mocked(method).mockResolvedValue([]);
  }
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function runSync(vendor: 'whoop' | 'strava'): Promise<void> {
  for (const suffix of ['CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN']) {
    vi.stubEnv(`${vendor.toUpperCase()}_${suffix}`, ['synthetic', suffix.toLowerCase()].join('-'));
  }
  await import('./sync.js');
  await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith(expect.stringContaining('sync complete')));
}

describe('CI dry-run credential safety', () => {
  it.each(['whoop', 'strava'] as const)('preflights and persists %s rotation while skipping data writes', async (vendor) => {
    await runSync(vendor);
    const refresh = vendor === 'whoop' ? whoop.refreshAccessToken : strava.refreshAccessToken;
    const readData = vendor === 'whoop' ? whoop.listCycles : strava.listActivities;
    expect(preflightSecretWrites).toHaveBeenCalledOnce();
    expect(putSecret).toHaveBeenCalledWith(`${vendor.toUpperCase()}_REFRESH_TOKEN`, newRefresh);
    expect(vi.mocked(preflightSecretWrites).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(refresh).mock.invocationCallOrder[0]!);
    expect(vi.mocked(putSecret).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(readData).mock.invocationCallOrder[0]!);
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(renameSync).not.toHaveBeenCalled();
    expect(mkdirSync).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(newRefresh);
  });

  it('does not consume the old token when CI persistence preflight fails', async () => {
    vi.mocked(preflightSecretWrites).mockRejectedValue(new Error('Synthetic preflight failure'));
    await runSync('whoop');
    expect(whoop.refreshAccessToken).not.toHaveBeenCalled();
    expect(putSecret).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('reports a failed token write-back even in a CI data dry run', async () => {
    vi.mocked(putSecret).mockRejectedValue(new Error('Synthetic persistence failure'));
    await runSync('whoop');
    expect(appendFileSync).toHaveBeenCalledWith('/synthetic/data/github-output',
      'token_rotation_failed=true\ntoken_rotation_vendors=whoop\n');
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
