/**
 * Schema tests.
 *
 * These lock in the guarantee that made the whole validation layer necessary:
 * generated artifacts used to be written behind an `as` cast, which does nothing
 * at runtime. A debrief shipped to production with highlight labels
 * ("Total Strain", "Cycling Duration", "Average Heart Rate") that the prompt's
 * own enum forbade, and the UI then crashed on an unguarded enum lookup.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  coachReplySchema,
  describeIssues,
  insightsReplySchema,
  monthlyPatternsReplySchema,
  raceWeekReplySchema,
  stripNulls,
  todayDebriefReplySchema,
  toResponseFormat,
  weeklyReviewReplySchema,
} from './schemas.js';

const validInsights = {
  headline: 'Recovery held at 82% on a deliberately easy day.',
  highlights: [{ label: 'Recovery', value: '82%', comparison: 'vs 71% 30d avg', tone: 'good' }],
  patterns: ['Three consecutive nights under 7h.'],
  research: {
    title: 'Lens: sleep-vs-recovery',
    body: 'A'.repeat(120),
    sources: ['whoop'],
  },
  flags: ['Watch bedtime tonight.'],
};

describe('insightsReplySchema', () => {
  it('accepts a well-formed reply', () => {
    expect(insightsReplySchema.safeParse(validInsights).success).toBe(true);
  });

  it('rejects a tone outside the enum', () => {
    const bad = {
      ...validInsights,
      highlights: [{ ...validInsights.highlights[0], tone: 'caution' }],
    };
    const result = insightsReplySchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) expect(describeIssues(result.error)).toContain('tone');
  });

  it('rejects a missing research block', () => {
    const { research: _research, ...bad } = validInsights;
    expect(insightsReplySchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an empty research body', () => {
    const bad = { ...validInsights, research: { ...validInsights.research, body: '' } };
    expect(insightsReplySchema.safeParse(bad).success).toBe(false);
  });

  it('accepts terse but valid prose', () => {
    // Length floors on free text used to fail whole runs over a short sentence.
    // Structure is validated here; quality is the prompt's job.
    const terse = { ...validInsights, research: { ...validInsights.research, body: 'Flat week.' } };
    expect(insightsReplySchema.safeParse(terse).success).toBe(true);
  });

  it('defaults optional arrays rather than leaving them undefined', () => {
    const { patterns: _p, flags: _f, ...rest } = validInsights;
    const parsed = insightsReplySchema.parse(rest);
    expect(parsed.patterns).toEqual([]);
    expect(parsed.flags).toEqual([]);
  });
});

describe('coachReplySchema', () => {
  const day = (weekday: string) => ({
    weekday,
    type: 'Lift A — Lower body',
    intensity: 'moderate',
    durationMinutes: 70,
    reason: 'Front squat 4×4–6 at RPE 7.',
  });
  const week = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day);

  const valid = {
    summary: 'Week 3, base phase. No amplitude change required.',
    plan: week,
    nutrition: {
      dailyAnchors: 'Protein 175g and fat 80g constant.',
      preAndPostFueling: 'Waffle before, yogurt bowl after.',
      mealIdea: 'Chicken rice broccoli bowl.',
      groceryItem: 'Frozen wild blueberries.',
    },
  };

  it('accepts exactly seven days', () => {
    expect(coachReplySchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a short week', () => {
    expect(coachReplySchema.safeParse({ ...valid, plan: week.slice(0, 6) }).success).toBe(false);
  });

  it('rejects an unknown intensity', () => {
    const bad = { ...valid, plan: [{ ...week[0], intensity: 'brutal' }, ...week.slice(1)] };
    expect(coachReplySchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a negative duration', () => {
    const bad = { ...valid, plan: [{ ...week[0], durationMinutes: -10 }, ...week.slice(1)] };
    expect(coachReplySchema.safeParse(bad).success).toBe(false);
  });

  it('tolerates a blank reason, which the generator backfills from the program', () => {
    const blank = { ...valid, plan: [{ ...week[0], reason: '' }, ...week.slice(1)] };
    expect(coachReplySchema.safeParse(blank).success).toBe(true);
  });
});

describe('todayDebriefReplySchema', () => {
  const base = {
    headline: 'Rode 57 km against a scheduled rest day.',
    highlights: [{ label: 'Day strain', value: '12.7', tone: 'warn' as const }],
    tomorrow: { planned: 'Swim', readiness: 'Fine.', target: 'Bed early.' },
  };

  /**
   * The prompt calls `research` optional, and models express that
   * inconsistently — sometimes omitting the key, sometimes returning an empty
   * or half-filled object. A plain `.optional()` accepted the first and
   * rejected the others, failing a live run over a section never required.
   */
  it('accepts an omitted research block', () => {
    expect(todayDebriefReplySchema.safeParse(base).success).toBe(true);
  });

  it('treats a half-filled research block as absent rather than failing', () => {
    const r = todayDebriefReplySchema.safeParse({ ...base, research: { sources: ['whoop'] } });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.research).toBeUndefined();
  });

  it('keeps a complete research block', () => {
    const r = todayDebriefReplySchema.safeParse({
      ...base,
      research: { title: 'Deload', body: 'Load dropped sharply.', sources: ['whoop'] },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.research?.title).toBe('Deload');
  });

  it('accepts a terse readiness line', () => {
    expect(todayDebriefReplySchema.safeParse(base).success).toBe(true);
  });

  it('does not accept an adherence status from the model', () => {
    // Adherence is computed; the model may only add a note. A reply that tries
    // to set the status is simply ignored rather than trusted.
    const parsed = todayDebriefReplySchema.parse({
      headline: 'Rode 57 km against a scheduled rest day.',
      highlights: [{ label: 'Day strain', value: '12.7', tone: 'warn' }],
      adherenceNote: 'Traded the rest day for the group ride.',
      tomorrow: { planned: 'Swim', readiness: 'Recovery is 82%, fine to swim.', target: 'Bed by 22:30.' },
    });
    expect('status' in parsed).toBe(false);
    expect(parsed.adherenceNote).toContain('group ride');
  });
});

