import { useCallback, useState } from 'react';
import type { ArtifactState } from '../../hooks/useAiArtifact';
import { includeExplorationDate, inDateRange, trendRange, type DateRange } from '../../lib/exploration';
import { RecoveryExplorer } from '../Review/RecoveryExplorer';
import { RouteExplorer } from '../Review/RouteExplorer';
import type {
  InsightsBlock,
  MonthlyPatternsBlock,
  Snapshot,
  TodayDebriefBlock,
  WeeklyReviewBlock,
} from '../../lib/types';
import { aiStatus } from '../../lib/aiMeta';
import { AiSectionStatus } from '../Coach/AiSectionStatus';
import { FeedbackExport } from '../Coach/FeedbackExport';
import { InsightsCard } from '../Coach/InsightsCard';
import { MonthlyPatternsCard } from '../Coach/MonthlyPatternsCard';
import { TodayDebriefCard } from '../Coach/TodayDebriefCard';
import { WeeklyReviewCard } from '../Coach/WeeklyReviewCard';
import { CorrelationPanel } from '../DailyGlance/CorrelationPanel';
import { CalendarHeatmap } from '../LongTerm/CalendarHeatmap';
import { FitnessCurve } from '../LongTerm/FitnessCurve';
import { GearCard } from '../LongTerm/GearCard';
import { PrTracker } from '../LongTerm/PrTracker';
import { RacePredictionComparison } from '../LongTerm/RacePredictionComparison';
import { StatGrid } from '../LongTerm/StatGrid';
import { TrainingLoadCard } from '../LongTerm/TrainingLoadCard';
import { TrainingStatusCard } from '../LongTerm/TrainingStatusCard';
import { Vo2MaxCard } from '../LongTerm/Vo2MaxCard';
import { YearOverYearCard } from '../LongTerm/YearOverYearCard';
import { WeeklyView } from '../WeeklyView/WeeklyView';
import { DisclosureSection } from '../shared/DisclosureSection';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { SectionLabel } from '../shared/SectionLabel';

interface ReviewPageProps {
  snapshot: Snapshot;
  insightsState: ArtifactState<InsightsBlock>;
  debriefState: ArtifactState<TodayDebriefBlock>;
  monthlyState: ArtifactState<MonthlyPatternsBlock>;
  weeklyReviewState: ArtifactState<WeeklyReviewBlock>;
}

