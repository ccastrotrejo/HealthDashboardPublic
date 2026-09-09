import { Card } from '../shared/Card';
import type { CyclingAnalytics } from '../../lib/types';
import { formatNumber } from '../../lib/format';
import { measuredPowerPoints, powerDurationLabel } from '../../lib/powerProfile';
import { PowerDurationChart } from './PowerDurationChart';

interface Props {
  data: CyclingAnalytics;
}

/**
 * FTP, the zones derived from it, and — deliberately prominent — how much of
 * the week's riding was actually power-measured.
 *
 * The coverage figure is the honesty gauge. A zone table looks equally
 * authoritative whether it came from a tested FTP against a smart trainer or
 * from a modelled guess against wrist heart rate, so the card states which it
 * is rather than letting a confident-looking watt range imply precision it does
 * not have.
 */
export function FtpCard({ data }: Props) {
  const { profile, zones, sweetSpot, wattsPerKg, tier, week, retest, ctlRampPerWeek } = data;
  const { baseGate, powerCurve } = data;
  const curve = measuredPowerPoints(powerCurve);
  const untested = profile.ftpSource === 'estimate';
  const rampTooFast = ctlRampPerWeek != null && ctlRampPerWeek > 7;

  return (
    <Card
      title="Cycling targets"
      info="ftp"
      subtitle={
        untested
          ? 'Estimated — not yet established by a test'
          : `From ${profile.ftpSource}${profile.ftpTestedOn ? ` on ${profile.ftpTestedOn}` : ''}`
      }
      right={
        <span className="text-xs tabular-nums text-ink-700">
          {formatNumber(week.powerCoveragePct)}% of this week’s ride time power-measured
        </span>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <p>
            <span className="text-3xl font-medium tabular-nums tracking-tight text-ink-900">
              {Math.round(profile.ftpWatts)}W
            </span>
            <span className="ml-2 text-xs text-ink-500">threshold power</span>
          </p>
          {wattsPerKg != null && (
            <p>
              <span className="text-xl font-medium tabular-nums tracking-tight text-ink-700">
                {wattsPerKg} W/kg
              </span>
              <span className="ml-2 text-xs text-ink-500">{tier}</span>
            </p>
          )}
        </div>

        {/* role=status so a screen reader hears these when the snapshot loads —
            they change what the watt numbers above actually mean. */}
        <div role="status" className="space-y-2 empty:hidden">
          {retest.due && (
            <p className="border-l-2 border-amber-ink pl-3 text-pretty text-sm leading-relaxed text-amber-ink">
              <span className="font-medium">FTP test due.</span> {retest.reason}
            </p>
          )}
          {baseGate && (
            <p
              className={`border-l-2 pl-3 text-pretty text-sm leading-relaxed ${
                baseGate.passing ? 'border-sage-ink text-ink-700' : 'border-amber-ink text-ink-700'
              }`}
            >
              <span className="font-medium">
                {baseGate.passing ? 'Base gate clear.' : 'Base gate not met.'}
              </span>{' '}
              {baseGate.reason}
            </p>
          )}
          {week.powerCoveragePct === 0 && (
            <p className="border-l-2 border-amber-ink pl-3 text-pretty text-sm leading-relaxed text-ink-700">
              No ride this week recorded real power. These are targets to ride{' '}
              <span className="font-medium">indoors</span>, not measurements — outdoor rides on this
              setup are heart-rate only.
            </p>
          )}
          {week.powerCoveragePct > 0 && week.powerCoveragePct < 100 && (
            <p className="text-sm leading-relaxed text-ink-700">
              Partial power coverage. {formatNumber(100 - week.powerCoveragePct)}% of this week’s ride time had no measured power.
            </p>
          )}
          {untested && (
            <p className="text-sm leading-relaxed text-ink-700">
              Zone targets below use an estimated FTP, not a tested threshold.
            </p>
          )}
        </div>

        <PowerDurationChart data={data} />

        <details className="border-t border-border">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-ink-700">
            Power zones & reference
          </summary>
          <section aria-labelledby="ftp-zones-heading">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <h4
              id="ftp-zones-heading"
              className="text-xs font-semibold text-ink-500"
            >
              Zones
            </h4>
            <p className="text-xs tabular-nums text-ink-500">
              Sweet spot {sweetSpot.minWatts}–{sweetSpot.maxWatts}W
            </p>
          </div>
          <ul className="space-y-0.5">
            {zones.map((z) => (
              <li
                key={z.zone}
                className="flex items-baseline justify-between gap-3 border-b border-border py-2 text-sm last:border-0"
              >
                <span className="text-ink-700">
                  <span className="text-ink-500">Z{z.zone}</span> {z.label}
                </span>
                <span className="shrink-0 tabular-nums text-ink-500">
                  {z.maxWatts == null ? `${z.minWatts}W+` : `${z.minWatts}–${z.maxWatts}W`}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {curve.length > 0 && (
          <section aria-labelledby="ftp-curve-heading" className="mt-4">
            <h4
              id="ftp-curve-heading"
              className="mb-2 text-xs font-semibold text-ink-500"
            >
              Best power · last 90 days
            </h4>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {curve.map(({ seconds, watts }) => (
                <li key={seconds} className="text-xs text-ink-700">
                  <span className="text-ink-500">{powerDurationLabel(seconds)}</span>{' '}
                  <span className="tabular-nums">{watts}W</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        </details>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 border-t border-ink-900/5 pt-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold text-ink-500">
              Week TSS
            </dt>
            <dd className="mt-0.5 text-sm tabular-nums text-ink-900">{week.tss}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-ink-500">
              Training rides
            </dt>
            <dd className="mt-0.5 text-sm tabular-nums text-ink-900">
              {week.rides}
              {week.commutes > 0 && (
                <span className="text-ink-500">
                  {' '}
                  +{week.commutes} commute{week.commutes === 1 ? '' : 's'}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-ink-500">
              CTL ramp
            </dt>
            <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-sm tabular-nums text-ink-900">
              <span className={rampTooFast ? 'text-terra-ink' : undefined}>
                {ctlRampPerWeek != null ? `${ctlRampPerWeek > 0 ? '+' : ''}${ctlRampPerWeek}` : '—'}
                <span className="text-ink-500"> /wk</span>
              </span>
              {/* Text, not just colour: the warning has to survive a greyscale
                  screenshot and a colour-blind reader. */}
              {rampTooFast && (
                <span className="text-xs font-medium text-terra-ink">
                  Too fast
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}
