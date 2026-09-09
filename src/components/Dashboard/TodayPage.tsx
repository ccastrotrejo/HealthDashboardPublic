import type { Snapshot } from '../../lib/types';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { SectionLabel } from '../shared/SectionLabel';
import { DisclosureSection } from '../shared/DisclosureSection';
import { StaleDataBanner } from '../shared/StaleDataBanner';
import { TodayLead } from '../DailyGlance/TodayLead';
import { PassiveMetricsStrip } from '../DailyGlance/PassiveMetricsStrip';
import { SleepCard } from '../DailyGlance/SleepCard';
import { HrvCard } from '../DailyGlance/HrvCard';
import { RhrCard } from '../DailyGlance/RhrCard';
import { StepsWeekChart } from '../DailyGlance/StepsWeekChart';
import { TrainingReadinessCard } from '../DailyGlance/TrainingReadinessCard';
import { StrainCard } from '../DailyGlance/StrainCard';
import { AnomalyPanel } from '../DailyGlance/AnomalyPanel';
import { SleepRegularityChart } from '../DailyGlance/SleepRegularityChart';
import { AgreementPanel } from '../DailyGlance/AgreementPanel';

interface TodayPageProps {
  snapshot: Snapshot;
}

/** The fast morning workflow: resolve today's call, then inspect its evidence. */
export function TodayPage({ snapshot }: TodayPageProps) {
  const disagreementCount = snapshot.daily?.agreement.filter((match) => match.flagged).length ?? 0;

  return (
    <div>
      <ErrorBoundary section="Stale data warning">
        <div className="mt-6">
          <StaleDataBanner syncedAt={snapshot.syncedAt} />
        </div>
      </ErrorBoundary>

      {!snapshot.daily && (
        <div role="status" className="mt-6 rounded-xl bg-ink-100 p-5 shadow-border">
          <h2 className="text-base font-semibold text-ink-900">No daily briefing yet</h2>
          <p className="mt-1 text-sm text-ink-500">
            Run the daily sync to generate recovery signals and today’s training call.
          </p>
        </div>
      )}

      {snapshot.daily && (
        <div className="mt-6 space-y-4">
          {snapshot.daily.anomalies && snapshot.daily.anomalies.length > 0 && (
            <ErrorBoundary section="Anomalies">
              <AnomalyPanel
                flags={snapshot.daily.anomalies}
                escalation={snapshot.daily.anomalyEscalation}
              />
            </ErrorBoundary>
          )}
          <ErrorBoundary section="Today’s Call">
            <TodayLead
              call={snapshot.daily.todaysCall}
              recovery={snapshot.daily.recovery ?? null}
            />
          </ErrorBoundary>
        </div>
      )}

      {snapshot.daily && (
        <section className="mt-12 space-y-4">
          <SectionLabel>Signals behind the call</SectionLabel>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {snapshot.daily.sleep && (
              <ErrorBoundary section="Sleep">
                <SleepCard data={snapshot.daily.sleep} />
              </ErrorBoundary>
            )}
            <ErrorBoundary section="HRV">
              <HrvCard
                latest={snapshot.daily.recovery?.hrvMs ?? null}
                deltaPct={snapshot.daily.recovery?.hrvDeltaPct ?? null}
                trend={snapshot.daily.trends.hrv}
                status={snapshot.daily.recovery?.hrvStatus ?? 'unknown'}
              />
            </ErrorBoundary>
            <ErrorBoundary section="Resting HR">
              <RhrCard
                latest={snapshot.daily.recovery?.rhrBpm ?? null}
                deltaPct={snapshot.daily.recovery?.rhrDeltaPct ?? null}
                trend={snapshot.daily.trends.rhr}
              />
            </ErrorBoundary>
            {snapshot.daily.dayStrain && (
              <ErrorBoundary section="Day strain">
                <StrainCard
                  data={snapshot.daily.dayStrain}
                  trend={snapshot.daily.trends.dayStrain}
                />
              </ErrorBoundary>
            )}
          </div>

          {snapshot.garmin && (
            <section className="pt-6">
              <div className="mb-4">
                <SectionLabel>Throughout the day</SectionLabel>
              </div>
              <div className={snapshot.garmin.trainingReadinessScore != null ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : ''}>
                <ErrorBoundary section="Passive metrics">
                  <PassiveMetricsStrip
                    steps={snapshot.garmin.steps}
                    stepGoal={snapshot.garmin.stepGoal}
                    stepsTrend={snapshot.garmin.stepsTrend}
                    bodyBatteryHigh={snapshot.garmin.bodyBatteryHigh}
                    bodyBatteryLow={snapshot.garmin.bodyBatteryLow}
                    bodyBatteryTrend={snapshot.garmin.bodyBatteryTrend}
                    stressAvg={snapshot.garmin.stressAvg}
                    intensityMinutesWeek={snapshot.garmin.intensityMinutesWeek}
                    intensityMinutesGoal={snapshot.garmin.intensityMinutesGoal}
                    intensityMinutesTrend={snapshot.garmin.intensityMinutesTrend}
                    floorsToday={snapshot.garmin.floorsToday}
                    floorsGoal={snapshot.garmin.floorsGoal}
                    avgSpo2={snapshot.garmin.avgSpo2}
                    minSpo2={snapshot.garmin.minSpo2}
                    spo2Trend={snapshot.garmin.spo2Trend}
                  />
                </ErrorBoundary>
                {snapshot.garmin.trainingReadinessScore != null && (
                  <ErrorBoundary section="Training readiness">
                    <TrainingReadinessCard
                      score={snapshot.garmin.trainingReadinessScore}
                      level={snapshot.garmin.trainingReadinessLevel}
                      recoveryTimeHours={snapshot.garmin.recoveryTimeHours}
                      feedback={snapshot.garmin.trainingReadinessFeedback}
                      trend={snapshot.garmin.trainingReadinessTrend}
                    />
                  </ErrorBoundary>
                )}
              </div>
            </section>
          )}

          <DisclosureSection
            id="supporting-signals"
            title="Supporting patterns"
            description="Daily steps and sleep timing over recent weeks."
            className="!mt-10"
          >
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {snapshot.garmin && (
                <ErrorBoundary section="Steps · Last 7 Days">
                  <StepsWeekChart trend={snapshot.garmin.stepsTrend} goal={snapshot.garmin.stepGoal} />
                </ErrorBoundary>
              )}
              <ErrorBoundary section="Sleep regularity">
                <SleepRegularityChart data={snapshot.daily.sleepRegularity} />
              </ErrorBoundary>
            </div>
          </DisclosureSection>

          {snapshot.daily.agreement.length > 0 && (
            <DisclosureSection
              id="source-agreement"
              title={disagreementCount > 0 ? `Source agreement · ${disagreementCount} flagged` : 'Source agreement'}
              description={disagreementCount > 0
                ? 'Heart-rate recordings disagree on a recent activity. Compare the readings before interpreting the effort.'
                : 'Compare Whoop and Strava heart-rate recordings across recent matched activities.'}
              defaultOpen={disagreementCount > 0}
            >
              <ErrorBoundary section="Source agreement">
                <AgreementPanel matches={snapshot.daily.agreement} />
              </ErrorBoundary>
            </DisclosureSection>
          )}
        </section>
      )}
    </div>
  );
}
