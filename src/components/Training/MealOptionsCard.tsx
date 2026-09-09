import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '../shared/Card';
import { mealOptions, mealPrepChecklist } from '../../lib/program';
import type { MealOption } from '../../lib/program';

const SECTIONS: Array<{ key: keyof typeof mealOptions; label: string; sub: string }> = [
  { key: 'preWorkout', label: 'Pre-workout', sub: '~150 kcal' },
  { key: 'breakfast', label: 'Breakfast', sub: '~730 kcal · 75g P' },
  { key: 'office', label: 'Office grab-and-go', sub: 'Pick 2 · ~240 kcal each' },
  { key: 'lunch', label: 'Lunch (meal-prepped)', sub: '~720 kcal · 50g P' },
  { key: 'dinner', label: 'Dinner', sub: '~700 kcal · 45g P' },
];

function MealList({ items }: { items: MealOption[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((m) => (
        <li
          key={m.name}
          className="flex flex-wrap items-baseline justify-between gap-x-2 border-b border-ink-900/5 pb-2 text-sm last:border-0"
        >
          <div className="min-w-0 flex-1">
            <span className="break-words text-ink-700">{m.name}</span>
            {m.detail && m.detail !== '—' && (
              <span className="ml-2 text-xs leading-relaxed text-ink-500">{m.detail}</span>
            )}
          </div>
          <div className="flex w-full flex-wrap items-center justify-between gap-1.5 min-[460px]:w-auto min-[460px]:justify-start">
            {m.headline && <Badge variant="green" label="go-to" />}
            {m.kcal != null && (
              <span className="tabular-nums text-xs text-ink-500">
                {m.kcal} kcal{m.protein != null ? ` · ${m.protein}g P` : ''}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MealOptionsCard() {
  return (
    <Card
      title="Meal Options"
      subtitle="TJ’s-first product specs · headline pick on top"
    >
      <div className="space-y-5">
        {SECTIONS.map((s) => (
          <div key={s.key}>
            <p className="mb-2 flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs font-semibold text-ink-500">
                {s.label}
              </span>
              <span className="text-xs text-ink-500">{s.sub}</span>
            </p>
            <MealList items={mealOptions[s.key]} />
          </div>
        ))}

        <div className="border-t border-border pt-3">
          <p className="mb-2 text-xs font-semibold text-ink-500">
            Sunday meal prep · ~90 min active
          </p>
          <ol className="list-decimal space-y-2 pl-4 text-sm leading-relaxed text-ink-700">
            {mealPrepChecklist.map((step, i) => (
              <li key={`${i}-${step}`}>{step}</li>
            ))}
          </ol>
          <p className="mt-2 text-xs leading-relaxed text-ink-500">
            Salmon and stir fry don't meal-prep well — cook those fresh weeknights.
          </p>
        </div>
      </div>
    </Card>
  );
}
