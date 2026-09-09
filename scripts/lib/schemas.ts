/**
 * Runtime schemas for every AI-generated artifact.
 *
 * These exist because the generators used to write model output straight to
 * disk behind an `as` cast. `as` is a compile-time assertion — it does nothing
 * at runtime — so a model that returned a wrong enum, a missing field or a
 * number-as-string shipped that straight into `private/data/` and then into
 * React, where an unguarded `TONE_CHIP[h.tone]` lookup would take the whole
 * card down.
 *
 * Two jobs:
 *   1. `safeParse` the model's reply before it is written anywhere.
 *   2. Generate the JSON Schema handed to providers that support strict
 *      structured outputs, so most drift never happens in the first place.
 */
import { z } from 'zod';

// ─── Primitives ─────────────────────────────────────────────────────────────

/**
 * NOTE ON STRICTNESS
 *
 * These schemas police STRUCTURE — the right keys, the right enums, seven days
 * in a week — because that is what stops malformed output reaching disk and
 * crashing a card. They deliberately do NOT police prose length. Minimum-length
 * floors on free text were rejecting benign replies and failing whole runs over
 * a slightly terse sentence, turning the safety net into a source of outages.
 * Quality is the prompt's job; validity is this file's.
 */

export const toneSchema = z.enum(['good', 'neutral', 'warn', 'flag']);
export const intensitySchema = z.enum(['easy', 'moderate', 'hard']);
export const planIntensitySchema = z.enum(['rest', 'easy', 'moderate', 'hard']);
export const weekdaySchema = z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
export const sourceTagSchema = z.enum(['whoop', 'strava', 'garmin', 'program', 'lifts']);

export const highlightSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.string().min(1).max(40),
  comparison: z.string().max(60).optional(),
  tone: toneSchema,
});

const researchShape = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1),
  sources: z.array(sourceTagSchema).default([]),
});

/**
 * Research section, tolerant of the model half-filling it.
 *
 * Prompts describe this as optional ("only when there is a real story"), and
 * models express that inconsistently: sometimes by omitting the key, sometimes
 * by returning `{}` or `{sources: []}`. A plain `.optional()` accepts the first
 * and rejects the other two, which failed a whole run over a section that was
 * never required. An incomplete block is treated as no block.
 */
export const optionalResearchSchema = z.preprocess((value) => {
  if (value == null || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v['title'] !== 'string' || typeof v['body'] !== 'string') return undefined;
  return v;
}, researchShape.optional());

export const researchSchema = researchShape;

// ─── Per-artifact model-reply schemas ───────────────────────────────────────
// These describe ONLY what the model is asked to return. Provenance fields
// (generatedAt, model, usage…) are stamped by the generator, never by the model.

export const insightsReplySchema = z.object({
  headline: z.string().min(1).max(200),
  highlights: z.array(highlightSchema).min(1).max(8),
  patterns: z.array(z.string().min(1)).max(4).default([]),
  research: researchSchema,
  flags: z.array(z.string().min(1)).max(3).default([]),
});

export const todayDebriefReplySchema = z.object({
  headline: z.string().min(1).max(200),
  highlights: z.array(highlightSchema).min(1).max(8),
  adherenceNote: z.string().max(300).default(''),
  tomorrow: z.object({
    planned: z.string().min(1),
    readiness: z.string().min(1),
    target: z.string().min(1),
  }),
  research: optionalResearchSchema,
  flags: z.array(z.string().min(1)).max(2).default([]),
});

export const coachDaySchema = z.object({
  weekday: weekdaySchema,
  type: z.string().min(1).max(120),
  intensity: planIntensitySchema,
  durationMinutes: z.number().int().min(0).max(600),
  // Blank is tolerated: the generator backfills it from the program template.
  // Failing an entire week's plan over one missing justification string is the
  // same misplaced quality gate that empty-prose floors were.
  reason: z.string().max(400).default(''),
});

export const coachReplySchema = z.object({
  summary: z.string().min(1).max(500),
  plan: z.array(coachDaySchema).length(7),
  nutrition: z.object({
    dailyAnchors: z.string().min(1),
    preAndPostFueling: z.string().min(1),
    mealIdea: z.string().min(1),
    groceryItem: z.string().min(1),
  }),
});

export const weeklyReviewReplySchema = z.object({
  headline: z.string().min(1).max(400),
  adherenceNote: z.string().max(300).default(''),
  fitnessNarrative: z.string().min(1).max(500),
  standoutWhy: z.string().min(1).max(400),
  trend: z.string().min(1).max(500),
  sleepTarget: z.string().min(1).max(300),
  nextWeekFocus: z.string().min(1).max(500),
});

export const monthlyPatternsReplySchema = z.object({
  headline: z.string().min(1).max(300),
  patterns: z
    .array(
      z.object({
        title: z.string().min(3).max(120),
        body: z.string().min(1),
        confidence: z.enum(['high', 'medium', 'low']),
        sources: z.array(sourceTagSchema).default([]),
      }),
    )
    .min(1)
    .max(6),
});

