import { describe, expect, it, vi } from 'vitest';
import {
  MAX_GPX_BYTES, MAX_RENDER_POINTS, MAX_ROUTE_SAMPLES, MAX_ROUTE_SEGMENTS,
  buildRoute, downsampleRouteSegments, parseGpx, parseGpxDocument, projectRoute,
  routeDistanceMeters, validateRoutePoint, type GpxDocument, type GpxElement, type RoutePoint,
} from './route';

const point = (latitude = 0, longitude = 0, elevationMeters: number | null = 0): RoutePoint =>
  ({ latitude, longitude, elevationMeters });
const GPX_NAMESPACE = 'http://www.topografix.com/GPX/1/1';

// Minimal DOM fixture adapter: tests traversal, not the browser's XML grammar implementation.
function element(
  localName: string,
  attributes: Record<string, string> = {},
  children: GpxElement[] = [],
  textContent: string | null = null,
  namespaceURI: string | null = GPX_NAMESPACE,
): GpxElement {
  return {
    localName, namespaceURI, children, textContent,
    getAttribute: (name: string) => attributes[name] ?? null,
  };
}

function documentFixture(root: GpxElement, doctype = false): GpxDocument {
  const elements: GpxElement[] = [];
  const visit = (node: GpxElement) => {
    elements.push(node);
    Array.from(node.children).forEach(visit);
  };
  visit(root);
  return {
    documentElement: root, doctype: doctype ? {} : null,
    getElementsByTagName: () => ({ length: elements.length, item: (index: number) => elements[index] ?? null }),
  };
}

function gpxPoint(name = 'trkpt', latitude = '0', longitude = '0', elevation: string | null = '0'): GpxElement {
  return element(name, { lat: latitude, lon: longitude }, elevation === null ? [] : [element('ele', {}, [], elevation)]);
}

describe('GPX point validation', () => {
  it('accepts boundary coordinates, negative elevation, whitespace and real zeroes', () => {
    expect(validateRoutePoint({ latitude: ' -90 ', longitude: '+180', elevation: '-12.75' }))
      .toEqual(point(-90, 180, -12.75));
    expect(validateRoutePoint({ latitude: '0', longitude: '0', elevation: '0' })).toEqual(point());
    expect(validateRoutePoint({ latitude: '90', longitude: '-180', elevation: '100000' }))
      .toEqual(point(90, -180, 100000));
  });

  it.each([null, '', ' ', 'NaN', 'Infinity', '-Infinity', '0x10', '1e999', '91', '-90.01', '2 degrees'])(
    'rejects invalid latitude %s rather than dropping a point and joining across it', (latitude) => {
      expect(() => validateRoutePoint({ latitude, longitude: '0', elevation: '0' })).toThrow(/latitude/);
    },
  );

  it.each([null, '', 'Infinity', '181', '-180.01'])('rejects invalid longitude %s', (longitude) => {
    expect(() => validateRoutePoint({ latitude: '0', longitude, elevation: '0' })).toThrow(/longitude/);
  });

  it.each([null, '', ' ', 'NaN', 'Infinity', '1e999', 'unknown', '-12001', '100001'])(
    'keeps missing/unusable elevation %s unknown', (elevation) => {
      expect(validateRoutePoint({ latitude: '0', longitude: '0', elevation }).elevationMeters).toBeNull();
    },
  );
});

