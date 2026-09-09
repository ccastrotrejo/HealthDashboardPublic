import type { GarminRacePrediction, RacePrediction } from '../../lib/types';
import { formatDuration, formatPace } from '../../lib/format';
import { Card } from '../shared/Card';

interface RacePredictionComparisonProps {
  riegel: RacePrediction[];
  garmin: GarminRacePrediction[] | null;
}

/** Compare independent models without presenting either as a measured result. */
export function RacePredictionComparison({ riegel, garmin }: RacePredictionComparisonProps) {
  const distances = [...new Set([...riegel, ...(garmin ?? [])].map((prediction) => prediction.distanceMeters))]
    .sort((a, b) => a - b);

  return (
    <Card title="Race estimates, side by side" subtitle="Running only · two independent models" fitContent>
      {distances.length === 0 ? (
        <p className="text-sm text-ink-500">
          No estimates yet. Riegel needs a qualifying run; Garmin needs recent fitness measurements.
        </p>
      ) : (
        <table className="w-full table-fixed text-left text-sm">
          <caption className="sr-only">Estimated finish times and paces by running distance and prediction model</caption>
          <thead>
            <tr className="border-b border-ink-200 text-caption text-ink-500">
              <th scope="col" className="w-1/4 pb-3 font-medium">Distance</th>
              <th scope="col" className="pb-3 font-medium">Riegel</th>
              <th scope="col" className="pb-3 font-medium">Garmin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-200">
            {distances.map((distance) => {
              const fromPr = riegel.find((prediction) => prediction.distanceMeters === distance);
              const fromGarmin = garmin?.find((prediction) => prediction.distanceMeters === distance);
              return (
                <tr key={distance}>
                  <th scope="row" className="py-4 pr-2 font-medium text-ink-900">{fromPr?.bucket ?? fromGarmin?.bucket}</th>
                  {[fromPr, fromGarmin].map((prediction, index) => (
                    <td key={index} className="py-4 pr-2 align-top">
                      <span className="block font-semibold tabular-nums text-ink-900">
                        {prediction ? formatDuration(prediction.predictedSeconds) : '—'}
                      </span>
                      <span className="mt-1 block text-caption tabular-nums text-ink-500">
                        {prediction
                          ? formatPace(prediction.predictedSeconds / (distance / 1000))
                          : 'Unavailable'}
                      </span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="mt-3 max-w-[70ch] text-caption leading-relaxed text-ink-500">
        Riegel extrapolates from your best qualifying PR; Garmin uses its fitness model.
        Neither is a performance guarantee. Longer-distance estimates assume preparation for that
        distance, and disagreement is not evidence that either model is more accurate.
      </p>
    </Card>
  );
}
