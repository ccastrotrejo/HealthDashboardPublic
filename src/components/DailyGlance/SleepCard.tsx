import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import type { SleepBlock } from '../../lib/types';
import { Card } from '../shared/Card';
import { brand } from '../../lib/palette';

interface Props {
  data: SleepBlock;
}

const STAGE_COLOR = {
  awake: brand.terra[500], // terra-500
  light: brand.dusty[500], // dusty-500
  rem: brand.cool[500], // cool-500
  deep: brand.cool[700], // cool-700
};

function fmtHM(hours: number): string {
  const minutes = Math.round(hours * 60);
  const hoursPart = Math.floor(minutes / 60);
  return hoursPart > 0 ? `${hoursPart}h ${minutes % 60}m` : `${minutes}m`;
}

export function SleepCard({ data }: Props) {
  const total =
    data.stages.awake + data.stages.light + data.stages.rem + data.stages.deep;
  const pct = (h: number) => (total > 0 ? (h / total) * 100 : 0);

  return (
    <Card title="Sleep" subtitle="Last night" info="sleep">
      <p className="text-3xl font-medium tabular-nums leading-none tracking-tight text-ink-900">
        {fmtHM(data.asleepHours)}
      </p>
      <p className="mt-0.5 text-xs text-ink-500">
        {data.performancePct.toFixed(0)}% of {fmtHM(data.neededHours)} needed
      </p>

      {/* Stacked stages bar */}
      <div className="mt-3 flex h-2 overflow-hidden rounded-full">
        <div style={{ width: `${pct(data.stages.awake)}%`, background: STAGE_COLOR.awake }} />
        <div style={{ width: `${pct(data.stages.light)}%`, background: STAGE_COLOR.light }} />
        <div style={{ width: `${pct(data.stages.rem)}%`, background: STAGE_COLOR.rem }} />
        <div style={{ width: `${pct(data.stages.deep)}%`, background: STAGE_COLOR.deep }} />
      </div>

      <div className="mt-2 text-caption [&_dt]:whitespace-nowrap">
        <MetadataList columns={2} label={{ position: 'start' }}>
          <MetadataListItem label="Deep">
            <span className="whitespace-nowrap font-mono text-ink-700">
              {fmtHM(data.stages.deep)}
            </span>
          </MetadataListItem>
          <MetadataListItem label="REM">
            <span className="whitespace-nowrap font-mono text-ink-700">
              {fmtHM(data.stages.rem)}
            </span>
          </MetadataListItem>
          <MetadataListItem label="Light">
            <span className="whitespace-nowrap font-mono text-ink-700">
              {fmtHM(data.stages.light)}
            </span>
          </MetadataListItem>
          <MetadataListItem label="Awake">
            <span className="whitespace-nowrap font-mono text-ink-700">
              {fmtHM(data.stages.awake)}
            </span>
          </MetadataListItem>
        </MetadataList>
      </div>

      {/* Sleep-need breakdown */}
      {data.neededBreakdown && (
        <details className="mt-4 border-t border-ink-200 text-caption">
          <summary className="min-h-11 cursor-pointer py-3 font-medium text-ink-700">
            Why you needed {fmtHM(data.neededHours)}
          </summary>
          <div className="space-y-2 pb-1">
            <div className="flex justify-between">
              <span className="text-ink-500">Baseline</span>
              <span className="whitespace-nowrap font-mono text-ink-700">
                {fmtHM(data.neededBreakdown.baselineHours)}
              </span>
            </div>
            {data.neededBreakdown.fromSleepDebtHours > 0.01 && (
              <div className="flex justify-between">
                <span className="text-terra-ink">+ sleep debt</span>
                <span className="font-mono text-terra-ink">
                  +{fmtHM(data.neededBreakdown.fromSleepDebtHours)}
                </span>
              </div>
            )}
            {data.neededBreakdown.fromRecentStrainHours > 0.01 && (
              <div className="flex justify-between">
                <span className="text-amber-ink">+ recent strain</span>
                <span className="font-mono text-amber-ink">
                  +{fmtHM(data.neededBreakdown.fromRecentStrainHours)}
                </span>
              </div>
            )}
            {Math.abs(data.neededBreakdown.fromRecentNapHours) > 0.01 && (
              <div className="flex justify-between">
                <span className="text-sage-ink">
                  {data.neededBreakdown.fromRecentNapHours >= 0 ? '+' : ''} nap credit
                </span>
                <span className="font-mono text-sage-ink">
                  {data.neededBreakdown.fromRecentNapHours >= 0 ? '+' : ''}
                  {fmtHM(Math.abs(data.neededBreakdown.fromRecentNapHours))}
                </span>
              </div>
            )}
          </div>
        </details>
      )}
    </Card>
  );
}
