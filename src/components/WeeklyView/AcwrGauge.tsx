import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import type { AcwrResult } from '../../lib/types';
import { Card } from '../shared/Card';
import { brand, hueTextClass, type Hue } from '../../lib/palette';
import { formatNumber } from '../../lib/format';
import { acwrRatioToPercent as ratioToPercent, acwrUnitLabel } from '../../lib/chartRefinement';

interface Props {
  data: AcwrResult;
  /** Optional Whoop-strain-based ACWR for a parallel reading. */
  strain?: AcwrResult | null;
}

/**
 * Zone bounds and hues — see analytics.ts → computeAcwr().
 *
 * `hue` drives both readings of the zone: the bar segment takes the `-500`
 * fill, the label takes the mode-aware `-ink` text tone. They are deliberately
 * different values — `-500` is not legible as small text on the light card.
 */
const ZONES: { from: number; to: number; hue: Hue; label: string; zone: AcwrResult['zone'] }[] = [
  { from: 0, to: 0.8, hue: 'cool', label: 'Detraining', zone: 'detraining' },
  { from: 0.8, to: 1.3, hue: 'sage', label: 'Sweet spot', zone: 'sweet-spot' },
  { from: 1.3, to: 1.5, hue: 'amber', label: 'Caution', zone: 'caution' },
  { from: 1.5, to: 2.0, hue: 'terra', label: 'Injury risk', zone: 'injury-risk' },
];
const GAUGE_MIN = 0;
const GAUGE_MAX = 2.0;

function zoneLabel(zone: AcwrResult['zone']): string {
  return ZONES.find((z) => z.zone === zone)?.label ?? '—';
}

/** Tailwind class for a zone's label. Neutral ink when the zone is undefined. */
function zoneTextClass(zone: AcwrResult['zone']): string {
  const z = ZONES.find((z) => z.zone === zone);
  return z ? hueTextClass[z.hue] : 'text-ink-500';
}

export function AcwrGauge({ data, strain }: Props) {
  const hasRatio = isFinite(data.ratio);
  const markerPct = ratioToPercent(data.ratio);
  const hasStrain = strain && isFinite(strain.ratio);
  const unit = acwrUnitLabel(data.unit);

  return (
    <Card
      title="Load Balance"
      subtitle={`All sports · ${unit} · 7d / 28d`}
      info="acwr"
      fitContent
    >
      <div className="space-y-4">
        <div className="flex items-baseline gap-3">
          <p className="text-3xl font-semibold tabular-nums text-ink-900">
            {hasRatio ? formatNumber(data.ratio, 2) : '—'}
          </p>
          <p className={`text-sm font-medium ${hasRatio ? zoneTextClass(data.zone) : 'text-ink-500'}`}>
            {zoneLabel(data.zone)}
          </p>
        </div>
        <p className="-mt-2 text-xs text-ink-500">
          Productive range <span className="font-medium text-sage-ink">0.80–1.30</span>
        </p>

        {/* Colored zone bar. Segment bounds are also printed as scale labels
            below, so the color is reinforcement — never the only signal. */}
        <div className="relative">
          <div className="flex h-3 overflow-hidden rounded-md">
            {ZONES.map((z) => (
              <div
                key={z.label}
                style={{
                  width: `${((z.to - z.from) / (GAUGE_MAX - GAUGE_MIN)) * 100}%`,
                  background: brand[z.hue][500],
                }}
              />
            ))}
          </div>
          {/* Marker triangle pointing down at current ratio */}
          {hasRatio && (
            <div
              className="absolute -top-2 -translate-x-1/2"
              style={{ left: `${markerPct}%` }}
            >
              <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden>
                <polygon points="7,10 0,0 14,0" fill="var(--color-ink-900)" />
              </svg>
            </div>
          )}
        </div>

        {/* Scale labels */}
        <div className="relative h-5 text-caption tabular-nums text-ink-500">
          {[0, 0.8, 1.3, 1.5, 2].map((ratio) => (
            <span
              key={ratio}
              className="absolute"
              style={{
                left: `${ratioToPercent(ratio)}%`,
                transform: ratio === 0 ? undefined : ratio === 2 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {ratio.toFixed(1)}{ratio === 2 ? '+' : ''}
            </span>
          ))}
        </div>

        {/* Acute / chronic breakdown */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-ink-50 px-3 py-2">
            <MetadataList columns="single" label={{ position: 'top' }}>
              <MetadataListItem label="Acute (7d)">
                <span className="font-mono text-sm tabular-nums">
                  {formatNumber(data.acuteKm, 1)} {unit}
                </span>
              </MetadataListItem>
            </MetadataList>
          </div>
          <div className="rounded-lg bg-ink-50 px-3 py-2">
            <MetadataList columns="single" label={{ position: 'top' }}>
              <MetadataListItem label="Chronic (28d avg)">
                <span className="font-mono text-sm tabular-nums">
                  {formatNumber(data.chronicKm, 1)} {unit}
                </span>
              </MetadataListItem>
            </MetadataList>
          </div>
        </div>

        {/* Whoop-strain ACWR — supplemental, captures cross-training too */}
        {hasStrain && (
          <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-dashed border-ink-900/10 px-3 py-2 text-xs">
            <div>
              <span className="text-ink-500">Strain ACWR (Whoop)</span>
              <span className="ml-2 font-mono text-ink-900">
                {formatNumber(strain.ratio, 2)}
              </span>
              <span className={`ml-2 ${zoneTextClass(strain.zone)}`}>
                {zoneLabel(strain.zone)}
              </span>
            </div>
            <div className="text-ink-500">
              {formatNumber(strain.acuteKm)} / {formatNumber(strain.chronicKm)} {acwrUnitLabel(strain.unit ?? 'strain')}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