describe('GPX document constraints', () => {
  it('preserves track segments and separate routes in source order, ignoring standalone waypoints', () => {
    const document = documentFixture(element('gpx', {}, [
      gpxPoint('wpt', '40', '50', '1000'),
      element('trk', {}, [
        element('trkseg', {}, [gpxPoint(), gpxPoint('trkpt', '0', '0.001', '10')]),
        element('trkseg', {}, [gpxPoint('trkpt', '1', '1', null)]),
      ]),
      element('rte', {}, [gpxPoint('rtept', '2', '2', '-3'), gpxPoint('rtept', '2', '2.001', '0')]),
    ]));
    const route = parseGpxDocument(document);
    expect(route.segments.map((segment) => segment.length)).toEqual([2, 1, 2]);
    expect(route.samples.map((sample) => sample.sourceIndex)).toEqual([1, 2, 3, 4, 5]);
    expect(route.samples.map((sample) => sample.segmentIndex)).toEqual([1, 1, 2, 3, 3]);
    expect(route.stats.unavailableElevations).toBe(1);
    expect(route.stats.ascentMeters).toBe(13);
    expect(route.stats.distanceMeters).toBeLessThan(225);
  });

  it.each([null, 'http://www.topografix.com/GPX/1/0', GPX_NAMESPACE])(
    'supports consistently namespaced or legacy unnamespaced GPX (%s)', (namespace) => {
      const sample = element('trkpt', { lat: '0', lon: '0' }, [], null, namespace);
      const segment = element('trkseg', {}, [sample, sample], null, namespace);
      const track = element('trk', {}, [segment], null, namespace);
      expect(parseGpxDocument(documentFixture(element('gpx', {}, [track], null, namespace))).samples).toHaveLength(2);
    },
  );

  it('does not mistake extension tags for elevations or route points', () => {
    const sample = element('trkpt', { lat: '0', lon: '0' }, [
      element('ele', {}, [], '99', 'urn:extension'),
      element('extensions', {}, [element('ele', {}, [], '42')]),
    ]);
    const route = parseGpxDocument(documentFixture(element('gpx', {}, [
      element('trk', {}, [element('trkseg', {}, [sample, gpxPoint()])]),
      element('rte', {}, [gpxPoint('rtept')], null, 'urn:extension'),
    ])));
    expect(route.samples).toHaveLength(2);
    expect(route.samples[0]!.elevationMeters).toBeNull();
  });

  it('rejects duplicate elevation values instead of picking one silently', () => {
    const sample = element('trkpt', { lat: '0', lon: '0' }, [element('ele'), element('ele')]);
    expect(() => parseGpxDocument(documentFixture(element('gpx', {}, [
      element('trk', {}, [element('trkseg', {}, [sample, gpxPoint()])]),
    ])))).toThrow(/more than one elevation/);
  });

  it('does not coerce nested markup into a recorded elevation value', () => {
    const sample = element('trkpt', { lat: '0', lon: '0' }, [
      element('ele', {}, [element('value', {}, [], '40')], '40'),
    ]);
    const route = parseGpxDocument(documentFixture(element('gpx', {}, [
      element('trk', {}, [element('trkseg', {}, [sample, gpxPoint()])]),
    ])));
    expect(route.samples[0]!.elevationMeters).toBeNull();
  });

  it('rejects parser-error documents, non-GPX roots, unsupported namespaces and DOCTYPE documents', () => {
    expect(() => parseGpx('<broken', () => documentFixture(element('parsererror')))).toThrow(/malformed/);
    expect(() => parseGpxDocument(documentFixture(element('gpx', {}, [element('parsererror')])))).toThrow(/malformed/);
    expect(() => parseGpxDocument(documentFixture(element('html')))).toThrow(/gpx root/);
    expect(() => parseGpxDocument(documentFixture(element('gpx', {}, [], null, 'urn:wrong')))).toThrow(/gpx root/);
    expect(() => parseGpxDocument(documentFixture(element('gpx'), true))).toThrow(/DOCTYPE/);
  });

  it.each(['<!DOCTYPE gpx SYSTEM "https://invalid.example/gpx.dtd"><gpx/>', '<!doctype gpx []>', '<!ENTITY route "value">'])(
    'rejects declaration text before an XML parser can process it', (text) => {
      const parser = vi.fn();
      expect(() => parseGpx(text, parser)).toThrow(/declarations/);
      expect(parser).not.toHaveBeenCalled();
    },
  );

  it('limits both text length and UTF-8 byte size before parsing', () => {
    const parser = vi.fn();
    expect(() => parseGpx('x'.repeat(MAX_GPX_BYTES + 1), parser)).toThrow(/5 MiB/);
    expect(() => parseGpx('é'.repeat(MAX_GPX_BYTES / 2 + 1), parser)).toThrow(/5 MiB/);
    expect(parser).not.toHaveBeenCalled();
  });

  it('counts ignored point elements toward the source sample bound', () => {
    const samples = Array.from({ length: MAX_ROUTE_SAMPLES + 1 }, () => gpxPoint('wpt'));
    expect(() => parseGpxDocument(documentFixture(element('gpx', {}, samples)))).toThrow(/sample limit/);
  });

  it('bounds even empty GPX segment containers', () => {
    const segments = Array.from({ length: MAX_ROUTE_SEGMENTS + 1 }, () => element('trkseg'));
    expect(() => parseGpxDocument(documentFixture(element('gpx', {}, [element('trk', {}, segments)]))))
      .toThrow(/segment limit/);
  });
});

