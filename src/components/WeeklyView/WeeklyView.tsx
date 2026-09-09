import { useCallback, useEffect, useMemo, useState } from 'react';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import type { WeeklyAnalytics } from '../../lib/types';
import { sportLabel } from '../../lib/format';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { VolumeChart } from './VolumeChart';
import { ActivitiesList } from './ActivitiesList';
import { IntensityDonut } from './IntensityDonut';
import { AcwrGauge } from './AcwrGauge';
import { WeeklyZoneMixCard } from './WeeklyZoneMixCard';
import { SportGlyph } from '../shared/icons';
import { ScrollRow } from '../shared/ScrollRow';

interface Props {
  data: WeeklyAnalytics;
}

const SPORT_THRESHOLD_KM = 1; // ignore sports with <1km total in last 8 weeks
const ALL_SPORTS_FILTER = '__all_sports__';

/**
 * Weekly view wrapper. Manages a sport-filter chip strip and applies it to
 * the cards that benefit (VolumeChart, ActivitiesList). ACWR + intensity
 * stay all-sport — they're load-not-distance metrics where filtering would
 * be misleading.
 */
export function WeeklyView({ data }: Props) {
  // `recentActivities` carries 14 days so the AI layer can audit a full Mon→Sun
  // week whenever it runs. This view is "this week", so trim to 7 for display.
  const weekActivities = useMemo(() => {
    const cutoff = Date.now() - 7 * 86_400_000;
    return data.recentActivities.filter(
      (a) => new Date(a.startDateUtc ?? a.startDateLocal).getTime() >= cutoff,
    );
  }, [data.recentActivities]);

  // Build the set of sports the user actually does (from last 8 weeks of volume)
  const availableSports = useMemo(() => {
    const totals = new Map<string, number>();
    for (const week of data.weeklyVolume) {
      for (const [sport, km] of Object.entries(week.bySport)) {
        totals.set(sport, (totals.get(sport) ?? 0) + km);
      }
    }
    // Also include sports from recent activities that may not have distance
    for (const a of weekActivities) {
      if (!totals.has(a.sportType)) totals.set(a.sportType, 0);
    }
    return Array.from(totals.entries())
      .filter(([, km]) => km >= SPORT_THRESHOLD_KM || km === 0)
      .sort((a, b) => b[1] - a[1])
      .map(([sport]) => sport);
  }, [data.weeklyVolume, weekActivities]);

  const [filter, setFilterState] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('sport'),
  );
  const effectiveFilter = filter && availableSports.includes(filter) ? filter : null;
  const setFilter = useCallback((next: string | null) => {
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('sport', next);
    else url.searchParams.delete('sport');
    history.replaceState(null, '', url);
    setFilterState(next);
  }, []);

  useEffect(() => {
    const syncFromUrl = () => {
      setFilterState(new URLSearchParams(window.location.search).get('sport'));
    };
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  // Filtered slice of recent activities
  const filteredActivities = useMemo(
    () =>
      effectiveFilter
        ? weekActivities.filter((a) => a.sportType === effectiveFilter)
        : weekActivities,
    [effectiveFilter, weekActivities],
  );

  return (
    <>
      {/* Filter chip strip. The control doesn't wrap and there can be a dozen
          sports, so it gets its own scroll container — with the root
          `overflow-x: clip` guard in place, anything wider than the viewport
          would otherwise be clipped and unreachable on a phone. */}
      {availableSports.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs text-ink-500">Volume + activities</span>
          <ScrollRow>
            <SegmentedControl
              value={effectiveFilter ?? ALL_SPORTS_FILTER}
              onChange={(value) => setFilter(value === ALL_SPORTS_FILTER ? null : value)}
              label="Filter volume and activities by sport"
              size="sm"
            >
              <SegmentedControlItem value={ALL_SPORTS_FILTER} label="All Sports" />
              {availableSports.map((sport) => (
                <SegmentedControlItem
                  key={sport}
                  value={sport}
                  icon={<SportGlyph sportType={sport} size="sm" />}
                  label={sportLabel(sport)}
                />
              ))}
            </SegmentedControl>
          </ScrollRow>
          <span className="text-caption text-ink-500">
            Load balance and intensity remain all-sport.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <ErrorBoundary section="Volume chart">
            <VolumeChart data={data.weeklyVolume} sportFilter={effectiveFilter} />
          </ErrorBoundary>
        </div>
        <div className="min-w-0">
          <ErrorBoundary section="ACWR gauge">
            <AcwrGauge data={data.acwr} strain={data.strainAcwr} />
          </ErrorBoundary>
        </div>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <ErrorBoundary section="Intensity donut">
          <IntensityDonut data={data.intensity} />
        </ErrorBoundary>
        {data.zoneMix && (
          <ErrorBoundary section="Weekly zone mix">
            <WeeklyZoneMixCard data={data.zoneMix} />
          </ErrorBoundary>
        )}
      </div>
      <ErrorBoundary section="Activities list">
        <ActivitiesList activities={filteredActivities} />
      </ErrorBoundary>
    </>
  );
}
