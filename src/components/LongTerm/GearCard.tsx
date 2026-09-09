import { Badge } from '@astryxdesign/core/Badge';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import type { GearInfo } from '../../lib/types';
import { Card } from '../shared/Card';
import { Glyph, gearIcon } from '../shared/icons';

interface Props {
  gear: GearInfo[];
}

const STATUS_BADGE_VARIANT = {
  ok: 'green',
  caution: 'yellow',
  replace: 'red',
} as const;

const STATUS_PROGRESS_VARIANT = {
  ok: 'success',
  caution: 'warning',
  replace: 'error',
} as const;

const STATUS_LABEL = {
  ok: 'OK',
  caution: 'Caution',
  replace: 'Retire',
};

function fmtKm(km: number): string {
  if (km >= 1000) return `${(km / 1000).toFixed(1)}k km`;
  return `${km.toFixed(0)} km`;
}

export function GearCard({ gear }: Props) {
  if (!gear || gear.length === 0) {
    return (
      <Card title="Gear mileage" subtitle="Shoes & bikes" info="gear">
        <p className="text-sm text-ink-500">
          No gear logged in Strava. Tag activities with gear and you'll see mileage here.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Gear mileage" subtitle="Shoes warn at 600 km, replace at 800 km" info="gear">
      <ul className="divide-y divide-ink-900/5">
        {gear.map((g) => {
          const km = Math.max(g.km, g.lifetimeKm);
          const warnKm = g.warnKm;
          return (
            <li key={g.id} className="grid grid-cols-12 items-center gap-2 py-2.5 text-sm">
              <span className="col-span-1 text-ink-500">
                <Glyph icon={gearIcon[g.kind] ?? gearIcon.other} size="lg" />
              </span>
              <div className="col-span-6 min-w-0">
                <p className="truncate text-ink-900">{g.name}</p>
                {warnKm != null && warnKm > 0 && (
                  <div className="mt-1">
                    <ProgressBar
                      label={`${g.name} mileage`}
                      value={Math.min(km, warnKm)}
                      max={warnKm}
                      variant={STATUS_PROGRESS_VARIANT[g.status]}
                      isLabelHidden
                    />
                  </div>
                )}
              </div>
              <div className="col-span-3 text-right">
                <p className="font-mono text-sm text-ink-900">{fmtKm(km)}</p>
                {g.warnKm && (
                  <p className="text-[10px] text-ink-500">/ {fmtKm(g.warnKm)}</p>
                )}
              </div>
              <div className="col-span-2 text-right">
                {g.kind === 'shoe' && (
                  <Badge
                    variant={STATUS_BADGE_VARIANT[g.status]}
                    label={STATUS_LABEL[g.status]}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