describe('worker-compatible XML parser', () => {
  const samples = '<trkpt lat="0" lon="0"><ele>0</ele></trkpt><trkpt lat="0" lon="0.001"><ele>1</ele></trkpt>';
  const xml = `<gpx><trk><trkseg>${samples}</trkseg></trk></gpx>`;

  it.each(['', 'http://www.topografix.com/GPX/1/0', GPX_NAMESPACE])(
    'parses actual XML without a browser DOMParser (%s)', (namespace) => {
      expect(typeof globalThis.DOMParser).toBe('undefined');
      const route = parseGpx(xml.replace('<gpx>', `<gpx xmlns="${namespace}">`));
      expect(route.samples).toHaveLength(2);
      expect(route.stats.ascentMeters).toBe(1);
      expect(route.stats.distanceMeters).toBeCloseTo(111.195, 3);
    },
  );

  it('handles prefixed GPX, source ordering, segment gaps and unknown elevations', () => {
    const route = parseGpx(`<?xml version="1.0"?>
      <g:gpx xmlns:g="${GPX_NAMESPACE}" xmlns:ext="urn:extension">
        <g:wpt lat="5" lon="5"><g:ele>9000</g:ele></g:wpt>
        <g:trk>
          <g:trkseg>
            <g:trkpt lat="0" lon="179.999"><g:ele>-5</g:ele></g:trkpt>
            <g:trkpt lat="0" lon="-179.999"><g:ele>0</g:ele></g:trkpt>
          </g:trkseg>
          <g:trkseg>
            <g:trkpt lat="0" lon="180"><ext:ele>500</ext:ele></g:trkpt>
          </g:trkseg>
        </g:trk>
        <g:rte>
          <g:rtept lat="0" lon="-180"><g:ele>100</g:ele></g:rtept>
          <g:rtept lat="0" lon="-180"><g:ele><ext:value>0</ext:value></g:ele></g:rtept>
        </g:rte>
      </g:gpx>`);
    expect(route.segments.map((segment) => segment.length)).toEqual([2, 1, 2]);
    expect(route.samples.map((sample) => sample.sourceIndex)).toEqual([1, 2, 3, 4, 5]);
    expect(route.samples.map((sample) => sample.elevationMeters)).toEqual([-5, 0, null, 100, null]);
    expect(route.stats).toMatchObject({ ascentMeters: 5, descentMeters: 0, unavailableElevations: 2, elevationEdges: 1 });
    expect(route.stats.distanceMeters).toBeCloseTo(222.39, 2);
    const projection = projectRoute(route);
    expect(projection.sceneSegments).toBeNull();
    expect(projection.points[0]!.x).toBeCloseTo(-2);
    expect(projection.points[1]!.x).toBeCloseTo(2);
  });

  it.each([
    '<gpx><trk></gpx>',
    '<gpx><trk>',
    '<gpx',
    `${xml}<gpx/>`,
    `text${xml}`,
    `${xml}text`,
    xml.replace('lat="0"', 'lat=0'),
    xml.replace('lat="0"', 'lat'),
    xml.replace('lat="0"', 'lat="0" lat="1"'),
    xml.replace('<gpx>', '<gpx unclosed="value>'),
    xml.replace('<gpx>', '<gpx attr="&unknown;">'),
    xml.replace('<gpx>', '<gpx><!-- invalid -- comment -->'),
    xml.replace('<gpx>', '<gpx><unbound:extension/>'),
    xml.replace('<gpx>', '<gpx><extensions>&#0;</extensions>'),
    xml.replace('<gpx>', '<gpx><extensions>&#xD800;</extensions>'),
    xml.replace('<gpx>', '<gpx><extensions>&#x110000;</extensions>'),
    xml.replace('<gpx>', '<gpx><extensions>&#65535;</extensions>'),
    xml.replace('<gpx>', '<gpx><extensions>&</extensions>'),
    xml.replace('<gpx>', '<gpx><extensions>&bad</extensions>'),
    xml.replace('<gpx>', '<gpx><extensions>]]></extensions>'),
    xml.replace('<gpx>', '<gpx><extensions>\u0001</extensions>'),
    xml.replace('<gpx>', '<gpx><extensions>\uD800</extensions>'),
    xml.replace('</gpx>', '<![CDATA[unclosed</gpx>'),
  ])('rejects malformed or recovered XML: %s', (source) => {
    const logging = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => parseGpx(source)).toThrow(/malformed/);
      expect(logging).not.toHaveBeenCalled();
    } finally {
      logging.mockRestore();
    }
  });

  it('allows escaped characters, Unicode, comments and CDATA without treating them as markup', () => {
    const route = parseGpx(xml.replace('<gpx>', `<gpx note="]]> &amp; &#x1f680;">
      <metadata><name>Trail 🚀 &amp; &#65;</name></metadata>
      <!-- & &#0; ]] > -->
      <?processing & &#0; ]] > ?>
      <extensions><![CDATA[& &#0; <fake/>]]></extensions>`));
    expect(route.samples).toHaveLength(2);
  });

  it.each([
    '<!DOCTYPE gpx SYSTEM "https://invalid.example/gpx.dtd">',
    '<!DOCTYPE gpx [<!ENTITY route "value">]>',
    '<!ENTITY route "value">',
  ])('rejects declarations with the real parser: %s', (declaration) => {
    expect(() => parseGpx(`${declaration}${xml}`)).toThrow(/declarations/);
  });

  it('checks root and duplicate elevations with parsed XML', () => {
    expect(() => parseGpx(xml.replaceAll('gpx', 'html'))).toThrow(/gpx root/);
    expect(() => parseGpx(xml.replace('<gpx>', '<gpx xmlns="urn:wrong">'))).toThrow(/gpx root/);
    expect(() => parseGpx(xml.replace('<ele>0</ele>', '<ele>0</ele><ele>1</ele>'))).toThrow(/more than one elevation/);
  });

  it('bounds ignored source points and empty segments in actual XML', () => {
    expect(() => parseGpx(`<gpx>${'<wpt/>'.repeat(MAX_ROUTE_SAMPLES + 1)}</gpx>`)).toThrow(/sample limit/);
    expect(() => parseGpx(`<gpx><trk>${'<trkseg/>'.repeat(MAX_ROUTE_SEGMENTS + 1)}</trk></gpx>`)).toThrow(/segment limit/);
  });
});