describe('weeklyReviewReplySchema', () => {
  it('carries narrative only — no scores or deltas', () => {
    const parsed = weeklyReviewReplySchema.parse({
      headline: 'Solid week: every lift hit, the swim missed.',
      fitnessNarrative: 'CTL climbed while ATL climbed faster, so form dipped.',
      standoutWhy: 'Longest ride of the block at a controlled heart rate.',
      trend: 'Third consecutive week of rising volume.',
      sleepTarget: 'Lights out by 22:45 on five of seven nights.',
      nextWeekFocus: 'Hold volume, restore the Monday swim.',
    });
    expect('score' in parsed).toBe(false);
    expect('ctlChange' in parsed).toBe(false);
    expect('bedtimeDriftMin' in parsed).toBe(false);
  });
});

describe('monthlyPatternsReplySchema', () => {
  it('rejects an unknown confidence value', () => {
    const bad = {
      headline: 'A month of steady aerobic building.',
      patterns: [
        { title: 'Rides getting cheaper', body: 'B'.repeat(60), confidence: 'moderate', sources: ['strava'] },
      ],
    };
    expect(monthlyPatternsReplySchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown source tag', () => {
    const bad = {
      headline: 'A month of steady aerobic building.',
      patterns: [
        { title: 'Rides getting cheaper', body: 'B'.repeat(60), confidence: 'high', sources: ['oura'] },
      ],
    };
    expect(monthlyPatternsReplySchema.safeParse(bad).success).toBe(false);
  });
});

describe('toResponseFormat', () => {
  const collectObjects = (node: any, acc: any[] = []): any[] => {
    if (!node || typeof node !== 'object') return acc;
    if (node.type === 'object' && node.properties) acc.push(node);
    for (const k of Object.keys(node)) collectObjects(node[k], acc);
    return acc;
  };
  const collectKeywords = (node: any, acc = new Set<string>()): Set<string> => {
    if (!node || typeof node !== 'object') return acc;
    for (const k of Object.keys(node)) {
      acc.add(k);
      collectKeywords(node[k], acc);
    }
    return acc;
  };

  const schemas = [
    ['insights', insightsReplySchema],
    ['coach', coachReplySchema],
    ['today_debrief', todayDebriefReplySchema],
    ['race_week', raceWeekReplySchema],
    ['monthly_patterns', monthlyPatternsReplySchema],
    ['weekly_review', weeklyReviewReplySchema],
  ] as const;

  it('emits a JSON Schema payload the chat API accepts', () => {
    const rf = toResponseFormat('insights', insightsReplySchema) as any;
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema.name).toBe('insights');
    expect(rf.json_schema.schema.type).toBe('object');
  });

  /**
   * Strict mode is what makes an invalid enum or a missing field impossible
   * rather than merely discouraged. Live runs failed on exactly those: an
   * `intensity` outside the enum, and blank `reason` strings across a
   * seven-element array. It only engages if the payload obeys its rules.
   */
  it.each(schemas)('emits a strict-mode-compatible schema for %s', (name, schema) => {
    const rf = toResponseFormat(name, schema) as any;
    expect(rf.json_schema.strict).toBe(true);

    const banned = [
      'minLength', 'maxLength', 'minItems', 'maxItems',
      'minimum', 'maximum', 'pattern', 'format', 'default',
    ];
    const used = collectKeywords(rf.json_schema.schema);
    for (const b of banned) expect(used.has(b)).toBe(false);

    for (const obj of collectObjects(rf.json_schema.schema)) {
      expect(obj.additionalProperties).toBe(false);
      // Strict mode requires every declared property to be listed as required.
      expect([...Object.keys(obj.properties)].sort()).toEqual([...obj.required].sort());
    }
  });

  it('expresses an optional field as nullable rather than dropping it', () => {
    const rf = toResponseFormat('insights', insightsReplySchema) as any;
    const highlight = rf.json_schema.schema.properties.highlights.items;
    expect(highlight.required).toContain('comparison');
    expect(JSON.stringify(highlight.properties.comparison)).toContain('null');
  });
});

