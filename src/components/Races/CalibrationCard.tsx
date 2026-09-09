import type { CalibrationBlock } from '../../lib/types';
import { Card } from '../shared/Card';
import { AiCardMeta } from '../Coach/AiCardMeta';
import { formatNumber } from '../../lib/format';
import { formatRaceDate, formatRaceTime } from './raceDisplay';

interface Props {
  data: CalibrationBlock;
}

const SOURCE_LABEL: Record<CalibrationBlock['betterSource'], string> = {
  riegel: 'Riegel',
  garmin: 'Garmin',
  tie: 'Too close to call',
  'insufficient-data': 'Not enough data to compare sources',
};

function pct(value: number | null): string {
  return value == null ? 'Not scored' : `${value >= 0 ? '+' : ''}${formatNumber(value, 1)}%`;
}

export function CalibrationCard({ data }: Props) {
  const hasScores = data.scores.some((score) => score.predictedSeconds != null || score.garminPredictedSeconds != null);

  return (
    <Card
      title="Prediction calibration"
      subtitle="Past estimates compared with recorded finish times"
      right={<AiCardMeta data={data} artifact="calibration" />}
      fitContent
    >
      {hasScores ? (
        <>
          <dl className="mb-4 flex flex-wrap gap-x-8 gap-y-3">
            {data.meanErrorPct != null && <Stat label="Riegel mean error" value={pct(data.meanErrorPct)} />}
            {data.garminMeanErrorPct != null && <Stat label="Garmin mean error" value={pct(data.garminMeanErrorPct)} />}
            <Stat label="More accurate" value={SOURCE_LABEL[data.betterSource]} />
          </dl>
          <ul className="divide-y divide-border border-y border-border">
            {data.scores.map((score) => (
              <li key={score.raceId} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-sm font-medium text-ink-900">{score.raceName}</p>
                  <p className="text-caption text-ink-500">{formatRaceDate(score.raceDate)} · {score.bucket}</p>
                </div>
                <dl className="mt-3 grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
                  <Stat label="Actual finish" value={formatRaceTime(score.actualSeconds, 2)} />
                  <Stat label="Riegel estimate" value={score.predictedSeconds != null ? `${formatRaceTime(score.predictedSeconds)} · ${pct(score.errorPct)}` : 'Not available'} />
                  <Stat label="Garmin estimate" value={score.garminPredictedSeconds != null ? `${formatRaceTime(score.garminPredictedSeconds)} · ${pct(score.garminErrorPct)}` : 'Not available'} />
                </dl>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-caption text-ink-500">Positive error means the finish was slower than the estimate; negative means faster.</p>
        </>
      ) : (
        <p className="max-w-prose text-sm leading-relaxed text-ink-700">
          No scored predictions yet. A recorded finish matched to a prediction distance is needed before accuracy or bias can be assessed.
        </p>
      )}
      <details className="mt-4 border-t border-border pt-3">
        <summary className="cursor-pointer text-sm font-medium text-ink-700">Calibration evidence and model notes</summary>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-700 [overflow-wrap:anywhere]">
          <p>{data.headline}</p>
          <p>{data.guidance}</p>
          {!hasScores && data.scores.length > 0 && (
            <ul className="space-y-1">
              {data.scores.map((score) => (
                <li key={score.raceId}>{formatRaceDate(score.raceDate)} · {score.raceName}: {formatRaceTime(score.actualSeconds, 2)} · no prediction available</li>
              ))}
            </ul>
          )}
          <p className="text-caption text-ink-500">Predictions are estimates, not performance guarantees.</p>
        </div>
      </details>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-ink-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium tabular-nums text-ink-900">{value}</dd>
    </div>
  );
}
