import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { athleteBrief, loadContext } from './ai-context';
import type { PostRaceBlock, RaceEvent, RacesData, Snapshot } from './types';
import { PostRaceCard } from '../../src/components/Races/PostRaceCard';
import { RaceCard } from '../../src/components/Races/RaceCard';
import { AiPostRaceCard } from '../../src/components/Races/AiPostRaceCard';
import { RacesPage } from '../../src/components/Races/RacesPage';
import { formatRaceTime, orderRaceDisplay } from '../../src/components/Races/raceDisplay';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn(), appendFile: vi.fn(), writeFile: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

const race: RaceEvent = {
  id: 'example-triathlon', name: 'Example triathlon', date: '2026-06-14',
  type: 'race', sport: 'tri', priority: 'A', status: 'registered',
  result: {
    finishSeconds: 4200.03, overallPlace: 42, overallFinishers: 200,
    divisionPlace: 5, division: 'Example division',
    legs: [
      { name: 'Swim', durationSeconds: 900.12 },
      { name: 'T1', durationSeconds: 100.23 },
      { name: 'Bike', durationSeconds: 1800.34, paceLabel: '20 mph' },
      { name: 'T2', durationSeconds: 80.45 },
      { name: 'Run', durationSeconds: 1318.86, paceLabel: '8:00 /mi' },
    ],
    notes: 'Synthetic official total differs from the sum of splits.',
  },
};
const races: RacesData = { races: [race] };
const postRace: PostRaceBlock = {
  generatedAt: '2026-06-15T12:00:00Z', model: 'template',
  raceId: race.id, raceName: race.name, raceDate: race.date,
  headline: 'Example result',
  outcome: { actualSeconds: 4200.03, goalSeconds: null, deltaSeconds: null, verdict: 'no-goal', narrative: 'Synthetic result.' },
  legs: race.result!.legs!.map((leg) => ({ ...leg, note: 'Example split.' })),
  executionVsBuildUp: 'Synthetic analysis.', lessons: ['Example lesson.'],
  recovery: { restDays: 2, guidance: 'Example only.' },
};

describe('recorded race results with synthetic fixtures', () => {
  it('points empty race calendars to private storage', () => {
    const html = renderToStaticMarkup(createElement(RacesPage, { racesData: { races: [] }, snapshot: null }));
    expect(html).toContain('private/data/races.json');
    expect(html).not.toContain('public/data/races.json');
  });

  it('preserves official precision rather than replacing the total with split sums', () => {
    const splitTotal = race.result!.legs!.reduce((total, leg) => total + leg.durationSeconds, 0);
    expect(splitTotal).toBeCloseTo(4200, 2);
    expect(race.result!.finishSeconds! - splitTotal).toBeCloseTo(0.03, 2);
    const html = renderToStaticMarkup(createElement(PostRaceCard, { race }));
    expect(html).toContain('1:10:00.03');
    expect(html).toContain('20 mph');
    expect(html).not.toContain('/km');
    for (const leg of race.result!.legs!) expect(html).toContain(formatRaceTime(leg.durationSeconds, 2));
  });

  it('includes the latest recorded result in the AI context without reading private files', async () => {
    const now = new Date('2026-06-15T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const snapshot: Snapshot = {
      syncedAt: now.toISOString(), pipelineVersion: 'synthetic',
      counts: { recoveries: 0, sleeps: 0, cycles: 0, workouts: 0, activities: 0, garminDays: 0 },
      daily: null, weekly: null, longTerm: null, garmin: null,
    };
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).endsWith('/snapshot.json')) return JSON.stringify(snapshot);
      if (String(path).endsWith('/races.json')) return JSON.stringify(races);
      throw new Error('No synthetic fixture');
    });
    expect(orderRaceDisplay(races.races, now).primary?.id).toBe(race.id);
    const context = await loadContext('post-race', '2026-06-15');
    expect(context.lastCompletedRace?.id).toBe(race.id);
    expect(athleteBrief(context)).toContain('finish 4200.03s');
    expect(athleteBrief(context)).toContain('not today');
    expect(athleteBrief({ ...context, lastCompletedRace: null })).not.toContain('Latest recorded result:');
  });

  it('renders the result in the summary and archive', () => {
    const html = renderToStaticMarkup(createElement(RaceCard, {
      race, daysUntil: -1, snapshot: null, isPast: true,
    }));
    expect(html).toContain('1:10:00.03');
    expect(html).toContain('Result recorded');
    const archive = renderToStaticMarkup(createElement(RacesPage, {
      racesData: { races: [{ ...race, id: 'later-result', date: '2026-06-16' }, race] }, snapshot: null,
    }));
    expect(archive).toContain('1:10:00.03');
    expect(archive).toContain('Past events');
  });

  it('still displays pace for standalone runs', () => {
    const run: RaceEvent = {
      ...race, sport: 'run', distance: { meters: 5000, label: '5K' }, result: { finishSeconds: 1500 },
    };
    expect(renderToStaticMarkup(createElement(PostRaceCard, { race: run }))).toContain('/km');
  });

  it('renders analysis precision and an explicit missing goal', () => {
    const html = renderToStaticMarkup(createElement(AiPostRaceCard, { data: postRace }));
    expect(html).toContain('1:10:00.03');
    expect(html).toContain('No time goal');
  });
});
