import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RaceTimeline } from '../../src/components/Races/RaceTimeline';
import { RacePreparationTimeline } from '../../src/components/Races/RacePreparationTimeline';
import { RaceTimelineChart } from '../../src/components/Races/RaceTimelineChart';
import { RacesPage } from '../../src/components/Races/RacesPage';
import { phaseFor } from '../../src/lib/races';
import {
  buildRaceTimeline,
  preparationBandLabel,
  racePreparationBands,
  raceTimelineDate,
  raceTimelineWidth,
  selectedTimelineRace,
  timelineEventStatus,
} from '../../src/lib/raceTimeline';
import type { RaceEvent, RacePriority } from '../../src/lib/types';

const DAY = 86_400_000;
const today = Date.parse('2026-09-06T00:00:00Z');
const eventDate = Date.parse('2026-10-18T00:00:00Z');
const race = (overrides: Partial<RaceEvent> = {}): RaceEvent => ({
  id: 'fall-race', name: 'Fall race', date: '2026-10-18', type: 'race',
  sport: 'run', priority: 'A', status: 'planned', ...overrides,
});

afterEach(() => vi.useRealTimers());

describe('D3 race preparation data', () => {
  it.each<RacePriority>(['A', 'B', 'C'])('matches every phaseFor boundary for %s priority', (priority) => {
    const bands = racePreparationBands(race({ priority }), eventDate - 98 * DAY, eventDate + DAY);
    expect(bands.map((band) => band.phase)).toEqual(['base', 'build', 'peak', 'taper', 'race-week']);
    for (let days = 1; days <= 98; days++) {
      const date = eventDate - days * DAY;
      const matches = bands.filter((band) => band.start <= date && band.end > date);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.phase).toBe(phaseFor(days, priority));
    }
    expect(bands.some((band) => band.start <= eventDate && band.end > eventDate)).toBe(false);
    expect((bands.find((band) => band.phase === 'taper')!.end - bands.find((band) => band.phase === 'taper')!.start) / DAY)
      .toBe(priority === 'A' ? 14 : 7);
  });

  it('clips bands to the window and never assigns phases after race day', () => {
    const bands = racePreparationBands(race(), eventDate - 10 * DAY, eventDate + 8 * DAY);
    expect(bands).toEqual([
      { phase: 'taper', start: eventDate - 10 * DAY, end: eventDate - 7 * DAY },
      { phase: 'race-week', start: eventDate - 7 * DAY, end: eventDate },
    ]);
    expect(racePreparationBands(race(), eventDate, eventDate + 8 * DAY)).toEqual([]);
    expect(racePreparationBands(race(), eventDate, eventDate)).toEqual([]);
    expect(racePreparationBands(race(), eventDate + DAY, eventDate)).toEqual([]);
  });

  it.each<RaceEvent['type']>(['travel', 'event', 'workout-goal'])('keeps %s phase-free', (type) => {
    expect(racePreparationBands(race({ type }), eventDate - 100 * DAY, eventDate)).toEqual([]);
  });

  it('validates actual calendar dates and remains UTC-safe across leap days and DST', () => {
    for (const invalid of ['', 'bad-date', '2026-02-30', '2026-02-29', '2026-1-01', '2026-09-06T00:00:00Z']) {
      expect(raceTimelineDate(invalid)).toBeNull();
    }
    expect(raceTimelineDate('2024-02-29')).toBe(Date.parse('2024-02-29T00:00:00Z'));
    const event = race({ date: '2026-03-15' });
    const date = raceTimelineDate(event.date)!;
    const bands = racePreparationBands(event, date - 98 * DAY, date);
    const raceWeek = bands.find((band) => band.phase === 'race-week')!;
    expect(raceWeek.start).toBe(Date.parse('2026-03-08T00:00:00Z'));
    expect((raceWeek.end - raceWeek.start) / DAY).toBe(7);
  });

  it('sorts separate lanes without mutating input, including coincident race dates', () => {
    const events = [
      race({ id: 'later', date: '2026-11-01' }),
      race({ id: 'same-day-b', priority: 'B' }),
      race({ id: 'same-day-a' }),
      race({ id: 'travel', type: 'travel', date: '2026-10-17' }),
      race({ id: 'invalid', date: '2026-02-30' }),
    ];
    const order = events.map((event) => event.id);
    const model = buildRaceTimeline(events, events[0]!, 'calendar')!;
    expect(model.lanes.map((lane) => lane.race.id)).toEqual(['travel', 'same-day-b', 'same-day-a', 'later']);
    expect(model.lanes[1]?.date).toBe(model.lanes[2]?.date);
    expect(model.lanes[0]?.bands).toEqual([]);
    expect(model.start).toBe(Date.parse('2026-10-17T00:00:00Z') - 98 * DAY);
    expect(model.end).toBe(Date.parse('2026-11-08T00:00:00Z'));
    expect(model.omittedCount).toBe(1);
    expect(events.map((event) => event.id)).toEqual(order);
  });

  it('focuses on the selected date while retaining off-window lanes and events', () => {
    const events = [race({ id: 'old', date: '2025-01-01' }), race(), race({ id: 'far', date: '2028-01-01' })];
    const model = buildRaceTimeline(events, events[1]!, 'selected')!;
    expect(model.start).toBe(eventDate - 98 * DAY);
    expect(model.end).toBe(eventDate + 7 * DAY);
    expect(model.lanes).toHaveLength(3);
    expect(model.lanes[0]?.bands).toEqual([]);
    expect(model.lanes[2]?.bands.map((band) => band.phase)).toEqual(['base']);
  });

  it('handles empty, single, and entirely invalid inputs without degenerate scales', () => {
    expect(buildRaceTimeline([], null, 'calendar')).toBeNull();
    expect(buildRaceTimeline([race({ date: 'invalid' })], null, 'calendar')).toBeNull();
    const model = buildRaceTimeline([race()], race(), 'calendar')!;
    expect(model.end - model.start).toBe(105 * DAY);
    expect(model.lanes).toHaveLength(1);
  });

  it('recovers stale selections and matches next/upcoming versus recorded past semantics', () => {
    const events = [
      race({ id: 'later' }),
      race({ id: 'past-unrecorded', date: '2026-08-31' }),
      race({ id: 'past-recorded', date: '2026-08-01', result: {} }),
      race({ id: 'today', date: '2026-09-06' }),
    ];
    expect(selectedTimelineRace(events, '', today)?.id).toBe('today');
    expect(selectedTimelineRace(events, 'missing', today)?.id).toBe('today');
    expect(selectedTimelineRace(events, 'later', today)?.id).toBe('later');
    expect(selectedTimelineRace(events.slice(1, 3), '', today)?.id).toBe('past-recorded');
    expect(selectedTimelineRace([events[1]!], '', today)?.id).toBe('past-unrecorded');
    expect(selectedTimelineRace([], '', today)).toBeNull();
  });

  it('prints inclusive dates while leaving the start of base unspecified', () => {
    const bands = racePreparationBands(race(), eventDate - 98 * DAY, eventDate);
    expect(preparationBandLabel(bands[0]!)).toMatch(/^Through /);
    expect(preparationBandLabel(bands[4]!)).toContain('11');
    expect(preparationBandLabel(bands[4]!)).toContain('17');
    expect(preparationBandLabel(bands[4]!)).not.toContain('18');
  });

  it('keeps phases readable on mobile and retains the supplied width on wide screens', () => {
    expect(raceTimelineWidth(today, today + 105 * DAY, 320)).toBe(1193);
    expect(raceTimelineWidth(today, today + 105 * DAY, 1440)).toBe(1440);
    expect(raceTimelineWidth(today, today + 365 * DAY, 320)).toBe(3533);
  });

  it('distinguishes planned or tentative dates from evidence, regardless of elapsed time', () => {
    expect(timelineEventStatus(race(), today)).toBe('Scheduled · planned');
    expect(timelineEventStatus(race({ status: 'considering' }), today)).toBe('Tentative · considering');
    expect(timelineEventStatus(race({ date: '2026-09-01' }), today)).toBe('Past date · no result recorded');
    expect(timelineEventStatus(race({ date: '2026-09-01', result: {} }), today)).toBe('Recorded result');
  });
});

