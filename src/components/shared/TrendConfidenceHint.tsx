import type { TrendConfidence } from '../../lib/trendConfidence';
import { describeTrendConfidence } from '../../lib/trendConfidence';

interface Props {
  confidence: TrendConfidence;
  className?: string;
}

/**
 * A deliberately quiet, muted cue for whether a sparkline's trend is
 * statistically meaningful or just noise. Same visual weight as the "last 30
 * days" captions so it never competes with the metric itself. Renders nothing
 * when there isn't enough data to make a call.
 */
export function TrendConfidenceHint({ confidence, className = '' }: Props) {
  const described = describeTrendConfidence(confidence);
  if (!described) return null;

  const t = Number.isFinite(confidence.tStatistic)
    ? confidence.tStatistic.toFixed(1)
    : '∞';

  // The regression detail is appended to the accessible name instead of living
  // in a `title`, which is unreachable on touch and inconsistently announced.
  return (
    <span
      className={`inline-flex items-center gap-1 text-caption text-ink-500 ${className}`}
      aria-label={`${described.text}. Linear-regression trend over ${confidence.n} readings, t=${t}, R²=${confidence.rSquared.toFixed(2)}.`}
    >
      <span aria-hidden>{described.arrow}</span>
      <span aria-hidden>{described.text}</span>
    </span>
  );
}
