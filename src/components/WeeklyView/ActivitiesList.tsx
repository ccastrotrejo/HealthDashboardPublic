import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import type { RecentActivity } from '../../lib/types';
import {
  formatDuration,
  formatKm,
  formatPace,
  formatShortDate,
  intensityColor,
  sportLabel,
} from '../../lib/format';
import { Card } from '../shared/Card';
import { useBrandPalette } from '../../lib/palette';
import { SportGlyph } from '../shared/icons';

interface Props {
  activities: RecentActivity[];
}

function isPaceSport(sportType: string): boolean {
  const s = sportType.toLowerCase();
  return s.includes('run') || s.includes('walk') || s.includes('hike');
}

const ZONE_LABELS = ['Z0', 'Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
const ZONE_DESC = ['recovery', 'easy', 'aerobic', 'tempo', 'threshold', 'VO₂max'];

/**
 * Compact zone strip on the collapsed row — a shape cue, not a data source.
 * The numbers it hints at are printed in full in the zone table inside
 * `ActivityDetail`, one click away, so the bar carries no information that
 * only exists on hover. It's decorative to assistive tech for that reason.
 */
function ZoneBar({ zones }: { zones: NonNullable<RecentActivity['zoneDurationsMs']> }) {
  const { zoneScale } = useBrandPalette();
  const total = zones.z0 + zones.z1 + zones.z2 + zones.z3 + zones.z4 + zones.z5;
  if (total <= 0) return null;
  const segments = (['z0', 'z1', 'z2', 'z3', 'z4', 'z5'] as const).map((key, i) => ({
    key,
    ms: zones[key],
    color: zoneScale[i]!,
  }));
  return (
    <div aria-hidden className="mt-1.5 flex h-1 overflow-hidden rounded-full">
      {segments.map((s) => {
        if (s.ms <= 0) return null;
        return (
          <div
            key={s.key}
            style={{ width: `${(s.ms / total) * 100}%`, background: s.color }}
          />
        );
      })}
    </div>
  );
}

function SourceBadge({ source }: { source: RecentActivity['source'] }) {
  // Strava-only is the visual default — no badge to avoid noise.
  if (source === 'strava') return null;
  const label = source === 'both' ? 'S+W' : 'W';
  const description =
    source === 'both'
      ? 'Recorded on Strava and matched to a Whoop workout'
      : 'Whoop-only — not synced to Strava';
  // The abbreviation is expanded in the accessible name rather than a `title`,
  // which touch devices can't surface. The expanded key also prints under the
  // list, so "S+W" is decodable without hovering anything.
  return (
    <span className="ml-2 align-middle" role="img" aria-label={description}>
      <Badge variant="neutral" label={label} />
    </span>
  );
}

function rollupBySport(activities: RecentActivity[]): { sport: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of activities) {
    counts.set(a.sportType, (counts.get(a.sportType) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([sport, count]) => ({ sport, count }))
    .sort((a, b) => b.count - a.count);
}

function fmtMinutes(ms: number): string {
  const total = Math.round(ms / 60_000);
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total - h * 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtSpeed(metersPerSec: number): string {
  // km/h is more intuitive for cycling
  return `${(metersPerSec * 3.6).toFixed(1)} km/h`;
}

function fmtLongDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Inline detail panel that renders below a row when the user clicks it.
 * All data comes from RecentActivity — no extra API calls needed.
 */
function ActivityDetail({ a }: { a: RecentActivity }) {
  const { zoneScale } = useBrandPalette();
  const hasZones = !!a.zoneDurationsMs;
  const totalZoneMs = a.zoneDurationsMs
    ? a.zoneDurationsMs.z0 +
      a.zoneDurationsMs.z1 +
      a.zoneDurationsMs.z2 +
      a.zoneDurationsMs.z3 +
      a.zoneDurationsMs.z4 +
      a.zoneDurationsMs.z5
    : 0;

  // Average speed only meaningful for distance-based, non-pace sports (ride, swim)
  const speed =
    a.distanceMeters > 0 && a.movingTimeSeconds > 0 && !isPaceSport(a.sportType)
      ? a.distanceMeters / a.movingTimeSeconds
      : null;

  // Strava activity URLs use the numeric activity id. Only Strava-sourced or
  // matched activities have a usable id for this; Whoop-only activities use
  // a synthesized id and have no public link.
  const stravaUrl =
    a.source !== 'whoop' && typeof a.id === 'number'
      ? `https://www.strava.com/activities/${a.id}`
      : null;

  return (
    <div className="mt-3 rounded-lg bg-ink-50/50 p-3">
      <p className="mb-2 text-caption text-ink-500">{fmtLongDate(a.startDateLocal)}</p>

      {/* Headline stats — 4-column grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Duration"
          value={formatDuration(a.movingTimeSeconds)}
        />
        {a.distanceMeters > 0 && <Stat label="Distance" value={formatKm(a.distanceMeters)} />}
        {/* Pace for pace sports, speed for everything else — never both. A ride
            was showing "2:54 /km" next to "20.7 km/h", which is the same fact
            twice and the running framing of it is the useless one. */}
        {isPaceSport(a.sportType) && a.averagePaceSecPerKm != null && (
          <Stat label="Avg pace" value={formatPace(a.averagePaceSecPerKm)} />
        )}
        {speed != null && <Stat label="Avg speed" value={fmtSpeed(speed)} />}
        {a.averageHeartrate != null && (
          <Stat label="Avg HR" value={`${a.averageHeartrate.toFixed(0)} bpm`} />
        )}
        {a.whoopStrain != null && (
          <Stat label="Whoop strain" value={a.whoopStrain.toFixed(1)} />
        )}
        {a.power && (
          <>
            <Stat label="Norm. power" value={`${Math.round(a.power.np)}W`} />
            <Stat label="TSS" value={a.power.tss.toFixed(0)} />
            <Stat label="Intensity" value={a.power.intensityFactor.toFixed(2)} />
            {a.power.efficiencyFactor != null && (
              <Stat label="Efficiency" value={`${a.power.efficiencyFactor.toFixed(2)} W/bpm`} />
            )}
          </>
        )}
        {/* Heart-rate stress is shown only when there is no power number, so the
            card never displays two competing load figures for one session. */}
        {!a.power && a.stressScore != null && (
          <Stat label="Stress (HR)" value={a.stressScore.toFixed(0)} />
        )}
        {a.elevationGainMeters != null && a.elevationGainMeters > FLAT_RIDE_ELEVATION_M && (
          <Stat label="Climbing" value={`${Math.round(a.elevationGainMeters)} m`} />
        )}
      </div>

      {(a.commute || a.indoor || a.heartrateSuspect) && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-pretty text-caption text-ink-500">
          {a.indoor && <li>Indoor — speed and distance are synthetic.</li>}
          {a.commute && <li>Logged as a commute, not a training session.</li>}
          {a.heartrateSuspect && (
            <li className="text-terra-ink">
              Heart rate looks like a sensor dropout — load estimated another way.
            </li>
          )}
        </ul>
      )}

      {/* Zone table */}
      {hasZones && totalZoneMs > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Time in HR zones
          </p>
          <table className="w-full text-caption">
            <tbody>
              {ZONE_LABELS.map((label, i) => {
                const ms = a.zoneDurationsMs![
                  ['z0', 'z1', 'z2', 'z3', 'z4', 'z5'][i] as
                    | 'z0'
                    | 'z1'
                    | 'z2'
                    | 'z3'
                    | 'z4'
                    | 'z5'
                ];
                if (ms === 0) return null;
                const pct = (ms / totalZoneMs) * 100;
                return (
                  <tr key={label} className="border-b border-ink-900/5 last:border-0">
                    <td className="py-1">
                      <span
                        className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                        style={{ background: zoneScale[i] }}
                      />
                      <span className="font-medium text-ink-700">{label}</span>
                      <span className="ml-1 text-ink-500">{ZONE_DESC[i]}</span>
                    </td>
                    <td className="py-1 text-right tabular-nums text-ink-700">
                      {fmtMinutes(ms)}
                    </td>
                    <td className="w-12 py-1 text-right tabular-nums text-ink-500">
                      {pct.toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Prior-session comparison */}
      {a.priorComparison && (
        <p className="mt-3 text-caption text-ink-500">
          <span className="font-medium text-ink-700">vs. prior similar session: </span>
          {a.priorComparison}
        </p>
      )}

      {/* Source attribution + Strava link */}
      <div className="mt-3 flex items-center justify-between border-t border-ink-900/5 pt-2.5 text-[10px] text-ink-500">
        <span>
          source:{' '}
          {a.source === 'both'
            ? 'Strava + Whoop (matched)'
            : a.source === 'whoop'
              ? 'Whoop only'
              : 'Strava'}
        </span>
        {stravaUrl && (
          <a
            href={stravaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-sage-ink hover:text-sage-700 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            View on Strava ↗
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Below this, elevation is noise rather than a feature of the ride — showing
 * "12 m" on a flat loop just crowds the grid.
 */
const FLAT_RIDE_ELEVATION_M = 50;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-surface px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wider text-ink-500">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-ink-900">{value}</p>
    </div>
  );
}

export function ActivitiesList({ activities }: Props) {
  // Track which activity row is expanded. Using the same composite key as the
  // React `key` keeps state stable across renders. Null = none expanded.
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!activities || activities.length === 0) {
    return (
      <Card title="This week's activities" subtitle="Last 7 days">
        <p className="text-sm text-ink-500">Nothing logged in the last 7 days.</p>
      </Card>
    );
  }

  const totals = rollupBySport(activities);

  return (
    <Card
      title="This week's activities"
      subtitle={`${activities.length} ${activities.length === 1 ? 'session' : 'sessions'}`}
      info="recent-activities"
      right={
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          {totals.map(({ sport, count }) => (
            <Badge
              key={sport}
              variant="neutral"
              icon={<SportGlyph sportType={sport} size="sm" />}
              label={`${sportLabel(sport)} ${count}`}
            />
          ))}
        </div>
      }
    >
      <ul className="divide-y divide-ink-900/5">
        {activities.map((a) => {
          const key = `${a.source}-${a.id}`;
          const isOpen = expanded === key;
          return (
            <li key={key} className="py-2.5">
              {/* Whole row is a button — keyboard-accessible click target. */}
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : key)}
                aria-expanded={isOpen}
                aria-controls={`activity-detail-${key}`}
                className="-mx-2 flex min-h-10 w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-1 text-left transition-[background-color,scale] duration-150 ease-out-strong hover:bg-ink-900/[0.025] active:scale-[0.96]"
              >
                <SportGlyph sportType={a.sportType} size="lg" className="text-ink-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink-900">
                    {a.name}
                    <SourceBadge source={a.source} />
                  </p>
                  <p className="text-xs text-ink-500">
                    {formatShortDate(a.startDateLocal)} · {sportLabel(a.sportType)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium tabular-nums text-ink-900">
                    {a.distanceMeters > 0
                      ? formatKm(a.distanceMeters)
                      : formatDuration(a.movingTimeSeconds)}
                  </p>
                  {a.distanceMeters > 0 && (
                    <p className={`text-xs tabular-nums ${intensityColor(a.intensity)}`}>
                      {isPaceSport(a.sportType) && a.averagePaceSecPerKm
                        ? formatPace(a.averagePaceSecPerKm)
                        : formatDuration(a.movingTimeSeconds)}
                    </p>
                  )}
                  {a.whoopStrain != null && (
                    <p className="mt-0.5 text-[10px] font-mono text-ink-500">
                      strain {a.whoopStrain.toFixed(1)}
                    </p>
                  )}
                </div>
                {/* Chevron — rotates 90° when expanded */}
                <span
                  aria-hidden
                  className={`ml-1 text-ink-500 transition-transform duration-200 ${
                    isOpen ? 'rotate-90' : ''
                  }`}
                >
                  ›
                </span>
              </button>

              {/* Compact summary still visible on collapsed rows */}
              {!isOpen && a.zoneDurationsMs && <ZoneBar zones={a.zoneDurationsMs} />}
              {!isOpen && a.priorComparison && (
                <p className="mt-1.5 text-caption text-ink-500">
                  vs. prior · {a.priorComparison}
                </p>
              )}

              {/* Expanded detail panel */}
              {isOpen && (
                <div id={`activity-detail-${key}`}>
                  <ActivityDetail a={a} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {/* Legend for the source badge, so "S+W" is decodable without hovering. */}
      {activities.some((a) => a.source !== 'strava') && (
        <p className="mt-3 border-t border-border pt-2.5 text-caption text-ink-500">
          S = Strava (device that recorded) · W = Whoop strap. Unbadged rows are Strava-only.
        </p>
      )}
    </Card>
  );
}
