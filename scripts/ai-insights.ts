#!/usr/bin/env node
/**
 * Morning recap: analyzes YESTERDAY and writes private/data/insights.json.
 *
 * The research lens is chosen deterministically in `computeFacts` — anomaly
 * first, then recovery debt, then a rotation over the remaining lenses using
 * the artifact history so the rotation actually rotates. The model is told
 * which lens to write rather than asked to pick one and remember yesterday's
 * choice, which it structurally could not do.
 *
 * Falls back to a deterministic template when no LLM provider is configured or
 * the call fails, so the workflow never dies on a flaky model endpoint. The
 * fallback marks itself `isTemplate` so the UI can badge it instead of
 * presenting placeholder prose as analysis.
 */
import type { Facts, InsightsBlock } from './lib/types.js';
import { chatSchema, llmAvailable, providerLabel } from './lib/llm.js';
import { insightsReplySchema } from './lib/schemas.js';
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
  shiftDate,
  dayKeyFor,
  mondayOf,
  writeArtifact,
  GROUNDING_RULES,
  type AiContext,
} from './lib/ai-context.js';

const TASK = 'insights';
const FILE = 'insights.json';

const LENS_BRIEF: Record<string, string> = {
  anomaly:
    'Diagnose the active anomalies. What does that combination of signals typically indicate physiologically, and what does it imply for the planned session? Title: "Anomaly: <short label>".',
  'recovery-debt':
    'Narrate the recovery debt. How much has accumulated, what load profile produced it, and how many easy days until TSB reaches −10 (the FACTS block gives the number). Title: "Recovery debt: <X days at TSB Y>".',
  'hrv-vs-stimulus': 'Relate the HRV trend to the training stimulus that preceded it.',
  'sleep-vs-recovery': 'Relate sleep regularity and duration to the recovery scores that followed.',
  'acwr-vs-subjective':
    'Compare the objective load ratio against how the sessions were actually rated or felt.',
  'cross-source-agreement':
    'Examine where Whoop, Strava and Garmin disagree and what that means for trusting the numbers.',
  'program-adherence':
    'Examine adherence against the program template and what the deviations cost.',
  'zone-polarization':
    'Examine the intensity distribution against the target for this block. This is a pyramidal ' +
    'sweet-spot build, not a polarized one — at 6-8 h/week the evidence favours roughly 70-75% ' +
    'easy, 20% tempo/sweet spot and 5-10% above threshold, rather than a strict 80/10/10. Judge ' +
    'against that, and note whether the hard minutes are landing on the prescribed interval days.',
};

const SYSTEM = `You are the AI analyst for a cyclist's personal health dashboard. You analyze
YESTERDAY's data and produce a structured recap.

You are given a FACTS block computed deterministically from the athlete's data. Those numbers are
authoritative: quote them and interpret them, but never recompute or contradict them.

Your value is physiological interpretation — explaining what the numbers mean together — not
restating them. The research section's lens is chosen for you; write that lens and no other.

${GROUNDING_RULES}`;

/**
 * Deterministic fallback. Unlike the previous version this is genuinely useful
 * on its own: the highlights carry real baseline comparisons and the research
 * section reports the selected lens with the computed numbers behind it.
 */
function templateInsights(ctx: AiContext, facts: Facts, forDate: string) {
  const trendLines = facts.trends
    .filter((t) => t.latest != null)
    .map((t) => `${t.label} ${t.latest} (30d mean ${t.mean30 ?? '—'}, ${t.direction})`)
    .join('; ');

  return {
    headline: `${forDate}: recovery ${ctx.snapshot.daily?.recovery?.score ?? '—'}%, load ratio ${facts.load.ratio ?? '—'} (${facts.load.zone}).`,
    highlights: facts.highlights,
    patterns: [] as string[],
    research: {
      title: `Lens: ${facts.lens}`,
      body:
        `No language model was available for this run, so this is the deterministic read. ` +
        `${facts.lensReason} ` +
        `Fitness stands at CTL ${facts.fitness.ctlNow} / ATL ${facts.fitness.atlNow} / TSB ${facts.fitness.tsbNow}. ` +
        `Sleep across the last ${facts.sleep.nights} nights averaged ${facts.sleep.meanAsleepHours ?? '—'}h with ` +
        `${facts.sleep.bedtimeDriftMin} min of bedtime drift and ${facts.sleep.shortNights} nights under 7h. ` +
        `Program adherence for the week is ${facts.adherenceWeek.score}%. ` +
        (trendLines ? `Trends: ${trendLines}.` : ''),
      sources: ['whoop'],
    },
    lensUsed: facts.lens,
    flags: [] as string[],
  };
}

async function main() {
  const ctx = await loadContext(TASK, process.env.FOR_DATE || undefined);
  const forDate = shiftDate(ctx.today, -1); // yesterday
  const yesterdayDay = dayKeyFor(forDate);

  const facts = computeFacts({
    snapshot: ctx.snapshot,
    template: ctx.program.template,
    weekStart: mondayOf(forDate),
    today: ctx.today,
    forDate,
    lifts: ctx.lifts,
    recentLenses: recentLenses(ctx.history),
  });

  const model = providerLabel(TASK);
  const tpl = templateInsights(ctx, facts, forDate);

  const writeTemplate = async (reason: string) => {
    const out: InsightsBlock = {
      ...provenance(ctx, 'template', { isTemplate: true, fallbackReason: reason }),
      forDate,
      ...tpl,
    };
    await writeArtifact(FILE, 'insights', out);
    console.log(`Wrote template ${FILE} for ${forDate} (${reason}).`);
  };

  if (!llmAvailable()) {
    await writeTemplate('no LLM provider configured');
    return;
  }

  const priorHeadlines = recentHeadlines(ctx.history, 'insights');

  const user = [
    athleteBrief(ctx),
    ``,
    `The date being analyzed is ${forDate} (${yesterdayDay}).`,
    `Adherence that day: ${facts.adherenceToday.status} — planned "${facts.adherenceToday.planned}", actual "${facts.adherenceToday.actual}".`,
    ``,
    factsBlock(facts),
    ``,
    `RESEARCH LENS — write exactly this lens: ${facts.lens}`,
    LENS_BRIEF[facts.lens] ?? '',
    `Body: 2-3 paragraphs, ~120-200 words, citing numbers from the FACTS block.`,
    ``,
    priorHeadlines.length
      ? `Your recent headlines (do NOT repeat these angles):\n${priorHeadlines.map((h) => `- ${h}`).join('\n')}`
      : '',
    feedbackBlock(ctx, 'insights'),
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
    console.log(`Generating insights via ${model}…`);
    const { data, usage } = await chatSchema(SYSTEM, user, insightsReplySchema, 'insights', {
      task: TASK,
      temperature: 0.2,
      maxTokens: 1400,
    });

    const out: InsightsBlock = {
      ...provenance(ctx, model, usage ? { usage } : {}),
      forDate,
      headline: data.headline,
      // Highlights are computed, never generated: the model used to write
      // comparisons like "slightly unbalanced" against no baseline at all.
      highlights: facts.highlights.length ? facts.highlights : data.highlights,
      patterns: data.patterns,
      research: data.research,
      lensUsed: facts.lens,
      flags: data.flags,
    };
    await writeArtifact(FILE, 'insights', out);
    console.log(`Wrote ${FILE} for ${forDate}: ${out.headline}`);
  } catch (e) {
    console.warn(`LLM failed (${(e as Error).message}); using template.`);
    await writeTemplate((e as Error).message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
