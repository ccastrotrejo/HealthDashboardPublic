import type { AgreementMatch } from '../../lib/types';
import { Card } from '../shared/Card';
import { formatDuration } from '../../lib/format';
import { SportGlyph } from '../shared/icons';
import { Glyph, severityIcon } from '../shared/icons';

interface Props {
  matches: AgreementMatch[];
}

function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function deltaLabel(delta: number | null): { text: string; color: string } | null {
  if (delta == null) return null;
  const abs = Math.abs(delta);
  let color = 'text-sage-ink';
  if (abs > 10) color = 'text-terra-ink';
  else if (abs > 5) color = 'text-amber-ink';
  return {
    text: `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%`,
    color,
  };
}

export function AgreementPanel({ matches }: Props) {
  if (matches.length === 0) {
    return null; // hide if no recent matched activities
  }

  const flagged = matches.filter((m) => m.flagged);

  return (
    <Card
      title="Source agreement"
      subtitle="Whoop vs Strava heart-rate · last 14 days"
      info="agreement"
      className="col-span-full"
      right={
        flagged.length > 0 ? (
          <span className="text-terra-ink">
            {flagged.length} flagged
          </span>
        ) : (
          <span className="text-sage-ink">all aligned</span>
        )
      }
    >
      <ul className="divide-y divide-ink-900/5">
        {matches.map((m) => {
          const avg = deltaLabel(m.avgHrDeltaPct);
          const max = deltaLabel(m.maxHrDeltaPct);
          return (
            <li key={m.stravaId} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 py-4 text-sm sm:grid-cols-12">
              <span className="text-ink-500 sm:col-span-1">
                <SportGlyph sportType={m.sportType} size="lg" />
              </span>
              <div className="min-w-0 sm:col-span-4">
                <p className="text-ink-900">{m.stravaName}</p>
                <p className="text-caption text-ink-500">
                  {fmtDateShort(m.startDateLocal)} · {formatDuration(m.durationMinutes * 60)}
                </p>
              </div>
              <div className="col-start-2 row-start-2 text-xs sm:col-span-3 sm:col-start-auto sm:row-start-auto">
                <p className="text-ink-500">Avg HR</p>
                <p className="font-mono text-ink-900">
                  {m.stravaAvgHr?.toFixed(0) ?? '—'} S /{' '}
                  {m.whoopAvgHr?.toFixed(0) ?? '—'} W
                </p>
                {avg && <p className={`tabular-nums ${avg.color}`}>{avg.text}</p>}
              </div>
              <div className="col-start-2 row-start-3 text-xs sm:col-span-3 sm:col-start-auto sm:row-start-auto">
                <p className="text-ink-500">Max HR</p>
                <p className="font-mono text-ink-900">
                  {m.stravaMaxHr?.toFixed(0) ?? '—'} S /{' '}
                  {m.whoopMaxHr?.toFixed(0) ?? '—'} W
                </p>
                {max && <p className={`tabular-nums ${max.color}`}>{max.text}</p>}
              </div>
              <div className="col-start-3 row-start-1 text-right sm:col-span-1 sm:col-start-auto sm:row-start-auto">
                {m.flagged && (
                  <span
                    className="inline-flex text-terra-ink"
                    role="img"
                    aria-label="Sources disagree by more than 5%"
                  >
                    <Glyph icon={severityIcon.warning} size="md" />
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-caption text-ink-500">
        S = Strava (device that recorded), W = Whoop strap. {'>'}5% delta flagged.
      </p>
    </Card>
  );
}
