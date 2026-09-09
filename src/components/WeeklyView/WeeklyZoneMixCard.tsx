import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import type { WeeklyZoneMix } from '../../lib/types';
import { Card } from '../shared/Card';
import { useBrandPalette } from '../../lib/palette';

interface Props {
  data: WeeklyZoneMix;
}

const ZONE_LABELS = {
  z1: 'Z1 · recovery',
  z2: 'Z2 · aerobic',
  z3: 'Z3 · tempo',
  z4: 'Z4 · threshold',
  z5: 'Z5 · VO₂max',
} as const;

function fmtMinutes(seconds: number): string {
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total - h * 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Weekly HR-zone roll-up from Whoop. The target is polarized 80/10/10
 * (easy / moderate / hard). The header shows the polarization score —
 * how close the actual mix is to that target.
 */
export function WeeklyZoneMixCard({ data }: Props) {
  // Z0–Z5 share one ramp app-wide (lib/palette.ts) so this card and the
  // per-activity ZoneBar can't drift apart again. Index into it by zone number.
  const { zoneScale } = useBrandPalette();
  const zones = [
    { key: 'z1' as const, index: 1, sec: data.z1Seconds },
    { key: 'z2' as const, index: 2, sec: data.z2Seconds },
    { key: 'z3' as const, index: 3, sec: data.z3Seconds },
    { key: 'z4' as const, index: 4, sec: data.z4Seconds },
    { key: 'z5' as const, index: 5, sec: data.z5Seconds },
  ];

  const trainingSec =
    data.z1Seconds +
    data.z2Seconds +
    data.z3Seconds +
    data.z4Seconds +
    data.z5Seconds;

  // Polarization grade — visual cue only. 0.85+ = polarized; 0.65–0.85 ok;
  // < 0.65 = pyramidal/threshold-heavy (the "black hole" of endurance).
  const score = data.polarizationScore;
  let grade: { label: string; tone: string };
  if (score >= 0.85) grade = { label: 'Polarized', tone: 'text-sage-ink' };
  else if (score >= 0.65) grade = { label: 'Mixed', tone: 'text-ink-700' };
  else grade = { label: 'Threshold-heavy', tone: 'text-terra-ink' };

  if (trainingSec === 0) {
    return (
      <Card title="Weekly zone mix" subtitle="All sports · Whoop HR zones · last 7 days" fitContent>
        <p className="text-sm text-ink-500">No recorded HR-zone time in this window.</p>
      </Card>
    );
  }

  return (
    <Card
      title="Weekly zone mix"
      subtitle="All sports · Whoop HR zones · last 7 days"
      info="weekly-zone-mix"
      fitContent
      right={
        <span className={grade.tone}>
          {grade.label} <span className="text-ink-500">· score {(score * 100).toFixed(0)}/100</span>
        </span>
      }
    >
      {/* Stacked horizontal bar. Decorative — every segment's label, duration
          and share are printed in the breakdown directly below, so nothing
          here lives only in a tooltip. */}
      <div aria-hidden className="flex h-5 overflow-hidden rounded-md bg-ink-900/5">
        {zones.map((z) => {
          const width = trainingSec > 0 ? (z.sec / trainingSec) * 100 : 0;
          if (width === 0) return null;
          return (
            <div
              key={z.key}
              style={{ width: `${width}%`, backgroundColor: zoneScale[z.index] }}
            />
          );
        })}
      </div>

      {/* Per-zone breakdown */}
      <div className="mt-3 text-xs">
        <MetadataList columns="single" label={{ position: 'start' }}>
          {zones.map((z) => {
            const pct = trainingSec > 0 ? (z.sec / trainingSec) * 100 : 0;
            return (
              <MetadataListItem
                key={z.key}
                label={ZONE_LABELS[z.key]}
                icon={
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: zoneScale[z.index] }}
                  />
                }
              >
                <span className="flex justify-end gap-2 tabular-nums">
                  <span className="text-ink-500">{fmtMinutes(z.sec)}</span>
                  <span className="w-10 text-right text-ink-500">{pct.toFixed(0)}%</span>
                </span>
              </MetadataListItem>
            );
          })}
        </MetadataList>
      </div>

      {/* Polarized target reference */}
      <div className="mt-3 border-t border-ink-200 pt-3 text-caption text-ink-700">
        <MetadataList columns="single" label={{ position: 'start' }}>
          <MetadataListItem label="Polarized target">
            <span className="tabular-nums">
              80% easy · 10% mod · 10% hard
            </span>
          </MetadataListItem>
          <MetadataListItem label="This week">
            <span className="tabular-nums text-ink-500">
              {(data.easyPct * 100).toFixed(0)}% ·{' '}
              {(data.moderatePct * 100).toFixed(0)}% ·{' '}
              {(data.hardPct * 100).toFixed(0)}%
            </span>
          </MetadataListItem>
        </MetadataList>
      </div>

      <p className="mt-2 text-caption text-ink-500">
        easy = Z1+Z2 · moderate = Z3 · hard = Z4+Z5 · total {fmtMinutes(trainingSec)}
      </p>
    </Card>
  );
}
