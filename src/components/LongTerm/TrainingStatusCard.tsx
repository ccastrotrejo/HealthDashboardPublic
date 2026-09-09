import type { GarminLatestMetrics } from '../../lib/types';
import { Card } from '../shared/Card';

type TrainingStatus = NonNullable<GarminLatestMetrics['trainingStatus']>;

interface Props {
  data: TrainingStatus | null;
}

/** Soft tone per status — keeps the page calm. Loud reds reserved for anomalies. */
function statusTone(label: string): string {
  const l = label.toLowerCase();
  if (l === 'productive' || l === 'peaking') return 'text-sage-ink';
  if (l === 'maintaining' || l === 'recovery') return 'text-ink-900';
  if (l === 'overreaching' || l === 'unproductive') return 'text-terra-ink';
  if (l === 'detraining') return 'text-ink-500';
  return 'text-ink-900';
}

export function TrainingStatusCard({ data }: Props) {
  if (!data || (data.label.trim().toLowerCase() === 'no status' && data.weeklyLoad == null)) {
    return (
      <Card title="Training status" subtitle="Garmin" info="training-status" fitContent>
        <p className="text-pretty text-sm text-ink-500">
          No status from Garmin yet. Logs in once you have ~7 days of recorded activities
          on a compatible device.
        </p>
        {data?.feedback && (
          <details className="mt-3 border-t border-border text-caption text-ink-500">
            <summary className="min-h-11 cursor-pointer py-3">Provider status details</summary>
            <p className="break-words pb-2">{data.feedback}</p>
          </details>
        )}
      </Card>
    );
  }

  const tone = statusTone(data.label);
  return (
    <Card title="Training status" subtitle="Garmin" info="training-status" fitContent>
      <div className="flex items-baseline gap-3">
        <span className={`text-2xl font-semibold tracking-tight ${tone}`}>
          {data.label}
        </span>
        {data.weeklyLoad != null && (
          <span className="ml-auto text-xs tabular-nums text-ink-500">
            weekly load {data.weeklyLoad.toFixed(0)}
          </span>
        )}
      </div>
      {data.feedback && (
        <p className="mt-2 text-pretty text-caption leading-snug text-ink-500">
          {data.feedback}
        </p>
      )}
      {data.loadTunnelMin != null && data.loadTunnelMax != null && data.weeklyLoad != null && (
        <div className="mt-4">
          <p className="mb-1.5 text-caption text-ink-500">
            Optimal load tunnel
          </p>
          <LoadTunnelBar
            min={data.loadTunnelMin}
            max={data.loadTunnelMax}
            value={data.weeklyLoad}
          />
          <div className="mt-1 flex justify-between text-caption tabular-nums text-ink-500">
            <span>{data.loadTunnelMin.toFixed(0)}</span>
            <span>{data.loadTunnelMax.toFixed(0)}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function LoadTunnelBar({ min, max, value }: { min: number; max: number; value: number }) {
  // Clamp the visual range so an extreme overreach doesn't squash the tunnel.
  const lo = min * 0.5;
  const hi = max * 1.5;
  const span = Math.max(1, hi - lo);
  const tunnelStart = ((min - lo) / span) * 100;
  const tunnelWidth = ((max - min) / span) * 100;
  const valuePos = Math.min(100, Math.max(0, ((value - lo) / span) * 100));

  return (
    <div className="relative h-2 w-full rounded-full bg-ink-900/5">
      <div
        className="absolute h-full rounded-full bg-sage-ink/30"
        style={{ left: `${tunnelStart}%`, width: `${tunnelWidth}%` }}
      />
      <div
        className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-900 transition-[left] duration-500 ease-out"
        style={{ left: `${valuePos}%` }}
        aria-label={`current load ${value}`}
      />
    </div>
  );
}
