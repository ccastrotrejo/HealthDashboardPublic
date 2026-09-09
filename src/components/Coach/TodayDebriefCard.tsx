import { Badge } from '@astryxdesign/core/Badge';
import { Heading } from '@astryxdesign/core/Heading';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import type { TodayDebriefBlock, InsightTone } from '../../lib/types';
import { Card } from '../shared/Card';
import { AiCardMeta } from './AiCardMeta';
import { lookup } from '../../lib/aiMeta';

interface Props {
  data: TodayDebriefBlock;
}

/** Tone -> wrapping comparison-chip styles (bg + text). */
const TONE_CHIP: Record<InsightTone, { bg: string; text: string }> = {
  good: { bg: 'bg-sage-ink/10', text: 'text-sage-ink' },
  neutral: { bg: 'bg-ink-900/5', text: 'text-ink-700' },
  warn: { bg: 'bg-amber-500/15', text: 'text-amber-ink' },
  flag: { bg: 'bg-terra-ink/10', text: 'text-terra-ink' },
};

const ADHERENCE_STYLE: Record<
  TodayDebriefBlock['adherence']['status'],
  { label: string; variant: 'green' | 'yellow' | 'red' | 'neutral' }
> = {
  hit: { label: 'Hit', variant: 'green' },
  modified: { label: 'Modified', variant: 'yellow' },
  skipped: { label: 'Skipped', variant: 'red' },
  'rest-day': { label: 'Rest day', variant: 'neutral' },
};

const ADHERENCE_FALLBACK = { label: 'Unknown', variant: 'neutral' } as const;

function fmtForDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * End-of-day debrief, generated at 8 PM ET. Forward-and-backward looking:
 * how today went vs the program plan, what's on for tomorrow, what tonight
 * should look like to set tomorrow up right.
 */
export function TodayDebriefCard({ data }: Props) {
  const adh = lookup(ADHERENCE_STYLE, data.adherence.status, ADHERENCE_FALLBACK);

  return (
    <Card
      title="Today's debrief"
      subtitle={`AI · ${fmtForDate(data.forDate)}`}
      className="col-span-full"
      right={<AiCardMeta data={data} artifact="today-debrief" />}
    >
      <p className="mb-4 text-base font-medium text-ink-900">{data.headline}</p>

      {/* Highlights strip */}
      {data.highlights.length > 0 && (
        <ul className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {data.highlights.map((h) => {
            const tone = lookup(TONE_CHIP, h.tone, TONE_CHIP.neutral);
            return (
              <li key={h.label} className="border-t border-border py-3">
                <p className="text-xs text-ink-500">{h.label}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink-900">{h.value}</p>
                {h.comparison && (
                  <span
                    className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium leading-relaxed text-pretty ${tone.bg} ${tone.text}`}
                  >
                    {h.comparison}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Today adherence */}
        <section className="border-t border-border pt-4">
          <header className="mb-2 flex items-baseline justify-between">
            <Heading
              level={4}
              className="text-xs font-semibold text-ink-500"
            >
              Today vs plan
            </Heading>
            <Badge variant={adh.variant} label={adh.label} />
          </header>
          <MetadataList columns="single" label={{ position: 'top' }}>
            <MetadataListItem label="Planned">
              <span className="text-sm leading-relaxed text-ink-700">{data.adherence.planned}</span>
            </MetadataListItem>
            <MetadataListItem label="Actual">
              <span className="text-sm leading-relaxed text-ink-700">{data.adherence.actual}</span>
            </MetadataListItem>
          </MetadataList>
        </section>

        {/* Tomorrow setup */}
        <section className="border-t border-border pt-4">
          <Heading
            level={4}
            className="mb-2 text-xs font-semibold text-ink-500"
          >
            Tomorrow · setup
          </Heading>
          <MetadataList columns="single" label={{ position: 'top' }}>
            <MetadataListItem label="Planned">
              <span className="text-sm font-medium text-ink-900">{data.tomorrow.planned}</span>
            </MetadataListItem>
            <MetadataListItem label="Readiness">
              <span className="text-sm leading-relaxed text-ink-700">
                {data.tomorrow.readiness}
              </span>
            </MetadataListItem>
          </MetadataList>
          <p className="mt-3 border-t border-border pt-3 text-sm font-medium leading-relaxed text-ink-900">
            Tonight: {data.tomorrow.target}
          </p>
        </section>
      </div>

      {/* Flags */}
      {data.flags.length > 0 && (
        <div className="mt-4 border-l-2 border-terra-ink/50 pl-3">
          <Heading
            level={4}
            className="mb-1.5 text-xs font-semibold text-terra-ink"
          >
            Watch tomorrow
          </Heading>
          <ul className="space-y-1">
            {data.flags.map((f, i) => (
              <li key={i} className="flex items-baseline gap-2 text-sm leading-relaxed text-ink-700">
                <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-terra-ink/60" aria-hidden />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Research deep-dive */}
      {data.research && (
        <details className="mt-4 border-t border-border">
          <summary className="min-h-11 cursor-pointer py-3">
            <span className="text-sm font-semibold text-ink-700">{data.research.title}</span>
            {data.research.sources && data.research.sources.length > 0 && (
              <span className="ml-2 text-xs font-normal text-ink-500">
                · {data.research.sources.join(' + ')}
              </span>
            )}
          </summary>
          <p className="mt-3 max-w-prose whitespace-pre-line text-sm leading-relaxed text-ink-700">
            {data.research.body}
          </p>
        </details>
      )}
    </Card>
  );
}
