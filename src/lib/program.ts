import athlete from '#athlete-config';
import { DAY_MS, utcDateTime } from '../../utils/date';
import type { DayKey, DayPlan, Phase } from '../../config/schema';

export type {
  Profile, Goal, Phase, DayKey, DayPlan, Exercise, Lift, CardioWeek,
  MealSlot, MealOption, GroceryGroup,
} from '../../config/schema';

export const {
  PROGRAM_START, PROGRAM_LENGTH_WEEKS, profile, cyclingProfileDefaults,
  goals, phases, weeklySchedule, CRITICAL_RECOVERY_CUE, lifts,
  cardioBike, cardioRun, cardioSwim, paceGlossary, macros, dailyTiming,
  mealOptions, mealPrepChecklist, hydrationRules, grocery, saunaRules,
  yogaRules, confirmedChoices, removedExercises, dayNotes,
} = athlete;

/** Returns the program week, or null outside the configured program. */
export function currentProgramWeek(date: Date = new Date(), startISO = PROGRAM_START): number | null {
  const diffDays = Math.floor((date.getTime() - utcDateTime(startISO)) / DAY_MS);
  if (diffDays < 0) return null;
  const week = Math.floor(diffDays / 7) + 1;
  return week > PROGRAM_LENGTH_WEEKS ? null : week;
}

export function phaseForWeek(week: number | null): Phase | null {
  if (week == null) return null;
  return phases.find((phase) => phase.weeks.includes(week)) ?? null;
}

const DAY_KEYS: DayKey[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function todayKey(date: Date = new Date()): DayKey {
  return DAY_KEYS[(date.getDay() + 6) % 7] ?? 'Mon';
}

export function planForDay(day: DayKey): DayPlan {
  return weeklySchedule.find((plan) => plan.day === day)!;
}
