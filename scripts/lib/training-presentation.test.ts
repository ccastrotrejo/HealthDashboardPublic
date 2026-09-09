import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isCurrentCoachWeek, macroEnergy, selectCoachDay } from '../../src/lib/trainingPresentation';
import { cardioBike, macros, PROGRAM_START, weeklySchedule } from '../../src/lib/program';
import { formatNumber } from '../../src/lib/format';
import { ratingFor, setRating } from '../../src/lib/aiFeedback';
import type { AiProvenance, CoachBlock, CoachDay, WeeklyReviewBlock } from '../../src/lib/types';
import { WeeklyPlan } from '../../src/components/Coach/WeeklyPlan';
import { TodayCard } from '../../src/components/Training/TodayCard';
import { WeeklyReviewCard } from '../../src/components/Coach/WeeklyReviewCard';
import { AiCardMeta } from '../../src/components/Coach/AiCardMeta';
import { MacrosCard } from '../../src/components/Training/MacrosCard';

const provenance: AiProvenance = { generatedAt: '2026-09-04T10:00:00Z', model: 'llm:test' };
const plan: CoachDay[] = weeklySchedule.map((day) => ({
  weekday: day.day,
  type: `${day.day} full session`,
  intensity: day.day === 'Sun' ? 'rest' : 'easy',
  durationMinutes: day.day === 'Sun' ? 0 : 45,
  reason: `${day.day} complete rationale, including any caution.`,
}));
const coach: CoachBlock = {
  ...provenance,
  forWeek: '2026-08-31',
  summary: 'Estimated FTP; measured power is not available.',
  plan,
  nutrition: { dailyAnchors: '', preAndPostFueling: '', mealIdea: '', groceryItem: '' },
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('selected weekly agenda', () => {
  it('does not mark historical, unknown, or invalid plan dates as today', () => {
    const now = new Date('2026-09-04T12:00:00');
    expect(isCurrentCoachWeek('2026-08-31', now)).toBe(true);
    expect(isCurrentCoachWeek('2026-08-24', now)).toBe(false);
    expect(isCurrentCoachWeek('2026-09-07', now)).toBe(false);
    expect(isCurrentCoachWeek('invalid', now)).toBe(false);
    expect(isCurrentCoachWeek(undefined, now)).toBe(false);
  });

  it('selects the current day when available and preserves the complete entry', () => {
    expect(selectCoachDay(plan, 'Fri')).toBe(plan[4]);
    for (const day of plan) expect(selectCoachDay(plan, day.weekday)).toBe(day);
  });

  it('falls back to the first available entry and handles empty plans', () => {
    expect(selectCoachDay(plan.slice(0, 2), 'Fri')).toBe(plan[0]);
    expect(selectCoachDay([], 'Fri')).toBeNull();
  });

  it('renders native day buttons with one current selection and full selected-day evidence', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T12:00:00'));
    const html = renderToStaticMarkup(createElement(WeeklyPlan, { data: coach }));
    const detailId = html.match(/<section id="([^"]+)" aria-label="Fri session"/)?.[1];
    expect(detailId).toBeDefined();
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const dayButtons = buttons.filter((button) => button.includes(`aria-controls="${detailId}"`));
    expect(dayButtons).toHaveLength(7);
    expect(dayButtons.filter((button) => button.includes('aria-pressed="true"'))).toHaveLength(1);
    for (const day of plan) {
      expect(dayButtons.some((button) => button.includes(`>${day.weekday}</span>`))).toBe(true);
    }
    const threeToggle = buttons.find((button) => button.includes('aria-label="Training week 3D view"'));
    expect(threeToggle).toContain('aria-pressed="false"');
    expect(threeToggle).not.toContain(`aria-controls="${detailId}"`);
    expect(html).toContain('Fri full session');
    expect(html).toContain('Fri complete rationale, including any caution.');
    expect(html).not.toContain('Mon full session');
    expect(html).toContain('min-h-11');
    expect(html).not.toContain('role="tab"');
    expect(html).toContain(coach.summary);
  });

  it('selects the first day of a historical plan without calling it today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T12:00:00'));
    const html = renderToStaticMarkup(createElement(WeeklyPlan, { data: { ...coach, forWeek: '2026-08-24' } }));
    expect(html).toContain('Mon full session');
    expect(html).not.toContain('>Today</span>');
  });
});

