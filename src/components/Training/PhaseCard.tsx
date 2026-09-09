import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Card } from '../shared/Card';
import {
  phases,
  currentProgramWeek,
  PROGRAM_LENGTH_WEEKS,
  PROGRAM_START,
} from '../../lib/program';

/**
 * Renders the program phase ribbon with the current week highlighted.
 * Each phase shows load, RPE and the configured training rationale.
 */
export function PhaseCard() {
  const week = currentProgramWeek();

  const weeks = Array.from({ length: PROGRAM_LENGTH_WEEKS }, (_, i) => i + 1);

  function phaseForWeekIdx(w: number) {
    return phases.find((p) => p.weeks.includes(w));
  }

  function colorForPhase(id?: string) {
    if (id === 'base') return 'bg-sage-ink/20 text-sage-ink';
    if (id === 'build') return 'bg-ink-900/10 text-ink-900';
    if (id === 'deload') return 'bg-terra-ink/15 text-terra-ink';
    if (id === 'peak') return 'bg-terra-ink/25 text-terra-ink';
    return 'bg-ink-900/5 text-ink-500';
  }

  return (
    <Card
      title="Phase structure"
      subtitle={`${PROGRAM_LENGTH_WEEKS} weeks · started ${PROGRAM_START}`}
      right={week != null ? <span>Week {week} of {PROGRAM_LENGTH_WEEKS}</span> : null}
    >
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {weeks.map((w) => {
          const ph = phaseForWeekIdx(w);
          const isCurrent = w === week;
          return (
            <div
              key={w}
              className={`relative rounded-md px-2 py-3 text-center ${colorForPhase(
                ph?.id,
              )} ${isCurrent ? 'ring-2 ring-ink-900' : ''}`}
            >
              <p className="text-xs font-semibold">
                W{w}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed">
                {ph?.id === 'base' && 'Base'}
                {ph?.id === 'build' && 'Build'}
                {ph?.id === 'deload' && 'Deload'}
                {ph?.id === 'peak' && 'Peak'}
              </p>
              {isCurrent && <span className="sr-only">Current week</span>}
            </div>
          );
        })}
      </div>

      <div className="mt-4 text-xs">
        <MetadataList columns="single" label={{ position: 'start', width: '9rem' }}>
          {phases.map((p) => (
            <MetadataListItem key={p.id} label={p.label}>
              <span className="tabular-nums text-ink-500">
                wk {p.weeks.join(',')} · {p.load} · RPE {p.rpe}
              </span>
              <span className="mt-1 block text-sm leading-relaxed text-ink-500">{p.notes}</span>
            </MetadataListItem>
          ))}
        </MetadataList>
      </div>

      <p className="mt-4 border-t border-ink-900/5 pt-3 text-sm leading-relaxed text-ink-500">
        <span className="font-semibold">Progressive overload rule:</span> hit top of
        rep range with clean form → add 2.5–5 lb next session (2.5 on isolation),
        drop back to bottom of range, repeat. Working sets within 1–3 reps of
        failure.
      </p>
    </Card>
  );
}
