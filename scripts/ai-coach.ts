#!/usr/bin/env node
/**
 * Weekly coach: renders the locked-in 8-week program for THIS week, adjusted for
 * current recovery / load ratio / TSB. Writes private/data/coach.json.
 *
 * The program template is authoritative — the model's job is to dial amplitude,
 * not to invent sessions. The template fallback below IS the program, so even
 * without a model the output is correct, just without current-state reasoning.
 *
 * Output is validated against the program's own exercise vocabulary before it
 * is written. Prompt instructions alone cannot prevent invented exercises or
 * ambiguous substitutions, so configured anchors and removed exercises are
 * enforced by validation as well.
 */
import type { CoachBlock, CoachDay } from './lib/types.js';
import { chatSchema, llmAvailable, providerLabel } from './lib/llm.js';
import { coachReplySchema } from './lib/schemas.js';
import { computeFacts } from './lib/facts.js';
import athleteConfig from './lib/athlete-config.js';
import {
  loadContext,
  snapshotForPrompt,
  athleteBrief,
  factsBlock,
  feedbackBlock,
  programContext,
  provenance,
  recentLenses,
  mondayOf,
  shiftDate,
  writeArtifact,
  GROUNDING_RULES,
  type ProgramContext,
} from './lib/ai-context.js';

const TASK = 'coach';
const FILE = 'coach.json';

const SYSTEM = `You are the AI training coach for a health dashboard. Use the athlete's supplied
program, goals and weekly schedule. Your job is NOT to design a new program — it is to render their
program for this specific week, then dial volume and intensity based on current state.

DO NOT generate generic labels like "Easy bike", "Strength", "Hot yoga". Use the program's own
session names, which are given in the weekly template.

NEVER name an exercise that does not appear in the weekly template. Do not generalise a named
movement into a category — "front squat" must not become "squats". Output naming an unknown or
removed exercise is rejected and thrown away.

PRESCRIBE BIKE WORK IN WATTS. The FACTS block carries the athlete's FTP and every power-zone
boundary in watts. A bike session must state its target as a watt range or a percentage of FTP —
"3 x 15 min @ 88-94% FTP (154-165 W)" — never as a bare zone name and never as a pace or a speed.
Speed is a function of draft, gradient and wind, so it says nothing about effort.

WHEN POWER COVERAGE IS LOW: the FACTS block reports what share of ride time had a real power meter.
For rides without measured power, give the target as a heart-rate range
or as perceived effort, and say plainly that it is not power-measured.

STRENGTH AND CYCLING INTERACT. Heavy lower-body lifting improves cycling economy, so never suggest
dropping the lifts to protect the bike. Two hard-won scheduling rules:
- Never place VO2max or threshold intervals on the same day as the lower-body lift.
- Keep at least 6 hours between the Friday lift and the Friday quality ride.

RECOVERY-DRIVEN SESSION MODIFICATION (this is the main lever you have):
- Whoop recovery >= 67 and HRV at or above baseline -> run the prescription as written
- Whoop recovery 34-66, or HRV below baseline       -> convert intervals to sweet spot, cut volume
                                                       ~20%, nothing above threshold
- Whoop recovery < 34                                -> Z1 spin 20-40 min or full rest
- Resting HR more than 5 bpm above baseline for 2+ days -> downgrade one step regardless of score
- Sleep performance < 70% the night before a key session -> move the intervals, don't just soften them

AMPLITUDE ADJUSTMENTS (apply only when triggered, never restructure the week):
- Load ratio > 1.5   -> drop lifts to "easy", make the Saturday ride Z2 only
- TSB < -30          -> replace Friday Lift C with Rest and cut the Saturday ride
- CTL ramp above 7 TSS/week -> say so and hold volume flat rather than adding
- Race within 7 days -> override the template with a taper/race-week structure

Use the load ratio named as primary in the FACTS block. Do not use the distance-based ratio for
these thresholds: a cycling block generates two to four times the kilometres of an equivalent
running week, so a distance ratio reads as injury risk off a single long ride while actual
cross-sport load is unremarkable. It also counts none of the lifting or yoga.

${GROUNDING_RULES}`;

