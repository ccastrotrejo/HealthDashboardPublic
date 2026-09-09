import type { WeeklyReviewBlock } from '../../lib/types';
import { formatNumber } from '../../lib/format';
import { Card } from '../shared/Card';
import { AiCardMeta } from './AiCardMeta';

interface Props {
  data: WeeklyReviewBlock;
}

function fmtForWeek(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function fmtSigned(n: number): string {
  if (n === 0) return '±0';
  return `${n > 0 ? '+' : '−'}${formatNumber(Math.abs(n), Math.abs(n) >= 1 ? 1 : 2)}`;
}

/** Retrospective evidence and next-week focus; its primary home is Review. */
export function WeeklyReviewCard({ data }: Props) {
  return (
    <Card
      title="Weekly review"
      subtitle={`AI · week of ${fmtForWeek(data.forWeek)}`}
      className="col-span-full"
      right={<AiCardMeta data={data} artifact="weekly-review" />}
    >
      <p className="mb-5 max-w-prose text-base font-medium leading-relaxed text-ink-900">{data.headline}</p>
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
        <section className="border-t border-border pt-4">
          <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-xs font-semibold text-ink-500">Program adherence</h4>
            <span className={`text-2xl font-semibold tabular-nums ${
              data.adherence.score >= 85 ? 'text-sage-ink' : data.adherence.score >= 65 ? 'text-ink-900' : 'text-terra-ink'
            }`}>
              {formatNumber(data.adherence.score)}%
            </span>
          </header>
          {data.adherence.note && <p className="text-sm leading-relaxed text-ink-700">{data.adherence.note}</p>}
          <details className="mt-3">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-ink-700">
              Compare planned and completed sessions
            </summary>
            <ol className="divide-y divide-border">
              {data.adherence.planned.map((planned, index) => (
                <li key={index} className="py-3 text-sm leading-relaxed">
                  <p className="mb-2 text-xs font-semibold text-ink-500">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index] ?? `Day ${index + 1}`}
                  </p>
                  <dl className="space-y-2">
                    <div>
                      <dt className="text-xs text-ink-500">Planned</dt>
                      <dd className="text-ink-700">{planned}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-500">Recorded</dt>
                      <dd className="text-ink-900">{data.adherence.actual[index] ?? '—'}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>
          </details>
        </section>

        <section className="border-t border-border pt-4">
          <h4 className="mb-3 text-xs font-semibold text-ink-500">Fitness change · week over week</h4>
          <dl className="grid grid-cols-3 gap-3">
            <Stat label="Fitness" value={fmtSigned(data.fitnessDelta.ctlChange)} hint="CTL · 42-day load" />
            <Stat label="Fatigue" value={fmtSigned(data.fitnessDelta.atlChange)} hint="ATL · 7-day load" />
            <Stat label="Freshness" value={fmtSigned(data.fitnessDelta.tsbChange)} hint="TSB · CTL − ATL" />
          </dl>
          <p className="mt-4 text-sm leading-relaxed text-ink-700">{data.fitnessDelta.narrative}</p>
          <details className="mt-2">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-ink-700">
              What do CTL, ATL, and TSB mean?
            </summary>
            <div className="space-y-3 text-sm leading-relaxed text-ink-700">
              <p>The <strong>Banister fitness/fatigue/form</strong> model — the standard way endurance coaches read training load.</p>
              <dl className="space-y-3">
                <div>
                  <dt className="font-semibold">CTL · Fitness</dt>
                  <dd>42-day exponentially weighted average of daily training load. Slow-moving — building it takes weeks; losing it takes weeks. Rising CTL = improving aerobic engine.</dd>
                </div>
                <div>
                  <dt className="font-semibold">ATL · Fatigue</dt>
                  <dd>7-day average. Fast-moving — spikes after hard sessions, drops within days of rest. High ATL = currently carrying a big training load.</dd>
                </div>
                <div>
                  <dt className="font-semibold">TSB · Form (CTL − ATL)</dt>
                  <dd>Positive = fresh and race-ready; negative = absorbing a training block. {'>'} +5 is taper territory; −10 to −30 is productive build; below −30 is overreached.</dd>
                </div>
              </dl>
              <p className="text-ink-500">Watch the <em>direction</em> more than the absolute number — CTL rising slowly week-over-week is the goal during build phases. A positive TSB with a sliding CTL means freshness from detraining, not a taper.</p>
            </div>
          </details>
        </section>

        <section className="border-t border-border pt-4 md:col-span-2">
          <h4 className="mb-2 text-xs font-semibold text-ink-500">Standout session</h4>
          <p className="text-base font-semibold text-ink-900">{data.standout.activity}</p>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-700">{data.standout.why}</p>
        </section>

        <section className="border-t border-border pt-4 md:col-span-2">
          <h4 className="mb-2 text-xs font-semibold text-ink-500">Multi-week trend</h4>
          <p className="max-w-prose text-sm leading-relaxed text-ink-700">{data.trend}</p>
        </section>

        <section className="border-t border-border pt-4">
          <h4 className="mb-3 text-xs font-semibold text-ink-500">Sleep consistency</h4>
          <dl className="grid grid-cols-2 gap-3">
            <Stat label="Bedtime drift" value={`±${formatNumber(data.sleepCoach.bedtimeDriftMin)} min`} />
            <Stat label="Duration variance" value={`±${formatNumber(data.sleepCoach.durationVarianceMin)} min`} />
          </dl>
          <details className="mt-3">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-ink-700">
              Sleep target · generated evidence
            </summary>
            <p className="mb-2 text-xs text-ink-500">Original model wording; numeric precision is not measurement confidence.</p>
            <p className="text-sm leading-relaxed text-ink-700">{data.sleepCoach.target}</p>
          </details>
        </section>

        <section className="border-t border-border pt-4">
          <h4 className="mb-2 text-xs font-semibold text-ink-500">Next week · focus</h4>
          <p className="text-sm leading-relaxed text-ink-700">{data.nextWeekFocus}</p>
        </section>
      </div>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-ink-900">{value}</dd>
      {hint && <dd className="mt-1 text-xs leading-relaxed text-ink-500">{hint}</dd>}
    </div>
  );
}
