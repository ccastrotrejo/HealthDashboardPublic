import { lazy, Suspense } from 'react';
import type { ArtifactState } from '../../hooks/useAiArtifact';
import type { TabId } from '../../hooks/useTab';
import type {
  CalibrationBlock,
  CoachBlock,
  InsightsBlock,
  MonthlyPatternsBlock,
  PostRaceBlock,
  RaceWeekBlock,
  RacesData,
  Snapshot,
  TodayDebriefBlock,
  WeeklyReviewBlock,
} from '../../lib/types';
import { AppSkeleton } from '../shared/AppSkeleton';
import { Colophon } from '../shared/Colophon';
import { Hero } from '../shared/Hero';
import { TabNav, tabId, tabPanelId } from '../shared/TabNav';
import { TodayPage } from './TodayPage';

const RacesPage = lazy(() =>
  import('../Races/RacesPage').then((module) => ({ default: module.RacesPage })),
);
const ReviewPage = lazy(() =>
  import('./ReviewPage').then((module) => ({ default: module.ReviewPage })),
);
const TrainingPage = lazy(() =>
  import('../Training/TrainingPage').then((module) => ({ default: module.TrainingPage })),
);

interface DashboardArtifacts {
  insights: ArtifactState<InsightsBlock>;
  debrief: ArtifactState<TodayDebriefBlock>;
  monthly: ArtifactState<MonthlyPatternsBlock>;
  coach: ArtifactState<CoachBlock>;
  review: ArtifactState<WeeklyReviewBlock>;
  raceWeek: ArtifactState<RaceWeekBlock>;
  postRace: ArtifactState<PostRaceBlock>;
  calibration: ArtifactState<CalibrationBlock>;
}

interface DashboardShellProps {
  snapshot: Snapshot;
  races: RacesData | null;
  tab: TabId;
  onTabChange: (tab: TabId) => void;
  artifacts: DashboardArtifacts;
}

const HERO_COPY: Record<TabId, { title: string; description: string }> = {
  dashboard: {
    title: 'Today’s Briefing',
    description: 'One resolved prescription, the readiness signal behind it, and the metrics that matter now.',
  },
  review: {
    title: 'Performance Review',
    description: 'Step back from today to understand patterns, load, consistency, and long-term direction.',
  },
  training: {
    title: 'Training Plan',
    description: 'The current block, today’s programmed work, and the nutrition that supports it.',
  },
  races: {
    title: 'Race Calendar',
    description: 'Targets, periodization, projections, and what the current training block is building toward.',
  },
};

function PanelFallback() {
  return <AppSkeleton compact />;
}

/** Presentational app shell and route-level composition. */
export function DashboardShell({
  snapshot,
  races,
  tab,
  onTabChange,
  artifacts,
}: DashboardShellProps) {
  const upcomingRacesCount =
    races?.races.filter((race) => new Date(`${race.date}T23:59:59Z`) >= new Date()).length ?? 0;
  const hero = HERO_COPY[tab];

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl p-4 sm:p-6 md:p-8">
      <Hero
        syncedAt={snapshot.syncedAt}
        sources={snapshot.sources}
        title={hero.title}
        description={hero.description}
      />

      <div className="sticky top-0 z-30 mt-2">
        <TabNav
          tabs={[
            { id: 'dashboard', label: 'Today' },
            { id: 'review', label: 'Review' },
            { id: 'training', label: 'Training' },
            { id: 'races', label: 'Races', count: upcomingRacesCount },
          ]}
          active={tab}
          onChange={onTabChange}
        />
      </div>

      {tab === 'dashboard' && (
        <div
          id={tabPanelId('dashboard')}
          role="tabpanel"
          aria-labelledby={tabId('dashboard')}
          tabIndex={0}
        >
          <TodayPage snapshot={snapshot} />
        </div>
      )}

      {tab === 'review' && (
        <div
          id={tabPanelId('review')}
          role="tabpanel"
          aria-labelledby={tabId('review')}
          tabIndex={0}
          className="mt-8"
        >
          <Suspense fallback={<PanelFallback />}>
            <ReviewPage
              snapshot={snapshot}
              insightsState={artifacts.insights}
              debriefState={artifacts.debrief}
              monthlyState={artifacts.monthly}
              weeklyReviewState={artifacts.review}
            />
          </Suspense>
        </div>
      )}

      {tab === 'training' && (
        <div
          id={tabPanelId('training')}
          role="tabpanel"
          aria-labelledby={tabId('training')}
          tabIndex={0}
          className="mt-8"
        >
          <Suspense fallback={<PanelFallback />}>
            <TrainingPage
              coach={artifacts.coach.data}
              cycling={snapshot.cycling ?? null}
              readinessCall={snapshot.daily?.todaysCall ?? null}
            />
          </Suspense>
        </div>
      )}

      {tab === 'races' && (
        <div
          id={tabPanelId('races')}
          role="tabpanel"
          aria-labelledby={tabId('races')}
          tabIndex={0}
          className="mt-8"
        >
          <Suspense fallback={<PanelFallback />}>
            <RacesPage
              racesData={races}
              snapshot={snapshot}
              raceWeek={artifacts.raceWeek.data}
              postRace={artifacts.postRace.data}
              calibration={artifacts.calibration.data}
            />
          </Suspense>
        </div>
      )}

      <Colophon snapshot={snapshot} />
    </main>
  );
}
