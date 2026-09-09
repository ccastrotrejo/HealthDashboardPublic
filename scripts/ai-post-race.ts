#!/usr/bin/env node
/**
 * Post-race analysis: goal vs actual, per-leg breakdown, what the build-up
 * predicted, and lessons for the next block. Writes private/data/post-race.json.
 *
 * Only runs when the most recent completed race has a result recorded and that
 * result hasn't been analysed yet, so it is idempotent and cheap.
 *
 * `RaceResult` has been a fully-specified type with finish time, placement and
 * per-leg splits since the races feature shipped, and nothing ever read it back.
 */
import { readFile } from 'node:fs/promises';
import { dataPath } from './lib/storage.js';
import { DAY_MS, utcDateTime } from '../utils/date.js';
import type { PostRaceBlock, RaceLegSplit } from './lib/types.js';
import { chatSchema, llmAvailable, providerLabel } from './lib/llm.js';
import { postRaceReplySchema } from './lib/schemas.js';
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
  sanitize,
  writeArtifact,
  GROUNDING_RULES,
} from './lib/ai-context.js';

const TASK = 'post-race';
const FILE = 'post-race.json';

/** Don't analyse a race more than this long after the fact. */
const MAX_AGE_DAYS = 21;

const OUT = dataPath(FILE);

/**
 * Which race the committed artifact already covers.
 *
 * Reads the artifact itself rather than the artifact history: `loadHistory`
 * returns only the last 40 lines, and the normal schedule appends three entries
 * a day, so the "already analysed" marker scrolls out of the tail after roughly
 * twelve days — well inside the 21-day analysis window. The job would then
 * re-run the full LLM call and rewrite the file every day, appending another
 * entry each time and shortening the window further.
 */
async function analysedRaceId(): Promise<string | null> {
  try {
    const raw = await readFile(OUT, 'utf8');
    return (JSON.parse(raw) as Partial<PostRaceBlock>).raceId ?? null;
  } catch {
    return null;
  }
}

const SYSTEM = `You are the AI post-race analyst for a cyclist's health dashboard. The athlete has
just raced and the result is in.

The outcome arithmetic — goal vs actual, the delta, the verdict — is computed for you. You write the
interpretation: what the build-up predicted, where the race was won or lost, and what to change.

Be honest. If the result was worse than the build-up suggested, say so and identify the most likely
cause from the data (taper, sleep, load ratio, adherence, pacing). If it was better, identify what
worked so it can be repeated.

Lessons must be specific and actionable. "Pace better" is not a lesson. "Go out 10s/km slower for
the first 3 km — you lost 45s in the back half" is.

${GROUNDING_RULES}`;

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