export const raceWeekReplySchema = z.object({
  headline: z.string().min(1).max(300),
  days: z
    .array(
      z.object({
        weekday: weekdaySchema,
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        session: z.string().min(1),
        intensity: planIntensitySchema,
        durationMinutes: z.number().int().min(0).max(600),
        purpose: z.string().min(1),
      }),
    )
    .min(1)
    // ai-race-week publishes from 10 days out, so a plan can legitimately run to
    // 11 entries (today through race day inclusive). A tighter cap made the
    // provider silently truncate the plan — dropping race day, which is last.
    .max(12),
  pacing: z.object({
    target: z.string().min(1),
    splits: z.array(z.string().min(1)).max(8).default([]),
    contingency: z.string().min(1),
  }),
  fuelling: z.object({
    before: z.string().min(1),
    during: z.string().min(1),
    after: z.string().min(1),
  }),
  checklist: z.array(z.string().min(1)).max(12).default([]),
  readiness: z.string().min(1),
});

export const postRaceReplySchema = z.object({
  headline: z.string().min(1).max(300),
  outcomeNarrative: z.string().min(1),
  legNotes: z.array(z.object({ name: z.string().min(1), note: z.string().min(1) })).default([]),
  executionVsBuildUp: z.string().min(1),
  lessons: z.array(z.string().min(1)).min(1).max(4),
  recoveryGuidance: z.string().min(1),
});

export const calibrationReplySchema = z.object({
  headline: z.string().min(1).max(300),
  guidance: z.string().min(1),
});

// ─── JSON Schema emission for strict structured outputs ─────────────────────

type JsonSchema = Record<string, any>;

/** Keywords OpenAI's strict structured-output mode rejects outright. */
const STRICT_UNSUPPORTED = [
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'pattern',
  'format',
  'default',
  'multipleOf',
  'uniqueItems',
];

/**
 * Rewrite a JSON Schema so OpenAI's `strict` structured-output mode accepts it.
 *
 * Strict mode is the difference between hoping the model returns the right
 * shape and it being unable to return anything else. Without it, live runs
 * failed on an invalid `intensity` enum and on empty `reason` strings across a
 * seven-element array — drift that no amount of prompt wording reliably fixes,
 * because a small model filling 35 fields will eventually skip one.
 *
 * Strict mode is picky in return: it forbids validation keywords, demands
 * `additionalProperties: false` everywhere, and requires every declared
 * property to appear in `required`. Optional fields therefore become nullable,
 * and the nulls are stripped again before zod parses, so the schemas stay
 * expressed naturally.
 */
export function toStrictJsonSchema(input: JsonSchema): JsonSchema {
  const walk = (node: JsonSchema): JsonSchema => {
    if (Array.isArray(node)) return node.map(walk) as unknown as JsonSchema;
    if (!node || typeof node !== 'object') return node;

    const out: JsonSchema = {};
    for (const [key, value] of Object.entries(node)) {
      if (STRICT_UNSUPPORTED.includes(key)) continue;
      out[key] = typeof value === 'object' && value !== null ? walk(value as JsonSchema) : value;
    }

    if (out['type'] === 'object' && out['properties']) {
      const keys = Object.keys(out['properties'] as JsonSchema);
      const wasRequired = new Set<string>((node['required'] as string[]) ?? []);
      // Strict mode requires every property to be listed as required, so an
      // optional field is expressed as "may be null" instead.
      for (const k of keys) {
        if (wasRequired.has(k)) continue;
        const prop = (out['properties'] as JsonSchema)[k] as JsonSchema;
        (out['properties'] as JsonSchema)[k] = { anyOf: [prop, { type: 'null' }] };
      }
      out['required'] = keys;
      out['additionalProperties'] = false;
    }

    return out;
  };

  return walk(input);
}

/**
 * Convert a zod schema into the `response_format.json_schema` payload OpenAI
 * and compatible providers accept. With `strict` honoured the model physically
 * cannot emit a shape that fails validation; the client falls back to plain
 * JSON mode for providers that reject the strict payload.
 */
export function toResponseFormat(name: string, schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as JsonSchema;
  return {
    type: 'json_schema',
    json_schema: { name, strict: true, schema: toStrictJsonSchema(json) },
  };
}

/**
 * The schema as stated to a provider that has no `response_format` — currently
 * the Copilot CLI, which is an agent rather than a completions endpoint.
 *
 * Deliberately NOT run through `toStrictJsonSchema`. That function exists to
 * satisfy OpenAI's strict mode, which rejects `maxItems`, `maxLength` and the
 * rest of STRICT_UNSUPPORTED — so on the strict path those bounds were dropped
 * from the wire and enforced only by zod afterwards, as a retry.
 *
 * A prompt has no such restriction, so the full schema goes across. Measured on
 * the real insights payload: the stripped schema produced four `flags` against
 * a `max(3)` and failed zod; the full schema passed four runs out of four. This
 * path therefore states MORE of the contract than the strict path could, which
 * is what makes the missing decoder constraint survivable.
 */
export function toPromptSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as JsonSchema;
}

/**
 * Drop nulls the strict schema forced the model to emit for absent optionals,
 * so zod sees the natural `undefined` its `.optional()` expects.
 */
export function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripNulls) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) continue;
      out[k] = stripNulls(v);
    }
    return out as T;
  }
  return value;
}

/** Human-readable one-line summary of why a parse failed, for logs + artifacts. */
export function describeIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ');
}
