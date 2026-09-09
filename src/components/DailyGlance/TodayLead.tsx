import type { RecoveryBlock, RecoveryState, TodaysCall } from '../../lib/types';
import { Glyph, intensityIcon } from '../shared/icons';
import { InfoTooltip } from '../shared/InfoTooltip';
import { tooltipCopy } from '../../hooks/useTooltipCopy';
import { currentProgramWeek, phaseForWeek, planForDay, todayKey } from '../../lib/program';
import { formatNumber } from '../../lib/format';
import { resolveTrainingAction } from '../../lib/trainingAction';
import { RecoveryContributor, WhyThisCall } from './TodayCallDetails';
import { RecoveryAccent } from './RecoveryAccent';

interface Props {
  call: TodaysCall;
  recovery: RecoveryBlock | null;
}

const INTENSITY_TEXT: Record<TodaysCall['intensity'], string> = {
  rest: 'text-cool-300',
  easy: 'text-sage-300',
  moderate: 'text-amber-300',
  hard: 'text-terra-300',
};

const STATE_LABEL: Record<RecoveryState, string> = {
  optimal: 'Optimal',
  good: 'Good',
  adequate: 'Adequate',
  'pay-attention': 'Pay attention',
  unscored: 'Not scored',
};

const STATE_TEXT: Record<RecoveryState, string> = {
  optimal: 'text-sage-300',
  good: 'text-sage-300',
  adequate: 'text-amber-300',
  'pay-attention': 'text-terra-300',
  unscored: 'briefing-secondary',
};

function signed(n: number, digits: number, suffix: string): string {
  return `${n >= 0 ? '+' : ''}${formatNumber(n, digits)}${suffix}`;
}

/**
 * The decision layer — the one thing the dashboard exists to answer.
 *
 * Everything below this block is evidence; this is the verdict, so it gets the
 * display face at hero scale and the full page width rather than a quarter of
 * a four-column grid. It used to sit as one more equal-weight card between
 * "Sleep" and "Floors climbed", which is what made the page read as an
 * undifferentiated wall.
 *
 * One containment layer: a single panel, split by a hairline, with the call on
 * the left and the recovery evidence on the right.
 */
export function TodayLead({ call, recovery }: Props) {
  const contributors = call.contributors ?? [];
  const now = new Date();
  const day = todayKey(now);
  const week = currentProgramWeek(now);
  const phase = week != null ? phaseForWeek(week) : null;
  const plan = planForDay(day);
  const action = resolveTrainingAction(call, plan.session);

  return (
    <section
      aria-labelledby="today-call-heading"
      className="briefing-surface grid grid-cols-1 overflow-hidden rounded-[1.25rem] lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]"
    >
      <div className="briefing-rule border-b p-6 md:p-8 lg:border-b-0 lg:border-r">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="briefing-secondary text-sm">
            {day}
            {week != null && <> · Week {week}</>}
            {phase && <> · {phase.label}</>}
          </p>
        </div>

        <h2
          id="today-call-heading"
          className="mt-5 max-w-[22ch] text-3xl font-semibold leading-[1.06] tracking-[-0.035em] text-[var(--briefing-ink)] sm:text-[2.5rem]"
        >
          {action.title}
        </h2>

        <div className="mt-4 flex items-start gap-3">
          <span className={`mt-0.5 shrink-0 ${INTENSITY_TEXT[call.intensity]}`}>
            <Glyph icon={intensityIcon[call.intensity]} size="md" />
          </span>
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${INTENSITY_TEXT[call.intensity]}`}>
              {action.guidance}
            </p>
            <p className="briefing-secondary mt-1 text-xs">
              Readiness call: {call.title} · {call.intensity}
            </p>
          </div>
        </div>

        <div className="briefing-rule mt-6 border-y py-4">
          <p className="briefing-secondary text-xs">
            {action.adjusted ? 'Originally programmed' : 'Programmed duration'}
          </p>
          {action.adjusted && (
            <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-[var(--briefing-ink)]">
              {plan.session}
            </p>
          )}
          <p className="briefing-secondary mt-1 text-xs tabular-nums">{plan.duration}</p>
        </div>

        <ul className="briefing-secondary mt-5 space-y-2 text-sm">
          {call.reasons.map((r, i) => (
            <li key={i} className="flex gap-2.5">
              <span aria-hidden>
                &middot;
              </span>
              <span>{r}</span>
            </li>
          ))}
        </ul>

        {contributors.length > 0 && <WhyThisCall contributors={contributors} />}

        <p className="briefing-secondary mt-6 max-w-[68ch] text-caption leading-relaxed">
          Pain, illness, or unusual symptoms override this score. When in doubt, choose recovery.
        </p>
      </div>

      <div className="p-6 md:p-8">
        <div className="flex items-center gap-1.5 [&_button]:text-[var(--briefing-secondary)]">
          <h2 className="text-base font-semibold text-[var(--briefing-ink)]">
            Recovery signal
          </h2>
          <InfoTooltip
            title={tooltipCopy.recovery.title}
            body={tooltipCopy.recovery.body}
            thresholds={tooltipCopy.recovery.thresholds}
          />
        </div>

        {recovery ? (
          <>
            <div className="mt-4 flex items-baseline gap-3">
              <span className="text-5xl font-semibold tabular-nums leading-none tracking-[-0.035em] text-[var(--briefing-ink)]">
                {recovery.score ?? '—'}
              </span>
              <span className={`text-sm font-medium ${STATE_TEXT[recovery.state]}`}>
                {STATE_LABEL[recovery.state]}
              </span>
            </div>

            <RecoveryAccent score={recovery.score} />

            <dl className="briefing-rule mt-7 grid grid-cols-2 gap-x-4 gap-y-5 border-t pt-5">
              <RecoveryContributor
                label="HRV"
                value={recovery.hrvMs != null ? formatNumber(recovery.hrvMs) : '—'}
                unit="ms"
                delta={
                  recovery.hrvDeltaPct != null
                    ? `${signed(recovery.hrvDeltaPct, 0, '%')} vs 30d`
                    : undefined
                }
              />
              <RecoveryContributor
                label="RHR"
                value={recovery.rhrBpm != null ? formatNumber(recovery.rhrBpm) : '—'}
                unit="bpm"
                delta={
                  recovery.rhrDeltaPct != null
                    ? `${signed(recovery.rhrDeltaPct, 0, '%')} vs 30d`
                    : undefined
                }
              />
              <RecoveryContributor
                label="SpO₂"
                value={recovery.spo2Pct != null ? formatNumber(recovery.spo2Pct, 1) : '—'}
                unit="%"
              />
              <RecoveryContributor
                label="Skin temp"
                value={recovery.skinTempC != null ? formatNumber(recovery.skinTempC, 1) : '—'}
                unit="°C"
                delta={
                  recovery.skinTempDeltaC != null
                    ? `${signed(recovery.skinTempDeltaC, 2, '')} vs 30d`
                    : undefined
                }
              />
            </dl>
          </>
        ) : (
          <p className="briefing-secondary mt-4 text-sm">
            No recovery score yet today. Whoop writes it after your sleep is processed.
          </p>
        )}
      </div>
    </section>
  );
}
