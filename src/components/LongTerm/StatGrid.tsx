import type { AllTimeStats } from '../../lib/types';
import { Card } from '../shared/Card';

interface Props {
  data: AllTimeStats;
  /** Current year — passed in for "X years on Strava" math. */
  thisYear: number;
}

interface Stat {
  label: string;
  value: string;
  sublabel?: string;
}

function fmtKm(km: number): string {
  if (km >= 1000) return `${(km / 1000).toFixed(1)}k km`;
  return `${km.toFixed(0)} km`;
}

export function StatGrid({ data, thisYear }: Props) {
  const yearsActive =
    data.firstYear != null ? Math.max(1, thisYear - data.firstYear + 1) : null;

  const stats: Stat[] = [
    {
      label: 'All-time activities',
      value: data.activityCount.toLocaleString(),
      sublabel:
        yearsActive != null
          ? `since ${data.firstYear} · ${yearsActive} yr${yearsActive === 1 ? '' : 's'}`
          : undefined,
    },
    {
      label: 'Lifetime distance',
      value: fmtKm(data.totalKm),
      sublabel:
        data.activityCount > 0
          ? `avg ${(data.totalKm / data.activityCount).toFixed(1)} km/activity`
          : undefined,
    },
    {
      label: 'Longest activity',
      value: `${data.longestActivityKm.toFixed(1)} km`,
    },
    {
      label: 'Longest streak',
      value: `${data.longestStreakDays} day${data.longestStreakDays === 1 ? '' : 's'}`,
      sublabel:
        data.currentStreakDays > 0
          ? `current: ${data.currentStreakDays} day${data.currentStreakDays === 1 ? '' : 's'}`
          : 'current: 0',
    },
  ];

  return (
    <Card title="All-time" subtitle="Headline stats across your entire history">
      {/* Hairline-divided cells, not four little cards inside a card — one
          containment layer is enough, and the rules read as a table. */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4 sm:gap-x-0">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className={i > 0 ? 'sm:border-l sm:border-border sm:pl-6' : ''}
          >
            <dt className="text-caption uppercase tracking-wider text-ink-500">{s.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
              {s.value}
            </dd>
            {s.sublabel && <p className="mt-0.5 text-caption text-ink-500">{s.sublabel}</p>}
          </div>
        ))}
      </dl>
    </Card>
  );
}