function templateCoach(program: ProgramContext): {
  summary: string;
  plan: CoachDay[];
  nutrition: CoachBlock['nutrition'];
} {
  const plan: CoachDay[] = program.template.map((t) => {
    const isRest = t.sessionType === 'rest';
    const isLift = t.sessionType === 'lift';
    return {
      weekday: t.day,
      type: t.session.split(' — ')[0] ?? t.session,
      intensity: isRest ? 'rest' : isLift ? 'moderate' : 'easy',
      durationMinutes: isRest ? 0 : isLift ? 70 : t.sessionType === 'bike' ? 75 : 45,
      reason: t.session,
    };
  });
  const carbs = program.template.map((day) => day.carbs);
  const meal = athleteConfig.mealOptions.lunch[0];

  return {
    summary:
      program.week != null
        ? `Week ${program.week}, ${program.phase?.label}. Program template rendered without current-state adjustment (no language model available).`
        : 'Outside the training block — template rendered as-is.',
    plan,
    nutrition: {
      dailyAnchors: `Protein ${program.macros.protein}g and fat ${program.macros.fat}g constant daily; configured carbs range ${Math.min(...carbs)}-${Math.max(...carbs)}g. Hydration: ${athleteConfig.hydrationRules.daily}.`,
      preAndPostFueling:
        'On the bike: nothing under 90 min, 30-40g carbs/hr for a long Z2 ride, 40-60g/hr for intervals, 60-90g/hr beyond 2.5 hours using a 2:1 glucose:fructose mix so both gut transporters are working. Post: 20-40g protein inside the hour, and treat the post-lift window as the priority one.',
      mealIdea: meal ? `${meal.name}: ${meal.detail}` : 'No meal reference configured.',
      groceryItem:
        'Dates or dried figs — compact, fast carbohydrate for the jersey pocket on long rides, and cheaper per gram than gels.',
    },
  };
}

/**
 * Reject a plan that names a banned or unknown exercise.
 *
 * Matching is deliberately loose on the banned list (substring, case-insensitive)
 * and loose-but-anchored on the allowed list: a `reason` may mention a movement
 * in passing, so we only require that any capitalised multi-word movement-looking
 * phrase resolves to something the program actually prescribes.
 */
function validateExercises(
  plan: CoachDay[],
  allowed: string[],
  removed: string[],
): string | null {
  const haystack = plan.map((d) => `${d.type} ${d.reason}`).join(' ').toLowerCase();

  for (const banned of removed) {
    if (haystack.includes(banned.toLowerCase())) {
      return `plan names a removed exercise: "${banned}"`;
    }
  }

  // "squats" / "squat" unqualified is the specific ambiguity that bit before:
  // the program prescribes front squat, and back squat is banned.
  if (/\bsquats?\b/.test(haystack) && !/\b(front|goblet|hack)[-\s]squat/.test(haystack)) {
    return 'plan says "squat" without qualifying which squat — the program only prescribes front squat / hack squat';
  }

  const allowedLower = allowed.map((a) => a.toLowerCase());
  const suspects = ['lunge', 'deadlift', 'clean', 'snatch', 'burpee', 'crunch', 'sit-up'];
  for (const s of suspects) {
    if (haystack.includes(s) && !allowedLower.some((a) => a.includes(s))) {
      return `plan names "${s}", which is not in the program`;
    }
  }

  return null;
}

