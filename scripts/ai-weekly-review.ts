#!/usr/bin/env node
/**
 * Sunday retrospective: adherence vs plan, fitness delta, standout session,
 * sleep coach, next-week focus. Writes private/data/weekly-review.json.
 *
 * Every number in this artifact is computed. The model supplies narrative only.
 * That split exists because the generated version of this file used to contain
 * an `adherence.actual` array that was a verbatim copy of `adherence.planned`,
 * a self-assigned score, and sleep-drift figures that appeared nowhere in the
 * input.
 */
import type { AiProvenance, Facts, WeeklyReviewBlock } from './lib/types.js';
import { chatSchema, llmAvailable, providerLabel } from './lib/llm.js';
import { weeklyReviewReplySchema } from './lib/schemas.js';
import { computeFacts } from './lib/facts.js';
import {
  loadContext,
  snapshotForPrompt,
  athleteBrief,
  factsBlock,
  feedbackBlock,
  provenance,
  recentHeadlines,
  recentLenses,
  mondayOf,
  writeArtifact,
  GROUNDING_RULES,
} from './lib/ai-context.js';

const TASK = 'weekly-review';
const FILE = 'weekly-review.json';

const SYSTEM = `You are the AI weekly retrospective for a cyclist's health dashboard. It is Sunday
evening. You analyze the week that just ended.

Adherence (day by day, plus the score), the CTL/ATL/TSB deltas, the standout session and the sleep
statistics are ALL computed for you in the FACTS block. You do not produce any of those numbers.

You write narrative only:
- headline: how the week actually went, 1-2 sentences
- adherenceNote: one line on WHY the score is what it is (only if it adds something)
- fitnessNarrative: what the CTL/ATL/TSB movement means physiologically
- standoutWhy: why the given standout session mattered
- trend: a multi-week pattern, citing the trend table
- sleepTarget: ONE concrete target. Not "sleep more" — a specific time or count.
- nextWeekFocus: given current state and the race timeline

${GROUNDING_RULES}`;

function templateReview(facts: Facts) {
  return {
    headline:
      `Adherence ${facts.adherenceWeek.score}% (${facts.adherenceWeek.hits} hit, ` +
      `${facts.adherenceWeek.modified} modified, ${facts.adherenceWeek.skipped} skipped). ` +
      `CTL ${facts.fitness.ctlNow}, TSB ${facts.fitness.tsbNow}.`,
    fitnessNarrative: `Computed deltas only — no language model was available for this run.`,
    standoutWhy: facts.standout
      ? `Top session of the week by ${facts.standout.metric} (${facts.standout.value}).`
      : 'No qualifying sessions logged this week.',
    trend: `Trend interpretation requires a language model. Raw trend table is in the dashboard.`,
    sleepTarget:
      facts.sleep.bedtimeDriftMin > 45
        ? `Pull bedtime variance under 45 min — it is currently ${facts.sleep.bedtimeDriftMin} min.`
        : `Hold the current bedtime window; drift is ${facts.sleep.bedtimeDriftMin} min.`,
    nextWeekFocus: `Next-week focus requires a language model.`,
  };
}

/** Assemble the final block from computed facts plus whatever narrative we have. */
function assemble(
  facts: Facts,
  forWeek: string,
  narrative: ReturnType<typeof templateReview> & { adherenceNote?: string },
  prov: AiProvenance,
): WeeklyReviewBlock {
  return {
    ...prov,
    forWeek,
    headline: narrative.headline,
    adherence: {
      planned: facts.adherenceWeek.days.map((d) => d.planned),
      actual: facts.adherenceWeek.days.map((d) => d.actual),
      score: facts.adherenceWeek.score,
      note:
        narrative.adherenceNote ||
        `${facts.adherenceWeek.hits} hit · ${facts.adherenceWeek.modified} modified · ${facts.adherenceWeek.skipped} skipped`,
    },
    fitnessDelta: {
      ctlChange: facts.fitness.ctlChange,
      atlChange: facts.fitness.atlChange,
      tsbChange: facts.fitness.tsbChange,
      narrative: narrative.fitnessNarrative,
    },
    standout: {
      activity: facts.standout
        ? `${facts.standout.activity} (${facts.standout.date})`
        : 'No activities logged',
      why: narrative.standoutWhy,
    },
    trend: narrative.trend,
    sleepCoach: {
      bedtimeDriftMin: facts.sleep.bedtimeDriftMin,
      durationVarianceMin: facts.sleep.durationVarianceMin,
      target: narrative.sleepTarget,
    },
    nextWeekFocus: narrative.nextWeekFocus,
  };
}

async function main() {
  const ctx = await loadContext(TASK, process.env.FOR_DATE || undefined);
  const forWeek = mondayOf(ctx.today);

  const facts = computeFacts({
    snapshot: ctx.snapshot,
    template: ctx.program.template,
    weekStart: forWeek,
    today: ctx.today,
    forDate: ctx.today,
    lifts: ctx.lifts,
    recentLenses: recentLenses(ctx.history),
  });

  const model = providerLabel(TASK);
  const tpl = templateReview(facts);

  const writeTemplate = async (reason: string) => {
    const out = assemble(
      facts,
      forWeek,
      tpl,
      provenance(ctx, 'template', { isTemplate: true, fallbackReason: reason }),
    );
    await writeArtifact(FILE, 'weekly-review', out);
    console.log(`Wrote template ${FILE} for ${forWeek} (${reason}).`);
  };

  if (!llmAvailable()) {
    await writeTemplate('no LLM provider configured');
    return;
  }

  const prior = recentHeadlines(ctx.history, 'weekly-review');

  const user = [
    athleteBrief(ctx),
    ``,
    `Reviewing the week starting Monday ${forWeek} (today is ${ctx.today}).`,
    ``,
    factsBlock(facts),
    ``,
    prior.length
      ? `Your recent weekly headlines (do NOT repeat these angles):\n${prior.map((h) => `- ${h}`).join('\n')}`
      : '',
    feedbackBlock(ctx, 'weekly-review'),
    ``,
    `SNAPSHOT DATA:`,
    snapshotForPrompt(ctx.snapshot, 'weekly'),
  ]
    .filter(Boolean)
    .join('\n');

  if (process.env.PRINT_PROMPT === '1') {
    console.log(`--- SYSTEM ---\n${SYSTEM}\n\n--- USER ---\n${user}`);
    return;
  }

  try {
    console.log(`Generating weekly review via ${model}…`);
    const { data, usage } = await chatSchema(
      SYSTEM,
      user,
      weeklyReviewReplySchema,
      'weekly_review',
      { task: TASK, temperature: 0.25, maxTokens: 1200 },
    );
    const out = assemble(facts, forWeek, data, provenance(ctx, model, usage ? { usage } : {}));
    await writeArtifact(FILE, 'weekly-review', out);
    console.log(`Wrote ${FILE} for ${forWeek}: ${out.headline}`);
  } catch (e) {
    console.warn(`LLM failed (${(e as Error).message}); using template.`);
    await writeTemplate((e as Error).message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
