import { ErrorBoundary } from '../shared/ErrorBoundary';
import { DisclosureSection } from '../shared/DisclosureSection';
import { SectionLabel } from '../shared/SectionLabel';
import { TodayCard } from './TodayCard';
import { PhaseCard } from './PhaseCard';
import { FtpCard } from './FtpCard';
import { ScheduleCard } from './ScheduleCard';
import { LiftCard } from './LiftCard';
import { CardioProgressionCard } from './CardioProgressionCard';
import { MacrosCard } from './MacrosCard';
import { MealOptionsCard } from './MealOptionsCard';
import { GroceryCard } from './GroceryCard';
import { RecoveryCard } from './RecoveryCard';
import { PreferencesCard } from './PreferencesCard';
import { WeeklyPlan } from '../Coach/WeeklyPlan';
import { NutritionCard } from '../Coach/NutritionCard';
import { lifts, PROGRAM_LENGTH_WEEKS } from '../../lib/program';
import type { CoachBlock, CyclingAnalytics, TodaysCall, WeeklyReviewBlock } from '../../lib/types';

interface Props {
  coach: CoachBlock | null;
  weeklyReview?: WeeklyReviewBlock | null;
  cycling: CyclingAnalytics | null;
  readinessCall?: TodaysCall | null;
}

/**
 * The Training tab. The configured cycling block surfaced as a daily-ops
 * dashboard: today's call and fuel, then the weekly agenda, FTP context,
 * nutrition, and disclosed program reference. Retrospectives live in Review.
 */
export function TrainingPage({ coach, cycling, readinessCall }: Props) {
  return (
    <div>
      {/* Today + macros — the operational answer, first. */}
      <section className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <ErrorBoundary section="Today">
          <TodayCard readinessCall={readinessCall} />
        </ErrorBoundary>
        <ErrorBoundary section="Macros">
          <MacrosCard />
        </ErrorBoundary>
      </section>

      {/* AI weekly plan — program-aware, current-state adjusted */}
      {coach && (
        <section className="mt-14 space-y-4">
          <SectionLabel>This Week</SectionLabel>
          <div className="space-y-4">
            <ErrorBoundary section="Weekly plan">
              <WeeklyPlan data={coach} />
            </ErrorBoundary>
            {cycling && (
              <ErrorBoundary section="FTP">
                <FtpCard data={cycling} />
              </ErrorBoundary>
            )}
            <ErrorBoundary section="Nutrition">
              <NutritionCard data={coach} />
            </ErrorBoundary>
          </div>
        </section>
      )}

      {!coach && cycling && (
        <section className="mt-10">
          <ErrorBoundary section="FTP">
            <FtpCard data={cycling} />
          </ErrorBoundary>
        </section>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 border-y border-border py-2">
        <p className="text-sm text-ink-500">Looking back at the week?</p>
        <a
          href="#review"
          className="inline-flex min-h-11 items-center gap-2 rounded px-2 text-sm font-medium text-ink-900 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Open weekly review <span aria-hidden>→</span>
        </a>
      </div>

      <DisclosureSection
        id="program-structure"
        title="Program Structure"
        description={`The ${PROGRAM_LENGTH_WEEKS}-week phase map and recurring weekly schedule.`}
        className="mt-10"
      >
        <div className="space-y-4">
          <ErrorBoundary section="Phase ribbon">
            <PhaseCard />
          </ErrorBoundary>
          <ErrorBoundary section="Weekly schedule">
            <ScheduleCard />
          </ErrorBoundary>
        </div>
      </DisclosureSection>

      <DisclosureSection
        id="exercise-library"
        title="Exercise Library"
        description="Strength sessions and sport-specific progressions used throughout the block."
        className="mt-4"
      >
        <div className="space-y-8">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {lifts.map((l) => (
              <ErrorBoundary key={l.id} section={`Lift ${l.id}`}>
                <LiftCard lift={l} />
              </ErrorBoundary>
            ))}
          </div>
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-ink-900">Cardio Progression</h3>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <ErrorBoundary section="Bike progression">
                <CardioProgressionCard sport="bike" />
              </ErrorBoundary>
              <ErrorBoundary section="Run progression">
                <CardioProgressionCard sport="run" />
              </ErrorBoundary>
              <ErrorBoundary section="Swim progression">
                <CardioProgressionCard sport="swim" />
              </ErrorBoundary>
            </div>
          </div>
        </div>
      </DisclosureSection>

      <DisclosureSection
        id="nutrition-library"
        title="Nutrition Library"
        description="Meal options, grocery list, recovery rules, and standing preferences."
        className="mt-4"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ErrorBoundary section="Meals">
              <MealOptionsCard />
            </ErrorBoundary>
            <ErrorBoundary section="Grocery">
              <GroceryCard />
            </ErrorBoundary>
          </div>
          <ErrorBoundary section="Recovery">
            <RecoveryCard />
          </ErrorBoundary>
          <ErrorBoundary section="Preferences">
            <PreferencesCard />
          </ErrorBoundary>
        </div>
      </DisclosureSection>
    </div>
  );
}
