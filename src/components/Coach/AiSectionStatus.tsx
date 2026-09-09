import { Banner } from '@astryxdesign/core/Banner';
import type { ArtifactState } from '../../hooks/useAiArtifact';

interface Props {
  /** Label → state, for every artifact this section renders. */
  states: Array<{ label: string; state: ArtifactState<unknown> }>;
  /** What the section is for, shown when nothing has been generated yet. */
  emptyHint: string;
}

/**
 * Loading, empty and error states for a section of AI cards.
 *
 * The AI section used to be wrapped in `{(insights || todayDebrief || monthly) && …}`,
 * so before the first generation run — or after any fetch failure — it simply
 * did not exist on the page. Nothing told the reader whether analysis was
 * loading, had never been produced, or had failed to load.
 *
 * Renders nothing once at least one artifact is present, so the happy path is
 * unaffected.
 */
export function AiSectionStatus({ states, emptyHint }: Props) {
  const anyReady = states.some((s) => s.state.status === 'ready');
  if (anyReady) return null;

  const errors = states.filter((s) => s.state.status === 'error');
  if (errors.length) {
    return (
      <Banner
        status="error"
        title="Could not load AI analysis"
        description={errors
          .map((e) => `${e.label}: ${e.state.status === 'error' ? e.state.error : ''}`)
          .join(' · ')}
      />
    );
  }

  if (states.some((s) => s.state.status === 'loading')) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border border-border p-5 text-sm text-ink-500"
      >
        <span className="sr-only">Loading AI analysis</span>
        <div aria-hidden className="space-y-2">
          <div className="h-4 w-2/3 animate-pulse rounded bg-ink-900/5" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-ink-900/5" />
        </div>
      </div>
    );
  }

  return (
    <Banner status="info" title="No AI analysis yet" description={emptyHint} />
  );
}
