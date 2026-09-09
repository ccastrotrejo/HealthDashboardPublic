#!/usr/bin/env node
/**
 * Race-week plan: taper, pacing, fuelling and logistics for the next A-race.
 * Writes private/data/race-week.json.
 *
 * Runs daily but no-ops unless a race is inside the window, so it costs nothing
 * for most of the season. `daysToRace` was already computed and injected into
 * every prompt; only the coach ever had a race-week rule, and there was no
 * dedicated race-week artifact at all despite `RaceWeekCard` existing in the UI.
 */
import { rm } from 'node:fs/promises';
import { dataPath } from './lib/storage.js';
import type { RaceWeekBlock } from './lib/types.js';
import { chatSchema, llmAvailable, providerLabel } from './lib/llm.js';
import { raceWeekReplySchema } from './lib/schemas.js';
import { computeFacts } from './lib/facts.js';
import {
  loadContext,
  snapshotForPrompt,
  athleteBrief,
  factsBlock,
  feedbackBlock,
  provenance,
  recentLenses,
  mondayOf,
  dayKeyFor,
  shiftDate,
  sanitize,
  writeArtifact,
  GROUNDING_RULES,
} from './lib/ai-context.js';

const TASK = 'race-week';
const FILE = 'race-week.json';
const OUT = dataPath(FILE);

/** How many days before a race the plan starts being published. */
const WINDOW_DAYS = 10;

const SYSTEM = `You are the AI race-week planner for a cyclist's health dashboard. A race is
approaching. You produce the taper, the pacing plan, the fuelling plan and the logistics checklist.

Principles:
- Taper reduces VOLUME sharply while preserving INTENSITY. Keep short race-pace efforts; cut duration.
- Do not introduce any session type the athlete has not been doing. Race week is not the time.
- Pacing must be grounded in the race predictions and recent session paces you were given, not in
  generic advice. If the predictions disagree with each other, say which you are using and why.
- Fuelling must respect the athlete's stated staples rather than inventing a new nutrition strategy.
- Every day from today through race day inclusive gets an entry.

${GROUNDING_RULES}`;

async function main() {
  const ctx = await loadContext(TASK, process.env.FOR_DATE || undefined);
  const race = ctx.nextRace;

  if (!race || ctx.daysToRace == null || ctx.daysToRace > WINDOW_DAYS) {
    // Remove a stale plan for a race that has already happened, so the UI can't
    // keep showing a taper for last month's event.
    await rm(OUT, { force: true });
    console.log(
      race
        ? `Next race ${race.date} is ${ctx.daysToRace} days out — outside the ${WINDOW_DAYS}-day window. Nothing to do.`
        : 'No upcoming race on the calendar. Nothing to do.',
    );
    return;
  }

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
  const daysOut = ctx.daysToRace;

  const dayList = Array.from({ length: daysOut + 1 }, (_, i) => {
    const date = shiftDate(ctx.today, i);
    const key = dayKeyFor(date);
    return {
      date,
      weekday: key,
      programSession: ctx.program.template.find((t) => t.day === key)?.session ?? 'unknown',
    };
  });

  const writeTemplate = async (reason: string) => {
    const out: RaceWeekBlock = {
      ...provenance(ctx, 'template', { isTemplate: true, fallbackReason: reason }),
      raceId: race.id,
      raceName: race.name,
      raceDate: race.date,
      daysOut,
      headline: `${race.name} in ${daysOut} days. Taper not generated — no language model available.`,
      days: dayList.map((d) => ({
        weekday: d.weekday,
        date: d.date,
        session: d.programSession,
        intensity: 'easy' as const,
        durationMinutes: 45,
        purpose: 'Program session, unadjusted for taper.',
      })),
      pacing: {
        target: 'Pacing plan requires a language model.',
        splits: [],
        contingency: 'n/a',
      },
      fuelling: { before: 'n/a', during: 'n/a', after: 'n/a' },
      checklist: [],
      readiness: `CTL ${facts.fitness.ctlNow}, ATL ${facts.fitness.atlNow}, TSB ${facts.fitness.tsbNow}.`,
    };
    await writeArtifact(FILE, 'race-week', out);
    console.log(`Wrote template ${FILE} for ${race.name} (${reason}).`);
  };

  if (!llmAvailable()) {
    await writeTemplate('no LLM provider configured');
    return;
  }

  const goal = race.goal;
  const goalLine = goal?.timeSeconds
    ? `Goal time: ${Math.floor(goal.timeSeconds / 3600)}h${String(Math.floor((goal.timeSeconds % 3600) / 60)).padStart(2, '0')}.`
    : goal?.finishOnly
      ? 'Goal: finish.'
      : 'No explicit goal time set.';

  const user = [
    athleteBrief(ctx),
    ``,
    `RACE: ${sanitize(race.name)} on ${race.date} — ${daysOut} days out.`,
    `Sport: ${race.sport}. Priority: ${race.priority}. Status: ${race.status}.`,
    race.distance ? `Distance: ${race.distance.label} (${race.distance.meters} m).` : '',
    race.location ? `Location: ${sanitize(race.location.name)}.` : '',
    race.terrain ? `Terrain: ${race.terrain}.` : '',
    race.elevationGainMeters != null ? `Elevation gain: ${race.elevationGainMeters} m.` : '',
    goalLine,
    race.notes ? `Athlete notes: ${sanitize(race.notes, 300)}` : '',
    ``,
    `Days to plan (one entry each, today through race day):`,
    ...dayList.map((d) => `  ${d.weekday} ${d.date} — program would say: ${d.programSession}`),
    ``,
    factsBlock(facts),
    feedbackBlock(ctx, 'race-week'),
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
    console.log(`Generating race-week plan via ${model}…`);
    const { data, usage } = await chatSchema(SYSTEM, user, raceWeekReplySchema, 'race_week', {
      task: TASK,
      temperature: 0.3,
      maxTokens: 2200,
    });

    const out: RaceWeekBlock = {
      ...provenance(ctx, model, usage ? { usage } : {}),
      raceId: race.id,
      raceName: race.name,
      raceDate: race.date,
      daysOut,
      headline: data.headline,
      days: data.days,
      pacing: data.pacing,
      fuelling: data.fuelling,
      checklist: data.checklist,
      readiness: data.readiness,
    };
    await writeArtifact(FILE, 'race-week', out);
    console.log(`Wrote ${FILE} for ${race.name}: ${out.headline}`);
  } catch (e) {
    console.warn(`LLM failed (${(e as Error).message}); using template.`);
    await writeTemplate((e as Error).message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
