import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as strava from './strava.js';
import * as whoop from './whoop.js';
import type { StravaActivity, WhoopCycle } from './types.js';

const NOW = new Date('2026-08-31T12:14:59Z');
const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function ride(id: number): StravaActivity {
  return {
    id, name: 'Synthetic activity', sport_type: 'Ride', start_date: NOW.toISOString(),
    start_date_local: '2026-08-31T08:14:59Z', distance: 10000, moving_time: 1800,
    elapsed_time: 1800, total_elevation_gain: 0, average_speed: 5.5, max_speed: 10, has_heartrate: false,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Strava client', () => {
  it('paginates a full page, preserves the incremental cursor, and stops at a short page', async () => {
    fetchMock.mockResolvedValueOnce(json([ride(1), ride(2)])).mockResolvedValueOnce(json([ride(3)]));
    expect((await strava.listActivities('synthetic-access', 12345, 2)).map((activity) => activity.id))
      .toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requests = fetchMock.mock.calls.map(([url]) => new URL(String(url)));
    expect(requests.map((url) => url.searchParams.get('page'))).toEqual(['1', '2']);
    expect(requests.every((url) => url.searchParams.get('after') === '12345')).toBe(true);
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it('stops on an empty first page without requesting more data', async () => {
    fetchMock.mockResolvedValueOnce(json([]));
    expect(await strava.listActivities('synthetic-access')).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries rate limiting at the next quarter-hour and stops after three retries', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue(json({}, 429));
    const request = strava.getAthlete('synthetic-access');
    const assertion = expect(request).rejects.toThrow('rate limited after 3 retries');
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(errorLog).toHaveBeenCalledTimes(3);
  });

  it('treats missing activity streams as absent but propagates other endpoint failures', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404)).mockResolvedValueOnce(json({}, 500));
    expect(await strava.getActivityStreams('synthetic-access', 1)).toBeNull();
    await expect(strava.getActivityStreams('synthetic-access', 2)).rejects.toThrow('HTTP 500');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('converts absolute OAuth expiry seconds into milliseconds', async () => {
    fetchMock.mockResolvedValueOnce(json({
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_at: 1800000000, token_type: 'Bearer',
    }));
    expect(await strava.refreshAccessToken({ clientId: 'synthetic-client', clientSecret: 'synthetic-secret' }, 'old-refresh'))
      .toEqual({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt: 1800000000000 });
  });
});

describe('Whoop client', () => {
  it('follows opaque pagination tokens while preserving the start cursor on every page', async () => {
    const cycle: WhoopCycle = {
      id: 1, start: NOW.toISOString(), end: NOW.toISOString(), score_state: 'PENDING_SCORE',
    };
    fetchMock
      .mockResolvedValueOnce(json({ records: [cycle], next_token: 'cursor+with/slash=' }))
      .mockResolvedValueOnce(json({ records: [{ ...cycle, id: 2 }], next_token: null }));
    expect((await whoop.listCycles('synthetic-access', '2026-08-01T00:00:00Z')).map((record) => record.id))
      .toEqual([1, 2]);
    const second = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(second.searchParams.get('nextToken')).toBe('cursor+with/slash=');
    expect(second.searchParams.get('start')).toBe('2026-08-01T00:00:00Z');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an incomplete rotating token pair and omits scope from refresh requests', async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: 'synthetic-access', expires_in: 3600 }));
    await expect(whoop.refreshAccessToken({
      clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
    }, 'old-refresh')).rejects.toThrow('missing tokens');
    const body = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.has('scope')).toBe(false);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it('computes relative OAuth expiry from the current clock', async () => {
    fetchMock.mockResolvedValueOnce(json({
      access_token: 'synthetic-access', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'bearer',
    }));
    expect(await whoop.refreshAccessToken({
      clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
    }, 'old-refresh')).toEqual({
      accessToken: 'synthetic-access', refreshToken: 'new-refresh', expiresAt: NOW.getTime() + 3_600_000,
    });
  });
});
