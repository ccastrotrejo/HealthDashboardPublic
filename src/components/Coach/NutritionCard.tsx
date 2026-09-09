import { Heading } from '@astryxdesign/core/Heading';
import type { CoachBlock } from '../../lib/types';
import { Card } from '../shared/Card';
import { AiCardMeta } from './AiCardMeta';
import { Glyph, nutritionIcon } from '../shared/icons';

interface Props {
  data: CoachBlock;
}

const SECTIONS: { key: keyof CoachBlock['nutrition']; label: string }[] = [
  { key: 'dailyAnchors', label: 'Daily anchors' },
  { key: 'preAndPostFueling', label: 'Pre / post fueling' },
  { key: 'mealIdea', label: 'One meal to make' },
  { key: 'groceryItem', label: 'Grocery to prioritise' },
];

export function NutritionCard({ data }: Props) {
  return (
    <Card
      title="Nutrition"
      subtitle="AI · phase + training-aware guidance"
      info="nutrition"
      className="col-span-full"
      // Same CoachBlock as the weekly plan, so it needs the same provenance:
      // read on its own, this card previously gave no indication it was
      // AI-generated at all, let alone that it could be template fallback.
      right={<AiCardMeta data={data} artifact="coach" />}
    >
      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {SECTIONS.map((s, i) => (
          <section
            key={s.key}
            className={`border-t border-border py-4 ${i < 2 ? 'sm:border-t-0 sm:pt-0' : ''}`}
          >
            <Heading
              level={4}
              className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-500"
            >
              <Glyph icon={nutritionIcon[s.key]} size="sm" />
              {s.label}
            </Heading>
            <p className="mt-2 text-sm leading-relaxed text-ink-700">{data.nutrition[s.key]}</p>
          </section>
        ))}
      </div>
    </Card>
  );
}
