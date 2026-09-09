import { describe, expect, it } from 'vitest';
import { resolveTrainingAction } from '../../src/lib/trainingAction';
import type { TodaysCall } from '../../src/lib/types';

const call = (intensity: TodaysCall['intensity']): TodaysCall => ({
  intensity,
  title: `${intensity} session`,
  reasons: [],
});

describe('resolved training action', () => {
  it('puts recovery ahead of an originally programmed interval session', () => {
    const action = resolveTrainingAction(call('rest'), 'Bike intervals');
    expect(action.title).toBe('Make today a recovery day.');
    expect(action.adjusted).toBe(true);
    expect(action.guidance).toContain('Replace');
  });

  it.each(['easy', 'moderate'] as const)('makes a %s ceiling the primary action', (intensity) => {
    const action = resolveTrainingAction(call(intensity), 'Bike intervals');
    expect(action.title).not.toContain('intervals');
    expect(action.adjusted).toBe(true);
  });

  it('never turns a programmed rest day into quality work', () => {
    const action = resolveTrainingAction(call('hard'), 'Rest day');
    expect(action.title).toBe('Rest day');
    expect(action.guidance).toContain('Keep any planned rest');
    expect(action.adjusted).toBe(false);
  });

  it('does not fabricate readiness when the call is missing', () => {
    const action = resolveTrainingAction(null, 'Easy ride');
    expect(action.title).toBe('Easy ride');
    expect(action.guidance).toContain('No readiness call');
    expect(action.adjusted).toBe(false);
  });
});
