/** Read an own, non-nullish entry; preserve valid false, zero, and empty values. */
export function lookup<T>(map: Record<string, T | null | undefined>, key: string | undefined, fallback: T): T {
  return key != null && Object.hasOwn(map, key) ? map[key] ?? fallback : fallback;
}