describe('daily macro energy', () => {
  it.each(weeklySchedule)('uses $day carbs in both the energy total and shares', (day) => {
    const energy = macroEnergy(macros.protein, day.carbs, macros.fat);
    expect(energy.calories).toBe(macros.protein * 4 + day.carbs * 4 + macros.fat * 9);
    expect(energy.carbsPct).toBeCloseTo(day.carbs * 4 / energy.calories * 100);
    expect(energy.proteinPct + energy.carbsPct + energy.fatPct).toBeCloseTo(100);
  });

  it('does not return NaN for zero macros', () => {
    expect(macroEnergy(0, 0, 0)).toEqual({ calories: 0, proteinPct: 0, carbsPct: 0, fatPct: 0 });
  });

  it('labels the listed-gram total separately from the stored calorie target', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T12:00:00'));
    const html = renderToStaticMarkup(createElement(MacrosCard));
    const friday = weeklySchedule.find((day) => day.day === 'Fri')!;
    expect(html).toContain(formatNumber(macros.protein * 4 + friday.carbs * 4 + macros.fat * 9));
    expect(html).toContain(formatNumber(friday.calories));
    expect(html).toContain('kcal from today’s macros');
    expect(html).toContain('Program calorie target:');
    expect(html).toContain(`${friday.carbs}g`);
  });
});

describe('resolved training prescription', () => {
  it.each(['rest', 'easy', 'moderate'] as const)('keeps the original workout secondary when readiness is %s', (intensity) => {
    vi.useFakeTimers();
    const friday = new Date(`${PROGRAM_START}T12:00:00`);
    friday.setDate(friday.getDate() + (5 - friday.getDay() + 7) % 7);
    vi.setSystemTime(friday);
    const html = renderToStaticMarkup(createElement(TodayCard, {
      readinessCall: { intensity, title: 'Recovery needs attention', reasons: ['Keep margin.'] },
    }));
    const title = intensity === 'rest' ? 'Make today a recovery day.' : intensity === 'easy' ? 'Keep today easy.' : 'Leave some margin today.';
    expect(html.indexOf(title)).toBeLessThan(html.indexOf('Originally programmed:'));
    expect(html).toMatch(/<details[^>]*>[\s\S]*Original program details · not today’s prescription/);
    expect(html).toContain('Key bike');
    expect(html).toContain(cardioBike[0]!.workout);
    expect(html).toContain('symptoms override this plan');
  });
});

describe('AI evidence and feedback', () => {
  it('keeps raw generated sleep wording in a closed evidence disclosure', () => {
    const data: WeeklyReviewBlock = {
      ...provenance,
      forWeek: '2026-08-31',
      headline: 'A week of mixed recovery.',
      adherence: { planned: ['Swim'], actual: ['—'], score: 38, note: 'Partial week.' },
      fitnessDelta: { ctlChange: 1.51, atlChange: 5.53, tsbChange: -4.02, narrative: 'Fatigue increased.' },
      standout: { activity: 'Swim', why: 'Consistent effort.' },
      trend: 'Sleep duration fell.',
      sleepCoach: { bedtimeDriftMin: 55, durationVarianceMin: 66, target: 'Target nightly asleep time: 8.116756666666667 hours.' },
      nextWeekFocus: 'Allow recovery.',
    };
    const html = renderToStaticMarkup(createElement(WeeklyReviewCard, { data }));
    expect(html).toContain(data.sleepCoach.target);
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Sleep target · generated evidence/);
    expect(html).toContain('±55 min');
    expect(html).toContain('±66 min');
    expect(html).toContain(data.nextWeekFocus);
  });

  it('makes degraded provenance explicit and reachable without a tooltip', () => {
    const html = renderToStaticMarkup(createElement(AiCardMeta, {
      artifact: 'coach',
      data: { ...provenance, model: 'template', dataStale: true, fallbackReason: 'Provider unavailable.' },
    }));
    expect(html).toContain('Fallback');
    expect(html).toContain('Stale source data');
    expect(html).toContain('<details');
    expect(html).toContain('Source details');
    expect(html).toContain('Provider unavailable.');
    expect(html).not.toContain('Analysis feedback');
  });

  it('renders saved feedback, allows replacement and clearing, and isolates artifact versions', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const render = () => renderToStaticMarkup(createElement(AiCardMeta, { artifact: 'coach', data: provenance }));
    setRating('coach', provenance.generatedAt, 'up');
    expect(render()).toContain('aria-pressed="true" aria-label="This analysis was useful"');
    setRating('coach', provenance.generatedAt, 'down');
    expect(render()).toContain('aria-pressed="true" aria-label="This analysis was wrong or unhelpful"');
    expect(ratingFor('coach', 'different-generation')).toBeNull();
    setRating('coach', provenance.generatedAt, null);
    expect(render()).not.toContain('aria-pressed="true"');
    expect(render()).toContain('Select again to undo.');
    expect(render()).toContain('min-h-11 min-w-11');
  });
});
