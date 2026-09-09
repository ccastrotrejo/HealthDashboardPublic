import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RaceEvent, Snapshot } from '../../src/lib/types';
import { SleepCard } from '../../src/components/DailyGlance/SleepCard';
import { TrainingStatusCard } from '../../src/components/LongTerm/TrainingStatusCard';
import { RaceCard } from '../../src/components/Races/RaceCard';

const snapshot: Snapshot = {
  syncedAt: '2026-09-04T12:00:00Z',
  pipelineVersion: 'test',
  counts: { recoveries: 0, sleeps: 0, workouts: 0, cycles: 0, activities: 1, garminDays: 0 },
  daily: null,
  weekly: null,
  garmin: null,
  longTerm: {
    fitnessCurve: [],
    trainingMap: [],
    gear: [],
    yearProgress: { thisYear: [], lastYear: [], ytdKm: 0, ytdKmLastYear: 0 },
    allTime: { activityCount: 1, totalKm: 5, longestActivityKm: 5, longestStreakDays: 1, currentStreakDays: 0, firstYear: 2026 },
    prSeries: [{
      bucket: '5k', distanceMeters: 5000, efforts: [],
      best: { date: '2026-08-01', paceSecPerKm: 300, activityId: 1 },
    }],
    racePredictions: [{ bucket: '5k', distanceMeters: 5000, predictedSeconds: 1500, paceSecPerKm: 300 }],
  },
};

const race: RaceEvent = {
  id: 'past-run', name: 'Past 5k', date: '2026-08-01', type: 'race',
  sport: 'run', priority: 'A', status: 'registered',
  distance: { meters: 5000, label: '5k' }, goal: { timeSeconds: 1440 },
};

describe('retained race comparisons', () => {
  it('keeps current comparisons in past-event details without implying historical forecasts', () => {
    const markup = renderToStaticMarkup(createElement(RaceCard, {
      race, snapshot, daysUntil: -34, isPast: true, detailsOnly: true,
    }));
    expect(markup).toContain('Current recorded PR pace');
    expect(markup).toContain('Current Riegel estimate');
    expect(markup).toContain('Original goal vs current estimate');
    expect(markup).toContain('not predictions recorded before this event');
    expect(markup).toContain('25:00');
  });

  it('does not apply running estimates to multisport events', () => {
    const markup = renderToStaticMarkup(createElement(RaceCard, {
      race: { ...race, sport: 'tri' }, snapshot, daysUntil: -34, isPast: true, detailsOnly: true,
    }));
    expect(markup).not.toContain('Riegel estimate');
    expect(markup).not.toContain('recorded PR pace');
  });
});

describe('compact metric presentation', () => {
  it('rounds sleep hours through minute boundaries without adding spurious seconds', () => {
    const markup = renderToStaticMarkup(createElement(SleepCard, {
      data: {
        asleepHours: 5.9999, performancePct: 75, efficiencyPct: 90, neededHours: 8,
        stages: { light: 3.5, rem: 1, deep: 1.5, awake: 0.25 },
        neededBreakdown: { baselineHours: 8, fromSleepDebtHours: 0, fromRecentStrainHours: 0, fromRecentNapHours: 0 },
        respiratoryRate: null,
      },
    }));
    expect(markup).toContain('6h 0m');
    expect(markup).toContain('15m');
    expect(markup).not.toContain('5h 60m');
    expect(markup).not.toContain('15m 0s');
    expect(markup).toContain('<summary');
  });

  it('retains a raw unavailable status behind provider details, not as a headline', () => {
    const markup = renderToStaticMarkup(createElement(TrainingStatusCard, {
      data: {
        label: 'No status', feedback: 'NO_STATUS_2', weeklyLoad: null,
        loadTunnelMin: null, loadTunnelMax: null, acuteLoad: null, chronicLoad: null,
      },
    }));
    expect(markup).toContain('No status from Garmin yet');
    expect(markup).toContain('Provider status details');
    expect(markup).toContain('NO_STATUS_2');
    expect(markup).not.toContain('text-2xl');
  });
});
