import type {
  CalibrationBlock,
  PostRaceBlock,
  RaceEvent,
  RacesData,
  RaceWeekBlock,
  Snapshot,
} from '../../lib/types';
import { Card } from '../shared/Card';
import { SectionLabel } from '../shared/SectionLabel';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { RaceCard } from './RaceCard';
import { PeriodizationCard } from './PeriodizationCard';
import { FitnessProjectionCard } from './FitnessProjectionCard';
import { RaceTimeline } from './RaceTimeline';
import { RaceWeekCard } from './RaceWeekCard';
import { PostRaceCard } from './PostRaceCard';
import { AiRaceWeekCard } from './AiRaceWeekCard';
import { AiPostRaceCard } from './AiPostRaceCard';
import { CalibrationCard } from './CalibrationCard';
import { RaceDisclosure } from './RaceDisclosure';
import { formatRaceDate, formatRaceTime, orderRaceDisplay, raceDaysUntil } from './raceDisplay';

interface Props {
  racesData: RacesData | null;
  snapshot: Snapshot | null;
  raceWeek?: RaceWeekBlock | null;
  postRace?: PostRaceBlock | null;
  calibration?: CalibrationBlock | null;
}

interface RaceDetailProps {
  race: RaceEvent;
  daysUntil: number;
  snapshot: Snapshot | null;
  raceWeek?: RaceWeekBlock | null;
  postRace?: PostRaceBlock | null;
}

function Preparation({ race, daysUntil, snapshot, raceWeek }: RaceDetailProps) {
  return (
    <div className="space-y-4">
      <ErrorBoundary section={`${race.name} · phase`}>
        <PeriodizationCard race={race} daysUntil={daysUntil} />
      </ErrorBoundary>
      {raceWeek?.raceId === race.id && (
        <ErrorBoundary section={`${race.name} · AI taper`}>
          <AiRaceWeekCard data={raceWeek} />
        </ErrorBoundary>
      )}
      {daysUntil <= 7 && (
        <RaceDisclosure title="Race-week reference" description="Daily guidance and estimated fueling">
          <ErrorBoundary section={`${race.name} · race week`}>
            <RaceWeekCard race={race} daysUntil={daysUntil} />
          </ErrorBoundary>
        </RaceDisclosure>
      )}
      {snapshot?.longTerm?.fitnessCurve && (
        <RaceDisclosure title="Fitness forecast" description="Recent CTL trend projected to race day · assumptions included">
          <ErrorBoundary section={`${race.name} · projection`}>
            <FitnessProjectionCard
              fitnessCurve={snapshot.longTerm.fitnessCurve}
              raceDate={race.date}
              raceName={race.name}
            />
          </ErrorBoundary>
        </RaceDisclosure>
      )}
    </div>
  );
}

function PastDetails({ race, daysUntil, snapshot, postRace }: RaceDetailProps) {
  return (
    <>
      <ErrorBoundary section={`${race.name} · event details`}>
        <RaceCard race={race} daysUntil={daysUntil} snapshot={snapshot} isPast detailsOnly />
      </ErrorBoundary>
      {race.result && (
        <ErrorBoundary section={`${race.name} · result`}>
          <PostRaceCard race={race} />
        </ErrorBoundary>
      )}
      {postRace?.raceId === race.id && (
        <ErrorBoundary section={`${race.name} · AI post-race`}>
          <AiPostRaceCard data={postRace} />
        </ErrorBoundary>
      )}
    </>
  );
}