describe('full-source route statistics and render sampling', () => {
  it('never bridges track/route boundaries in distance, ascent, descent or profiles', () => {
    const route = buildRoute([
      [point(0, 0, 10), point(0, 0.001, 30)],
      [point(40, 40, 1000), point(40, 40.001, 990)],
    ]);
    expect(route.stats.distanceMeters).toBeCloseTo(routeDistanceMeters(point(), point(0, 0.001))
      + routeDistanceMeters(point(40, 40), point(40, 40.001)));
    expect(route.stats.ascentMeters).toBe(20);
    expect(route.stats.descentMeters).toBe(10);
    expect(route.samples[2]!.distanceMeters).toBe(route.samples[1]!.distanceMeters);
    expect(route.samples[2]!.segmentSampleIndex).toBe(1);
    expect(route.profileSegments!.map((segment) => segment.length)).toEqual([2, 2]);
  });

  it('does not fill missing elevations or sum across them', () => {
    const route = buildRoute([[point(0, 0, 0), point(0, 0.001, null), point(0, 0.002, 100), point(0, 0.003, 99.5)]]);
    expect(route.stats).toMatchObject({
      ascentMeters: 0, descentMeters: 0.5, unavailableElevations: 1, minElevationMeters: 0,
      maxElevationMeters: 100, elevationEdges: 1,
    });
    expect(route.profileSegments!.map((segment) => segment.map((sample) => sample.sourceIndex))).toEqual([[1], [3, 4]]);
    const projected = projectRoute(route);
    expect(projected.sceneSegments).toBeNull();
    expect(projected.points[1]!.y).toBeNull();
  });

  it('reports entirely absent elevation without fabricating a flat 3D route', () => {
    const route = buildRoute([[point(0, 0, null), point(0, 0.001, null)]]);
    expect(route.stats.minElevationMeters).toBeNull();
    expect(route.stats.maxElevationMeters).toBeNull();
    expect(route.stats.elevationEdges).toBe(0);
    expect(route.profileSegments).toEqual([]);
    expect(projectRoute(route).sceneSegments).toBeNull();
  });

  it('retains original samples and computes noisy ascent from all points, before downsampling', () => {
    const original = Array.from({ length: 8_001 }, (_, index) => point(0, index / 100_000, index % 2));
    const before = structuredClone(original);
    const route = buildRoute([original]);
    expect(route.samples).toHaveLength(8_001);
    expect(route.renderSegments[0]).toHaveLength(MAX_RENDER_POINTS);
    expect(route.renderSegments[0]![0]).toBe(route.samples[0]);
    expect(route.renderSegments[0]!.at(-1)).toBe(route.samples.at(-1));
    expect(route.stats.ascentMeters).toBe(4_000);
    expect(route.stats.descentMeters).toBe(4_000);
    expect(route.stats.distanceMeters).toBeCloseTo(routeDistanceMeters(original[0]!, original.at(-1)!), 6);
    expect(original).toEqual(before);
  });

  it('preserves single-point segments and endpoint order within a global budget', () => {
    const segments = [[0], [10, 11, 12, 13, 14], [20, 21, 22, 23]];
    const sampled = downsampleRouteSegments(segments, 7);
    expect(sampled.flat()).toHaveLength(7);
    expect(sampled.map((segment) => [segment[0], segment.at(-1)])).toEqual([[0, 0], [10, 14], [20, 23]]);
    expect(sampled.flat().length).toBe(new Set(sampled.flat()).size);
    expect(downsampleRouteSegments([[], [1], []])).toEqual([[1]]);
    expect(() => downsampleRouteSegments(segments, 4)).toThrow(/preserve/);
    expect(() => downsampleRouteSegments(segments, NaN)).toThrow(/budget/);
  });

  it('omits an over-budget fragmented profile instead of drawing false connections', () => {
    const points = Array.from({ length: 4_003 }, (_, index) => point(0, index / 100_000, index % 2 ? null : 0));
    const route = buildRoute([points]);
    expect(route.profileSegments).toBeNull();
    expect(route.renderSegments.flat()).toHaveLength(MAX_RENDER_POINTS);
    expect(route.stats.elevationEdges).toBe(0);
  });

  it('rejects oversized and unusable source inputs', () => {
    expect(() => buildRoute([Array.from({ length: MAX_ROUTE_SAMPLES + 1 }, () => point())])).toThrow(/sample limit/);
    expect(() => buildRoute(Array.from({ length: MAX_ROUTE_SEGMENTS + 1 }, () => [point()]))).toThrow(/segment limit/);
    expect(() => buildRoute([[point()]])).toThrow(/at least two/);
    expect(() => buildRoute([[point(), point(NaN)]])).toThrow(/coordinates/);
  });
});

