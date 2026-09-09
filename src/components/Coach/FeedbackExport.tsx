import { useEffect, useState } from 'react';
import { clearAll, exportPayload, pendingCount } from '../../lib/aiFeedback';

/**
 * Export control for locally-recorded AI feedback.
 *
 * The dashboard is a static site behind basic auth with no backend, so ratings
 * accumulate in localStorage and are carried into the repo by hand — the same
 * clipboard round trip the coach workflow already documents. Without this the
 * ratings would never reach the generators and the feedback loop would be
 * decorative.
 *
 * Renders nothing until there is something to export.
 */
export function FeedbackExport() {
  const [count, setCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  // Ratings are written by sibling cards, so poll rather than thread a store
  // through the whole tree for a control that is usually invisible.
  useEffect(() => {
    const tick = () => setCount(pendingCount());
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  if (count === 0) return null;

  const copy = async () => {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(exportPayload());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2 text-xs text-ink-500">
      <span>
        <span className="font-medium tabular-nums text-ink-700">{count}</span> AI rating
        {count === 1 ? '' : 's'} recorded locally
      </span>
      <button
        type="button"
        onClick={copy}
        className="min-h-11 rounded-md bg-ink-900/5 px-3 py-2 font-medium text-ink-700 transition-colors duration-150 hover:bg-ink-900/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {copied ? 'Copied' : 'Copy for `pnpm log feedback`'}
      </button>
      <button
        type="button"
        onClick={() => {
          clearAll();
          setCount(0);
          window.dispatchEvent(new Event('health-dashboard:ai-feedback-changed'));
        }}
        className="min-h-11 min-w-11 rounded-md px-3 py-2 text-ink-500 transition-colors duration-150 hover:text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Clear
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Feedback copied to clipboard' : ''}
      </span>
      {copyError && <p role="status" className="text-amber-ink">Could not copy feedback. Check clipboard permission and try again.</p>}
    </div>
  );
}
