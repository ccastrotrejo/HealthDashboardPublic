import { Card } from '../shared/Card';
import { grocery } from '../../lib/program';

/**
 * The TJ's-first weekly shopping list. Collapsed by default so it doesn't
 * dominate the page — each group expands independently. The final group
 * lists non-TJ's stops (David Bars, Honey Stinger, etc.).
 */
export function GroceryCard() {
  return (
    <Card
      title="Trader Joe's shopping list"
      subtitle="Sunday prep · quantities for one week"
    >
      <div className="space-y-1.5">
        {grocery.map((g) => (
          <details
            key={g.group}
            className="border-b border-border pb-2"
          >
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink-700">
              {g.group}
              <span className="ml-2 text-xs tabular-nums text-ink-500">
                ({g.items.length})
              </span>
            </summary>
            <ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-relaxed text-ink-700">
              {g.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </Card>
  );
}
