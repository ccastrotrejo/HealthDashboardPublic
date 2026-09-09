import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PowerDurationChart } from '../../src/components/Training/PowerDurationChart';
import { FtpCard } from '../../src/components/Training/FtpCard';
import {
  measuredPowerPoints, powerDurationLabel, powerProfilePlotRows, powerProfileSeries,
} from '../../src/lib/powerProfile';
import type { CyclingAnalytics, CyclingProfile, RideStreamMetrics } from '../../src/lib/types';
import { computeCyclingAnalytics } from './analytics';

const now = new Date('2026-09-06T17:30:00Z');
const profile: CyclingProfile = {
  ftpWatts: 200, ftpSource: 'estimate', ftpTestedOn: null,
  weightKg: 0, lthr: null, maxHr: 190, restingHr: 50,
};
const snapshot = (streams: RideStreamMetrics[] = []) =>
  computeCyclingAnalytics([], now, profile, [], [], streams);

function ride(activityId: number, daysAgo: number, meanMaximalPower: Record<string, number>): RideStreamMetrics {
  const day = new Date(now.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  return {
    activityId, date: `${day}T10:00:00`, meanMaximalPower, movingTimeSeconds: 3600,
    np: null, decouplingPct: null, efFirst: null, efSecond: null,
  };
}

function markup(data: Pick<CyclingAnalytics, 'powerCurve' | 'powerBlocks'>): string {
  return renderToStaticMarkup(createElement(PowerDurationChart, { data }));
}

describe('cached power block aggregation', () => {
  it('uses disjoint 30 / 60 calendar-day blocks with inclusive, deterministic boundaries', () => {
    const recentStart = ride(2, 29, { '60': 320 });
    recentStart.date = recentStart.date.slice(0, 10) + 'T00:00:00';
    const precedingEnd = ride(3, 30, { '300': 270 });
    precedingEnd.date = precedingEnd.date.slice(0, 10) + 'T23:59:59';
    const data = snapshot([
      ride(1, 0, { '5': 600 }), recentStart, precedingEnd,
      ride(4, 89, { '1200': 220 }), ride(5, 90, { '3600': 999 }),
      ride(6, -1, { '15': 999 }),
    ]);
    expect(data.powerBlocks?.asOf).toBe('2026-09-06');
    expect(Object.keys(data.powerBlocks!.recent)).toEqual(['5', '60']);
    expect(Object.keys(data.powerBlocks!.preceding)).toEqual(['300', '1200']);
    expect(data.powerCurve).toEqual({ '5': 600, '60': 320, '300': 270, '1200': 220 });
    expect(data.powerBlocks?.recent['60']).toEqual({
      watts: 320, activityId: 2, date: '2026-08-08T00:00:00',
    });
  });

  it('attributes maxima to their own block, with stable tie selection regardless of cache order', () => {
    const streams = [
      ride(5, 5, { '60': 350 }), ride(2, 5, { '60': 350 }),
      ride(3, 1, { '60': 350 }), ride(4, 31, { '60': 330, '1200': 210 }),
    ];
    const data = snapshot(streams);
    expect(data.powerBlocks?.recent['60']?.activityId).toBe(2);
    expect(data.powerBlocks?.preceding['60']?.activityId).toBe(4);
    expect(data.powerBlocks?.recent['1200']).toBeUndefined();
    expect(data.powerCurve).toEqual({ '60': 350, '1200': 210 });
    expect(snapshot([...streams].reverse()).powerBlocks).toEqual(data.powerBlocks);
  });

  it('rejects malformed observations and dates without converting missing power to zero', () => {
    const invalid = ride(2, 1, { '60': 999 });
    invalid.date = 'not-a-date';
    const impossible = { ...invalid, activityId: 3, date: '2026-06-31T10:00:00' };
    const data = snapshot([ride(1, 0, {
      '5': 0, '005': 200, '60': NaN, '300': Infinity,
      '1200': -10, '0': 999, '-1': 999, Infinity: 999, invalid: 999,
    }), invalid, impossible]);
    expect(data.powerCurve).toEqual({ '5': 200 });
    expect(data.powerBlocks?.preceding).toEqual({});
    expect(snapshot().powerCurve).toEqual({});
    expect(snapshot().powerBlocks).toEqual({ asOf: '2026-09-06', recent: {}, preceding: {} });
  });

  it('preserves a genuinely recorded zero rather than applying truthiness to watts', () => {
    const data = snapshot([ride(1, 0, { '5': 0 })]);
    expect(data.powerCurve).toEqual({ '5': 0 });
    expect(data.powerBlocks?.recent['5']?.watts).toBe(0);
  });
});

describe('measured power presentation model', () => {
  it('sorts numeric durations, canonicalizes duplicates and discards invalid observations', () => {
    expect(measuredPowerPoints({
      '1200': 210, '60': 300, '5': 500, '005': 490,
      '0': 1000, '-5': 1000, bad: 1000, Infinity: 1000, '15': NaN, '30': Infinity,
      '300': -1, '3600': 0,
    })).toEqual([
      { seconds: 5, watts: 500, source: null },
      { seconds: 60, watts: 300, source: null },
      { seconds: 1200, watts: 210, source: null },
      { seconds: 3600, watts: 0, source: null },
    ]);
  });

  it('does not construct short-window comparison or provenance from a legacy curve', () => {
    const series = powerProfileSeries({ powerCurve: { '300': 270 } });
    expect(series).toEqual([{
      id: 'all', label: 'Best power · last 90 days',
      points: [{ seconds: 300, watts: 270, source: null }],
    }]);
    expect(powerDurationLabel(300)).toBe('5min');
    expect(powerDurationLabel(15)).toBe('15s');
  });

  it('leaves holes for unmeasured sampled durations and block-specific misses', () => {
    const data = snapshot([
      ride(1, 0, { '60': 320, '1200': 220 }), ride(2, 50, { '300': 250 }),
    ]);
    const rows = powerProfilePlotRows(powerProfileSeries(data));
    expect(rows.map((row) => row.seconds)).toEqual([60, 300, 1200]);
    expect(rows[1]?.points[0]).toBeNull();
    expect(rows[1]?.points[1]?.watts).toBe(250);
    expect(rows[0]?.points[1]).toBeNull();
    expect(powerProfilePlotRows(powerProfileSeries({ powerCurve: {} }))).toEqual([]);
  });
});

describe('power profile server-rendered interface', () => {
  it('keeps the empty profile reachable while preserving FTP facts and estimated-power warnings', () => {
    const html = renderToStaticMarkup(createElement(FtpCard, { data: snapshot() }));
    const profilePosition = html.indexOf('Power-duration profile');
    expect(profilePosition).toBeGreaterThan(0);
    expect(profilePosition).toBeLessThan(html.indexOf('<details'));
    expect(html).toContain('No measured power efforts in the last 90 days');
    expect(html).toContain('recorded power');
    expect(html).toContain('Estimated — not yet established by a test');
    expect(html).toContain('No ride this week recorded real power');
    expect(html).toContain('Zone targets below use an estimated FTP');
    expect(html).toContain('Power zones &amp; reference');
    expect(html).toContain('Week TSS');
    expect(html).toContain('CTL ramp');
    expect(html).not.toContain('Inspect duration');
    expect(html).not.toContain('Measured cycling power by duration');
  });

  it('renders legacy measured points and preserves the original best-power textual reference', () => {
    const data = { ...snapshot(), powerBlocks: undefined, powerCurve: { '5': 500, '60': 300 } };
    const html = renderToStaticMarkup(createElement(FtpCard, { data }));
    expect(html).toContain('Best power · last 90 days');
    expect(html).toContain('500W');
    expect(html).toContain('300W');
    expect(html).toContain('This snapshot has no block comparison or source activity attribution');
    expect(html).toContain('Source activity unavailable in this snapshot');
    expect(html).not.toContain('Recent · last 30 days');
    expect(html.match(/<circle\b/g)).toHaveLength(2);
  });

  it('uses logarithmic duration geometry with discrete points, finite SVG and no smooth curve', () => {
    const html = markup({ powerCurve: { '5': 500, '50': 300, '500': 200 } });
    const coordinates = [...html.matchAll(/<circle[^>]*cx="([^"]+)"/g)].map((match) => Number(match[1]));
    expect(coordinates).toHaveLength(3);
    expect(coordinates[1]! - coordinates[0]!).toBeCloseTo(coordinates[2]! - coordinates[1]!);
    expect(html).not.toMatch(/NaN|Infinity/);
    for (const match of html.matchAll(/<path[^>]* d="([^"]+)"/g)) {
      expect(match[1]).not.toMatch(/[CQ]/);
    }
    expect(html).toContain('not measurements between them');
    expect(html).toContain('role="img"');
    expect(html).toContain('<title');
    expect(html).toContain('<desc');
    expect(html).toContain('viewBox="0 0 240 240"');
  });

  it('labels a native keyboard selector and announces exact watts with attributed rides', () => {
    const html = markup(snapshot([
      ride(11, 0, { '5': 550.25, '60': 320 }), ride(12, 45, { '5': 540, '1200': 210 }),
    ]));
    const selectId = html.match(/<select id="([^"]+)"/)?.[1];
    expect(selectId).toBeTruthy();
    expect(html).toContain(`<label for="${selectId}"`);
    expect(html).toContain('focus-visible:outline-2');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('550.25 W');
    expect(html).toContain('540 W');
    expect(html).toContain('https://www.strava.com/activities/11');
    expect(html).toContain('https://www.strava.com/activities/12');
    expect(html).toContain('2026-09-06');
    expect(html).toContain('Recent · last 30 days');
    expect(html).toContain('Preceding · days 31–90');
    expect(html).toContain('Disjoint blocks');
    expect(html).toContain('Unequal observation windows');
    expect(html).toContain('value="1200"');
    expect(html.match(/<circle\b/g)).toHaveLength(2);
    expect(html.match(/<rect\b/g)).toHaveLength(2);
  });

  it('never describes a missing recent duration as zero watts or a gain', () => {
    const html = markup(snapshot([ride(1, 50, { '1200': 250 })]));
    expect(html).toContain('Recent · last 30 days · no measured efforts');
    expect(html).toContain('No measured effort at this duration');
    expect(html).toContain('250 W');
    expect(html).not.toMatch(/>0 W<|improved|gain|increase/);
  });

  it('handles singleton and zero-watt observations without invalid coordinates', () => {
    for (const watts of [0, 310]) {
      const html = markup({ powerCurve: { '300': watts } });
      expect(html.match(/<circle\b/g)).toHaveLength(1);
      expect(html).toContain(`${watts} W`);
      expect(html).not.toMatch(/NaN|Infinity/);
    }
  });
});
