/**
 * Shared helpers for rendering AI artifact provenance.
 *
 * The dashboard used to render every AI card identically regardless of whether
 * a model actually produced it. A generator that fell back to its deterministic
 * template wrote placeholder prose ("No LLM provider was configured for this
 * run…") and `model: "template"`, and the UI displayed that in the same dim grey
 * ten-pixel slot as `llm:gpt-4o-mini` — so a silently degraded pipeline looked
 * exactly like a healthy one. It also had no notion of a stale artifact: an
 * insight generated three days ago showed as "Jul 23", indistinguishable from
 * this morning's.
 *
 * These helpers make both conditions visible.
 */
import type { AiProvenance } from './types';

/** An AI artifact is considered out of date past this age, per artifact cadence. */
export const AI_STALE_AFTER_HOURS: Record<string, number> = {
  insights: 36,
  'today-debrief': 30,
  coach: 8 * 24,
  'weekly-review': 8 * 24,
  'monthly-patterns': 35 * 24,
  'race-week': 36,
  'post-race': 30 * 24,
  calibration: 30 * 24,
};

export interface AiStatus {
  /** True when the deterministic fallback produced this, not a model. */
  isTemplate: boolean;
  /** Why the fallback fired, when known. */
  fallbackReason?: string;
  /** True when this artifact is older than its cadence allows. */
  isStale: boolean;
  /** True when the snapshot it was generated FROM was already stale. */
  fromStaleData: boolean;
  ageHours: number;
  /** Human relative age, e.g. "3h ago", "2 days ago". */
  relative: string;
}

/**
 * Relative time that keeps working past 24 hours.
 *
 * Each card previously carried its own copy of this and every copy fell back to
 * a bare date string after a day, which is precisely when the reader most needs
 * to know how old something is. One copy also rendered "-1h ago" whenever the
 * generating runner's clock ran slightly ahead of the browser's.
 */
export function formatAge(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!isFinite(ms)) return 'unknown';
  // Clock skew between the CI runner and the browser can make this negative.
  if (ms < 0) return 'just now';

  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(ms / 86_400_000);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;

  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks} weeks ago`;

  return `${Math.round(days / 30)} months ago`;
}

export function aiStatus(
  data: AiProvenance,
  artifact: keyof typeof AI_STALE_AFTER_HOURS,
  now: Date = new Date(),
): AiStatus {
  const ageHours = Math.max(0, (now.getTime() - new Date(data.generatedAt).getTime()) / 3_600_000);
  const budget = AI_STALE_AFTER_HOURS[artifact] ?? 36;

  return {
    // `model === 'template'` covers artifacts written before `isTemplate` existed.
    isTemplate: data.isTemplate === true || data.model === 'template',
    fallbackReason: data.fallbackReason,
    isStale: ageHours > budget,
    fromStaleData: data.dataStale === true,
    ageHours,
    relative: formatAge(data.generatedAt, now),
  };
}

/**
 * Safe enum lookup.
 *
 * Every style map in the AI cards was indexed directly — `TONE_CHIP[h.tone]`,
 * `ADHERENCE_STYLE[status]`, `CONFIDENCE_BADGE[confidence]` — with no fallback.
 * `Record<Enum, T>` makes TypeScript treat those as exhaustive, so it offered no
 * protection against a model returning a value outside the enum, and one did:
 * a debrief shipped with tone labels the schema never allowed. The result was a
 * `TypeError` on property access and an error boundary swallowing the whole card.
 *
 * Output is now schema-validated at generation time; this is the second line of
 * defence for artifacts already committed.
 */
export { lookup } from '../../utils/collections';
