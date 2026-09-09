import type { AnomalyEscalation, AnomalyFlag, AnomalySeverity } from '../../lib/types';
import { Glyph, severityIcon, escalationIcon } from '../shared/icons';

interface Props {
  flags: AnomalyFlag[];
  /** Optional escalation. Absent on snapshots written before escalation existed. */
  escalation?: AnomalyEscalation | null;
}

/** Static class literals so the Tailwind scanner can see them. */
const SEV_TEXT: Record<AnomalySeverity, string> = {
  info: 'text-cool-ink',
  caution: 'text-amber-ink',
  warning: 'text-terra-ink',
};

const SEV_LABEL: Record<AnomalySeverity, string> = {
  info: 'Info',
  caution: 'Caution',
  warning: 'Warning',
};

/**
 * The alert layer. Sits at the very top of the day, above the call, and is
 * absent entirely when nothing is flagged — so its presence is the signal.
 *
 * Containment is deliberately flat: one bordered panel, hairline-separated
 * rows. The previous version nested a ringed banner and ringed list items
 * inside a card, three rounded layers deep, which made a routine "skin temp is
 * up" read as loud as a genuine escalation. Severity now travels through the
 * icon, the word, and the text tone — never through another box.
 */
export function AnomalyPanel({ flags, escalation }: Props) {
  if (flags.length === 0) return null;

  const isEscalated = escalation?.active === true;
  const triggered = new Set(escalation?.triggeredBy ?? []);

  return (
    <section
      aria-label="Anomalies"
      className={`rounded-2xl bg-ink-100 ${
        isEscalated ? 'ring-1 ring-terra-500' : 'shadow-border'
      }`}
    >
      {isEscalated && escalation && (
        <div role="alert" className="flex gap-3 border-b border-border px-5 py-4">
          <span className="mt-0.5 text-terra-ink">
            <Glyph icon={escalationIcon} size="lg" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-terra-ink">Escalated — needs attention</h3>
            <ul className="mt-1.5 space-y-1 text-xs text-ink-700">
              {escalation.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <ul className="divide-y divide-border">
        {flags.map((f) => (
          <li key={f.id} className="flex gap-3 px-5 py-3.5">
            <span className={`mt-0.5 ${SEV_TEXT[f.severity]}`}>
              <Glyph icon={severityIcon[f.severity]} size="md" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-900">
                {f.title}
                {/* Severity is spelled out, so it never depends on colour alone. */}
                <span className={`ml-2 text-caption font-normal ${SEV_TEXT[f.severity]}`}>
                  {SEV_LABEL[f.severity]}
                  {triggered.has(f.id) && ' · escalating'}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-ink-500">{f.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
