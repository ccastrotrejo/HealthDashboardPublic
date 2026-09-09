import type { CyclingAnalytics, CyclingPowerEffort } from './types';

export interface PowerProfilePoint {
  seconds: number;
  watts: number;
  source: CyclingPowerEffort | null;
}

export interface PowerProfileSeries {
  id: 'all' | 'recent' | 'preceding';
  label: string;
  points: PowerProfilePoint[];
}

const SAMPLED_DURATIONS = [5, 15, 30, 60, 300, 1200, 3600];

/** Keep only recorded finite values, including a measured zero, on positive durations. */
export function measuredPowerPoints(
  curve: Record<string, number>,
  sources: Record<string, CyclingPowerEffort> = {},
): PowerProfilePoint[] {
  const points = new Map<number, PowerProfilePoint>();
  for (const [duration, watts] of Object.entries(curve)) {
    const seconds = Number(duration);
    if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(watts) || watts < 0) continue;
    const previous = points.get(seconds);
    if (!previous || watts > previous.watts) {
      const source = sources[duration];
      points.set(seconds, { seconds, watts, source: source?.watts === watts ? source : null });
    }
  }
  return [...points.values()].sort((a, b) => a.seconds - b.seconds);
}

/** Older snapshots carry only the 90-day maximum; never infer their shorter blocks. */
export function powerProfileSeries(
  data: Pick<CyclingAnalytics, 'powerCurve' | 'powerBlocks'>,
): PowerProfileSeries[] {
  if (!data.powerBlocks) {
    return [{ id: 'all', label: 'Best power · last 90 days', points: measuredPowerPoints(data.powerCurve) }];
  }
  return (['recent', 'preceding'] as const).map((id) => {
    const efforts = data.powerBlocks![id];
    return {
      id,
      label: id === 'recent' ? 'Recent · last 30 days' : 'Preceding · days 31–90',
      points: measuredPowerPoints(
        Object.fromEntries(Object.entries(efforts).map(([duration, effort]) => [duration, effort.watts])),
        efforts,
      ),
    };
  });
}

/** Null entries break connectors at missing sampled durations instead of implying zero. */
export function powerProfilePlotRows(series: PowerProfileSeries[]) {
  const measured = series.flatMap((item) => item.points.map((point) => point.seconds));
  if (!measured.length) return [];
  const minimum = Math.min(...measured);
  const maximum = Math.max(...measured);
  const durations = [...new Set([...SAMPLED_DURATIONS, ...measured])]
    .filter((seconds) => seconds >= minimum && seconds <= maximum)
    .sort((a, b) => a - b);
  return durations.map((seconds) => ({
    seconds,
    points: series.map((item) => item.points.find((point) => point.seconds === seconds) ?? null),
  }));
}

export function powerDurationLabel(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}min`;
  return `${seconds}s`;
}
