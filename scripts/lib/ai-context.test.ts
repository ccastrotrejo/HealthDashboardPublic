import { readFile, appendFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendHistory,
  assessFreshness,
  compactSnapshot,
  fitPayload,
  loadContext,
  loadHistory,
  negativeExamples,
  programContext,
  provenance,
  recentHeadlines,
  recentLenses,
  shiftDate,
  todayLocal,
  type HistoryEntry,
} from './ai-context.js';
import { computeDailyAnalytics } from './daily.js';
import { computeLongTermAnalytics, computeWeeklyAnalytics } from './analytics.js';
import { PROGRAM_LENGTH_WEEKS, PROGRAM_START, cardioBike, lifts } from '../../src/lib/program.js';
import type { AiFeedbackEntry, RaceEvent, Snapshot } from './types.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  appendFile: vi.fn(),
  writeFile: vi.fn(),
}));

const NOW = new Date('2026-09-06T16:00:00Z');

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    syncedAt: NOW.toISOString(),
    pipelineVersion: 'test',
    counts: { recoveries: 0, sleeps: 0, cycles: 0, workouts: 0, activities: 0, garminDays: 0 },
    daily: null,
    weekly: null,
    longTerm: null,
    garmin: null,
    ...over,
  };
}

function mockFiles(files: Record<string, unknown>): void {
  vi.mocked(readFile).mockImplementation(async (path) => {
    const name = String(path).split('/').at(-1)!;
    if (!(name in files)) throw new Error(`Missing synthetic fixture: ${name}`);
    return name.endsWith('.jsonl') ? String(files[name]) : JSON.stringify(files[name]);
  });
}

