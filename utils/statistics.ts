/** Arithmetic mean, or null when no samples exist. Callers decide missing-data policy. */
export function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
