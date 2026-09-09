import { useId } from 'react';
import type { CallContributor } from '../../lib/types';
import { useUrlPanel } from '../../hooks/useUrlPanel';
import { Glyph, directionIcon, disclosureIcon } from '../shared/icons';

const EFFECT_LABEL: Record<CallContributor['effect'], string> = {
  base: 'base',
  downgrade: 'downgrade',
  cap: 'cap',
};

const EFFECT_TEXT: Record<CallContributor['effect'], string> = {
  base: 'text-cool-300',
  downgrade: 'text-amber-300',
  cap: 'text-terra-300',
};

interface RecoveryContributorProps {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
}

/** One recovery contributor with its value and baseline delta. */
export function RecoveryContributor({
  label,
  value,
  unit,
  delta,
}: RecoveryContributorProps) {
  return (
    <div>
      <dt className="briefing-secondary text-caption font-medium">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1">
        <span className="text-lg font-semibold tabular-nums text-[var(--briefing-ink)]">
          {value}
        </span>
        {unit && <span className="briefing-secondary text-caption">{unit}</span>}
      </dd>
      {delta && <p className="briefing-secondary text-caption tabular-nums">{delta}</p>}
    </div>
  );
}

/** Collapsible rule trace behind the daily call. */
export function WhyThisCall({ contributors }: { contributors: CallContributor[] }) {
  const [open, setOpen] = useUrlPanel('why-this-call');
  const panelId = useId();

  return (
    <div className="mt-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="disclosure-trigger pressable-feedback briefing-secondary relative -ml-1.5 inline-flex items-center gap-1.5 rounded-lg py-1 pl-1.5 pr-2 text-xs font-medium after:absolute after:inset-x-0 after:top-1/2 after:h-10 after:-translate-y-1/2 after:content-[''] hover:bg-white/10 hover:text-white"
      >
        <span
          className="disclosure-chevron inline-flex origin-center transition-transform duration-150 ease-out-strong"
          style={{ transform: open ? 'rotate(90deg)' : 'none' }}
        >
          <Glyph icon={disclosureIcon} size="sm" />
        </span>
        Why This Call?
      </button>

      <div id={panelId} hidden={!open} className="mt-2">
        <ul className="briefing-rule divide-y border-t">
          {contributors.map((contributor, index) => (
            <li key={`${contributor.label}-${index}`} className="flex items-baseline gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium text-[var(--briefing-ink)]">
                    {contributor.label}
                  </span>
                  <span className="briefing-secondary inline-flex items-baseline gap-1 font-mono text-xs tabular-nums">
                    <span className="translate-y-0.5">
                      <Glyph icon={directionIcon[contributor.direction]} size="sm" />
                    </span>
                    {contributor.value}
                  </span>
                </div>
                <p className="briefing-secondary mt-0.5 text-xs">
                  Rule: {contributor.threshold}
                </p>
              </div>
              <span
                className={`shrink-0 text-caption font-medium ${EFFECT_TEXT[contributor.effect]}`}
              >
                {EFFECT_LABEL[contributor.effect]}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