function history(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    at: NOW.toISOString(),
    artifact: 'insights',
    headline: 'Synthetic insight',
    lens: 'program-adherence',
    model: 'test',
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('configured local date', () => {
  it('uses the synthetic UTC configuration unless explicitly overridden', () => {
    vi.setSystemTime(new Date('2026-09-06T01:00:00Z'));
    vi.stubEnv('USER_TIMEZONE', '');
    expect(todayLocal()).toBe('2026-09-06');
    vi.stubEnv('USER_TIMEZONE', 'America/Los_Angeles');
    expect(todayLocal()).toBe('2026-09-05');
  });
});

describe('assessFreshness', () => {
  it.each([
    ['today-debrief', 6], ['insights', 8], ['coach', 12], ['weekly-review', 8],
    ['monthly-patterns', 30], ['post-race', 48], ['calibration', 72], ['unknown-task', 12],
  ])('uses the %s freshness budget without prematurely rounding the age', (task, hours) => {
    const atBoundary = snapshot({ syncedAt: new Date(NOW.getTime() - Number(hours) * 3_600_000).toISOString() });
    expect(assessFreshness(atBoundary, String(task))).toMatchObject({ stale: false, budgetHours: hours });
    const justStale = snapshot({ syncedAt: new Date(new Date(atBoundary.syncedAt).getTime() - 1000).toISOString() });
    expect(assessFreshness(justStale, String(task))).toMatchObject({ stale: true, ageHours: hours });
  });
});

describe('programContext', () => {
  it('enforces both ends of the configured program rather than inventing a phase', () => {
    expect(programContext(shiftDate(PROGRAM_START, -1))).toMatchObject({ week: null, phase: null });
    expect(programContext(PROGRAM_START).week).toBe(1);
    expect(programContext(shiftDate(PROGRAM_START, PROGRAM_LENGTH_WEEKS * 7 - 1)).week).toBe(PROGRAM_LENGTH_WEEKS);
    expect(programContext(shiftDate(PROGRAM_START, PROGRAM_LENGTH_WEEKS * 7))).toMatchObject({ week: null, phase: null });
  });

  it('keeps Friday’s separated lift and key bike distinct from Saturday’s long ride', () => {
    const context = programContext(PROGRAM_START);
    const bike = cardioBike.find((week) => week.week === 1)!;
    expect(context.template.map((day) => day.day)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(context.template.find((day) => day.day === 'Fri')?.session).toContain('KEY BIKE (≥6 h after the lift)');
    expect(context.template.find((day) => day.day === 'Fri')?.session).toContain(bike.workout);
    expect(context.template.find((day) => day.day === 'Sat')?.session).toBe(`Long ride — ${bike.longRide}`);
    expect(context.allowedExercises).toEqual(lifts.flatMap((lift) => lift.exercises.map((exercise) => exercise.name)));
  });
});

describe('artifact history and feedback', () => {
  it('limits history to its tail and ignores malformed lines without reading real data', async () => {
    const older = history({ headline: 'Older' });
    const newer = history({ headline: 'Newer' });
    mockFiles({ 'ai-history.jsonl': `${JSON.stringify(older)}\nnot-json\n${JSON.stringify(newer)}\n` });
    expect(await loadHistory(2)).toEqual([newer]);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('returns empty history when the file is absent', async () => {
    mockFiles({});
    expect(await loadHistory()).toEqual([]);
  });

  it('appends one JSONL record and treats append failures as nonfatal', async () => {
    const entry = history();
    await appendHistory(entry);
    expect(appendFile).toHaveBeenCalledWith(expect.stringContaining('ai-history.jsonl'), JSON.stringify(entry) + '\n');
    vi.mocked(appendFile).mockRejectedValueOnce(new Error('synthetic disk failure'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(appendHistory(entry)).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('could not append'));
  });

  it('returns only the most recent insight lenses, newest first, without mutating history', () => {
    const entries = [
      history({ lens: 'anomaly' }),
      history({ artifact: 'coach', lens: 'recovery-debt' }),
      history({ lens: undefined }),
      history({ lens: 'sleep-vs-recovery' }),
      history({ lens: 'zone-polarization' }),
    ];
    const original = structuredClone(entries);
    expect(recentLenses(entries, 2)).toEqual(['zone-polarization', 'sleep-vs-recovery']);
    expect(entries).toEqual(original);
  });

  it('scopes headlines by artifact and uses forDate before the generation date', () => {
    const entries = [
      history({ headline: 'Older' }),
      history({ artifact: 'coach', headline: 'Wrong artifact' }),
      history({ forDate: '2026-09-05', headline: 'Most recent' }),
    ];
    expect(recentHeadlines(entries, 'insights', 2)).toEqual([
      '2026-09-05: Most recent', '2026-09-06: Older',
    ]);
  });

  it('uses the last three negative notes only and bounds each note', () => {
    const feedback = (note: string, over: Partial<AiFeedbackEntry> = {}): AiFeedbackEntry => ({
      at: NOW.toISOString(), artifactGeneratedAt: NOW.toISOString(), artifact: 'coach', rating: 'down', note, ...over,
    });
    const result = negativeExamples([
      feedback('Old correction'), feedback('Keep rest day'), feedback('Do not invent weight'),
      feedback('x'.repeat(300)), feedback('Positive', { rating: 'up' }),
      feedback('Other artifact', { artifact: 'insights' }), feedback(''),
    ], 'coach');
    expect(result.slice(0, 2)).toEqual(['- Keep rest day', '- Do not invent weight']);
    expect(result).toHaveLength(3);
    expect(result[2]!.length).toBeLessThanOrEqual(202);
  });
});

function race(id: string, date: string, finishSeconds?: number): RaceEvent {
  return {
    id, name: id, date, type: 'race', sport: 'run', priority: 'A', status: 'registered',
    ...(finishSeconds != null ? { result: { finishSeconds } } : {}),
  };
}

describe('loadContext and provenance', () => {
  it('refuses to invent a context when the mandatory snapshot is absent', async () => {
    mockFiles({});
    await expect(loadContext('coach', '2026-09-06')).rejects.toThrow('Aborting rather than inventing data');
  });

  it('treats optional files as empty and selects races by date rather than file order', async () => {
    mockFiles({
      'snapshot.json': snapshot(),
      'races.json': { races: [
        race('later', '2026-10-01'), race('old-result', '2026-08-01', 4000),
        race('today', '2026-09-06'), race('recent-result', '2026-09-02', 3900),
        race('past-without-result', '2026-09-05'),
      ] },
    });
    const context = await loadContext('coach', '2026-09-06');
    expect(context).toMatchObject({
      today: '2026-09-06', nextRace: { id: 'today' }, daysToRace: 0,
      lastCompletedRace: { id: 'recent-result' }, lifts: [], history: [], feedback: [],
      coach: null, insights: null,
    });
  });

  it('warns on stale data and propagates the same age into artifact provenance', async () => {
    mockFiles({ 'snapshot.json': snapshot({ syncedAt: '2026-09-05T16:00:00Z' }) });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const context = await loadContext('coach', '2026-09-06');
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('snapshot is 24h old'));
    expect(provenance(context, 'template', {
      fallbackReason: 'upstream https://example.test/error failed',
    })).toMatchObject({
      generatedAt: NOW.toISOString(), model: 'template', snapshotAgeHours: 24, dataStale: true,
      snapshotSyncedAt: '2026-09-05T16:00:00Z', fallbackReason: 'upstream [url] failed',
    });
  });
});

describe('synthetic prompt packing', () => {
  function seriesSnapshot(): Snapshot {
    const daily = computeDailyAnalytics([], [], [], null, NOW);
    daily.trends.hrv = Array.from({ length: 30 }, (_, index) => ({
      date: shiftDate('2026-08-08', index), value: index === 10 ? null : 100 + index + 0.49,
    }));
    return snapshot({ daily, longTerm: computeLongTermAnalytics([], NOW) });
  }

  it('keeps gaps, rounds precision, and omits all-null series without mutating input', () => {
    const input = seriesSnapshot();
    const original = structuredClone(input);
    const result = compactSnapshot(input, 'monthly');
    expect(result.daily?.trends.hrv).toMatchObject({ from: '2026-08-08' });
    expect(result.daily?.trends.hrv?.v.slice(9, 12)).toEqual([109, null, 111]);
    expect(result.daily?.trends.rhr).toBeUndefined();
    expect(input).toEqual(original);
  });

  it('uses UTC activity starts at the prompt lookback boundary rather than local-clock text', () => {
    const weekly = computeWeeklyAnalytics([], NOW);
    weekly.recentActivities = [{
      id: 1, name: 'Boundary ride', sportType: 'Ride', startDateUtc: '2026-08-30T16:00:00.000Z',
      startDateLocal: '2026-08-30T12:00:00Z', distanceMeters: 10000, movingTimeSeconds: 1800,
      averagePaceSecPerKm: null, averageHeartrate: null, intensity: 'easy', source: 'strava',
    }, {
      id: 2, name: 'Too old', sportType: 'Ride', startDateUtc: '2026-08-30T15:59:59.999Z',
      startDateLocal: '2026-08-30T11:59:59Z', distanceMeters: 10000, movingTimeSeconds: 1800,
      averagePaceSecPerKm: null, averageHeartrate: null, intensity: 'easy', source: 'strava',
    }];
    const result = compactSnapshot(snapshot({ weekly }), 'daily');
    expect(result.weekly?.recentActivities.map((activity) => activity.name)).toEqual(['Boundary ride']);
  });

  it('leaves a small payload unchanged and warns if the irreducible core cannot fit', () => {
    const input = seriesSnapshot();
    expect(fitPayload(input, 100_000, 'monthly').dropped).toEqual([]);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = fitPayload(input, 1, 'monthly');
    expect(result.dropped).toHaveLength(7);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('irreducible core'));
    expect(result.payload.syncedAt).toBe(input.syncedAt);
  });

  it('advances trend date anchors with the values removed during thinning', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const input = seriesSnapshot();
    const { payload } = fitPayload(input, 1, 'monthly');
    expect(payload).toMatchObject({
      daily: {
        trends: {
          hrv: {
            from: '2026-08-24',
            v: input.daily!.trends.hrv.slice(-14).map((point) => Math.round(point.value!)),
          },
        },
      },
    });
    expect(input.daily!.trends.hrv[0]!.date).toBe('2026-08-08');
  });

  it('retains a correctly shifted date anchor for the thinned fitness curve', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const input = seriesSnapshot();
    const { payload } = fitPayload(input, 1, 'monthly');
    expect(payload).toMatchObject({
      longTerm: {
        fitnessCurve: {
          from: input.longTerm!.fitnessCurve.at(-14)!.date,
          load: Array<number>(14).fill(0),
        },
      },
    });
  });
});
