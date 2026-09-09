/**
 * Race-specific client-side analytics. These run in the browser against the
 * already-loaded snapshot, because they're parametric on each race's date
 * and the user's current state can be tweaked without a sync rerun.
 */

import type { FitnessPoint, RaceEvent, RacePriority } from './types';
import { addDays, DAY_MS, utcDateTime } from '../../utils/date';

// ─── Periodization phase ────────────────────────────────────────────────────

export type RacePhase =
  | 'race-day'
  | 'race-week'
  | 'taper'
  | 'peak'
  | 'build'
  | 'base'
  | 'past';

const PHASE_LABEL: Record<RacePhase, string> = {
  'race-day': 'Race day',
  'race-week': 'Race week',
  taper: 'Taper',
  peak: 'Peak',
  build: 'Build',
  base: 'Base',
  past: 'Past',
};

export function phaseFor(daysUntil: number, priority: RacePriority): RacePhase {
  if (daysUntil < 0) return 'past';
  if (daysUntil === 0) return 'race-day';
  if (daysUntil <= 7) return 'race-week';
  // A-races get a longer taper than B/C
  const taperDays = priority === 'A' ? 21 : 14;
  if (daysUntil <= taperDays) return 'taper';
  if (daysUntil <= 28) return 'peak';
  if (daysUntil <= 70) return 'build';
  return 'base';
}

export function phaseLabel(phase: RacePhase): string {
  return PHASE_LABEL[phase];
}

export interface PhaseGuidance {
  phase: RacePhase;
  label: string;
  weeklyVolumeTarget: string;
  qualitySessions: string;
  longWorkout: string;
  rest: string;
  advice: string;
}

/**
 * Rule-of-thumb guidance for the current phase. Volume targets are expressed
 * relative to the athlete's CTL because absolute km targets depend on event
 * distance and what's normal for that athlete.
 */
export function guidanceForPhase(phase: RacePhase): PhaseGuidance {
  switch (phase) {
    case 'base':
      return {
        phase,
        label: PHASE_LABEL[phase],
        weeklyVolumeTarget: 'Build steadily — add ≤10% week-over-week',
        qualitySessions: '0–1 (light tempo only)',
        longWorkout: 'Gradually longest of the week',
        rest: '1–2 full rest days',
        advice:
          'Aerobic foundation. Most sessions Z2. Avoid the moderate-intensity trap. This is where your CTL gets built — no rush.',
      };
    case 'build':
      return {
        phase,
        label: PHASE_LABEL[phase],
        weeklyVolumeTarget: 'Peak training volume of the cycle',
        qualitySessions: '1–2 per week (tempo + threshold)',
        longWorkout: 'Race-distance simulation every 2 weeks',
        rest: '1 full rest day',
        advice:
          'Highest workload weeks. Polarized: most easy, some hard, almost no moderate. Watch ACWR — keep below 1.3.',
      };
    case 'peak':
      return {
        phase,
        label: PHASE_LABEL[phase],
        weeklyVolumeTarget: 'Hold volume, reduce easy days slightly',
        qualitySessions: '2 per week — race-specific intensity',
        longWorkout: 'One race-pace effort at 60–80% race distance',
        rest: '1–2 rest days',
        advice:
          'Sharpening phase. Quality stays high, easy volume drops. You should feel sharp at the end of this block.',
      };
    case 'taper':
      return {
        phase,
        label: PHASE_LABEL[phase],
        weeklyVolumeTarget: '50–70% of peak volume',
        qualitySessions: '1 short, race-pace',
        longWorkout: 'Cut by 30–50%',
        rest: '2 rest days OK',
        advice:
          'Maintain INTENSITY, drop VOLUME. CTL will drop slightly — that\'s expected. TSB should swing positive (fresh) by race day.',
      };
    case 'race-week':
      return {
        phase,
        label: PHASE_LABEL[phase],
        weeklyVolumeTarget: '40–50% of peak',
        qualitySessions: '1 very short race-pace effort (T–4 to T–3)',
        longWorkout: 'Just shake-out runs/rides 20–40 min',
        rest: 'T–1 fully rest',
        advice:
          'You can\'t add fitness now — only lose it through fatigue. Sleep 8+, eat normally, hydrate. Resist the urge to "test" yourself.',
      };
    case 'race-day':
      return {
        phase,
        label: PHASE_LABEL[phase],
        weeklyVolumeTarget: 'Race only',
        qualitySessions: 'The race',
        longWorkout: 'The race',
        rest: 'After',
        advice:
          'Stick to your fueling plan. Start conservative — you can always pick up in the last third. Trust the training.',
      };
    case 'past':
      return {
        phase,
        label: PHASE_LABEL[phase],
        weeklyVolumeTarget: 'Recovery',
        qualitySessions: '0',
        longWorkout: 'Walks, easy spins',
        rest: 'As much as needed',
        advice: 'Rule of thumb: 1 day of easy recovery per km of the race distance.',
      };
  }
}

// ─── Fitness projection to race day ─────────────────────────────────────────

export interface FitnessProjection {
  /** Past + projected future, oldest → race day. */
  series: Array<{ date: string; ctl: number; atl: number; tsb: number; projected: boolean }>;
  /** Today's values (last historical point). */
  current: { ctl: number; atl: number; tsb: number } | null;
  /** Projected race-day values. */
  raceDay: { ctl: number; atl: number; tsb: number } | null;
  /** ISO date the race lands on. */
  raceDate: string;
}