export function RacesPage({ racesData, snapshot, raceWeek, postRace, calibration }: Props) {
  const now = new Date();
  const { upcoming, past, primary } = orderRaceDisplay(racesData?.races ?? [], now);
  const primaryIsPast = upcoming.length === 0;
  const otherPast = past.filter((race) => race.id !== primary?.id);

  return (
    <div className="space-y-8">
      {upcoming.length === 0 && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-4">
          <h2 className="text-base font-semibold text-ink-900">No upcoming races</h2>
          <p className="text-sm text-ink-500">
            {past.length > 0 ? 'Your recorded results and past events are below.' : 'Add an event to start planning.'}
          </p>
        </div>
      )}

      {primary && (
        <section className="space-y-4">
          <SectionLabel>{primaryIsPast ? (primary.result ? 'Latest recorded result' : 'Latest past event') : 'Next race'}</SectionLabel>
          <ErrorBoundary section={`${primary.name} · summary`}>
            <RaceCard race={primary} daysUntil={raceDaysUntil(primary.date, now)} snapshot={snapshot} isPast={primaryIsPast} />
          </ErrorBoundary>
          {primaryIsPast ? (
            <RaceDisclosure
              title={primary.result ? 'Full result and race details' : 'Race details'}
              description={primary.result ? `Placements, splits and notes${postRace?.raceId === primary.id ? ' · AI analysis' : ''}` : 'Event information and notes'}
            >
              <PastDetails race={primary} daysUntil={raceDaysUntil(primary.date, now)} snapshot={snapshot} postRace={postRace} />
            </RaceDisclosure>
          ) : (
            <Preparation race={primary} daysUntil={raceDaysUntil(primary.date, now)} snapshot={snapshot} raceWeek={raceWeek} />
          )}
        </section>
      )}

      {racesData && racesData.races.length > 0 && (
        <RaceDisclosure title="Season preparation timeline"
          description="All recorded and planned events · select a race to compare its date-based preparation window">
          <ErrorBoundary section="Race timeline">
            <RaceTimeline races={racesData.races} />
          </ErrorBoundary>
        </RaceDisclosure>
      )}

      {upcoming.length > 1 && (
        <section className="space-y-4">
          <SectionLabel>Season ahead · {upcoming.length} events</SectionLabel>
          {upcoming.slice(1).map((race) => (
            <RaceDisclosure
              key={race.id}
              title={race.name}
              description={`${formatRaceDate(race.date)} · ${race.distance?.label ?? race.sport} · ${race.priority} priority`}
              value={`${raceDaysUntil(race.date, now)} days`}
            >
              <ErrorBoundary section={`${race.name} · summary`}>
                <RaceCard race={race} daysUntil={raceDaysUntil(race.date, now)} snapshot={snapshot} />
              </ErrorBoundary>
              <Preparation race={race} daysUntil={raceDaysUntil(race.date, now)} snapshot={snapshot} raceWeek={raceWeek} />
            </RaceDisclosure>
          ))}
        </section>
      )}

      {otherPast.length > 0 && (
        <section className="space-y-3">
          <SectionLabel>Past events · {otherPast.length}</SectionLabel>
          {otherPast.map((race) => (
            <RaceDisclosure
              key={race.id}
              title={race.name}
              description={`${formatRaceDate(race.date)} · ${race.distance?.label ?? race.sport} · Details${postRace?.raceId === race.id ? ' and AI analysis' : ''}`}
              value={race.result?.finishSeconds != null ? formatRaceTime(race.result.finishSeconds, 2) : 'No finish time recorded'}
            >
              <PastDetails race={race} daysUntil={raceDaysUntil(race.date, now)} snapshot={snapshot} postRace={postRace} />
            </RaceDisclosure>
          ))}
        </section>
      )}

      {calibration && (
        <section className="space-y-3">
          <SectionLabel>Prediction accuracy</SectionLabel>
          <ErrorBoundary section="Prediction calibration">
            <CalibrationCard data={calibration} />
          </ErrorBoundary>
        </section>
      )}

      {!primary && (
        <RaceDisclosure title="How to add a race" description="Local race-file setup">
          <Card title="Log an event" fitContent>
            <p className="text-sm text-ink-700">
              Add events to <code className="break-all">private/data/races.json</code>. The pipeline leaves your entries unchanged.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-ink-50 p-3 text-caption leading-relaxed text-ink-700">{`{
  "races": [
    {
      "id": "berlin-2026",
      "name": "Berlin Marathon",
      "date": "2026-09-27",
      "type": "race",
      "sport": "run",
      "priority": "A",
      "status": "registered",
      "distance": { "meters": 42195, "label": "Marathon" },
      "goal": { "timeSeconds": 14400 }
    }
  ]
}`}</pre>
            <p className="mt-3 text-caption text-ink-500">Full schema in <code>03-races-research.md §3</code>.</p>
          </Card>
        </RaceDisclosure>
      )}
    </div>
  );
}