async function main() {
  const ctx = await loadContext(TASK, process.env.FOR_DATE || undefined);
  const race = ctx.lastCompletedRace;

  if (!race?.result?.finishSeconds) {
    console.log('No completed race with a recorded result. Nothing to do.');
    return;
  }

  const ageDays = Math.round(
    (utcDateTime(ctx.today) - utcDateTime(race.date)) / DAY_MS,
  );
  if (ageDays > MAX_AGE_DAYS && process.env.FORCE !== '1') {
    console.log(`Most recent result (${race.name}, ${race.date}) is ${ageDays} days old. Skipping.`);
    return;
  }

  const alreadyDone = (await analysedRaceId()) === race.id;
  if (alreadyDone && process.env.FORCE !== '1') {
    console.log(`${race.name} (${race.date}) has already been analysed. Skipping.`);
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

  const actual = race.result.finishSeconds;
  const goalSeconds = race.goal?.timeSeconds ?? null;
  const delta = goalSeconds != null ? actual - goalSeconds : null;
  const verdict: PostRaceBlock['outcome']['verdict'] =
    goalSeconds == null
      ? 'no-goal'
      : delta! <= -1
        ? 'beat'
        : Math.abs(delta!) <= Math.max(30, goalSeconds * 0.01)
          ? 'met'
          : 'missed';

  const legs: RaceLegSplit[] = race.result.legs ?? [];
  const model = providerLabel(TASK);

  const writeTemplate = async (reason: string) => {
    const out: PostRaceBlock = {
      ...provenance(ctx, 'template', { isTemplate: true, fallbackReason: reason }),
      raceId: race.id,
      raceName: race.name,
      raceDate: race.date,
      headline: `${race.name}: ${fmt(actual)}${goalSeconds != null ? ` vs ${fmt(goalSeconds)} goal` : ''}.`,
      outcome: {
        goalSeconds,
        actualSeconds: actual,
        deltaSeconds: delta,
        verdict,
        narrative: 'Analysis requires a language model.',
      },
      legs: legs.map((l) => ({ name: l.name, durationSeconds: l.durationSeconds, note: '' })),
      executionVsBuildUp: 'Requires a language model.',
      lessons: [],
      recovery: {
        restDays: 3,
        guidance: 'Default post-race window. No individualised guidance without a language model.',
      },
    };
    await writeArtifact(FILE, 'post-race', { ...out, forDate: race.date });
    console.log(`Wrote template ${FILE} for ${race.name} (${reason}).`);
  };

  if (!llmAvailable()) {
    await writeTemplate('no LLM provider configured');
    return;
  }

  const r = race.result;
  const user = [
    athleteBrief(ctx),
    ``,
    `RACE JUST COMPLETED: ${sanitize(race.name)} on ${race.date} (${ageDays} days ago).`,
    `Sport: ${race.sport}. Priority: ${race.priority}.`,
    race.distance ? `Distance: ${race.distance.label}.` : '',
    ``,
    `COMPUTED OUTCOME (authoritative):`,
    `  Finish: ${fmt(actual)} (${actual}s)`,
    goalSeconds != null ? `  Goal:   ${fmt(goalSeconds)} (${goalSeconds}s)` : '  Goal:   none set',
    delta != null
      ? `  Delta:  ${delta >= 0 ? '+' : ''}${delta}s (${verdict})`
      : `  Verdict: ${verdict}`,
    r.overallPlace != null
      ? `  Place:  ${r.overallPlace}${r.overallFinishers != null ? ` of ${r.overallFinishers}` : ''}`
      : '',
    r.divisionPlace != null ? `  Division: ${r.divisionPlace} in ${r.division ?? 'age group'}` : '',
    legs.length
      ? `  Legs: ${legs.map((l) => `${l.name} ${fmt(l.durationSeconds)}${l.paceLabel ? ` (${l.paceLabel})` : ''}`).join(' · ')}`
      : '',
    r.notes ? `  Athlete notes: ${sanitize(r.notes, 400)}` : '',
    ``,
    `What the build-up looked like — use this to judge execution vs preparation:`,
    factsBlock(facts),
    feedbackBlock(ctx, 'post-race'),
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
    console.log(`Generating post-race analysis via ${model}…`);
    const { data, usage } = await chatSchema(SYSTEM, user, postRaceReplySchema, 'post_race', {
      task: TASK,
      temperature: 0.3,
      maxTokens: 1800,
    });

    const noteFor = (name: string) =>
      data.legNotes.find((n) => n.name.toLowerCase() === name.toLowerCase())?.note ?? '';

    const out: PostRaceBlock = {
      ...provenance(ctx, model, usage ? { usage } : {}),
      raceId: race.id,
      raceName: race.name,
      raceDate: race.date,
      headline: data.headline,
      outcome: {
        goalSeconds,
        actualSeconds: actual,
        deltaSeconds: delta,
        verdict,
        narrative: data.outcomeNarrative,
      },
      legs: legs.map((l) => ({
        name: l.name,
        durationSeconds: l.durationSeconds,
        note: noteFor(l.name),
      })),
      executionVsBuildUp: data.executionVsBuildUp,
      lessons: data.lessons,
      recovery: {
        // One easy day per hour raced is the common rule of thumb; clamp to a
        // sane range so a very long or very short event doesn't produce nonsense.
        restDays: Math.min(10, Math.max(1, Math.round(actual / 3600))),
        guidance: data.recoveryGuidance,
      },
    };
    await writeArtifact(FILE, 'post-race', { ...out, forDate: race.date });
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
