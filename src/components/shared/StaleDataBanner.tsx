import { Banner } from '@astryxdesign/core/Banner';
import { formatRelativeTime } from '../../lib/format';

/** Data older than this is considered stale — a daily sync should land well inside it. */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

interface StaleDataBannerProps {
  /** ISO timestamp the snapshot was last written (snapshot.syncedAt). */
  syncedAt: string;
  /** Injectable clock for testing. */
  now?: Date;
}

/**
 * Prominent warning shown when the snapshot hasn't been refreshed in over
 * 36 hours — a strong hint that the daily GitHub Action pipeline failed and
 * the numbers on screen may be out of date. Renders nothing when data is fresh.
 */
export function StaleDataBanner({ syncedAt, now = new Date() }: StaleDataBannerProps) {
  const ageMs = now.getTime() - new Date(syncedAt).getTime();
  if (!(ageMs > STALE_AFTER_MS)) return null;

  return (
    <Banner
      status="warning"
      title="Data may be stale"
      description={`Last successful sync was ${formatRelativeTime(
        syncedAt,
        now,
      )}. The daily pipeline may not have run — the numbers below could be out of date.`}
    />
  );
}
