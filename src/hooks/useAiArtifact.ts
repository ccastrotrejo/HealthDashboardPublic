import { useEffect, useState } from 'react';

export type ArtifactState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  /** The file doesn't exist yet — expected before a generator's first run. */
  | { status: 'absent'; data: null; error: null }
  | { status: 'error'; data: null; error: string };

/**
 * Fetch one AI artifact from /data/.
 *
 * The previous inline pattern was `fetch(...).then(r => r.ok ? r.json() : null).catch(() => null)`,
 * which collapsed three genuinely different situations into one `null`:
 * "not generated yet", "network failed", and "the JSON is corrupt". All three
 * made the card silently vanish with nothing shown to the user, and there was
 * no loading state at all — sections popped in whenever their promise resolved.
 */
export function useAiArtifact<T>(path: string): ArtifactState<T> {
  const [state, setState] = useState<ArtifactState<T>>({
    status: 'loading',
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    fetch(path)
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 404) {
          setState({ status: 'absent', data: null, error: null });
          return;
        }
        if (!r.ok) {
          setState({ status: 'error', data: null, error: `HTTP ${r.status}` });
          return;
        }
        try {
          const data = (await r.json()) as T;
          if (!cancelled) setState({ status: 'ready', data, error: null });
        } catch {
          if (!cancelled) {
            setState({ status: 'error', data: null, error: 'malformed JSON' });
          }
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          data: null,
          error: e instanceof Error ? e.message : 'network error',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return state;
}