describe('D3 race timeline rendering', () => {
  it('exposes the timeline for a single upcoming event and for an entirely past season', () => {
    vi.useFakeTimers().setSystemTime(new Date(today));
    for (const event of [race(), race({ date: '2026-08-01', result: { finishSeconds: 3600 } })]) {
      const markup = renderToStaticMarkup(createElement(RacesPage, {
        racesData: { races: [event] }, snapshot: null,
      }));
      expect(markup).toContain('Season preparation timeline');
      expect(markup).toContain('Race preparation timeline');
      expect(markup).toContain('data-race-id="fall-race"');
    }
  });

  it('retains calendar list text, native selection, labeled scope, and guidance disclaimers', () => {
    vi.useFakeTimers().setSystemTime(new Date(today));
    const markup = renderToStaticMarkup(createElement(RaceTimeline, {
      races: [race({ id: 'second', name: 'Second race', date: '2026-10-25' }), race()],
    }));
    expect(markup).toContain('Race calendar');
    expect(markup).toContain('Chronological order · gaps between events');
    expect(markup).toContain('aria-label="Chronological race calendar"');
    expect(markup).toContain('Next race');
    expect(markup).toContain('7 days after previous');
    expect(markup).toContain('not an individualized training plan');
    expect(markup).toContain('not a combined prescription');
    expect(markup).toContain('Solid marker: recorded result');
    expect(markup).toContain('Hollow marker: calendar date without a result');
    expect(markup.match(/<select /g)).toHaveLength(2);
    expect(markup).toContain('aria-label="View timeline details for Fall race" aria-pressed="true"');
    expect(markup).toContain('aria-label="View timeline details for Second race" aria-pressed="false"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('overflow-x-auto');
    expect(markup).not.toMatch(/NaN|Infinity/);
  });

  it('shows selected-event phase dates, including shorter B/C taper dates', () => {
    const selected = race({ priority: 'B' });
    const markup = renderToStaticMarkup(createElement(RacePreparationTimeline, {
      races: [selected], selected, today, onSelect: () => {},
    }));
    expect(markup).toContain('Fall race phase dates');
    expect(markup).toContain('Build as of');
    expect(markup).toContain('Oct 4, 2026 – Oct 10, 2026');
    expect(markup).toContain('Oct 11, 2026 – Oct 17, 2026');
    expect(markup).toContain('Through Aug 8, 2026');
    expect(markup).toContain('left edge is not a prescribed start date');
  });

  it('keeps non-race events unphased while showing selected details and a marker', () => {
    const selected = race({ type: 'travel', name: 'Travel to event' });
    const markup = renderToStaticMarkup(createElement(RacePreparationTimeline, {
      races: [selected], selected, today, onSelect: () => {},
    }));
    expect(markup).toContain('Non-race calendar event · no training phases assigned');
    expect(markup).toContain('Calendar event · no training phases');
    expect(markup).not.toContain('data-phase=');
    expect(markup).not.toContain('aria-label="Travel to event phase dates"');
    expect(markup).not.toContain('aria-label="Date-based phase legend"');
    expect(markup).toContain('<circle ');
  });

  it('keeps same-day labels in separate lanes and prints the original same-day gap', () => {
    vi.useFakeTimers().setSystemTime(new Date(today));
    const markup = renderToStaticMarkup(createElement(RaceTimeline, {
      races: [race(), race({ id: 'ride', name: 'Very long cycling event name that remains available in full', sport: 'ride' })],
    }));
    expect(markup).toContain('Same day');
    expect(markup).toContain('data-race-id="fall-race"');
    expect(markup).toContain('data-race-id="ride"');
    expect(markup).toContain('Very long cycling event name that remains available in full');
    expect(markup.match(/<circle /g)).toHaveLength(2);
  });

  it('keeps recorded and unrecorded past markers distinct and never calls a past event next', () => {
    vi.useFakeTimers().setSystemTime(new Date(today));
    const markup = renderToStaticMarkup(createElement(RaceTimeline, {
      races: [
        race({ id: 'recorded', date: '2026-08-01', result: { finishSeconds: 3600 } }),
        race({ id: 'unrecorded', date: '2026-08-05' }),
      ],
    }));
    expect(markup).toContain('Recorded result');
    expect(markup).toContain('Past date · no result recorded');
    expect(markup).toContain('Past event');
    expect(markup).not.toContain('Next race');
    expect(markup).toContain('stroke-dasharray="3 3"');
    expect(markup).toContain('stroke-dasharray="4 3"');
    expect(markup).not.toContain('Today (UTC)');
  });

  it('marks off-window dates explicitly rather than clamping them to a fake race date', () => {
    const events = [race({ id: 'past', date: '2025-01-01' }), race(), race({ id: 'future', date: '2027-10-01' })];
    const markup = renderToStaticMarkup(createElement(RaceTimelineChart, {
      model: buildRaceTimeline(events, events[1]!, 'selected')!, selectedId: 'fall-race', today,
    }));
    expect(markup.match(/outside window/g)).toHaveLength(2);
    expect(markup.match(/<circle /g)).toHaveLength(1);
  });

  it('spaces race markers by elapsed time while keeping date ticks at least 110 pixels apart', () => {
    const events = [race(), race({ id: 'week-later', date: '2026-10-25' })];
    const markup = renderToStaticMarkup(createElement(RaceTimelineChart, {
      model: buildRaceTimeline(events, events[0]!, 'calendar')!, selectedId: 'fall-race', today,
    }));
    const markers = [...markup.matchAll(/<circle cx="([^"]+)"/g)].map((match) => Number(match[1]));
    expect(markers).toHaveLength(2);
    expect(markers[1]! - markers[0]!).toBeCloseTo(7 * 9);
    const ticks = [...markup.matchAll(/<text x="([^"]+)" y="35" text-anchor="middle"/g)].map((match) => Number(match[1]));
    expect(ticks.length).toBeGreaterThan(1);
    for (let index = 1; index < ticks.length; index++) {
      expect(ticks[index]! - ticks[index - 1]!).toBeGreaterThanOrEqual(110);
    }
    expect(markup).toContain('>Race week</text>');
  });

  it('preserves invalid entries with an explanation and renders an empty list as nothing', () => {
    expect(renderToStaticMarkup(createElement(RaceTimeline, { races: [] }))).toBe('');
    const markup = renderToStaticMarkup(createElement(RaceTimeline, { races: [race({ date: 'invalid' })] }));
    expect(markup).toContain('no valid event dates');
    expect(markup).toContain('Fall race');
    expect(markup).toContain('Date unavailable');
    expect(markup).not.toContain('<svg');
    const mixed = renderToStaticMarkup(createElement(RaceTimeline, {
      races: [race(), race({ id: 'invalid', date: 'bad-date' })],
    }));
    expect(mixed).toContain('1 event(s) with invalid dates omitted');
    expect(mixed).not.toMatch(/NaN|Infinity/);
    const invalidFirst = renderToStaticMarkup(createElement(RaceTimeline, {
      races: [race(), race({ id: 'invalid', date: '2026-02-30' })],
    }));
    expect(invalidFirst).toContain('2026-02-30');
    expect(invalidFirst).toContain('Gap unavailable');
    expect(invalidFirst).not.toMatch(/NaN|Infinity/);
  });
});
