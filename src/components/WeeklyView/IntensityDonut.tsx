import type { IntensityDistribution } from '../../lib/types';
import { formatDuration } from '../../lib/format';
import { Card } from '../shared/Card';
import { brand } from '../../lib/palette';

interface Props {
  data: IntensityDistribution;
}

const COLORS = {
  easy: brand.sage[500], // sage-500
  moderate: brand.amber[500], // amber-500
  hard: brand.terra[500], // terra-500
};

const TARGET_EASY_PCT = 80;
const WHOLE_PERCENT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function IntensityDonut({ data }: Props) {
  const total = data.easySeconds + data.moderateSeconds + data.hardSeconds;

  if (total === 0) {
    return (
      <Card title="Intensity Distribution" subtitle="Last 28 days">
        <p className="text-sm text-ink-500">No activity time logged in the last 28 days.</p>
      </Card>
    );
  }

  const easyPct = (data.easySeconds / total) * 100;

  const chartData = [
    { name: 'Easy', seconds: data.easySeconds, color: COLORS.easy },
    {
      name: 'Moderate',
      seconds: data.moderateSeconds,
      color: COLORS.moderate,
    },
    { name: 'Hard', seconds: data.hardSeconds, color: COLORS.hard },
  ].map((entry) => ({ ...entry, pct: (entry.seconds / total) * 100 }));

  const targetDelta = easyPct - TARGET_EASY_PCT;

  return (
    <Card
      title="Intensity Distribution"
      subtitle="All sports · last 28 days"
      info="intensity-distribution"
      right={<span>{formatDuration(total)} total</span>}
      fitContent
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-3xl font-semibold tabular-nums tracking-tight text-ink-900">
          {Math.round(easyPct)}%
          <span className="ml-1 text-sm font-medium text-ink-500">easy</span>
        </p>
        <p className={targetDelta >= 0 ? 'text-xs text-sage-ink' : 'text-xs text-amber-ink'}>
          {Math.abs(targetDelta) < 0.5 ? 'At the 80% easy target' : <>
            {WHOLE_PERCENT.format(Math.abs(targetDelta))} points{' '}
            {targetDelta > 0 ? 'above' : 'below'} 80% easy target
          </>}
        </p>
      </div>

      <div className="relative mt-5">
        <div
          role="img"
          aria-label={chartData
            .map((entry) => `${entry.name} ${WHOLE_PERCENT.format(entry.pct)} percent`)
            .join(', ')}
          className="flex h-5 overflow-hidden rounded-md bg-ink-200"
        >
          {chartData.map((entry) => (
            <div
              key={entry.name}
              style={{ width: `${entry.pct}%`, backgroundColor: entry.color }}
            />
          ))}
        </div>
        <span
          aria-hidden
          className="absolute -top-2 h-9 w-px bg-ink-900"
          style={{ left: `${TARGET_EASY_PCT}%` }}
        />
        <span
          className="absolute top-7 -translate-x-1/2 whitespace-nowrap text-caption text-ink-500"
          style={{ left: `${TARGET_EASY_PCT}%` }}
        >
          {TARGET_EASY_PCT}% target
        </span>
      </div>

      <dl className="mt-10 grid grid-cols-3 gap-3">
        {chartData.map((entry) => (
          <div key={entry.name} className="min-w-0 border-t border-ink-200 pt-3">
            <dt className="flex items-center gap-2 text-caption text-ink-500">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: entry.color }}
              />
              {entry.name}
            </dt>
            <dd className="mt-1 font-mono text-sm tabular-nums text-ink-900">
              {WHOLE_PERCENT.format(entry.pct)}%
            </dd>
            <dd className="mt-0.5 text-caption text-ink-500">{formatDuration(entry.seconds)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
