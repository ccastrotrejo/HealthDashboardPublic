#!/usr/bin/env node
/**
 * Prediction calibration: score every past race prediction against what
 * actually happened. Writes private/data/calibration.json.
 *
 * Two independent prediction sources already exist and disagree — our
 * Riegel-from-PR-pace extrapolation in `longTerm.racePredictions`, and Garmin's
 * own model in `garmin.racePredictions` — and until now neither had ever been
 * checked against a real finish time. A prediction that is never scored is a
 * guess with a decimal point.
 */
import type { CalibrationBlock, PredictionScore, RaceEvent } from './lib/types.js';
import { chatSchema, llmAvailable, providerLabel } from './lib/llm.js';
import { calibrationReplySchema } from './lib/schemas.js';
import { mean } from '../utils/statistics.js';
import {
  loadContext,
  athleteBrief,
  feedbackBlock,
  provenance,
  sanitize,
  writeArtifact,
  GROUNDING_RULES,
} from './lib/ai-context.js';

const TASK = 'calibration';
const FILE = 'calibration.json';

const SYSTEM = `You are the AI prediction-calibration analyst for a cyclist's health dashboard.

You are given every past race where a finish time exists alongside the predictions that were
standing at the time — one from a Riegel extrapolation of the athlete's own PR paces, one from
Garmin's model. The errors are computed for you.

Write two things:
- headline: what the calibration record says, in one or two sentences
- guidance: how the athlete should read the CURRENT predictions given the observed bias. Be
  concrete: if Riegel has run 4% optimistic across three races, say that the current 5k prediction
  should be read about 4% slower.

If there are fewer than two scored races, say plainly that there isn't enough history yet and do
not extrapolate a bias from a single data point.

${GROUNDING_RULES}`;

/** Map a race distance onto the PR bucket labels the predictions use. */
function bucketFor(race: RaceEvent): string | null {
  const m = race.distance?.meters;
  if (m == null) return null;
  const buckets: Array<[string, number]> = [
    ['1k', 1_000],
    ['5k', 5_000],
    ['10k', 10_000],
    ['Half', 21_097],
    ['Marathon', 42_195],
  ];
  for (const [label, meters] of buckets) {
    if (Math.abs(m - meters) / meters <= 0.05) return label;
  }
  return null;
}

async function main() {
  const ctx = await loadContext(TASK, process.env.FOR_DATE || undefined);

  const ourPredictions = ctx.snapshot.longTerm?.racePredictions ?? [];
  const garminPredictions = ctx.snapshot.garmin?.racePredictions ?? [];

  const scores: PredictionScore[] = [];
  for (const race of ctx.races?.races ?? []) {
    const actual = race.result?.finishSeconds;
    if (actual == null) continue;
    const bucket = bucketFor(race);
    if (!bucket) continue;

    const ours = ourPredictions.find((p) => p.bucket === bucket)?.predictedSeconds ?? null;
    const garmin =
      garminPredictions.find((p) => p.bucket.toLowerCase() === bucket.toLowerCase())
        ?.predictedSeconds ?? null;

    scores.push({
      raceId: race.id,
      raceName: race.name,
      raceDate: race.date,
      bucket,
      predictedSeconds: ours,
      garminPredictedSeconds: garmin,
      actualSeconds: actual,
      errorPct: ours != null && ours > 0 ? +(((actual - ours) / ours) * 100).toFixed(2) : null,
      garminErrorPct:
        garmin != null && garmin > 0 ? +(((actual - garmin) / garmin) * 100).toFixed(2) : null,
    });
  }
  scores.sort((a, b) => a.raceDate.localeCompare(b.raceDate));

  const meanErr = mean(scores.map((s) => s.errorPct).filter((e): e is number => e != null));
  const garminMeanErr = mean(
    scores.map((s) => s.garminErrorPct).filter((e): e is number => e != null),
  );

  let betterSource: CalibrationBlock['betterSource'] = 'insufficient-data';
  if (scores.length >= 2 && meanErr != null && garminMeanErr != null) {
    const a = Math.abs(meanErr);
    const b = Math.abs(garminMeanErr);
    betterSource = Math.abs(a - b) < 0.5 ? 'tie' : a < b ? 'riegel' : 'garmin';
  } else if (scores.length >= 2 && meanErr != null) {
    betterSource = 'riegel';
  }

  const model = providerLabel(TASK);
  const base = {
    scores,
    meanErrorPct: meanErr != null ? +meanErr.toFixed(2) : null,
    garminMeanErrorPct: garminMeanErr != null ? +garminMeanErr.toFixed(2) : null,
    betterSource,
  };

  const writeTemplate = async (reason: string) => {
    const out: CalibrationBlock = {
      ...provenance(ctx, 'template', { isTemplate: true, fallbackReason: reason }),
      headline: scores.length
        ? `${scores.length} scored race${scores.length === 1 ? '' : 's'}; mean Riegel error ${base.meanErrorPct ?? '—'}%.`
        : 'No race results with a matching prediction bucket yet.',
      ...base,
      guidance: 'Interpretation requires a language model.',
    };
    await writeArtifact(FILE, 'calibration', out);
    console.log(`Wrote template ${FILE} (${reason}).`);
  };

  if (!llmAvailable()) {
    await writeTemplate('no LLM provider configured');
    return;
  }

  const user = [
    athleteBrief(ctx),
    ``,
    `SCORED PREDICTIONS (authoritative — errors already computed):`,
    scores.length
      ? scores
          .map(
            (s) =>
              `  ${s.raceDate} ${sanitize(s.raceName)} [${s.bucket}] actual ${s.actualSeconds}s · ` +
              `riegel ${s.predictedSeconds ?? '—'}s (${s.errorPct ?? '—'}%) · ` +
              `garmin ${s.garminPredictedSeconds ?? '—'}s (${s.garminErrorPct ?? '—'}%)`,
          )
          .join('\n')
      : '  (none)',
    ``,
    `Mean Riegel error: ${base.meanErrorPct ?? 'n/a'}%. Mean Garmin error: ${base.garminMeanErrorPct ?? 'n/a'}%.`,
    `Better source so far: ${betterSource}.`,
    ``,
    `CURRENT STANDING PREDICTIONS:`,
    `  Riegel: ${JSON.stringify(ourPredictions)}`,
    `  Garmin: ${JSON.stringify(garminPredictions)}`,
    feedbackBlock(ctx, 'calibration'),
  ]
    .filter(Boolean)
    .join('\n');

  if (process.env.PRINT_PROMPT === '1') {
    console.log(`--- SYSTEM ---\n${SYSTEM}\n\n--- USER ---\n${user}`);
    return;
  }

  try {
    console.log(`Generating calibration via ${model}…`);
    const { data, usage } = await chatSchema(SYSTEM, user, calibrationReplySchema, 'calibration', {
      task: TASK,
      temperature: 0.2,
      maxTokens: 900,
    });

    const out: CalibrationBlock = {
      ...provenance(ctx, model, usage ? { usage } : {}),
      headline: data.headline,
      ...base,
      guidance: data.guidance,
    };
    await writeArtifact(FILE, 'calibration', out);
    console.log(`Wrote ${FILE}: ${out.headline}`);
  } catch (e) {
    console.warn(`LLM failed (${(e as Error).message}); using template.`);
    await writeTemplate((e as Error).message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