/**
 * Project CTL/ATL/TSB to race day using a simple linear regression on the
 * last 28 days of CTL. Real-world: training plans are usually nonlinear
 * (taper drops CTL deliberately), but a linear-trend projection gives the
 * athlete a "if I keep doing what I'm doing" baseline.
 */
export function projectFitness(
  fitnessCurve: FitnessPoint[],
  raceDateIso: string,
): FitnessProjection {
  if (fitnessCurve.length === 0) {
    return {
      series: [],
      current: null,
      raceDay: null,
      raceDate: raceDateIso,
    };
  }

  const lastIdx = fitnessCurve.length - 1;
  const last = fitnessCurve[lastIdx]!;
  const daysUntil = Math.max(0, Math.round((utcDateTime(raceDateIso) - utcDateTime(last.date)) / DAY_MS));

  // Linear regression on the most recent 28 days of CTL
  const recent = fitnessCurve.slice(-28);
  const n = recent.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += recent[i]!.ctl;
    sumXY += i * recent[i]!.ctl;
    sumXX += i * i;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const slope = n > 1 ? (sumXY - n * meanX * meanY) / (sumXX - n * meanX * meanX) : 0;

  // Project forward. We keep the linear extrapolation simple — daily CTL
  // increment = slope. ATL decays toward CTL during taper; we approximate it
  // as 90% of CTL during the projected window (athletes usually shed fatigue).
  const series: FitnessProjection['series'] = fitnessCurve.map((p) => ({
    date: p.date,
    ctl: p.ctl,
    atl: p.atl,
    tsb: p.tsb,
    projected: false,
  }));

  let projectedCtl = last.ctl;
  for (let i = 1; i <= daysUntil; i++) {
    projectedCtl += slope;
    if (projectedCtl < 0) projectedCtl = 0;
    const projectedAtl = projectedCtl * 0.9;
    const projectedTsb = projectedCtl - projectedAtl;
    series.push({
      date: addDays(last.date, i),
      ctl: projectedCtl,
      atl: projectedAtl,
      tsb: projectedTsb,
      projected: true,
    });
  }

  const raceDay = series.find((p) => p.date === raceDateIso) ?? series[series.length - 1] ?? null;

  return {
    series,
    current: { ctl: last.ctl, atl: last.atl, tsb: last.tsb },
    raceDay: raceDay ? { ctl: raceDay.ctl, atl: raceDay.atl, tsb: raceDay.tsb } : null,
    raceDate: raceDateIso,
  };
}

// ─── Race-day fueling (rough heuristics) ────────────────────────────────────

export interface FuelingPlan {
  durationHours: number;
  carbsPerHour: number;
  totalCarbsG: number;
  fluidsPerHourMl: number;
  totalFluidsMl: number;
  sodiumPerHourMg: number;
  preRaceCarbsG: number;
  notes: string[];
}

/** Reasonable defaults; user adjusts per personal preference. */
export function fuelingFor(race: RaceEvent, bodyWeightKg = 75): FuelingPlan | null {
  // Estimate duration: prefer explicit duration, else predict from distance + sport
  let durationH = race.duration?.hours;
  if (durationH == null && race.distance) {
    // Rough per-sport pace assumptions (intentionally on the slow side so we
    // overestimate duration rather than under-fuel)
    const km = race.distance.meters / 1000;
    switch (race.sport) {
      case 'run':
        durationH = km / 9; // ~9 km/h ≈ 6:40 /km
        break;
      case 'ride':
        durationH = km / 25; // ~25 km/h average
        break;
      case 'swim':
        durationH = km / 2.5;
        break;
      case 'tri':
        // Sprint tri: ~1.5h; Olympic: ~3h; rough lookup
        if (km <= 25) durationH = 1.5;
        else if (km <= 60) durationH = 3;
        else durationH = 6;
        break;
      default:
        durationH = km / 8;
    }
  }
  if (!durationH || durationH < 0.5) return null;

  // Standard endurance fueling:
  //   <1h:    no carbs needed, just water
  //   1-2h:   30 g/h
  //   2-3h:   60 g/h
  //   >3h:    60-90 g/h (gut-trained)
  let carbsPerHour: number;
  if (durationH < 1) carbsPerHour = 0;
  else if (durationH < 2) carbsPerHour = 30;
  else if (durationH < 3) carbsPerHour = 60;
  else carbsPerHour = 75;

  const fluidsPerHourMl = 500 + (durationH > 2 ? 200 : 0); // bumped up for longer events
  const sodiumPerHourMg = 300 + (durationH > 2 ? 200 : 0);

  // Pre-race meal: ~1 g/kg of carbs 2 hours before
  const preRaceCarbsG = Math.round(bodyWeightKg * 1.0);

  const notes: string[] = [];
  if (durationH < 1) {
    notes.push('Under an hour — no race-day carbs needed. Sip water as desired.');
  } else {
    notes.push(`Eat ~${preRaceCarbsG} g of easy carbs 2 hours before the start.`);
    notes.push(`During: a gel or chew every 20–30 minutes, sip fluids continuously.`);
    if (durationH > 2) {
      notes.push('Practice this exact fueling in your last 2–3 long sessions before race day.');
    }
  }
  if (race.sport === 'tri') {
    notes.push('On the bike is the easiest leg to take in calories — fuel heavily there.');
  }

  return {
    durationHours: durationH,
    carbsPerHour,
    totalCarbsG: Math.round(carbsPerHour * durationH),
    fluidsPerHourMl,
    totalFluidsMl: Math.round(fluidsPerHourMl * durationH),
    sodiumPerHourMg,
    preRaceCarbsG,
    notes,
  };
}
