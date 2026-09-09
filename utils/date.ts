export const DAY_MS = 86_400_000;

/** Parse date-only keys at UTC midnight; preserve offsets on full timestamps. */
export function utcDateTime(date: string): number {
  return Date.parse(date.length === 10 ? `${date}T00:00:00Z` : date);
}

/** Format an instant as its UTC calendar date; invalid dates remain errors. */
export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Shift a UTC date by calendar days without local daylight-saving changes. */
export function addDays(date: string, days: number): string {
  return dateKey(new Date(utcDateTime(date) + days * DAY_MS));
}
