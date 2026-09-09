/**
 * Display formatters. Keep these pure and locale-aware where it matters.
 */

const NUMBER_FORMATTERS = new Map<number, Intl.NumberFormat>();

/** Locale-aware fixed-precision number formatting for dashboard measurements. */
export function formatNumber(value: number, fractionDigits = 0): string {
  let formatter = NUMBER_FORMATTERS.get(fractionDigits);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    NUMBER_FORMATTERS.set(fractionDigits, formatter);
  }
  return formatter.format(value);
}

export function formatKm(meters: number): string {
  const km = meters / 1000;
  return `${formatNumber(km, km < 10 ? 2 : 1)} km`;
}

/** "5:23 /km". Returns "—" for null/zero. */
export function formatPace(secPerKm: number | null): string {
  if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0) return '—';
  const total = Math.round(secPerKm);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')} /km`;
}

/** "1h 23m" for ≥60min, "23m 14s" for <60min, "47s" for <60s. */
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  const mm = m - h * 60;
  return `${h}h ${mm}m`;
}

/** Speed in km/h. For ride-family activities. */
export function formatSpeed(metersPerSecond: number): string {
  if (!isFinite(metersPerSecond) || metersPerSecond <= 0) return '—';
  return `${formatNumber(metersPerSecond * 3.6, 1)} km/h`;
}

/** Human label for a sport_type — strips PascalCase into "Mountain Bike Ride". */
export function sportLabel(sportType: string): string {
  return sportType.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Short date "Mon May 19" — for activity rows. */
export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** "3 minutes ago", "2 hours ago", "yesterday", "3 days ago", "May 19". */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 30) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
