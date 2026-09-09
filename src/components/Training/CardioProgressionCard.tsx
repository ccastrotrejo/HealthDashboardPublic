import { Badge } from '@astryxdesign/core/Badge';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Card } from '../shared/Card';
import {
  cardioRun,
  cardioSwim,
  cardioBike,
  paceGlossary,
  currentProgramWeek,
} from '../../lib/program';
import type { CardioWeek } from '../../lib/program';

interface Props {
  sport: 'run' | 'swim' | 'bike';
}

const data: Record<Props['sport'], { title: string; subtitle: string; rows: CardioWeek[] }> = {
  run: {
    title: 'Run progression',
    subtitle: 'Optional cross-training — not a target this block',
    rows: cardioRun,
  },
  swim: {
    title: 'Swim progression',
    subtitle: 'Monday — aerobic maintenance, zero bike interference',
    rows: cardioSwim,
  },
  bike: {
    title: 'Bike progression',
    subtitle: 'Friday key session indoors · Saturday long ride outdoors',
    rows: cardioBike,
  },
};

export function CardioProgressionCard({ sport }: Props) {
  const week = currentProgramWeek();
  const { title, subtitle, rows } = data[sport];

  return (
    <Card title={title} subtitle={subtitle}>
      <div className="space-y-1.5">
        {rows.map((r) => {
          const isCurrent = r.week === week;
          return (
            <div
              key={r.week}
              className={`flex flex-wrap items-baseline gap-x-2 rounded-md px-2 py-2 text-sm ${
                isCurrent ? 'bg-sage-ink/10 ring-1 ring-sage-ink/30' : ''
              }`}
            >
              <span
                className={`tabular-nums ${
                  isCurrent ? 'font-semibold text-sage-ink' : 'text-ink-500'
                }`}
              >
                W{r.week}{isCurrent ? ' · current' : ''}
              </span>
              <Badge variant="neutral" label={r.tag} />
              <span className="basis-full text-pretty text-ink-700 sm:basis-auto sm:flex-1">
                {r.workout}
                {r.longRide && (
                  <span className="mt-0.5 block text-ink-500">
                    <span className="font-medium text-ink-700">Sat:</span> {r.longRide}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {sport === 'bike' && (
        <details className="mt-4 group">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink-500 hover:text-ink-700">
            Power glossary
          </summary>
          <div className="mt-2 text-sm leading-relaxed text-ink-700">
            <MetadataList columns="single" label={{ position: 'start' }}>
              {paceGlossary.map((p) => (
                <MetadataListItem key={p.key} label={`${p.key}:`}>
                  {p.def}
                </MetadataListItem>
              ))}
            </MetadataList>
          </div>
        </details>
      )}
    </Card>
  );
}