/** The deliberate review workflow: recent load first, deeper analysis on demand. */
export function ReviewPage({
  snapshot,
  insightsState,
  debriefState,
  monthlyState,
  weeklyReviewState,
}: ReviewPageProps) {
  const review = weeklyReviewState.data;
  const reviewStatus = review ? aiStatus(review, 'weekly-review') : null;
  const [range, setRange] = useState<DateRange | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [highlightedDates, setHighlightedDates] = useState<string[]>([]);
  const available = snapshot.daily ? trendRange(snapshot.daily.trends) : null;
  const onRangeChange = useCallback((next: DateRange | null) => {
    setRange(next);
    setSelectedDate((current) => current && inDateRange(current, next ?? available) ? current : null);
    setHighlightedDates([]);
  }, [available?.start, available?.end]);
  const onSelectDate = useCallback((date: string) => {
    setSelectedDate(date);
    if (!inDateRange(date, range ?? available)) {
      setRange(includeExplorationDate(date, range ?? available));
      setHighlightedDates([]);
    }
  }, [range, available?.start, available?.end]);

  return (
    <div>
      <AiSectionStatus
        states={[{ label: 'Weekly assessment', state: weeklyReviewState }]}
        emptyHint="Your weekly assessment will appear after the next scheduled review."
      />
      {review && reviewStatus && (
        <ErrorBoundary section="Weekly assessment">
          <details className="mb-10 border-b border-ink-200 pb-6">
            <summary className="cursor-pointer rounded-md">
              <span className="text-sm font-semibold text-ink-700">
                Weekly assessment · week of {review.forWeek}
              </span>
              <span className="mt-3 block max-w-[65ch] text-lg leading-relaxed text-ink-900 sm:text-xl">
                {review.headline}
              </span>
              <span className="mt-3 block text-caption text-ink-500">
                {reviewStatus.isTemplate ? 'Fallback assessment' : 'AI assessment'} · {reviewStatus.relative}
                {reviewStatus.isStale && ' · Out of date'}
                {reviewStatus.fromStaleData && ' · Based on stale source data'}
                {' · Expand for adherence, evidence, and next week’s focus'}
              </span>
            </summary>
            <div className="mt-5">
              <WeeklyReviewCard data={review} />
            </div>
          </details>
        </ErrorBoundary>
      )}

      <section className="space-y-4">
        <SectionLabel>Recent training</SectionLabel>
        {snapshot.weekly ? (
          <ErrorBoundary section="Weekly view">
            <WeeklyView data={snapshot.weekly} />
          </ErrorBoundary>
        ) : (
          <p className="text-sm text-ink-500">
            No analytics yet. Wait for the next daily sync, or trigger the workflow manually.
          </p>
        )}
      </section>

      <DisclosureSection
        id="route-elevation"
        title="Route & elevation"
        description="Explore a local GPX in 2D or 3D. Location data stays in memory and is never uploaded."
        className="mt-10"
      >
        <ErrorBoundary section="Local route explorer">
          <RouteExplorer />
        </ErrorBoundary>
      </DisclosureSection>

      <DisclosureSection
        id="coach-review"
        title="Coaching notes"
        description="Daily debrief, recurring patterns, and generated coaching notes."
        className="mt-16"
      >
        <div className="space-y-4">
          <AiSectionStatus
            states={[
              { label: 'Today debrief', state: debriefState },
              { label: 'Insights', state: insightsState },
              { label: 'Monthly patterns', state: monthlyState },
            ]}
            emptyHint="The scheduled AI workflows haven’t produced anything yet. They run daily in the morning and evening — check the Actions tab if this persists."
          />
          {debriefState.data && (
            <ErrorBoundary section="Today debrief">
              <TodayDebriefCard data={debriefState.data} />
            </ErrorBoundary>
          )}
          {insightsState.data && (
            <ErrorBoundary section="Insights">
              <InsightsCard data={insightsState.data} />
            </ErrorBoundary>
          )}
          {monthlyState.data && (
            <ErrorBoundary section="Monthly patterns">
              <MonthlyPatternsCard data={monthlyState.data} />
            </ErrorBoundary>
          )}
          <ErrorBoundary section="Feedback export">
            <FeedbackExport />
          </ErrorBoundary>
        </div>
      </DisclosureSection>

      {snapshot.daily && (
        <DisclosureSection
          id="relationships"
          title="Recovery & relationships"
          description="Select dates, compare recovery with training, and inspect personal patterns. Selection also follows you into the training calendar."
          className="mt-4"
        >
          <div className="space-y-6">
            <ErrorBoundary section="Recovery explorer">
              <RecoveryExplorer snapshot={snapshot} range={range} selectedDate={selectedDate}
                highlightedDates={highlightedDates} onRangeChange={onRangeChange} onSelectDate={onSelectDate} />
            </ErrorBoundary>
            <ErrorBoundary section="Correlations">
              <CorrelationPanel trends={snapshot.daily.trends} range={range} selectedDate={selectedDate}
                highlightedDates={highlightedDates} onSelectDate={onSelectDate} onHighlightDates={setHighlightedDates} />
            </ErrorBoundary>
          </div>
        </DisclosureSection>
      )}

      <DisclosureSection
        id="season-trajectory"
        title="Season trajectory"
        description="Fitness over 90 days, consistency, and performance. Equipment stays in its own reference section."
        className="mt-4"
      >
        {snapshot.longTerm ? (
          <div className="space-y-6">
            <ErrorBoundary section="Fitness curve">
              <FitnessCurve data={snapshot.longTerm.fitnessCurve} />
            </ErrorBoundary>
            <h3 className="pt-4 text-lg font-semibold text-ink-900">Consistency</h3>
            {snapshot.longTerm.allTime && (
              <ErrorBoundary section="All-time stats">
                <StatGrid
                  data={snapshot.longTerm.allTime}
                  thisYear={new Date(snapshot.syncedAt).getUTCFullYear()}
                />
              </ErrorBoundary>
            )}
            {snapshot.longTerm.trainingMap && (
              <ErrorBoundary section="Training calendar">
                <CalendarHeatmap data={snapshot.longTerm.trainingMap} trends={snapshot.daily?.trends}
                  range={range} selectedDate={selectedDate} onRangeChange={onRangeChange}
                  onSelectDate={onSelectDate} highlightedDates={highlightedDates} />
              </ErrorBoundary>
            )}
            <h3 className="pt-4 text-lg font-semibold text-ink-900">Performance</h3>
            {snapshot.garmin?.vo2Max != null && (
              <ErrorBoundary section="VO₂ max">
                <Vo2MaxCard
                  latest={snapshot.garmin.vo2Max}
                  trend={snapshot.garmin.vo2MaxTrend}
                />
              </ErrorBoundary>
            )}
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <ErrorBoundary section="PR tracker">
                <PrTracker series={snapshot.longTerm.prSeries} />
              </ErrorBoundary>
              <ErrorBoundary section="Year over year">
                <YearOverYearCard
                  data={snapshot.longTerm.yearProgress}
                  thisYearNum={new Date(snapshot.syncedAt).getUTCFullYear()}
                />
              </ErrorBoundary>
            </div>
            <ErrorBoundary section="Race estimates">
              <RacePredictionComparison
                riegel={snapshot.longTerm.racePredictions}
                garmin={snapshot.garmin?.racePredictions ?? null}
              />
            </ErrorBoundary>
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              {snapshot.garmin?.trainingStatus && (
                <ErrorBoundary section="Training status">
                  <TrainingStatusCard data={snapshot.garmin.trainingStatus} />
                </ErrorBoundary>
              )}
              {snapshot.garmin?.trainingStatus &&
                (snapshot.garmin.trainingStatus.acuteLoad != null ||
                  snapshot.garmin.trainingStatus.chronicLoad != null) && (
                  <ErrorBoundary section="Training load (Garmin)">
                    <TrainingLoadCard
                      acuteLoad={snapshot.garmin.trainingStatus.acuteLoad}
                      chronicLoad={snapshot.garmin.trainingStatus.chronicLoad}
                    />
                  </ErrorBoundary>
                )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-500">
            Long-term analytics need at least one Strava activity to start.
          </p>
        )}
      </DisclosureSection>

      {snapshot.longTerm && (
        <DisclosureSection
          id="equipment"
          title="Equipment"
          description={snapshot.longTerm.gear.length > 0
            ? `${snapshot.longTerm.gear.length} tracked items · mileage and replacement guidance.`
            : 'No gear linked yet. Tag activities with shoes or a bike in Strava to track mileage.'}
          className="mt-4"
        >
          <ErrorBoundary section="Gear mileage">
            <GearCard gear={snapshot.longTerm.gear} />
          </ErrorBoundary>
        </DisclosureSection>
      )}
    </div>
  );
}
