import type { Snapshot } from '../../lib/types';

interface ColophonProps {
  snapshot: Snapshot;
}

/** Closing source and pipeline metadata. */
export function Colophon({ snapshot }: ColophonProps) {
  const sources = snapshot.sources
    ? Object.keys(snapshot.sources)
        .map((key) => key.charAt(0).toUpperCase() + key.slice(1))
        .join(' · ')
    : null;

  return (
    <footer aria-label="Page metadata" className="mt-14 border-t border-border pt-6 text-caption text-ink-500">
      <p className="text-ink-700">
        <span className="tabular-nums">{snapshot.counts.activities.toLocaleString()}</span>{' '}
        Strava activities loaded
      </p>
      <p className="mt-1">
        {sources && <>Sources: {sources}. </>}
        Synced{' '}
        <time dateTime={new Date(snapshot.syncedAt).toISOString()} className="tabular-nums">
          {new Date(snapshot.syncedAt).toLocaleString()}
        </time>
        .
      </p>
      <p className="mt-1 tabular-nums">Pipeline v{snapshot.pipelineVersion}</p>
    </footer>
  );
}
