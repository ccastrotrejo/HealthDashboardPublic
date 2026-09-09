import { useEffect, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Heading } from '@astryxdesign/core/Heading';
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
} from './lib/types';
import { useAiArtifact } from './hooks/useAiArtifact';
import { useTab } from './hooks/useTab';
import { AppSkeleton } from './components/shared/AppSkeleton';
import { SkipLink } from './components/shared/SkipLink';
import { ThemeToggle } from './components/shared/ThemeToggle';
import { DashboardShell } from './components/Dashboard/DashboardShell';

/**
 * Start the snapshot request while the bundle evaluates so data loads in
 * parallel with React mounting.
 */
const snapshotPromise: Promise<Snapshot> = fetch('/data/snapshot.json').then((response) => {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<Snapshot>;
});

/**
 * Data container for the static dashboard. Vendor credentials never reach the
 * browser; every request reads a generated JSON artifact from `/data/`.
 */
export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [races, setRaces] = useState<RacesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { tab, setTab } = useTab();

  const artifacts = {
    insights: useAiArtifact<InsightsBlock>('/data/insights.json'),
    debrief: useAiArtifact<TodayDebriefBlock>('/data/today-debrief.json'),
    monthly: useAiArtifact<MonthlyPatternsBlock>('/data/monthly-patterns.json'),
    coach: useAiArtifact<CoachBlock>('/data/coach.json'),
    review: useAiArtifact<WeeklyReviewBlock>('/data/weekly-review.json'),
    raceWeek: useAiArtifact<RaceWeekBlock>('/data/race-week.json'),
    postRace: useAiArtifact<PostRaceBlock>('/data/post-race.json'),
    calibration: useAiArtifact<CalibrationBlock>('/data/calibration.json'),
  };

  useEffect(() => {
    snapshotPromise
      .then(setSnapshot)
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : 'Unknown error';
        setError(`Could not load snapshot (${message}). Has the daily sync run yet?`);
      });

    fetch('/data/races.json')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: RacesData | null) => setRaces(data))
      .catch(() => setRaces(null));
  }, []);

  if (error) {
    return (
      <>
        <SkipLink />
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-2xl p-8">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <Heading level={1} className="text-2xl font-semibold">
              Health Dashboard
            </Heading>
            <ThemeToggle />
          </header>
          <div className="mt-4">
            <Banner status="error" title="Could Not Load Data" description={error} />
          </div>
        </main>
      </>
    );
  }

  if (!snapshot) {
    return (
      <>
        <SkipLink />
        <main id="main-content" tabIndex={-1}>
          <AppSkeleton />
        </main>
      </>
    );
  }

  return (
    <>
      <SkipLink />
      <DashboardShell
        snapshot={snapshot}
        races={races}
        tab={tab}
        onTabChange={setTab}
        artifacts={artifacts}
      />
    </>
  );
}