describe('metric route projection', () => {
  it.each([-179.982, -179.948, -179.914, -0.001, 0.001, 33.0123])(
    'keeps the circular cut exact for western/eastern longitude %s', (longitude) => {
      const route = buildRoute([[point(0, longitude), point(0, longitude + 0.001)]]);
      const projection = projectRoute(route);
      expect(projection.metersPerUnit * 4).toBeCloseTo(route.stats.distanceMeters, 6);
      expect(projection.points[0]!.x).toBeCloseTo(-2);
      expect(projection.points[1]!.x).toBeCloseTo(2);
    },
  );

  it('projects nearby dateline samples together, including separate segments', () => {
    const route = buildRoute([[point(0, 179.999, 2), point(0, -179.999, 3)], [point(0, 180, 2), point(0, -180, 3)]]);
    expect(route.stats.distanceMeters).toBeCloseTo(222.39, 2);
    const projection = projectRoute(route);
    expect(projection.metersPerUnit).toBeCloseTo(222.39 / 4, 2);
    expect(projection.points[0]!.x).toBeCloseTo(-2);
    expect(projection.points[1]!.x).toBeCloseTo(2);
    expect(projection.points[2]!.x).toBeCloseTo(projection.points[3]!.x);
    expect(projection.sceneSegments).toHaveLength(2);
  });

  it('uses one metre-to-scene factor for horizontal movement and true elevation', () => {
    const route = buildRoute([[point(0, 0, 0), point(0, 0.001, 100)]]);
    const projected = projectRoute(route);
    const [first, last] = projected.points;
    expect((last!.x - first!.x) * projected.metersPerUnit).toBeCloseTo(route.stats.distanceMeters, 5);
    expect((last!.y! - first!.y!) * projected.metersPerUnit).toBeCloseTo(100, 8);
    expect(first!.x + last!.x).toBeCloseTo(0);
    expect(first!.y! + last!.y!).toBeCloseTo(0);
  });

  it('uses the same factor for northing and easting at the reference latitude', () => {
    const route = buildRoute([[point(0, 0, -10), point(0.001, 0.001, 30)]]);
    const projection = projectRoute(route);
    const [a, b] = projection.points;
    expect((a!.z - b!.z) * projection.metersPerUnit).toBeCloseTo(routeDistanceMeters(point(), point(0.001)), 6);
    expect((b!.y! - a!.y!) * projection.metersPerUnit).toBeCloseTo(40, 8);
  });

  it.each([
    [point(), point()],
    [point(90, -180, -5), point(90, 180, -5)],
    [point(90, 0, 0), point(90, 150, 0)],
    [point(-90, 179.999, 3), point(-89.999, -179.999, 3)],
    [point(0, 0, -12000), point(0, 0, 100000)],
  ])('keeps repeated, polar and elevation-only samples finite and centered', (a, b) => {
    const projection = projectRoute(buildRoute([[a, b]]));
    expect(Number.isFinite(projection.metersPerUnit)).toBe(true);
    for (const position of projection.points) {
      for (const coordinate of [position.x, position.y!, position.z]) {
        expect(Number.isFinite(coordinate)).toBe(true);
        expect(Math.abs(coordinate)).toBeLessThanOrEqual(2.000001);
      }
    }
  });

  it('collapses identical positions at an exact pole regardless of longitude', () => {
    const projection = projectRoute(buildRoute([[point(90, 0), point(90, 150)]]));
    expect(projection.points[0]!.x).toBeCloseTo(projection.points[1]!.x, 12);
    expect(projection.points[0]!.z).toBeCloseTo(projection.points[1]!.z, 12);
  });

  it('retains positions for source samples omitted from the reduced 3D line', () => {
    const route = buildRoute([Array.from({ length: 5_001 }, (_, index) => point(0, index / 100_000, index / 10))]);
    const projection = projectRoute(route);
    expect(projection.points).toHaveLength(5_001);
    expect(projection.sceneSegments![0]).toHaveLength(MAX_RENDER_POINTS);
    expect(projection.points[3]!.y).toBeCloseTo((0.3 - 250) / projection.metersPerUnit);
  });
});
