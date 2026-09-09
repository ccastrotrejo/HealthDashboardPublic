import { useMemo } from 'react';
import type { Snapshot } from '../../lib/types';
import {
  explorerDays, formatExplorationDate, inDateRange, trendRange, type DateRange,
} from '../../lib/exploration';
import { Card } from '../shared/Card';
import { DateRangeControls } from './DateRangeControls';
import { DateBrush } from './DateBrush';
import { RecoveryTracks } from './RecoveryTracks';

interface RecoveryExplorerProps {
  snapshot: Snapshot;
  range: DateRange | null;
  selectedDate: string | null;
  highlightedDates: readonly string[];
  onRangeChange: (range: DateRange | null) => void;
  onSelectDate: (date: string) => void;
}

export function RecoveryExplorer({ snapshot, range, selectedDate, highlightedDates, onRangeChange, onSelectDate }: RecoveryExplorerProps) {
  const available = snapshot.daily ? trendRange(snapshot.daily.trends) : null;
  const window = range ?? available;
  const days = useMemo(() => snapshot.daily && window
    ? explorerDays(snapshot.daily.trends, snapshot.longTerm?.fitnessCurve ?? [], window) : [],
  [snapshot.daily, snapshot.longTerm?.fitnessCurve, window?.start, window?.end]);
  if (!snapshot.daily || !available || !window) return (
    <Card title="Recovery & training explorer"><p className="text-sm text-ink-500">Daily signal history will appear after a successful sync.</p></Card>
  );
  const history = [
    available.start, available.end,
    ...(snapshot.longTerm?.trainingMap.map((day) => day.date) ?? []),
    ...(snapshot.longTerm?.fitnessCurve.map((day) => day.date) ?? []),
  ].sort();
  const bounds = { start: history[0]!, end: history.at(-1)! };
  const activities = (snapshot.weekly?.recentActivities ?? []).filter((activity) =>
    inDateRange(activity.startDateLocal.slice(0, 10), window));

  return (
    <Card title="Recovery & training explorer"
      subtitle={`${formatExplorationDate(window.start)} to ${formatExplorationDate(window.end)} · one selection across review views`}>
      <div className="space-y-5">
        <DateRangeControls key={`${range?.start}:${range?.end}`} bounds={bounds} range={range ?? available} onChange={onRangeChange} />
        <DateBrush bounds={available} range={range} onChange={onRangeChange} />
        <p className="text-caption text-ink-500">
          Physiological history: {formatExplorationDate(available.start)} to {formatExplorationDate(available.end)}.
          {' '}Load is modeled from recorded activity, not a direct measure of readiness. Gaps are missing data, not zero.
        </p>
        {highlightedDates.length > 0 && <p role="status" className="text-sm text-cool-ink">
          {highlightedDates.length} source dates highlighted from the patterns plot.
        </p>}
        <RecoveryTracks days={days} selectedDate={selectedDate} highlightedDates={highlightedDates} onSelectDate={onSelectDate} />
        <section className="border-t border-ink-200 pt-4" aria-label="Activities in selected dates">
          <h4 className="text-sm font-medium text-ink-900">Available activity detail</h4>
          <p className="mt-1 text-caption text-ink-500">
            Latest 7-day feed, grouped by recorded local start date. Older activity detail is not included in this snapshot;
            an empty list does not establish a rest day. Daily signals retain their source date keys.
          </p>
          {activities.length ? <ul className="mt-3 divide-y divide-ink-200">
            {activities.map((activity) => {
              const date = activity.startDateLocal.slice(0, 10);
              return <li key={`${activity.source}-${activity.id}`} className="py-2">
                <button type="button" onClick={() => onSelectDate(date)} aria-pressed={selectedDate === date}
                  className={`flex min-h-11 w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded px-2 text-left text-sm ${selectedDate === date ? 'bg-cool-surface' : 'hover:bg-ink-100'}`}>
                  <span className="min-w-0 break-words text-ink-900">{activity.name}</span>
                  <span className="text-caption tabular-nums text-ink-500">{date} / {Math.round(activity.movingTimeSeconds / 60)} min / {activity.intensity}</span>
                </button>
              </li>;
            })}
          </ul> : <p className="mt-3 text-sm text-ink-500">No activity details available for these dates.</p>}
        </section>
      </div>
    </Card>
  );
}
