import { useCallback, useSyncExternalStore } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import type { AiArtifactKind, AiProvenance } from '../../lib/types';
import { aiStatus, type AiStatus } from '../../lib/aiMeta';
import { ratingFor, setRating } from '../../lib/aiFeedback';
import { formatNumber } from '../../lib/format';

interface Props {
  data: AiProvenance;
  artifact: AiArtifactKind;
}

const FEEDBACK_CHANGED = 'health-dashboard:ai-feedback-changed';

function subscribeToFeedback(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(FEEDBACK_CHANGED, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(FEEDBACK_CHANGED, onChange);
  };
}

/**
 * The right-hand slot on every AI card: provenance, degradation state, and the
 * feedback control.
 *
 * Replaces `right={<span>{data.model}</span>}`, which rendered "template" and
 * "llm:gpt-4o-mini" in identical dim grey — so an artifact containing nothing
 * but placeholder text looked exactly like real analysis.
 */
export function AiCardMeta({ data, artifact }: Props) {
  const status = aiStatus(data, artifact);
  const readRating = useCallback(
    () => ratingFor(artifact, data.generatedAt),
    [artifact, data.generatedAt],
  );
  const rating = useSyncExternalStore(subscribeToFeedback, readRating, readRating);

  const rate = useCallback(
    (next: 'up' | 'down') => {
      const value = readRating() === next ? null : next;
      setRating(artifact, data.generatedAt, value);
      window.dispatchEvent(new Event(FEEDBACK_CHANGED));
    },
    [artifact, data.generatedAt, readRating],
  );

  return (
    <div className="min-w-0 text-xs">
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {status.isTemplate && <Badge variant="warning" label="Fallback" />}
        {status.fromStaleData && <Badge variant="warning" label="Stale source data" />}
        <span className={status.isStale ? 'text-amber-ink' : 'text-ink-500'}>
          {status.isStale ? 'Out of date · ' : ''}{status.relative}
        </span>
      </div>
      <details className="mt-1 min-w-0 text-left">
        <summary className="min-h-11 cursor-pointer rounded py-3 font-medium text-ink-700">
          {status.isTemplate ? 'Source details' : 'Source & feedback'}
        </summary>
        <div className="max-w-sm space-y-3 border-t border-border py-3 text-xs leading-relaxed text-ink-500">
          {status.isTemplate && (
            <p className="text-amber-ink">
              {status.fallbackReason
                ? `No model output for this run: ${status.fallbackReason}`
                : 'No model ran — this is the deterministic fallback, not analysis.'}
            </p>
          )}
          {status.fromStaleData && (
            <p className="text-amber-ink">Generated from stale source data. The sync may have failed.</p>
          )}
          <dl className="space-y-2">
            <div><dt className="font-medium text-ink-700">Model</dt><dd className="break-words">{data.model}</dd></div>
            <div><dt className="font-medium text-ink-700">Generated</dt><dd>{new Date(data.generatedAt).toLocaleString()}</dd></div>
            <div>
              <dt className="font-medium text-ink-700">Source snapshot</dt>
              <dd>{data.snapshotSyncedAt ? new Date(data.snapshotSyncedAt).toLocaleString() : 'Not recorded'}</dd>
              {data.snapshotAgeHours != null && <dd>{formatNumber(data.snapshotAgeHours, 1)}h old when generated</dd>}
            </div>
            {data.usage && (
              <div><dt className="font-medium text-ink-700">Token usage</dt><dd>{formatNumber(data.usage.promptTokens)} in / {formatNumber(data.usage.completionTokens)} out</dd></div>
            )}
          </dl>
          <FeedbackButtons rating={rating} onRate={rate} status={status} />
        </div>
      </details>
    </div>
  );
}

function FeedbackButtons({
  rating,
  onRate,
  status,
}: {
  rating: 'up' | 'down' | null;
  onRate: (r: 'up' | 'down') => void;
  status: AiStatus;
}) {
  // Rating the deterministic fallback tells us nothing about model quality.
  if (status.isTemplate) return null;

  const base =
    'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border px-3 text-xs transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

  return (
    <div className="border-t border-border pt-3">
      <p className="mb-2">Rate this analysis locally. Select again to undo.</p>
      <div role="group" aria-label="Analysis feedback" className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onRate('up')}
          aria-pressed={rating === 'up'}
          aria-label="This analysis was useful"
          className={`${base} ${rating === 'up' ? 'border-sage-ink bg-sage-ink/5 text-sage-ink' : 'border-border text-ink-500 hover:text-ink-900'}`}
        >
          <ThumbIcon direction="up" filled={rating === 'up'} />
          Useful
        </button>
        <button
          type="button"
          onClick={() => onRate('down')}
          aria-pressed={rating === 'down'}
          aria-label="This analysis was wrong or unhelpful"
          className={`${base} ${rating === 'down' ? 'border-terra-ink bg-terra-ink/5 text-terra-ink' : 'border-border text-ink-500 hover:text-ink-900'}`}
        >
          <ThumbIcon direction="down" filled={rating === 'down'} />
          Not useful
        </button>
      </div>
      <p className="mt-2" role="status">
        {rating ? `${rating === 'up' ? 'Useful' : 'Not useful'} selected. Select again to undo.` : 'No rating selected.'}
      </p>
    </div>
  );
}

function ThumbIcon({ direction, filled }: { direction: 'up' | 'down'; filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={direction === 'down' ? 'rotate-180' : undefined}
    >
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}
