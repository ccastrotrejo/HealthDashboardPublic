import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Card } from '../shared/Card';

interface Props {
  acuteLoad: number | null;
  chronicLoad: number | null;
}

export function TrainingLoadCard({ acuteLoad, chronicLoad }: Props) {
  if (acuteLoad == null && chronicLoad == null) {
    return (
      <Card title="Training load" subtitle="Garmin · 7d vs 28d" info="training-load">
        <p className="text-pretty text-sm text-ink-500">
          Not enough recorded activity. Garmin computes load from EPOC across logged workouts.
        </p>
      </Card>
    );
  }

  // Acute / chronic ratio — read like ACWR but in Garmin's units.
  const ratio = acuteLoad != null && chronicLoad != null && chronicLoad > 0
    ? acuteLoad / chronicLoad
    : null;
  const ratioTone =
    ratio == null
      ? 'text-ink-500'
      : ratio > 1.5
        ? 'text-terra-ink'
        : ratio < 0.8
          ? 'text-ink-500'
          : 'text-sage-ink';

  return (
    <Card title="Training load" subtitle="Garmin · 7d vs 28d" info="training-load">
      <MetadataList columns={2}>
        <MetadataListItem label="Acute · 7d">
          <span className="text-lg font-semibold tabular-nums text-ink-900">
            {acuteLoad != null ? acuteLoad.toFixed(0) : '—'}
          </span>
        </MetadataListItem>
        <MetadataListItem label="Chronic · 28d">
          <span className="text-lg font-semibold tabular-nums text-ink-900">
            {chronicLoad != null ? chronicLoad.toFixed(0) : '—'}
          </span>
        </MetadataListItem>
      </MetadataList>
      {ratio != null && (
        <div className="mt-3">
          <MetadataList columns="single" label={{ position: 'start' }}>
            <MetadataListItem label="Acute / chronic">
              <span className={`text-sm font-semibold tabular-nums ${ratioTone}`}>
                {ratio.toFixed(2)}
              </span>
            </MetadataListItem>
          </MetadataList>
        </div>
      )}
      <p className="mt-3 text-[10px] text-ink-500">
        Garmin EPOC-derived; complements the km-based ACWR card.
      </p>
    </Card>
  );
}
