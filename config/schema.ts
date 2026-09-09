import { z } from 'zod';

const text = z.string();
const positive = z.number().positive();
const nonnegative = z.number().nonnegative();
const day = z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
const exercise = z.strictObject({
  name: text, sets: positive.int(), reps: text, notes: text.optional(),
  phase1Skip: z.boolean().optional(),
});
const phase = z.strictObject({
  id: z.enum(['base', 'build', 'peak', 'deload']),
  label: text, weeks: z.array(positive.int()), load: text, rpe: text, notes: text,
});
const dayPlan = z.strictObject({
  day, session: text, duration: text, calories: nonnegative, carbs: nonnegative,
  sessionType: z.enum(['swim', 'lift', 'yoga', 'bike', 'run', 'rest']),
});
const lift = z.strictObject({
  id: z.enum(['A', 'B', 'C']), day: z.enum(['Tue', 'Thu', 'Fri']),
  label: text, focus: text, exercises: z.array(exercise),
  core: z.strictObject({ label: text, items: z.array(exercise) }),
  conditioning: text.optional(),
});
const cardioWeek = z.strictObject({
  week: positive.int(), workout: text, tag: text, longRide: text.optional(),
});
const mealOption = z.strictObject({
  name: text, detail: text, kcal: nonnegative.optional(),
  protein: nonnegative.optional(), headline: z.boolean().optional(),
});
const mealSlot = z.strictObject({ time: text, meal: text, kcal: nonnegative, protein: nonnegative });
const goal = z.strictObject({
  category: z.enum(['primary', 'composition', 'strength', 'maintain']),
  label: text, detail: text.optional(),
});
const groceryGroup = z.strictObject({ group: text, items: z.array(text) });

/** Configuration is data only. Unknown keys (including credentials) are rejected. */
export const athleteConfigSchema = z.strictObject({
  timezone: text.refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch (error) {
      if (error instanceof RangeError) return false;
      throw error;
    }
  }, 'Use an IANA timezone'),
  PROGRAM_START: z.iso.date(),
  PROGRAM_LENGTH_WEEKS: positive.int().max(104),
  profile: z.strictObject({
    age: positive.int(), weightLb: positive, heightInches: positive,
    location: text, job: text, nativeSports: z.array(text), otherMovement: z.array(text),
  }),
  cyclingProfileDefaults: z.strictObject({
    ftpWatts: positive, ftpSource: z.enum(['estimate', 'ramp-test', '20min-test', 'manual', 'strava']),
    ftpTestedOn: z.iso.date().nullable(), weightKg: positive,
    lthr: positive.nullable(), maxHr: positive, restingHr: positive,
  }),
  goals: z.array(goal),
  phases: z.array(phase),
  weeklySchedule: z.array(dayPlan).length(7),
  CRITICAL_RECOVERY_CUE: text,
  lifts: z.array(lift),
  cardioBike: z.array(cardioWeek),
  cardioRun: z.array(cardioWeek),
  cardioSwim: z.array(cardioWeek),
  paceGlossary: z.array(z.strictObject({ key: text, def: text })),
  macros: z.strictObject({
    calories: nonnegative, protein: nonnegative, fat: nonnegative, carbs: nonnegative, cycling: text,
  }),
  dailyTiming: z.array(mealSlot),
  mealOptions: z.strictObject({
    preWorkout: z.array(mealOption), breakfast: z.array(mealOption),
    office: z.array(mealOption), lunch: z.array(mealOption), dinner: z.array(mealOption),
  }),
  mealPrepChecklist: z.array(text),
  hydrationRules: z.strictObject({
    daily: text, preTraining: text, duringTraining: text, postTraining: text,
    saturdayRides: text, note: text,
  }),
  grocery: z.array(groceryGroup),
  saunaRules: z.array(text),
  yogaRules: z.array(text),
  confirmedChoices: z.array(z.strictObject({ choice: text, reason: text })),
  removedExercises: z.array(text),
  dayNotes: z.partialRecord(day, z.strictObject({ title: text, detail: text })),
}).superRefine((config, ctx) => {
  if (new Set(config.weeklySchedule.map((entry) => entry.day)).size !== 7) {
    ctx.addIssue({ code: 'custom', path: ['weeklySchedule'], message: 'Include every weekday exactly once' });
  }
  for (const [index, phase] of config.phases.entries()) {
    if (new Set(phase.weeks).size !== phase.weeks.length ||
        phase.weeks.some((week) => week > config.PROGRAM_LENGTH_WEEKS)) {
      ctx.addIssue({
        code: 'custom', path: ['phases', index, 'weeks'],
        message: 'Phase weeks must be unique and inside the program',
      });
    }
  }
  for (let week = 1; week <= config.PROGRAM_LENGTH_WEEKS; week++) {
    if (config.phases.filter((entry) => entry.weeks.includes(week)).length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['phases'], message: `Week ${week} must have exactly one phase` });
    }
  }
  for (const entries of [config.cardioBike, config.cardioRun, config.cardioSwim]) {
    if (new Set(entries.map((entry) => entry.week)).size !== entries.length ||
        entries.some((entry) => entry.week > config.PROGRAM_LENGTH_WEEKS)) {
      ctx.addIssue({ code: 'custom', message: 'Cardio weeks must be unique and inside the program' });
    }
  }
  if (config.cyclingProfileDefaults.restingHr >= config.cyclingProfileDefaults.maxHr) {
    ctx.addIssue({ code: 'custom', path: ['cyclingProfileDefaults'], message: 'Resting HR must be below maximum HR' });
  }
});

export type AthleteConfig = z.infer<typeof athleteConfigSchema>;
export type Profile = AthleteConfig['profile'];
export type Goal = z.infer<typeof goal>;
export type Phase = z.infer<typeof phase>;
export type DayKey = z.infer<typeof day>;
export type DayPlan = z.infer<typeof dayPlan>;
export type Exercise = z.infer<typeof exercise>;
export type Lift = z.infer<typeof lift>;
export type CardioWeek = z.infer<typeof cardioWeek>;
export type MealSlot = z.infer<typeof mealSlot>;
export type MealOption = z.infer<typeof mealOption>;
export type GroceryGroup = z.infer<typeof groceryGroup>;
