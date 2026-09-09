#!/usr/bin/env node
/**
 * End-of-day debrief: how TODAY went vs the program plan, plus tomorrow's setup.
 * Writes private/data/today-debrief.json.
 *
 * Runs in the evening when today's strain has accumulated and tomorrow is close
 * enough that a "tonight" action is actionable.
 *
 * Adherence is computed, not asked for. The model previously decided for itself
 * whether a day was hit/modified/skipped and could contradict the activity list
 * it was looking at; here it only gets to add a one-line gloss.
 */
import type { Facts, TodayDebriefBlock } from './lib/types.js';
import { chatSchema, llmAvailable, providerLabel } from './lib/llm.js';
import { todayDebriefReplySchema } from './lib/schemas.js';
import { computeFacts } from './lib/facts.js';
import {
  loadContext,
  snapshotForPrompt,
  athleteBrief,
  factsBlock,
  feedbackBlock,
  provenance,
  recentLenses,
  shiftDate,
  dayKeyFor,
  mondayOf,
  writeArtifact,
  GROUNDING_RULES,
  type AiContext,
} from './lib/ai-context.js';
import { sanitizeHeadline } from './lib/sanitize.js';

const TASK = 'today-debrief';
const FILE = 'today-debrief.json';

const SYSTEM = `You are the AI end-of-day debrief for a cyclist's health dashboard. It is evening.
You analyze what happened TODAY (not yesterday) against the program plan, then set up tomorrow.

Adherence status and the day's activity list are computed for you and given in the FACTS block.
Do not restate or re-derive them — your \`adherenceNote\` is a single line of interpretation, and
only when it adds something the status doesn't already say.

Only include "research" when there is a real story (anomaly, PR, deload start, race week). Do not
repeat what this morning's insight already covered.

${GROUNDING_RULES}`;

function templateDebrief(ctx: AiContext, facts: Facts, tomorrowPlan: string) {
  return {
    headline: `${ctx.today}: ${facts.adherenceToday.status} — ${facts.adherenceToday.actual}.`,
    highlights: facts.highlights,
    tomorrow: {
      planned: tomorrowPlan,
      readiness:
        `Recovery ${ctx.snapshot.daily?.recovery?.score ?? '—'}%, TSB ${facts.fitness.tsbNow}, ` +
        `load ratio ${facts.load.ratio ?? '—'} (${facts.load.zone}).`,
      target:
        facts.sleep.meanAsleepHours != null && facts.sleep.meanAsleepHours < 7.5
          ? `Lights out 30 min earlier — the 14-night mean is ${facts.sleep.meanAsleepHours}h.`
          : 'Hold the current bedtime; the recent sleep window is on target.',
    },
    flags: [] as string[],
  };
}

async function main() {
  const ctx = await loadContext(TASK, process.env.FOR_DATE || undefined);
  const todayKey = dayKeyFor(ctx.today);
  const tomorrow = shiftDate(ctx.today, 1);
  const tomorrowKey = dayKeyFor(tomorrow);
  const tomorrowPlan =
    ctx.program.template.find((t) => t.day === tomorrowKey)?.session ?? 'unknown';

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
  const tpl = templateDebrief(ctx, facts, tomorrowPlan);

  const adherence: TodayDebriefBlock['adherence'] = {
    planned: facts.adherenceToday.planned,
    actual: facts.adherenceToday.actual,
    // 'future' can't occur for today, but the type is shared with the weekly view.
    status: facts.adherenceToday.status === 'future' ? 'rest-day' : facts.adherenceToday.status,
  };

  const writeTemplate = async (reason: string) => {
    const out: TodayDebriefBlock = {
      ...provenance(ctx, 'template', { isTemplate: true, fallbackReason: reason }),
      forDate: ctx.today,
      ...tpl,
      adherence,
    };
    await writeArtifact(FILE, 'today-debrief', out);
    console.log(`Wrote template ${FILE} for ${ctx.today} (${reason}).`);
  };

  if (!llmAvailable()) {
    await writeTemplate('no LLM provider configured');
    return;
  }

  const user = [
    athleteBrief(ctx),
    ``,
    `Today is ${ctx.today} (${todayKey}). Tomorrow is ${tomorrow} (${tomorrowKey}).`,
    `Program says tomorrow: ${tomorrowPlan}`,
    ``,
    factsBlock(facts),
    ``,
    ctx.insights
      ? `This morning's insight headline (do NOT repeat it): ${sanitizeHeadline(ctx.insights.headline)}`
      : '',
    feedbackBlock(ctx, 'today-debrief'),
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
    console.log(`Generating today-debrief via ${model}…`);
    const { data, usage } = await chatSchema(
      SYSTEM,
      user,
      todayDebriefReplySchema,
      'today_debrief',
      { task: TASK, temperature: 0.25, maxTokens: 1200 },
    );

    const out: TodayDebriefBlock = {
      ...provenance(ctx, model, usage ? { usage } : {}),
      forDate: ctx.today,
      headline: data.headline,
      highlights: facts.highlights.length ? facts.highlights : data.highlights,
      adherence: data.adherenceNote
        ? { ...adherence, actual: `${adherence.actual} — ${data.adherenceNote}` }
        : adherence,
      tomorrow: { ...data.tomorrow, planned: tomorrowPlan },
      research: data.research,
      flags: data.flags,
    };
    await writeArtifact(FILE, 'today-debrief', out);
    console.log(`Wrote ${FILE} for ${ctx.today}: ${out.headline}`);
  } catch (e) {
    console.warn(`LLM failed (${(e as Error).message}); using template.`);
    await writeTemplate((e as Error).message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
