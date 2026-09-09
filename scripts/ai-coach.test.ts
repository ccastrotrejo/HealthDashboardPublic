import { afterEach, describe, expect, it, vi } from 'vitest';
import example from '../config/athlete.example.json';
import type { Snapshot } from './lib/types';

const snapshot: Snapshot = {
  syncedAt: '2026-01-05T12:00:00Z', pipelineVersion: 'synthetic',
  counts: { recoveries: 0, sleeps: 0, workouts: 0, cycles: 0, activities: 0, garminDays: 0 },
  daily: null, weekly: null, longTerm: null, cycling: null, garmin: null,
};

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (path: string) => {
    if (path.endsWith('/snapshot.json')) return JSON.stringify(snapshot);
    throw new Error('No synthetic fixture for this optional file');
  }),
  appendFile: vi.fn(), writeFile: vi.fn(),
}));
vi.mock('./lib/llm.js', () => ({
  llmAvailable: () => false,
  providerLabel: () => 'template',
  chatSchema: vi.fn(() => { throw new Error('Tests must not call a provider'); }),
}));
vi.mock('./lib/ai-context.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/ai-context.js')>(),
  writeArtifact: vi.fn(),
}));

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('configured coach fallback', () => {
  it.each([true, false])('uses only configured nutrition references (meal configured: %s)', async (hasMeal) => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock('./lib/athlete-config.js');
    vi.useFakeTimers();
    vi.setSystemTime(new Date(snapshot.syncedAt));
    vi.stubEnv('FOR_DATE', '2026-01-05');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.doMock('./lib/athlete-config.js', () => ({
      default: {
        ...example,
        hydrationRules: { ...example.hydrationRules, daily: 'Synthetic hydration guidance' },
        mealOptions: { ...example.mealOptions, lunch: hasMeal ? [{ name: 'Synthetic lunch', detail: 'Configured ingredients' }] : [] },
      },
    }));
    const { writeArtifact } = await import('./lib/ai-context.js');
    await import('./ai-coach.js');
    await vi.waitFor(() => expect(writeArtifact).toHaveBeenCalledOnce());
    const output = vi.mocked(writeArtifact).mock.calls[0]?.[2];
    expect(output).toMatchObject({
      nutrition: {
        dailyAnchors: expect.stringContaining('configured carbs range 300-300g'),
        mealIdea: hasMeal ? 'Synthetic lunch: Configured ingredients' : 'No meal reference configured.',
      },
    });
    expect(JSON.stringify(output)).toContain('Synthetic hydration guidance');
  });
});
