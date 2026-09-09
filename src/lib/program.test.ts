import { describe, expect, it } from 'vitest';
import {
  currentProgramWeek, phaseForWeek, phases, planForDay, PROGRAM_LENGTH_WEEKS,
  PROGRAM_START, todayKey, weeklySchedule,
} from './program';

describe('program calendar', () => {
  const start = '2026-09-01';

  it.each([
    ['2026-08-31T23:59:59Z', null], ['2026-09-01T00:00:00Z', 1],
    ['2026-09-07T23:59:59Z', 1], ['2026-09-08T00:00:00Z', 2],
    ['2026-12-07T23:59:59Z', 14], ['2026-12-08T00:00:00Z', null],
  ])('maps %s to program week %s at UTC boundaries', (iso, expected) => {
    expect(currentProgramWeek(new Date(iso), start)).toBe(expected);
  });

  it('uses the configured program start when no override is passed', () => {
    expect(currentProgramWeek(new Date(`${PROGRAM_START}T00:00:00Z`))).toBe(1);
    expect(currentProgramWeek(new Date('2026-09-08T01:00:00+02:00'), start)).toBe(1);
  });

  it('assigns every program week to exactly one phase', () => {
    for (let week = 1; week <= PROGRAM_LENGTH_WEEKS; week++) {
      const matches = phases.filter((phase) => phase.weeks.includes(week));
      expect(matches).toHaveLength(1);
      expect(phaseForWeek(week)).toBe(matches[0]);
    }
    for (const week of [null, 0, -1, 15]) expect(phaseForWeek(week)).toBeNull();
  });

  it.each(weeklySchedule)('returns the configured $day plan without copying or mutating it', (plan) => {
    expect(planForDay(plan.day)).toBe(plan);
  });

  it('selects weekdays using the local calendar, with Sunday at the end', () => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    days.forEach((day, index) => {
      expect(todayKey(new Date(2026, 8, 7 + index, 0, 1))).toBe(day);
      expect(todayKey(new Date(2026, 8, 7 + index, 23, 59))).toBe(day);
    });
  });
});
