import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { countdownProgress, recoveryProgress, trainingHeights } from './threeScene';
import { RaceCountdown } from '../components/Races/RaceCountdown';
import { RecoveryAccent } from '../components/DailyGlance/RecoveryAccent';
import { TrainingMiniature } from '../components/Training/TrainingMiniature';
import type { CoachDay } from './types';

describe('3D data semantics', () => {
  it.each([
    [180, 0], [90, 0], [45, 0.5], [1, 89 / 90], [0, 1],
  ])('shows calendar progress for %s days remaining', (days, progress) => {
    expect(countdownProgress(days!)).toBeCloseTo(progress!);
  });

  it.each([-1, NaN, Infinity])('does not turn invalid/past countdown %s into completion', (days) => {
    expect(countdownProgress(days)).toBeNull();
  });

  it.each([null, NaN, Infinity, -1, 101])('preserves missing or invalid recovery %s', (score) => {
    expect(recoveryProgress(score)).toBeNull();
  });

  it('distinguishes a measured zero from missing recovery', () => {
    expect(recoveryProgress(0)).toBe(0);
    expect(recoveryProgress(87)).toBe(0.87);
    expect(recoveryProgress(100)).toBe(1);
    expect(recoveryProgress(null)).toBeNull();
  });

  it('uses distinct ordinal heights for all planned intensities', () => {
    const { rest, easy, moderate, hard } = trainingHeights;
    expect(rest).toBeGreaterThan(0);
    expect(rest).toBeLessThan(easy);
    expect(easy).toBeLessThan(moderate);
    expect(moderate).toBeLessThan(hard);
  });
});

describe('accessible 2D alternatives', () => {
  it('uses singular wording for a race tomorrow', () => {
    const html = renderToStaticMarkup(createElement(RaceCountdown, { daysUntil: 1 }));
    expect(html).toContain('1 day until race day');
    expect(html).not.toContain('1 days');
  });

  it('prints the exact countdown and its window without a WebGL canvas', () => {
    const html = renderToStaticMarkup(createElement(RaceCountdown, { daysUntil: 33 }));
    expect(html).toContain('33 days until race day');
    expect(html).toContain('final 90 calendar days');
    expect(html).toContain('aria-label="Race countdown 3D view"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('<canvas');
  });

  it('keeps a zero recovery score visible and does not invent a missing one', () => {
    const zero = renderToStaticMarkup(createElement(RecoveryAccent, { score: 0 }));
    expect(zero).toContain('Reported recovery: 0/100');
    const missing = renderToStaticMarkup(createElement(RecoveryAccent, { score: null }));
    expect(missing).toContain('No scored recovery value');
    expect(missing).not.toContain('3D view');
  });

  it('connects the training miniature to the selected agenda day', () => {
    const days: CoachDay[] = [
      { weekday: 'Mon', type: 'Rest', intensity: 'rest', durationMinutes: 0, reason: 'Rest day' },
      { weekday: 'Tue', type: 'Easy ride', intensity: 'easy', durationMinutes: 45, reason: 'Base work' },
    ];
    const html = renderToStaticMarkup(createElement(TrainingMiniature, { days, selectedDay: 'Tue' }));
    expect(html).toContain('The dot marks Tue');
    expect(html).toContain('not completed sessions or measured load');
    expect(html).toContain('aria-label="Training week 3D view"');
    expect(html).not.toContain('<canvas');
  });

  it('does not fabricate a training miniature for an empty plan', () => {
    const html = renderToStaticMarkup(createElement(TrainingMiniature, { days: [], selectedDay: 'Mon' }));
    expect(html).toContain('recorded intensity labels');
    expect(html).not.toContain('3D view');
  });
});
