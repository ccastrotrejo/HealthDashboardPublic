#!/usr/bin/env tsx
/**
 * Coach helper for the manual Claude.ai workflow.
 *
 *   pnpm coach:prompt          → prints the prompt to copy into claude.ai
 *   pnpm coach:save < FILE     → reads JSON from stdin/file, validates, writes coach.json
 *
 * Why manual: the AI plan + nutrition is the one feature we don't want to pay
 * an Anthropic API bill for. You generate it once a week (or whenever you
 * want) by chatting with Claude.ai using your existing subscription, then
 * paste the JSON output back into private/data/coach.json.
 *
 * The sync pipeline DELIBERATELY does not touch coach.json — your manual
 * updates persist across syncs.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dataPath } from './lib/storage.js';

const SNAPSHOT_PATH = dataPath('snapshot.json');
const COACH_PATH = dataPath('coach.json');

const SYSTEM_PROMPT = `You are a thoughtful endurance training and nutrition coach. Given an athlete's recent training and recovery state, you respond with a weekly training plan (Mon→Sun) and brief, practical nutrition guidance for the coming week.

Output ONLY a valid JSON object matching this exact schema. No prose, no markdown fences, no comments. Just the JSON.

{
  "generatedAt": "ISO-8601 timestamp of right now",
  "model": "claude.ai (manual)",
  "summary": "1–2 sentence framing of the week given the current state",
  "plan": [
    {
      "weekday": "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun",
      "type": "short label, e.g. 'Easy run', 'Tempo intervals', 'Long ride', 'Rest', 'Strength', 'Yoga'",
      "intensity": "rest" | "easy" | "moderate" | "hard",
      "durationMinutes": <number>,
      "reason": "one sentence justification tied to current state"
    }
    // exactly 7 entries, Mon through Sun in order
  ],
  "nutrition": {
    "dailyAnchors":     "~35 words. Daily eating pattern + hydration baseline.",
    "preAndPostFueling":"~35 words. Pre and post-workout fueling guidance.",
    "mealIdea":         "~35 words. One specific meal recommendation.",
    "groceryItem":      "~35 words. One grocery item to prioritise this week."
  }
}

Hard constraints:
- Exactly 7 plan entries, Mon→Sun in order.
- If ACWR > 1.5 (injury risk), the week is recovery-leaning. No hard days.
- If TSB is very negative (< −30), at least 2 full rest days.
- At least 2 non-running days per week (yoga, strength, rest, or cross-training).
- Nutrition tone: practical and grounded. No fads, no extreme prescriptions, no supplements.
- All free-text fields in English.`;

function buildPrompt(): string {
  const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as {
    weekly?: {
      acwr?: { acuteKm: number; chronicKm: number; ratio: number; zone: string };
      intensity?: { easySeconds: number; moderateSeconds: number; hardSeconds: number };
      recentActivities?: Array<{
        startDateLocal: string;
        sportType: string;
        distanceMeters: number;
        movingTimeSeconds: number;
        intensity: string;
      }>;
    };
    longTerm?: {
      fitnessCurve?: Array<{ ctl: number; atl: number; tsb: number }>;
    };
  };

  const acwr = snap.weekly?.acwr;
  const intensity = snap.weekly?.intensity;
  const latestFitness = snap.longTerm?.fitnessCurve?.at(-1);
  const recent = snap.weekly?.recentActivities?.slice(0, 8) ?? [];

  const fmtH = (s: number) => (s / 3600).toFixed(1) + 'h';

  return `${SYSTEM_PROMPT}

---

Date: ${new Date().toISOString().slice(0, 10)}

Recent training:
- Last 7d volume: ${acwr ? acwr.acuteKm.toFixed(1) : 'n/a'} km
- Chronic avg: ${acwr ? acwr.chronicKm.toFixed(1) : 'n/a'} km/wk
- ACWR: ${acwr ? acwr.ratio.toFixed(2) + ' (' + acwr.zone + ')' : 'n/a'}
- CTL (fitness): ${latestFitness?.ctl.toFixed(0) ?? 'n/a'}
- ATL (fatigue): ${latestFitness?.atl.toFixed(0) ?? 'n/a'}
- TSB (form): ${latestFitness?.tsb.toFixed(0) ?? 'n/a'}
- Last 28d intensity: easy ${intensity ? fmtH(intensity.easySeconds) : 'n/a'} / moderate ${intensity ? fmtH(intensity.moderateSeconds) : 'n/a'} / hard ${intensity ? fmtH(intensity.hardSeconds) : 'n/a'}

Recent activities (newest first):
${
  recent.length === 0
    ? '  (none in last 7d)'
    : recent
        .map(
          (a) =>
            `  - ${a.startDateLocal.slice(0, 10)} · ${a.sportType} · ${(a.distanceMeters / 1000).toFixed(1)} km · ${Math.round(a.movingTimeSeconds / 60)} min · ${a.intensity}`,
        )
        .join('\n')
}

Generate the JSON now.`;
}

function validateAndSave(rawJson: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson.trim());
  } catch (e) {
    console.error('Input is not valid JSON:', e instanceof Error ? e.message : 'unknown');
    process.exit(2);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    console.error('JSON root must be an object');
    process.exit(2);
  }
  const r = parsed as Record<string, unknown>;
  if (typeof r.summary !== 'string') throw new Error('summary missing');
  if (!Array.isArray(r.plan) || r.plan.length !== 7) {
    console.error(`plan must be an array of exactly 7 entries (got ${Array.isArray(r.plan) ? r.plan.length : typeof r.plan})`);
    process.exit(2);
  }
  if (typeof r.nutrition !== 'object' || r.nutrition === null) {
    console.error('nutrition missing');
    process.exit(2);
  }

  // Stamp generatedAt + model if missing
  if (typeof r.generatedAt !== 'string') r.generatedAt = new Date().toISOString();
  if (typeof r.model !== 'string') r.model = 'claude.ai (manual)';

  writeFileSync(COACH_PATH, JSON.stringify(r, null, 2));
  console.error(`✓ Wrote ${COACH_PATH}`);
  console.error('  Saved locally. Only commit private/data/coach.json to a private repository.');
}

const cmd = process.argv[2];
if (cmd === 'prompt') {
  console.log(buildPrompt());
} else if (cmd === 'save') {
  // Read JSON from stdin
  const chunks: Buffer[] = [];
  process.stdin.on('data', (c: Buffer) => chunks.push(c));
  process.stdin.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) {
      console.error('No input received on stdin. Pipe in the JSON, e.g.:');
      console.error('  pbpaste | pnpm coach:save');
      process.exit(2);
    }
    validateAndSave(raw);
  });
} else {
  console.error('Usage:');
  console.error('  pnpm coach:prompt          # print the prompt to copy into claude.ai');
  console.error('  pbpaste | pnpm coach:save  # paste the JSON response from claude.ai');
  process.exit(2);
}
