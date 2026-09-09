import { useState } from 'react';
import type { DailyTrendPoint } from '../../lib/types';
import { Sparkline } from '../shared/Sparkline';
import { MetricDetailModal } from '../shared/MetricDetailModal';
import { brand } from '../../lib/palette';
import { latestNonNull } from '../../lib/trendFallback';
import { trendConfidence } from '../../lib/trendConfidence';

interface Row {
  key: string;
  label: string;
  /** Period the headline value covers, e.g. "Today", "This week". */
  period: string;
  value: number | null;
  format: (n: number) => string;
  unit?: string;
  goal?: number | null;
  trend?: DailyTrendPoint[];
  color: string;
  /** Range wording for the drill-down dialog. */
  rangeLabel?: string;
  /** Extra note shown under the label when the value is a fallback. */
  note?: string;
}

interface Props {
  steps: number | null;
  stepGoal: number | null;
  stepsTrend: DailyTrendPoint[];
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  bodyBatteryTrend: DailyTrendPoint[];
  stressAvg: number | null;
  intensityMinutesWeek: number | null;
  intensityMinutesGoal: number;
  intensityMinutesTrend: DailyTrendPoint[];
  floorsToday: number | null;
  floorsGoal: number | null;
  avgSpo2: number | null;
  minSpo2: number | null;
  spo2Trend: DailyTrendPoint[];
}

const int = (n: number) => n.toLocaleString('en-US');
const one = (n: number) => n.toFixed(1);

/** A single passive row. Clickable only when there's history to drill into. */
function MetricRow({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  const series = row.trend ?? [];
  const hasHistory = series.filter((p) => p.value != null).length >= 2;
  const pct =
    row.value != null && row.goal != null && row.goal > 0
      ? (row.value / row.goal) * 100
      : null;

  const body = (
    <>
      <div className="min-w-0 sm:w-44">
        <p className="truncate text-sm font-medium text-ink-900">{row.label}</p>
        <p className="text-caption text-ink-500">{row.note ?? row.period}</p>
      </div>

      <div className="flex shrink-0 items-baseline gap-1.5">
        <span className="text-lg font-medium tabular-nums text-ink-900">
          {row.value != null ? row.format(row.value) : '—'}
        </span>
        {row.unit && <span className="text-caption text-ink-500">{row.unit}</span>}
        {row.goal != null && row.goal > 0 && (
          <span className="text-caption tabular-nums text-ink-500">
            / {row.format(row.goal)}
          </span>
        )}
      </div>

      {/* Percent-of-goal, right-aligned so the column reads as a column. */}
      <div className="ml-auto flex items-center gap-4">
        {hasHistory && (
          <div aria-hidden className="hidden w-24 sm:block">
            <Sparkline
              values={series.map((p) => p.value)}
              height={22}
              color={row.color}
            />
          </div>
        )}
        {pct != null && (
          <span className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-500">
            {pct.toFixed(0)}%
          </span>
        )}
      </div>
    </>
  );

  return (
    <li>
      {hasHistory ? (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="-mx-2 flex w-[calc(100%+1rem)] flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-2 py-3 text-left transition-[background-color,scale] duration-150 ease-out-strong hover:bg-ink-900/[0.03] active:scale-[0.96] md:-mx-4 md:w-[calc(100%+2rem)] md:px-4"
          >
            {body}
          </button>
          <MetricDetailModal
            isOpen={open}
            onClose={() => setOpen(false)}
            title={row.label}
            series={series}
            unit={row.unit}
            color={row.color}
            rangeLabel={row.rangeLabel ?? 'last 30 days'}
            confidence={trendConfidence(series)}
          />
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">{body}</div>
      )}
    </li>
  );
}

/**
 * Passive Garmin metrics — steps, body battery, intensity minutes, floors,
 * overnight SpO₂.
 *
 * These are ambient counters, not decisions: you glance at them, you don't act
 * on them. They used to occupy five full cards in the same four-column grid as
 * recovery and sleep, which gave "Floors climbed" the same visual weight as
 * the day's training verdict. Here they're a dense hairline-separated list —
 * one containment layer, one line each, with the sparkline and drill-down
 * still a click away for anything that has history.
 */
export function PassiveMetricsStrip({
  steps,
  stepGoal,
  stepsTrend,
  bodyBatteryHigh,
  bodyBatteryLow,
  bodyBatteryTrend,
  stressAvg,
  intensityMinutesWeek,
  intensityMinutesGoal,
  intensityMinutesTrend,
  floorsToday,
  floorsGoal,
  avgSpo2,
  minSpo2,
  spo2Trend,
}: Props) {
  // Garmin's totalSteps is often null early in the day — fall back to the most
  // recent non-null trend point so the row stops showing "—" all morning.
  const stepsFallback = steps == null ? latestNonNull(stepsTrend) : null;
  const stepsValue = steps ?? stepsFallback?.value ?? null;

  const rows: Row[] = [
    {
      key: 'steps',
      label: 'Steps',
      period: 'Today',
      note: stepsFallback ? `as of ${stepsFallback.date}` : undefined,
      value: stepsValue,
      format: int,
      goal: stepGoal,
      trend: stepsTrend,
      color: brand.cool[700],
    },
    {
      key: 'body-battery',
      label: 'Body Battery',
      period:
        bodyBatteryLow != null
          ? `Peak today · low ${bodyBatteryLow.toFixed(0)}`
          : 'Peak today',
      value: bodyBatteryHigh,
      format: (n) => n.toFixed(0),
      trend: bodyBatteryTrend,
      color: brand.sage[500],
    },
    {
      key: 'intensity',
      label: 'Intensity minutes',
      period: 'This week',
      value: intensityMinutesWeek,
      format: (n) => n.toFixed(0),
      unit: 'min',
      goal: intensityMinutesGoal,
      trend: intensityMinutesTrend,
      color: brand.sage[500],
      rangeLabel: 'last 8 weeks · moderate-equivalent',
    },
    {
      key: 'floors',
      label: 'Floors climbed',
      period: 'Today · 1 floor ≈ 3 m gain',
      value: floorsToday,
      format: (n) => n.toFixed(0),
      goal: floorsGoal,
      color: brand.cool[500],
    },
    {
      key: 'spo2',
      label: 'Pulse Ox',
      period: minSpo2 != null ? `Overnight avg · low ${minSpo2.toFixed(0)}%` : 'Overnight avg',
      value: avgSpo2,
      format: one,
      unit: '%',
      trend: spo2Trend,
      color: brand.cool[700],
    },
  ];

  // Skip rows Garmin never returned rather than printing a column of dashes.
  const present = rows.filter(
    (r) => r.value != null || (r.trend?.some((p) => p.value != null) ?? false),
  );
  if (present.length === 0) return null;

  return (
    /* Concentric: the 12px hover rows sit 8px inside this 20px panel. */
    <section
      aria-labelledby="passive-metrics-heading"
      className="glass-panel rounded-2xl bg-ink-100 px-4 py-1 shadow-border md:px-6"
    >
      <h3 id="passive-metrics-heading" className="sr-only">
        Passive metrics from Garmin
      </h3>
      <ul className="divide-y divide-border">
        {present.map((r) => (
          <MetricRow key={r.key} row={r} />
        ))}
      </ul>
      {stressAvg != null && (
        <p className="border-t border-border py-3 text-caption text-ink-500">
          Average all-day stress {stressAvg.toFixed(0)}
        </p>
      )}
    </section>
  );
}
