import { Badge } from '@astryxdesign/core/Badge';
import { Heading } from '@astryxdesign/core/Heading';
import type { PostRaceBlock } from '../../lib/types';
import { Card } from '../shared/Card';
import { AiCardMeta } from '../Coach/AiCardMeta';
import { lookup } from '../../lib/aiMeta';
import { formatDuration } from '../../lib/format';
import { formatRaceTime } from './raceDisplay';

interface Props {
  data: PostRaceBlock;
}

const VERDICT: Record<string, { label: string; variant: 'green' | 'neutral' | 'yellow' }> = {
  beat: { label: 'Beat goal', variant: 'green' },
  met: { label: 'Met goal', variant: 'green' },
  missed: { label: 'Missed goal', variant: 'yellow' },
  'no-goal': { label: 'No time goal', variant: 'neutral' },
};

function signedDuration(seconds: number): string {
  const sign = seconds >= 0 ? '+' : '−';
  return `${sign}${formatDuration(Math.abs(seconds))}`;
}

/**
 * AI analysis of a completed race: goal vs actual, per-leg reading, what the
 * build-up predicted, and lessons for the next block.
 *
 * `RaceResult` has carried finish time, placement and per-leg splits since the
 * races feature shipped, and until now nothing ever read them back.
 */
export function AiPostRaceCard({ data }: Props) {
  const verdict = lookup(VERDICT, data.outcome.verdict, VERDICT['no-goal']!);

  return (
    <Card
      fitContent
      title={`Post-race · ${data.raceName}`}
      subtitle="AI analysis"
      className="col-span-full"
      right={<AiCardMeta data={data} artifact="post-race" />}
    >
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <p className="text-base font-medium text-ink-900">{data.headline}</p>
        <Badge variant={verdict.variant} label={verdict.label} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border py-3 sm:grid-cols-4">
        <Stat
          label="Finish"
          value={data.outcome.actualSeconds != null ? formatRaceTime(data.outcome.actualSeconds, 2) : '—'}
        />
        <Stat
          label="Goal"
          value={data.outcome.goalSeconds != null ? formatRaceTime(data.outcome.goalSeconds) : '—'}
        />
        <Stat
          label="Delta"
          value={data.outcome.deltaSeconds != null ? signedDuration(data.outcome.deltaSeconds) : '—'}
        />
        <Stat label="Rest advised" value={`${data.recovery.restDays} days`} />
      </div>

      <p className="mb-4 text-[12px] leading-relaxed text-ink-700">{data.outcome.narrative}</p>

      {data.legs.length > 0 && (
        <section className="mb-4">
          <Heading
            level={3}
            className="mb-2 text-caption font-semibold text-ink-500"
          >
            Legs
          </Heading>
          <ul className="space-y-1.5">
            {data.legs.map((l) => (
              <li key={l.name} className="rounded-lg bg-ink-50/40 p-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[12px] font-medium text-ink-900">{l.name}</span>
                  <span className="text-[12px] tabular-nums text-ink-700">
                    {formatRaceTime(l.durationSeconds, 2)}
                  </span>
                </div>
                {l.note && <p className="mt-1 text-caption leading-relaxed text-ink-500">{l.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section>
          <Heading
            level={3}
            className="mb-2 text-caption font-semibold text-ink-500"
          >
            Execution vs build-up
          </Heading>
          <p className="text-[12px] leading-relaxed text-ink-700">{data.executionVsBuildUp}</p>
        </section>

        <section>
          <Heading
            level={3}
            className="mb-2 text-caption font-semibold text-ink-500"
          >
            Lessons
          </Heading>
          <ul className="space-y-1">
            {data.lessons.map((l, i) => (
              <li key={i} className="flex items-baseline gap-2 text-[12px] leading-relaxed text-ink-700">
                <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-sage-ink/60" aria-hidden />
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className="mt-4 text-caption leading-relaxed text-ink-500">{data.recovery.guidance}</p>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-caption text-ink-500">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums text-ink-900">{value}</p>
    </div>
  );
}
