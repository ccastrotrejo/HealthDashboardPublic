/**
 * Client-side store for AI feedback.
 *
 * The dashboard is a static site behind basic auth with no backend, so feedback
 * is recorded in localStorage and exported by hand — the same clipboard round
 * trip the coach workflow already uses (see COACH.md). `pnpm log feedback`
 * ingests the export into public/data/ai-feedback.json, and the next generation
 * run picks the notes up as few-shot negatives.
 *
 * Without this the system could not improve: the athlete could see a wrong
 * insight and had nowhere to say so, and the next run would make the same
 * mistake.
 */
import type { AiArtifactKind, AiFeedbackEntry } from './types';

const KEY = 'health-dashboard:ai-feedback:v1';

function read(): AiFeedbackEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AiFeedbackEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: AiFeedbackEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-200)));
  } catch {
    // Private-mode or quota failures must never break the dashboard.
  }
}

/** The rating recorded for a specific artifact version, if any. */
export function ratingFor(
  artifact: AiArtifactKind,
  artifactGeneratedAt: string,
): 'up' | 'down' | null {
  const hit = read().find(
    (e) => e.artifact === artifact && e.artifactGeneratedAt === artifactGeneratedAt,
  );
  return hit?.rating ?? null;
}

/**
 * Record (or clear) a rating. Re-rating the same artifact version replaces the
 * previous entry; clicking the active rating again removes it.
 */
export function setRating(
  artifact: AiArtifactKind,
  artifactGeneratedAt: string,
  rating: 'up' | 'down' | null,
  note?: string,
): void {
  const entries = read().filter(
    (e) => !(e.artifact === artifact && e.artifactGeneratedAt === artifactGeneratedAt),
  );
  if (rating) {
    entries.push({
      at: new Date().toISOString(),
      artifact,
      artifactGeneratedAt,
      rating,
      ...(note ? { note } : {}),
    });
  }
  write(entries);
}

/** How many ratings are waiting to be exported. */
export function pendingCount(): number {
  return read().length;
}

/** The export payload for `pbpaste | pnpm log feedback`. */
export function exportPayload(): string {
  return JSON.stringify({ entries: read() }, null, 2);
}

/** Clear the local store, e.g. after a successful export. */
export function clearAll(): void {
  write([]);
}
