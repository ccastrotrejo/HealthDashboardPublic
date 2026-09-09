import { StatusDot } from '@astryxdesign/core/StatusDot';
import type { StatusDotVariant } from '@astryxdesign/core/StatusDot';
import type { SourceHealth, SourceHealthMap, SourceKey } from '../../lib/types';
import { formatRelativeTime } from '../../lib/format';
import { STALE_AFTER_MS } from './StaleDataBanner';

/** Human labels + display order for the configured sources. */
const SOURCE_LABELS: Record<SourceKey, string> = {
  whoop: 'Whoop',
  strava: 'Strava',
  garmin: 'Garmin',
};
const SOURCE_ORDER: readonly SourceKey[] = ['whoop', 'strava', 'garmin'];

export type SourceState = 'ok' | 'stale' | 'failed';

/**
 * Collapse a source's raw health into a display state:
 * - `failed` — last sync attempt failed (or it has never succeeded)
 * - `stale`  — last success is older than the freshness window
 * - `ok`     — synced successfully within the window
 */
export function deriveSourceState(health: SourceHealth, now: Date): SourceState {
  if (!health.ok || !health.lastSuccess) return 'failed';
  const ageMs = now.getTime() - new Date(health.lastSuccess).getTime();
  return ageMs > STALE_AFTER_MS ? 'stale' : 'ok';
}

const STATE_VARIANT: Record<SourceState, StatusDotVariant> = {
  ok: 'success',
  stale: 'warning',
  failed: 'error',
};
const STATE_LABEL: Record<SourceState, string> = {
  ok: 'OK',
  stale: 'stale',
  failed: 'failed',
};

interface SourceHealthRowProps {
  /** Per-source health from snapshot.sources. Absent on legacy snapshots. */
  sources?: SourceHealthMap;
  /** Injectable clock for testing. */
  now?: Date;
}

/**
 * Compact per-source status strip so a silently-failing vendor (e.g. a Garmin
 * login failure that drops today's cards) is visible at a glance. Renders one
 * dot per configured source; sources absent from the snapshot are skipped,
 * so old snapshots without a `sources` field simply show nothing.
 */
export function SourceHealthRow({ sources, now = new Date() }: SourceHealthRowProps) {
  if (!sources) return null;

  const entries = SOURCE_ORDER.flatMap((key) => {
    const health = sources[key];
    return health ? [[key, health] as const] : [];
  });
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {entries.map(([key, health]) => {
        const state = deriveSourceState(health, now);
        const rel = health.lastSuccess
          ? formatRelativeTime(health.lastSuccess, now)
          : 'never';
        const tooltip = health.ok
          ? `${SOURCE_LABELS[key]} · synced ${rel}`
          : `${SOURCE_LABELS[key]} sync failed · last success ${rel}`;
        return (
          <span key={key} className="inline-flex items-center gap-1.5 text-xs">
            <StatusDot
              variant={STATE_VARIANT[state]}
              label={`${SOURCE_LABELS[key]} ${STATE_LABEL[state]}`}
              tooltip={tooltip}
            />
            <span className="font-medium text-ink-700">{SOURCE_LABELS[key]}</span>
            <span className="tabular-nums text-ink-500">{rel}</span>
          </span>
        );
      })}
    </div>
  );
}
