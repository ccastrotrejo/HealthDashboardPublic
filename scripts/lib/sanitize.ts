/**
 * Neutralise athlete-controlled free text before it reaches an LLM prompt.
 *
 * Lives in its own module because two independent paths need it and neither
 * should import the other: `compactSnapshot` (the SNAPSHOT DATA block) and
 * `computeFacts` (the FACTS block).
 *
 * That split is exactly how the gap arose. Only the snapshot path sanitised, so
 * the single unsanitised copy of an activity name was the one interpolated into
 * the section the prompt introduces as "FACTS — authoritative. Use these numbers
 * verbatim." The sanitised duplicate sat further down under a weaker label.
 *
 * Strava activity titles are up to 255 characters, are settable by any third
 * party app the athlete has connected, and flow through unattended daily jobs
 * whose output is committed to the repository — so this is the trust boundary.
 */

/** Max characters kept from any single free-text field. */
const DEFAULT_MAX = 120;

export function sanitize(text: string | null | undefined, max = DEFAULT_MAX): string {
  if (!text) return '';
  return text
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/```/g, "'''")
    .replace(
      /\b(ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\b/gi,
      '[redacted]',
    )
    .replace(/\b(?:system|assistant|developer)\s*:/gi, '')
    // Quotes are stripped rather than escaped: several prompts embed these
    // values inside quoted strings, so a stray quote lets the value break out
    // of its delimiter and read as prompt structure.
    .replace(/["`]/g, "'")
    .slice(0, max)
    .trim();
}

/**
 * Sanitise a previously-generated headline before feeding it back into a prompt.
 *
 * The artifact history is a genuine re-ingestion loop: a deterministic template
 * can copy an activity name into a headline, `appendHistory` writes it to
 * `ai-history.jsonl`, the workflow commits that to main, and later runs read it
 * back as "what you said before". Without this the name outlives the 14-day
 * activity window and spreads across artifact types.
 */
export function sanitizeHeadline(text: string | null | undefined): string {
  return sanitize(text, 200);
}