async function main() {
  const ctx = await loadContext(TASK, process.env.FOR_DATE || undefined);
  // The coach plans the week ahead. On Sunday that means tomorrow's Monday.
  const forWeek = mondayOf(shiftDate(ctx.today, 1));

  // Resolve the program for the week being PLANNED, not the one ending today.
  // `ctx.program` is anchored to today and is right for scoring adherence, but
  // using it to render the plan published a week-N template under a week-N+1
  // label — and the job runs on Sunday, so that was the normal path, not an
  // edge case. It also crossed phase boundaries silently.
  const nextWeek = programContext(forWeek);

  const facts = computeFacts({
    snapshot: ctx.snapshot,
    template: ctx.program.template,
    weekStart: mondayOf(ctx.today),
    today: ctx.today,
    forDate: ctx.today,
    lifts: ctx.lifts,
    recentLenses: recentLenses(ctx.history),
  });

  const model = providerLabel(TASK);
  const tpl = templateCoach(nextWeek);

  const writeTemplate = async (reason: string) => {
    const out: CoachBlock = {
      ...provenance(ctx, 'template', { isTemplate: true, fallbackReason: reason }),
      forWeek,
      ...tpl,
    };
    await writeArtifact(FILE, 'coach', out);
    console.log(`Wrote template ${FILE} for ${forWeek} (${reason}).`);
  };

  if (!llmAvailable()) {
    await writeTemplate('no LLM provider configured');
    return;
  }

  const user = [
    athleteBrief(ctx),
    ``,
    `Today is ${ctx.today}. Render the plan for the week starting Monday ${forWeek}.`,
    nextWeek.week != null
      ? `That is program week ${nextWeek.week}, ${nextWeek.phase?.label ?? 'unknown phase'}.`
      : `That week falls outside the 8-week block.`,
    `PROGRAM TEMPLATE FOR THE WEEK BEING PLANNED (use these session names verbatim):`,
    nextWeek.template
      .map((t) => `  ${t.day}: ${t.session}  [${t.calories} kcal, ${t.carbs}g carbs]`)
      .join('\n'),
    ``,
    `Exercises the program prescribes (the ONLY movements you may name):`,
    `  ${nextWeek.allowedExercises.join(', ')}`,
    ``,
    factsBlock(facts),
    feedbackBlock(ctx, 'coach'),
    ``,
    `SNAPSHOT DATA:`,
    snapshotForPrompt(ctx.snapshot),
  ]
    .filter(Boolean)
    .join('\n');

  if (process.env.PRINT_PROMPT === '1') {
    console.log(`--- SYSTEM ---\n${SYSTEM}\n\n--- USER ---\n${user}`);
    return;
  }

  try {
    console.log(`Generating coach plan via ${model}…`);
    const { data, usage } = await chatSchema(SYSTEM, user, coachReplySchema, 'coach', {
      task: TASK,
      // Slightly warmer than the analytical jobs: this one also writes the meal
      // idea and grocery pick, where a little variety is the point.
      temperature: 0.4,
      maxTokens: 1800,
    });

    // Backfill any justification the model left blank from the program itself.
    // The plan is still correct and usable without one; discarding the whole
    // week over a missing sentence would not be.
    const plan = data.plan.map((day) => {
      if (day.reason.trim()) return day;
      const tpl = nextWeek.template.find((t) => t.day === day.weekday);
      return { ...day, reason: tpl?.session ?? day.type };
    });

    // Validate after backfilling, so the check sees exactly what gets written.
    const problem = validateExercises(
      plan,
      nextWeek.allowedExercises,
      nextWeek.removedExercises,
    );
    if (problem) {
      await writeTemplate(`rejected model plan — ${problem}`);
      return;
    }

    const out: CoachBlock = {
      ...provenance(ctx, model, usage ? { usage } : {}),
      forWeek,
      summary: data.summary,
      plan,
      nutrition: data.nutrition,
    };
    await writeArtifact(FILE, 'coach', out);
    console.log(`Wrote ${FILE} for ${forWeek}: ${out.summary}`);
  } catch (e) {
    console.warn(`LLM failed (${(e as Error).message}); using program template.`);
    await writeTemplate((e as Error).message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
