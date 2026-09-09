#!/usr/bin/env node
/**
 * Monthly pattern detection: 3-5 multi-week patterns a good coach would spot
 * after watching a month of training. Writes private/data/monthly-patterns.json.
 *
 * This is the long-context lens — patterns spanning 3-4 weeks that the daily
 * and weekly tasks structurally cannot see.
 *
 * It is also the generator that most needed the payload expansion. It used to
 * be asked for "non-obvious multi-week patterns" while receiving a single
 * scalar for recovery, sleep efficiency, respiratory rate and skin temperature,
 * and it responded by describing series it had never been given. It now gets 30
 * days of each.
 */
import type { MonthlyPatternsBlock } from './lib/types.js';
import { chatSchema, llmAvailable, providerLabel } from './lib/llm.js';
import { monthlyPatternsReplySchema } from './lib/schemas.js';
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

const TASK = 'monthly-patterns';
const FILE = 'monthly-patterns.json';

const SYSTEM = `You are the AI monthly pattern detector for a cyclist's health dashboard. You have
~30 days of training, sleep and recovery data, including full daily series for recovery score, HRV,
RHR, sleep duration, sleep efficiency, respiratory rate, skin temperature and day strain.

Find 3-5 NON-OBVIOUS multi-week patterns.

PATTERN TYPES to look for:
- Adaptation   — same output at lower cost (e.g. same pace at lower HR over 4 weeks)
- Regression   — a metric moving the wrong way for 2+ weeks
- Correlation  — one signal reliably preceding another
- Volume drift — load changing while the load ratio stays put, or vice versa
- Adherence    — a specific session repeatedly missed or modified

RULES:
- Every body MUST cite at least one real number from the series you were given.
- Patterns must span >= 2 weeks. Single-week observations belong in the weekly review.
- Vary the angles. Do not surface five sleep observations.
- "high" = clear consistent week-over-week direction. "low" = suggestive; say so.
- If a series has too few non-null points to support a claim, do not make the claim.

${GROUNDING_RULES}`;

async function main() {
  const ctx = await loadContext(TASK, process.env.FOR_DATE || undefined);
  // First of the PREVIOUS month
  const d = new Date(ctx.today + 'T12:00:00Z');
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const forMonth = d.toISOString().slice(0, 10);

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

  const templateBlock = {
    headline: `Month starting ${forMonth}: computed trend summary only — no language model ran.`,
    patterns: facts.trends
      .filter((t) => t.direction !== 'unknown' && t.mean30 != null)
      .slice(0, 5)
      .map((t) => ({
        title: `${t.label} trending ${t.direction}`,
        body:
          `${t.label} sits at ${t.latest ?? '—'} against a 30-day mean of ${t.mean30} ` +
          `(${t.deltaPct != null ? `${t.deltaPct >= 0 ? '+' : ''}${t.deltaPct}%` : 'no delta'}), ` +
          `with a 14-day slope of ${t.slopePerDay ?? '—'} per day. This is the deterministic read; ` +
          `no interpretation was generated because no language model was available.`,
        confidence: 'low' as const,
        sources: [] as string[],
      })),
  };
  if (!templateBlock.patterns.length) {
    templateBlock.patterns = [
      {
        title: 'Insufficient data',
        body:
          'No trend series had enough non-null points to describe a direction over the month. ' +
          'Check that the daily sync is running.',
        confidence: 'low' as const,
        sources: [],
      },
    ];
  }

  const writeTemplate = async (reason: string) => {
    const out: MonthlyPatternsBlock = {
      ...provenance(ctx, 'template', { isTemplate: true, fallbackReason: reason }),
      forMonth,
      ...templateBlock,
    };
    await writeArtifact(FILE, 'monthly-patterns', out);
    console.log(`Wrote template ${FILE} for ${forMonth} (${reason}).`);
  };

  if (!llmAvailable()) {
    await writeTemplate('no LLM provider configured');
    return;
  }

  const prior = recentHeadlines(ctx.history, 'monthly-patterns', 3);
  const weeklyPrior = recentHeadlines(ctx.history, 'weekly-review', 4);

  const user = [
    athleteBrief(ctx),
    ``,
    `Reviewing the month starting ${forMonth} (today is ${ctx.today}).`,
    `This is the only pass with this much temporal context — use it. Look for patterns spanning`,
    `3-4 weeks that the daily and weekly tasks structurally cannot see.`,
    ``,
    factsBlock(facts),
    ``,
    weeklyPrior.length
      ? `What the weekly reviews already said (go beyond these, don't restate them):\n${weeklyPrior.map((h) => `- ${h}`).join('\n')}`
      : '',
    prior.length
      ? `Your previous monthly headlines:\n${prior.map((h) => `- ${h}`).join('\n')}`
      : '',
    feedbackBlock(ctx, 'monthly-patterns'),
    ``,
    `SNAPSHOT DATA (30-day daily series, 8-week volume, 56-day fitness curve):`,
    snapshotForPrompt(ctx.snapshot, 'monthly'),
  ]
    .filter(Boolean)
    .join('\n');

  if (process.env.PRINT_PROMPT === '1') {
    console.log(`--- SYSTEM ---\n${SYSTEM}\n\n--- USER ---\n${user}`);
    return;
  }

  try {
    console.log(`Generating monthly patterns via ${model}…`);
    // The month-long pass is the hardest reasoning task in the pipeline, so it
    // gets the largest budget and honours LLM_MODEL_MONTHLY_PATTERNS.
    const { data, usage } = await chatSchema(
      SYSTEM,
      user,
      monthlyPatternsReplySchema,
      'monthly_patterns',
      { task: TASK, temperature: 0.3, maxTokens: 2400 },
    );

    const out: MonthlyPatternsBlock = {
      ...provenance(ctx, model, usage ? { usage } : {}),
      forMonth,
      headline: data.headline,
      patterns: data.patterns,
    };
    await writeArtifact(FILE, 'monthly-patterns', out);
    console.log(`Wrote ${FILE} for ${forMonth} with ${out.patterns.length} patterns.`);
  } catch (e) {
    console.warn(`LLM failed (${(e as Error).message}); using template.`);
    await writeTemplate((e as Error).message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
