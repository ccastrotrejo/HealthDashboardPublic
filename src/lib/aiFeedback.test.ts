import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAll, exportPayload, pendingCount, ratingFor, setRating } from './aiFeedback';

describe('local AI feedback', () => {
  const storage = new Map<string, string>();
  const generatedAt = '2026-09-06T12:00:00Z';
  const now = '2026-09-06T14:00:00.000Z';

  beforeEach(() => {
    storage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('exports an empty collection before any ratings exist', () => {
    expect(pendingCount()).toBe(0);
    expect(ratingFor('coach', generatedAt)).toBeNull();
    expect(JSON.parse(exportPayload())).toEqual({ entries: [] });
  });

  it('records a timestamped, version-pinned correction and exports it losslessly', () => {
    setRating('coach', generatedAt, 'down', 'The session was too hard.');
    expect(JSON.parse(exportPayload())).toEqual({
      entries: [{
        at: now, artifact: 'coach', artifactGeneratedAt: generatedAt,
        rating: 'down', note: 'The session was too hard.',
      }],
    });
    expect(pendingCount()).toBe(1);
  });

  it('isolates artifact kinds and versions when replacing or removing a rating', () => {
    setRating('coach', generatedAt, 'up');
    setRating('insights', generatedAt, 'up');
    setRating('coach', '2026-09-05T12:00:00Z', 'down');
    setRating('coach', generatedAt, 'down');
    expect(pendingCount()).toBe(3);
    expect(ratingFor('coach', generatedAt)).toBe('down');
    setRating('coach', generatedAt, null);
    expect(pendingCount()).toBe(2);
    expect(ratingFor('insights', generatedAt)).toBe('up');
    expect(ratingFor('coach', '2026-09-05T12:00:00Z')).toBe('down');
    expect(ratingFor('coach', generatedAt)).toBeNull();
  });

  it('retains the most recent 200 ratings and clears them after export', () => {
    for (let index = 0; index < 201; index++) {
      setRating('coach', new Date(index * 1000).toISOString(), 'up');
    }
    expect(pendingCount()).toBe(200);
    expect(ratingFor('coach', new Date(0).toISOString())).toBeNull();
    expect(ratingFor('coach', new Date(200_000).toISOString())).toBe('up');
    clearAll();
    expect(pendingCount()).toBe(0);
    expect(JSON.parse(exportPayload())).toEqual({ entries: [] });
  });

  it.each(['{broken', '{}', 'null'])('ignores unreadable or non-array saved data: %s', (value) => {
    vi.stubGlobal('localStorage', { getItem: () => value });
    expect(pendingCount()).toBe(0);
    expect(ratingFor('coach', generatedAt)).toBeNull();
  });

  it('keeps the dashboard usable when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new DOMException('Blocked', 'SecurityError'); },
      setItem: () => { throw new DOMException('Full', 'QuotaExceededError'); },
    });
    expect(pendingCount()).toBe(0);
    expect(() => setRating('coach', generatedAt, 'up')).not.toThrow();
    expect(() => clearAll()).not.toThrow();
  });
});
