import { Heading } from '@astryxdesign/core/Heading';
import type { RaceWeekBlock } from '../../lib/types';
import { Card } from '../shared/Card';
import { AiCardMeta } from '../Coach/AiCardMeta';
import { lookup } from '../../lib/aiMeta';
import { hueTextClass, type Hue } from '../../lib/palette';

interface Props {
  data: RaceWeekBlock;
}

const INTENSITY_HUE: Record<string, Hue> = {
  rest: 'cool',
  easy: 'sage',
  moderate: 'amber',
  hard: 'terra',
};

function fmtDay(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * AI taper plan for the days between now and race day.
 *
 * Distinct from `RaceWeekCard`, which renders generic phase guidance derived
 * from the race date alone. This one is grounded in the athlete's actual
 * CTL/ATL/TSB, recent paces and race predictions.
 */
export function AiRaceWeekCard({ data }: Props) {
  return (
    <Card
      fitContent
      title={`Race week · ${data.raceName}`}
      subtitle={`AI taper · ${data.daysOut} day${data.daysOut === 1 ? '' : 's'} out`}
      className="col-span-full"
      right={<AiCardMeta data={data} artifact="race-week" />}
    >
      <p className="mb-4 text-base font-medium text-ink-900">{data.headline}</p>

      <ol className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {data.days.map((d) => (
          <li key={d.date} className="rounded-xl bg-ink-50/50 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                {fmtDay(d.date)}
              </p>
              <span
                className={`text-caption font-medium ${
                  hueTextClass[lookup(INTENSITY_HUE, d.intensity, 'sage')]
                }`}
              >
                {d.intensity}
              </span>
            </div>
            <p className="mt-2 text-sm font-medium text-ink-900">{d.session}</p>
            {d.durationMinutes > 0 && (
              <p className="mt-0.5 text-xs tabular-nums text-ink-500">{d.durationMinutes} min</p>
            )}
            <p className="mt-2 text-caption leading-relaxed text-ink-500">{d.purpose}</p>
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Panel title="Pacing">
          <p className="text-[12px] leading-relaxed text-ink-900">{data.pacing.target}</p>
          {data.pacing.splits.length > 0 && (
            <ul className="mt-2 space-y-1">
              {data.pacing.splits.map((s, i) => (
                <li key={i} className="flex items-baseline gap-2 text-[12px] text-ink-700">
                  <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-sage-ink/60" aria-hidden />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-caption leading-relaxed text-ink-500">
            If it goes wrong: {data.pacing.contingency}
          </p>
        </Panel>

        <Panel title="Fuelling">
          <dl className="space-y-1.5 text-[12px] leading-relaxed">
            <Row label="Before" value={data.fuelling.before} />
            <Row label="During" value={data.fuelling.during} />
            <Row label="After" value={data.fuelling.after} />
          </dl>
        </Panel>

        <Panel title="Checklist">
          {data.checklist.length > 0 ? (
            <ul className="space-y-1">
              {data.checklist.map((c, i) => (
                <li key={i} className="flex items-baseline gap-2 text-[12px] text-ink-700">
                  <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-ink-500/60" aria-hidden />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-ink-500">Nothing flagged.</p>
          )}
        </Panel>
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-ink-700">{data.readiness}</p>
    </Card>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-ink-50/40 p-3">
      <Heading
        level={3}
        className="mb-2 text-caption font-semibold text-ink-500"
      >
        {title}
      </Heading>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-ink-500">{label}</dt>
      <dd className="text-ink-700">{value}</dd>
    </div>
  );
}