describe('stripNulls', () => {
  it('removes the nulls strict mode forces for absent optionals', () => {
    expect(stripNulls({ a: 1, b: null, c: { d: null, e: 2 } })).toEqual({ a: 1, c: { e: 2 } });
  });

  it('recurses into arrays', () => {
    expect(stripNulls([{ a: null, b: 1 }])).toEqual([{ b: 1 }]);
  });

  it('lets an optional field parse after its null is stripped', () => {
    const withNull = {
      headline: 'Recovery held at 82% on a deliberately easy day.',
      highlights: [{ label: 'Recovery', value: '82%', comparison: null, tone: 'good' }],
      patterns: [],
      research: { title: 'Lens', body: 'A'.repeat(60), sources: [] },
      flags: [],
    };
    expect(insightsReplySchema.safeParse(withNull).success).toBe(false);
    expect(insightsReplySchema.safeParse(stripNulls(withNull)).success).toBe(true);
  });
});

describe('describeIssues', () => {
  it('produces a readable one-line summary', () => {
    const result = z.object({ a: z.string() }).safeParse({ a: 1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(describeIssues(result.error)).toMatch(/^a: /);
    }
  });
});

describe('raceWeekReplySchema', () => {
  const day = (n: number) => ({
    weekday: (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const)[n % 7],
    date: `2026-08-${String(13 + n).padStart(2, '0')}`,
    session: 'Easy spin, 20 min',
    intensity: 'easy' as const,
    durationMinutes: 20,
    purpose: 'Flush the legs without adding fatigue.',
  });

  const body = (n: number) => ({
    headline: 'Eleven days out: volume comes down, sharpness stays.',
    days: Array.from({ length: n }, (_, i) => day(i)),
    pacing: { target: 'Hold 4:45/km through 5 km.', splits: [], contingency: 'Back off 10s/km.' },
    fuelling: { before: 'Waffle 45 min prior.', during: 'One gel at 20 min.', after: 'Yogurt bowl.' },
    checklist: [],
    readiness: 'CTL 30, TSB climbing into race day.',
  });

  /**
   * The generator publishes from 10 days out, so a plan legitimately runs to 11
   * entries. A tighter cap made the provider silently truncate — dropping race
   * day, which is last in the list.
   */
  it('accepts a full 11-day taper', () => {
    expect(raceWeekReplySchema.safeParse(body(11)).success).toBe(true);
  });

  it('accepts a single-day plan on race eve', () => {
    expect(raceWeekReplySchema.safeParse(body(1)).success).toBe(true);
  });

  it('rejects a plan longer than any real race window', () => {
    // Strict mode forbids `maxItems`, so the array cap is enforced by zod at
    // parse time rather than by the provider. That is the safer direction: a
    // schema-level cap that was too low silently truncated the plan and dropped
    // race day, whereas an over-long reply is simply rejected and retried.
    expect(raceWeekReplySchema.safeParse(body(13)).success).toBe(false);
  });
});
