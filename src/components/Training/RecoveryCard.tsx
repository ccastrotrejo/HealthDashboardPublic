import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Card } from '../shared/Card';
import { saunaRules, yogaRules, hydrationRules } from '../../lib/program';

/**
 * Recovery adjuncts: configured sauna, yoga, and hydration guidance.
 * Stays at the bottom of the tab — reference material, not daily reading.
 */
export function RecoveryCard() {
  return (
    <Card title="Recovery & adjuncts" subtitle="Sauna · yoga · hydration">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div>
          <p className="mb-2 text-xs font-semibold text-ink-500">
            Sauna
          </p>
          <ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed text-ink-700">
            {saunaRules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-ink-500">
            Yoga
          </p>
          <ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed text-ink-700">
            {yogaRules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-ink-500">
            Hydration
          </p>
          <div className="text-sm leading-relaxed text-ink-700">
            <MetadataList columns="single" label={{ position: 'top' }}>
              <MetadataListItem label="Daily">{hydrationRules.daily}</MetadataListItem>
              <MetadataListItem label="Pre-training">
                {hydrationRules.preTraining}
              </MetadataListItem>
              <MetadataListItem label="During">
                {hydrationRules.duringTraining}
              </MetadataListItem>
              <MetadataListItem label="Post">
                {hydrationRules.postTraining}
              </MetadataListItem>
              <MetadataListItem label="Sat rides">
                {hydrationRules.saturdayRides}
              </MetadataListItem>
            </MetadataList>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-500">
            {hydrationRules.note}
          </p>
        </div>
      </div>
    </Card>
  );
}
