import type { Intensity } from './types';

export {
  formatNumber, formatKm, formatPace, formatDuration, formatSpeed,
  sportLabel, formatShortDate, formatRelativeTime,
} from '../../utils/format';

/** Tailwind text-color class for an intensity bucket. Matches design tokens. */
export function intensityColor(intensity: Intensity): string {
  switch (intensity) {
    case 'easy':
      return 'text-sage-ink';
    case 'moderate':
      return 'text-amber-ink';
    case 'hard':
      return 'text-terra-ink';
  }
}
