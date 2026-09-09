import { Heading } from '@astryxdesign/core/Heading';
import type { SourceHealthMap } from '../../lib/types';
import { formatRelativeTime } from '../../lib/format';
import { deriveSourceState, SourceHealthRow } from './SourceHealthRow';
import { ThemeToggle } from './ThemeToggle';

interface HeroProps {
  syncedAt: string;
  title: string;
  description: string;
  /** Per-source health from the snapshot. Absent on legacy snapshots. */
  sources?: SourceHealthMap;
}

/**
 * Page header.
 *
 * This used to be an atmospheric hero: three brand-tinted blobs blurred to
 * 64px drifting on 20–28 second loops, a sage→cool→terra gradient clipped into
 * the word "Dashboard", a staggered entrance cascade, and a pulsing dot
 * implying live telemetry — on a page whose data is a static JSON file written
 * once a day by a cron job. All of it is gone. The dot that remains is driven
 * by actual source health, so a green dot now means something is genuinely
 * healthy rather than that an animation is running.
 */
export function Hero({ syncedAt, title, description, sources }: HeroProps) {
  const states = sources
    ? Object.values(sources).map((h) => deriveSourceState(h, new Date()))
    : [];
  const worst = states.includes('failed')
    ? 'failed'
    : states.includes('stale')
      ? 'stale'
      : 'ok';

  const dotClass =
    worst === 'failed'
      ? 'bg-terra-500'
      : worst === 'stale'
        ? 'bg-amber-500'
        : 'bg-sage-500';

  const dotLabel =
    worst === 'failed'
      ? 'A source failed to sync'
      : worst === 'stale'
        ? 'A source is behind'
        : 'All sources synced';

  const synced = new Date(syncedAt);

  return (
    <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 pb-5 pt-1">
      <div className="min-w-0 max-w-2xl">
        <Heading
          level={1}
          className="text-[1.75rem] font-semibold leading-[1.05] tracking-[-0.035em] text-ink-900 sm:text-[2rem]"
        >
          {title}
        </Heading>
        <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-ink-700">{description}</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
          {sources && (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
              {/* The state is spelled out, never colour alone. */}
              <span>{dotLabel}</span>
            </span>
          )}
          {sources && <span aria-hidden>·</span>}
          {/* Both the relative and the absolute time are printed — the exact
              timestamp used to live only in a `title`, unreachable on touch. */}
          <time dateTime={synced.toISOString()} className="tabular-nums">
            Updated {formatRelativeTime(syncedAt)} ·{' '}
            {synced.toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </time>
        </p>
        {sources && (
          <details className="mt-1 text-caption text-ink-500">
            <summary className="w-fit cursor-pointer py-2">Source details</summary>
            <div className="py-2"><SourceHealthRow sources={sources} /></div>
          </details>
        )}
      </div>
      <div className="shrink-0">
        <ThemeToggle />
      </div>
    </header>
  );
}
