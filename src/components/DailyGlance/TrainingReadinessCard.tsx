import { useState } from 'react';
import type { DailyTrendPoint } from '../../lib/types';
import { Card } from '../shared/Card';
import { Sparkline } from '../shared/Sparkline';
import { MetricDetailModal } from '../shared/MetricDetailModal';
import { TrendConfidenceHint } from '../shared/TrendConfidenceHint';
import { trendConfidence } from '../../lib/trendConfidence';
import { brand, hueTextClass, type Hue } from '../../lib/palette';

interface Props {
  score: number | null;
  level: string | null;
  recoveryTimeHours: number | null;
  feedback: string | null;
  trend: DailyTrendPoint[];
}

/**
 * Readiness band → hue. `null` means "no score", which reads as neutral ink
 * rather than a brand hue.
 */
function scoreHue(score: number | null): Hue | null {
  if (score == null) return null;
  if (score >= 75) return 'sage';
  if (score >= 51) return 'cool';
  if (score >= 25) return 'amber';
  return 'terra';
}

/**
 * Garmin returns readiness feedback as a raw enum token
 * (`RECOVERED_AND_READY`, `LOW_HRV_AND_SLEEP`, …). Render it as prose rather
 * than shouting an API constant at the reader.
 */
function humanizeFeedback(raw: string): string {
  const words = raw.trim().replace(/[_-]+/g, ' ').toLowerCase();
  if (!words) return '';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function TrainingReadinessCard({
  score,
  level,
  recoveryTimeHours,
  feedback,
  trend = [],
}: Props) {
  const [open, setOpen] = useState(false);
  const hue = scoreHue(score);
  // Text takes the mode-aware `-ink` tone; the sparkline takes the `-500`
  // fill, which is a stroke and doesn't need to clear a text contrast bar.
  const scoreClass = hue ? hueTextClass[hue] : 'text-ink-500';
  const strokeColor = brand[hue ?? 'cool'][500];
  const confidence = trendConfidence(trend);
  return (
    <Card
      title="Training readiness"
      subtitle="Garmin"
      info="training-readiness"
      onExpand={() => setOpen(true)}
      expandLabel="Training readiness"
      fitContent
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`text-2xl font-semibold tabular-nums ${scoreClass}`}>
          {score != null ? score.toFixed(0) : '—'}
        </span>
        {level && (
          <span className="text-caption uppercase tracking-wider text-ink-500">
            {level.toLowerCase()}
          </span>
        )}
        {recoveryTimeHours != null && recoveryTimeHours > 0 && (
          <span className="ml-auto text-xs tabular-nums text-ink-500">
            recover {recoveryTimeHours}h
          </span>
        )}
      </div>
      <Sparkline
        className="mt-4"
        values={trend.map((t) => t.value)}
        height={64}
        color={strokeColor}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-caption">
        <p className="whitespace-nowrap text-ink-500">30d</p>
        <TrendConfidenceHint confidence={confidence} />
      </div>
      {feedback && (
        <p className="mt-2 text-pretty text-caption leading-snug text-ink-500">
          {humanizeFeedback(feedback)}
        </p>
      )}
      <MetricDetailModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Training readiness"
        series={trend}
        color={strokeColor}
        rangeLabel="last 30 days"
        confidence={confidence}
      />
    </Card>
  );
}
