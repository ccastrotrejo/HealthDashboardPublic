import { Badge } from '@astryxdesign/core/Badge';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Card } from '../shared/Card';
import { confirmedChoices, removedExercises, goals } from '../../lib/program';

/**
 * The locked-in program decisions. The "Removed exercises" list is the most
 * load-bearing thing here — it's why the AI coach must never propose RDL,
 * Bulgarian split squat, back squat, etc. without explicit permission.
 */
export function PreferencesCard() {
  return (
    <Card title="Program preferences" subtitle="Locked-in decisions">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold text-ink-500">
            Goals
          </p>
          <div className="text-sm leading-relaxed text-ink-700">
            <MetadataList columns="single" label={{ position: 'top' }}>
              {goals.map((g) => (
                <MetadataListItem key={g.label} label={g.label}>
                  {g.detail && <span className="text-ink-500">{g.detail}</span>}
                </MetadataListItem>
              ))}
            </MetadataList>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-ink-500">
            Confirmed exercise choices
          </p>
          <div className="text-sm leading-relaxed text-ink-700">
            <MetadataList columns="single" label={{ position: 'top' }}>
              {confirmedChoices.map((c) => (
                <MetadataListItem key={c.choice} label={c.choice}>
                  <span className="text-ink-500">{c.reason}</span>
                </MetadataListItem>
              ))}
            </MetadataList>
          </div>
        </div>

        <div className="md:col-span-2">
          <p className="mb-2 text-xs font-semibold text-terra-ink">
            Removed exercises — never reintroduce without explicit permission
          </p>
          <div className="flex flex-wrap gap-1.5">
            {removedExercises.map((e) => (
              <Badge key={e} variant="red" label={e} />
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
