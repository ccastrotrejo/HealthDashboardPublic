import { Card } from '../shared/Card';
import {
  PROGRAM_LENGTH_WEEKS,
  currentProgramWeek,
  todayKey,
  planForDay,
  phaseForWeek,
  lifts,
  cardioBike,
  cardioRun,
  cardioSwim,
  CRITICAL_RECOVERY_CUE,
  dayNotes,
} from '../../lib/program';
import type { TodaysCall } from '../../lib/types';
import { resolveTrainingAction } from '../../lib/trainingAction';

interface Props {
  readinessCall?: TodaysCall | null;
}

/**
 * Surfaces today's resolved session and the configured day-specific cue.
 */
export function TodayCard({ readinessCall }: Props) {
  const now = new Date();
  const week = currentProgramWeek(now);
  const day = todayKey(now);
  const plan = planForDay(day);
  const phase = phaseForWeek(week);
  const action = resolveTrainingAction(readinessCall ?? null, plan.session);

  const lift = lifts.find((l) => l.day === day);
  const cardioWeek = week != null && week >= 1 && week <= PROGRAM_LENGTH_WEEKS ? week : null;

  // Today's headline cardio session. Friday carries the week's key bike
  // workout and Saturday the long endurance ride — they are different sessions
  // from different fields, so neither day may fall back to the other.
  const cardioForToday = (() => {
    if (cardioWeek == null) return null;
    if (day === 'Mon') return cardioSwim.find((c) => c.week === cardioWeek);
    if (day === 'Sun') return cardioRun.find((c) => c.week === cardioWeek);
    const bike = cardioBike.find((c) => c.week === cardioWeek);
    if (day === 'Fri' && bike) return { label: 'Key bike', tag: bike.tag, text: bike.workout };
    if (day === 'Sat' && bike?.longRide)
      return { label: 'Long ride', tag: 'Endurance', text: bike.longRide };
    return null;
  })();

  const isLiftA = day === 'Tue';

  const programDetails = (
    <div className="space-y-3">
        {action.adjusted && (
          <p className="text-xs text-ink-500">Original duration: {plan.duration}. Reference only; follow today’s adjustment above.</p>
        )}
        {lift && (
          <div className="border-t border-border pt-3">
            <p className="text-xs font-semibold text-ink-500">
              Lift {lift.id} · {lift.focus}
            </p>
            <ul className="mt-2 space-y-2 text-sm text-ink-700">
              {lift.exercises.map((e) => (
                <li key={e.name} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="min-w-0">{e.name}</span>
                  <span className="shrink-0 tabular-nums text-ink-500">
                    {e.sets} × {e.reps}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {cardioForToday && (
          <div className="border-t border-border pt-3">
            <p className="text-xs font-semibold text-ink-500">
              {'label' in cardioForToday
                ? cardioForToday.label
                : day === 'Mon'
                  ? 'Swim'
                  : 'Run'}{' '}
              · {cardioForToday.tag}
            </p>
            <p className="mt-1.5 text-pretty text-sm leading-relaxed text-ink-700">
              {'text' in cardioForToday ? cardioForToday.text : cardioForToday.workout}
            </p>
          </div>
        )}

        {dayNotes[day] && (
          <div className="border-t border-border pt-3">
            <p className="text-xs font-semibold text-ink-500">
              {dayNotes[day].title}
            </p>
            <p className="mt-1 text-pretty text-sm leading-relaxed text-ink-700">
              {dayNotes[day].detail}
            </p>
          </div>
        )}

        {isLiftA && (
          <p className="border-l-2 border-terra-ink/40 pl-3 text-xs leading-relaxed text-ink-500">
            {CRITICAL_RECOVERY_CUE}
          </p>
        )}
    </div>
  );

  return (
    <Card
      fitContent
      title={`Today's session · ${day}`}
      subtitle={week != null ? `Week ${week} · ${phase?.label ?? ''}` : 'Program not started yet'}
    >
      <div className="space-y-4">
        <div>
          <p className="text-2xl font-semibold leading-tight tracking-tight text-ink-900">{action.title}</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-700">{action.guidance}</p>
          {!action.adjusted && <p className="mt-1 text-xs text-ink-500">{plan.duration}</p>}
        </div>
        {action.adjusted && (
          <p className="border-t border-border pt-3 text-sm leading-relaxed text-ink-500">
            <span className="font-medium">Originally programmed:</span> {plan.session}
          </p>
        )}
        {readinessCall && (
          <details className="border-t border-border text-sm">
            <summary className="min-h-11 cursor-pointer py-3 font-medium text-ink-700">
              Readiness evidence · {readinessCall.title}
            </summary>
            <ul className="list-disc space-y-2 pb-3 pl-5 text-sm leading-relaxed text-ink-700">
              {readinessCall.reasons.map((reason, index) => <li key={index}>{reason}</li>)}
            </ul>
          </details>
        )}
        {action.adjusted ? (
          <details className="border-t border-border">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-ink-700">
              Original program details · not today’s prescription
            </summary>
            {programDetails}
          </details>
        ) : programDetails}
        <p className="border-t border-border pt-3 text-xs leading-relaxed text-ink-500">
          Pain, illness, unusual fatigue, or symptoms override this plan. Adjust or stop regardless of readiness.
        </p>
      </div>
    </Card>
  );
}
