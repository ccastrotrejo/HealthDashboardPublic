import type { CoachDay } from './types';
import { DAY_MS, utcDateTime } from '../../utils/date';

/** Match local calendar dates without DST changing the plan's seven-day window. */
export function isCurrentCoachWeek(forWeek: string | undefined, now = new Date()): boolean {
  if (!forWeek) return false;
  const start = utcDateTime(forWeek);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Number.isFinite(start) && today >= start && today < start + 7 * DAY_MS;
}

/** Prefer the selected/current weekday, then the first available plan entry. */
export function selectCoachDay(
  plan: CoachDay[],
  weekday: CoachDay['weekday'],
): CoachDay | null {
  return plan.find((day) => day.weekday === weekday) ?? plan[0] ?? null;
}

/** Energy and shares from the same listed grams, not a separate calorie target. */
export function macroEnergy(protein: number, carbs: number, fat: number) {
  const proteinCalories = protein * 4;
  const carbCalories = carbs * 4;
  const fatCalories = fat * 9;
  const calories = proteinCalories + carbCalories + fatCalories;
  return {
    calories,
    proteinPct: calories > 0 ? (proteinCalories / calories) * 100 : 0,
    carbsPct: calories > 0 ? (carbCalories / calories) * 100 : 0,
    fatPct: calories > 0 ? (fatCalories / calories) * 100 : 0,
  };
}
