import { useId, useState } from 'react';
import type { CoachBlock, CoachDay } from '../../lib/types';
import { Card } from '../shared/Card';
import { AiCardMeta } from './AiCardMeta';
import { lookup } from '../../lib/aiMeta';
import { hueTextClass, type Hue } from '../../lib/palette';
import { todayKey } from '../../lib/program';
import { isCurrentCoachWeek, selectCoachDay } from '../../lib/trainingPresentation';
import { TrainingMiniature } from '../Training/TrainingMiniature';

interface Props {
  data: CoachBlock;
}

const INTENSITY_HUE: Record<CoachDay['intensity'], Hue> = {
  rest: 'cool',
  easy: 'sage',
  moderate: 'amber',
  hard: 'terra',
};

function fmtDuration(mins: number): string {
  const rounded = Math.round(mins);
  if (rounded < 60) return `${rounded}m`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** "Week of Mon 21 Jul" — so a plan for last week can't pass as this week's. */
function fmtWeek(iso: string | undefined): string {
  if (!iso) return 'week not recorded';
  const d = new Date(iso + 'T12:00:00Z');
  return `week of ${d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })}`;
}

export function WeeklyPlan({ data }: Props) {
  const today = todayKey();
  const isCurrentWeek = isCurrentCoachWeek(data.forWeek);
  const [selectedWeekday, setSelectedWeekday] = useState<CoachDay['weekday']>(
    isCurrentWeek ? today : data.plan[0]?.weekday ?? today,
  );
  const selectedDay = selectCoachDay(data.plan, selectedWeekday);
  const detailId = useId();

  return (
    <Card
      title="Weekly plan"
      subtitle={`AI-generated · ${fmtWeek(data.forWeek)}`}
      info="weekly-plan"
      className="col-span-full"
      right={<AiCardMeta data={data} artifact="coach" />}
    >
      <p className="mb-3 text-xs text-ink-500">Select a day for the full session and coach rationale.</p>
      {selectedDay ? (
        <>
          <div role="group" aria-label="Weekly plan days" className="grid grid-cols-4 gap-1 sm:grid-cols-7">
            {data.plan.map((day) => {
              const selected = day.weekday === selectedDay.weekday;
              return (
                <button
                  type="button"
                  key={day.weekday}
                  aria-pressed={selected}
                  aria-controls={detailId}
                  onClick={() => setSelectedWeekday(day.weekday)}
                  className={`min-h-11 min-w-0 rounded-lg border px-2 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    selected
                      ? 'border-ink-900/25 bg-ink-900/5 text-ink-900'
                      : 'border-transparent text-ink-500 hover:border-border hover:bg-ink-900/5'
                  }`}
                >
                  <span className="block text-sm font-semibold">{day.weekday}</span>
                  <span className={`mt-1 block text-xs ${hueTextClass[lookup(INTENSITY_HUE, day.intensity, 'sage')]}`}>
                    {day.intensity}
                  </span>
                  <span className="mt-0.5 block text-xs tabular-nums">
                    {day.durationMinutes > 0 ? fmtDuration(day.durationMinutes) : 'Rest'}
                  </span>
                  {isCurrentWeek && day.weekday === today && <span className="mt-1 block text-xs">Today</span>}
                </button>
              );
            })}
          </div>
          <TrainingMiniature days={data.plan} selectedDay={selectedDay.weekday} />
          <section id={detailId} aria-label={`${selectedDay.weekday} session`} className="mt-4 border-t border-border pt-4">
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
              <span className="font-semibold text-ink-500">{selectedDay.weekday} · selected session</span>
              <span className={hueTextClass[lookup(INTENSITY_HUE, selectedDay.intensity, 'sage')]}>
                {selectedDay.intensity}
                {selectedDay.durationMinutes > 0 ? ` · ${fmtDuration(selectedDay.durationMinutes)}` : ''}
              </span>
            </div>
            <h4 className="max-w-prose text-base font-semibold leading-snug text-ink-900">{selectedDay.type}</h4>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-700">{selectedDay.reason}</p>
          </section>
        </>
      ) : (
        <p className="text-sm text-ink-500">No daily sessions were included in this plan.</p>
      )}
      {data.summary && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-1 text-xs font-semibold text-ink-500">Week context · generated with this plan</p>
          <p className="max-w-prose text-sm leading-relaxed text-ink-700">{data.summary}</p>
        </div>
      )}
    </Card>
  );
}
