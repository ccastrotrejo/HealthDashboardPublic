import { recoveryProgress } from '../../lib/threeScene';
import { MetricRing } from '../shared/MetricRing';
import { ThreeView } from '../shared/ThreeView';

interface RecoveryAccentProps {
  score: number | null;
}

/** Mirrors the reported score only; it adds no health interpretation. */
export function RecoveryAccent({ score }: RecoveryAccentProps) {
  const progress = recoveryProgress(score);
  if (progress === null) {
    return <p className="briefing-secondary mt-4 text-caption">No scored recovery value for the visual summary.</p>;
  }
  return (
    <div className="mt-4">
      <ThreeView
        label="Recovery lens"
        scene={{ kind: 'recovery', score }}
        className="h-44"
        readout={{ value: String(score), label: 'of 100' }}
        fallback={<MetricRing progress={progress} value={`${score}/100`} />}
      />
      <p className="briefing-secondary mt-2 text-caption">
        Reported recovery: {score}/100. The lens is a visual accent, not a new score.
      </p>
    </div>
  );
}
