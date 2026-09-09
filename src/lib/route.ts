import { DOMParser, onWarningStopParsing } from '@xmldom/xmldom';
import type { RouteScenePoint } from './threeScene';
import { MAX_GPX_BYTES, MAX_ROUTE_SAMPLES, MAX_ROUTE_SEGMENTS, MAX_RENDER_POINTS } from './routeLimits';

export { MAX_GPX_BYTES, MAX_ROUTE_SAMPLES, MAX_ROUTE_SEGMENTS, MAX_RENDER_POINTS } from './routeLimits';
const EARTH_RADIUS_METERS = 6_371_008.8;
const RADIANS = Math.PI / 180;
const GPX_NAMESPACES = new Set(['', 'http://www.topografix.com/GPX/1/0', 'http://www.topografix.com/GPX/1/1']);
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export interface RoutePoint {
  latitude: number;
  longitude: number;
  elevationMeters: number | null;
}

export interface RouteSample extends RoutePoint {
  /** One-based original point order, including samples omitted from rendering. */
  sourceIndex: number;
  segmentIndex: number;
  segmentSampleIndex: number;
  distanceMeters: number;
}

export interface RouteData {
  samples: RouteSample[];
  segments: RouteSample[][];
  renderSegments: RouteSample[][];
  /** Null means the elevation gaps exceed the safe render budget. */
  profileSegments: RouteSample[][] | null;
  stats: {
    distanceMeters: number;
    ascentMeters: number;
    descentMeters: number;
    minElevationMeters: number | null;
    maxElevationMeters: number | null;
    unavailableElevations: number;
    elevationEdges: number;
  };
}

export interface RouteProjection {
  points: Array<{ x: number; y: number | null; z: number }>;
  sceneSegments: RouteScenePoint[][] | null;
  metersPerUnit: number;
}

/** The shared read-only XML surface implemented by browser DOM and xmldom. */
export interface GpxElement {
  readonly localName: string | null;
  readonly namespaceURI: string | null;
  readonly children: ArrayLike<GpxElement>;
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
}

export interface GpxDocument {
  readonly doctype: unknown;
  readonly documentElement: GpxElement | null;
  getElementsByTagName(name: string): {
    readonly length: number;
    item(index: number): GpxElement | null;
  };
}

function decimal(value: string | null): number | null {
  const text = value?.trim();
  if (!text || !DECIMAL.test(text)) return null;
  const result = Number(text);
  return Number.isFinite(result) ? result : null;
}

function usableElevation(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= -12_000 && value <= 100_000;
}

function validCoordinates(point: RoutePoint): boolean {
  return Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}

/** Invalid coordinates reject the import; missing/unusable elevation remains unknown. */
export function validateRoutePoint(raw: {
  latitude: string | null;
  longitude: string | null;
  elevation: string | null;
}): RoutePoint {
  const latitude = decimal(raw.latitude);
  const longitude = decimal(raw.longitude);
  if (latitude === null || longitude === null || !validCoordinates({ latitude, longitude, elevationMeters: null })) {
    throw new Error('Every route sample needs finite latitude (−90 to 90) and longitude (−180 to 180).');
  }
  const elevation = decimal(raw.elevation);
  return { latitude, longitude, elevationMeters: usableElevation(elevation) ? elevation : null };
}

/** Great-circle surface distance, taking the short path across the dateline. */
export function routeDistanceMeters(a: RoutePoint, b: RoutePoint): number {
  const dLat = (b.latitude - a.latitude) * RADIANS;
  let longitudeDelta = b.longitude - a.longitude;
  if (longitudeDelta > 180) longitudeDelta -= 360;
  if (longitudeDelta < -180) longitudeDelta += 360;
  const dLon = longitudeDelta * RADIANS;
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(a.latitude * RADIANS) * Math.cos(b.latitude * RADIANS) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.max(0, Math.min(1, haversine))));
}

/** Uniform source-index sampling retains every segment and both of its endpoints. */
export function downsampleRouteSegments<T>(segments: readonly (readonly T[])[], budget = MAX_RENDER_POINTS): T[][] {
  if (!Number.isInteger(budget) || budget < 1 || budget > MAX_RENDER_POINTS) {
    throw new Error(`Render budget must be between 1 and ${MAX_RENDER_POINTS}.`);
  }
  const nonempty = segments.filter((segment) => segment.length > 0);
  const required = nonempty.reduce((sum, segment) => sum + Math.min(2, segment.length), 0);
  if (required > budget) throw new Error('Too many separate segments to preserve within the render limit.');
  const interiors = nonempty.reduce((sum, segment) => sum + Math.max(0, segment.length - 2), 0);
  const remaining = Math.min(budget - required, interiors);
  let seenInteriors = 0;
  let allocated = 0;
  return nonempty.map((segment) => {
    seenInteriors += Math.max(0, segment.length - 2);
    const cumulative = interiors ? Math.floor(seenInteriors * remaining / interiors) : 0;
    const count = Math.min(2, segment.length) + cumulative - allocated;
    allocated = cumulative;
    if (count === 1) return [segment[0]!];
    return Array.from({ length: count }, (_, index) =>
      segment[Math.round(index * (segment.length - 1) / (count - 1))]!);
  });
}

/** Builds full-resolution statistics first; neither distance nor elevation bridges gaps. */
export function buildRoute(sourceSegments: readonly (readonly RoutePoint[])[]): RouteData {
  if (sourceSegments.length > MAX_ROUTE_SEGMENTS) {
    throw new Error(`GPX exceeds the ${MAX_ROUTE_SEGMENTS}-segment limit.`);
  }
  const count = sourceSegments.reduce((sum, segment) => sum + segment.length, 0);
  if (count > MAX_ROUTE_SAMPLES) throw new Error(`GPX exceeds the ${MAX_ROUTE_SAMPLES.toLocaleString('en-US')}-sample limit.`);
  if (count < 2) throw new Error('Include at least two track or route samples in the GPX.');
  const samples: RouteSample[] = [];
  const segments: RouteSample[][] = [];
  const elevationRuns: RouteSample[][] = [];
  const stats: RouteData['stats'] = {
    distanceMeters: 0, ascentMeters: 0, descentMeters: 0,
    minElevationMeters: null, maxElevationMeters: null, unavailableElevations: 0, elevationEdges: 0,
  };
  sourceSegments.forEach((source, segmentIndex) => {
    const segment: RouteSample[] = [];
    let elevationRun: RouteSample[] = [];
    source.forEach((point, segmentSampleIndex) => {
      if (!validCoordinates(point)) throw new Error('The GPX contains invalid route coordinates.');
      const elevationMeters = usableElevation(point.elevationMeters) ? point.elevationMeters : null;
      const previous = segment.at(-1);
      if (previous) stats.distanceMeters += routeDistanceMeters(previous, point);
      if (elevationMeters === null) {
        stats.unavailableElevations++;
        elevationRun = [];
      } else {
        stats.minElevationMeters = Math.min(stats.minElevationMeters ?? elevationMeters, elevationMeters);
        stats.maxElevationMeters = Math.max(stats.maxElevationMeters ?? elevationMeters, elevationMeters);
        if (previous && previous.elevationMeters !== null) {
          const change = elevationMeters - previous.elevationMeters;
          stats.ascentMeters += Math.max(0, change);
          stats.descentMeters += Math.max(0, -change);
          stats.elevationEdges++;
        }
      }
      const sample: RouteSample = {
        ...point, elevationMeters, sourceIndex: samples.length + 1,
        segmentIndex: segmentIndex + 1, segmentSampleIndex: segmentSampleIndex + 1,
        distanceMeters: stats.distanceMeters,
      };
      samples.push(sample);
      segment.push(sample);
      if (elevationMeters !== null) {
        if (!elevationRun.length) elevationRuns.push(elevationRun);
        elevationRun.push(sample);
      }
    });
    if (segment.length) segments.push(segment);
  });
  const profileEndpoints = elevationRuns.reduce((sum, run) => sum + Math.min(2, run.length), 0);
  return {
    samples, segments, stats,
    renderSegments: downsampleRouteSegments(segments),
    profileSegments: profileEndpoints > MAX_RENDER_POINTS ? null : downsampleRouteSegments(elevationRuns),
  };
}

/** Reads only direct GPX track segments/routes, not extension or waypoint lookalikes. */
export function parseGpxDocument(document: GpxDocument): RouteData {
  if (document.doctype) throw new Error('DOCTYPE declarations are not allowed in GPX imports.');
  const root = document.documentElement;
  if (!root || root.localName !== 'gpx' || !GPX_NAMESPACES.has(root.namespaceURI ?? '')) {
    throw new Error('Choose a valid GPX document with a gpx root element.');
  }
  const elements = document.getElementsByTagName('*');
  let pointCount = 0;
  for (let index = 0; index < elements.length; index++) {
    const element = elements.item(index)!;
    if (element.localName === 'parsererror') throw new Error('The GPX XML is malformed.');
    if (['trkpt', 'rtept', 'wpt'].includes(element.localName ?? '') && ++pointCount > MAX_ROUTE_SAMPLES) {
      throw new Error(`GPX exceeds the ${MAX_ROUTE_SAMPLES.toLocaleString('en-US')}-sample limit.`);
    }
  }
  const matches = (element: GpxElement, name: string) =>
    element.localName === name && element.namespaceURI === root.namespaceURI;
  const segments: RoutePoint[][] = [];
  const readSegment = (container: GpxElement, pointName: string) => {
    if (segments.length >= MAX_ROUTE_SEGMENTS) throw new Error(`GPX exceeds the ${MAX_ROUTE_SEGMENTS}-segment limit.`);
    const points: RoutePoint[] = [];
    for (const element of Array.from(container.children)) {
      if (!matches(element, pointName)) continue;
      const elevation = Array.from(element.children).filter((child) => matches(child, 'ele'));
      if (elevation.length > 1) throw new Error('A GPX sample has more than one elevation value.');
      points.push(validateRoutePoint({
        latitude: element.getAttribute('lat'), longitude: element.getAttribute('lon'),
        elevation: elevation[0]?.children.length ? null : elevation[0]?.textContent ?? null,
      }));
    }
    segments.push(points);
  };
  for (const element of Array.from(root.children)) {
    if (matches(element, 'trk')) {
      for (const segment of Array.from(element.children)) {
        if (matches(segment, 'trkseg')) readSegment(segment, 'trkpt');
      }
    } else if (matches(element, 'rte')) {
      readSegment(element, 'rtept');
    }
  }
  return buildRoute(segments);
}

function parseXml(source: string): GpxDocument {
  try {
    // xmldom does not diagnose invalid XML characters, bare ampersands or "]]>" in character data.
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u.test(source)) throw new Error();
    const markup = source.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, ' ');
    if (/&(?!(?:amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+);)/.test(markup)) throw new Error();
    for (const match of markup.matchAll(/&#(x[\da-fA-F]+|\d+);/g)) {
      const value = match[1]!;
      const code = value.startsWith('x') ? Number.parseInt(value.slice(1), 16) : Number(value);
      if (!(code === 9 || code === 10 || code === 13
        || (code >= 0x20 && code <= 0xD7FF) || (code >= 0xE000 && code <= 0xFFFD)
        || (code >= 0x10000 && code <= 0x10FFFF))) throw new Error();
    }
    const characterData = markup.replace(/<(?:"[^"]*"|'[^']*'|[^'">])*>/g, ' ');
    if (characterData.includes(']]>')) throw new Error();
    // Warnings can represent recovered malformed XML: reject every diagnostic, without logging source data.
    return new DOMParser({ onError: onWarningStopParsing, locator: false }).parseFromString(source, 'application/xml');
  } catch {
    throw new Error('The GPX XML is malformed.');
  }
}

/** Preflight runs before worker-compatible XML parsing; no XML or route data leaves memory. */
export function parseGpx(
  text: string,
  parseDocument: (source: string) => GpxDocument = parseXml,
): RouteData {
  if (text.length > MAX_GPX_BYTES || new TextEncoder().encode(text).byteLength > MAX_GPX_BYTES) {
    throw new Error('GPX files must be 5 MiB or smaller.');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DOCTYPE and entity declarations are not allowed in GPX imports.');
  const document = parseDocument(text);
  if (document.documentElement?.localName === 'parsererror') throw new Error('The GPX XML is malformed.');
  return parseGpxDocument(document);
}

/** Local equirectangular metres, centered and scaled uniformly on all three axes. */
export function projectRoute(route: RouteData): RouteProjection {
  const longitudes = route.samples.map((point) => point.longitude < 0 ? point.longitude + 360 : point.longitude)
    .sort((a, b) => a - b);
  // Cut the longitude circle at its largest empty arc, not necessarily at ±180°.
  let gap = -1;
  let west = longitudes[0]!;
  for (let index = 0; index < longitudes.length; index++) {
    const nextIndex = (index + 1) % longitudes.length;
    const next = longitudes[nextIndex]! + (nextIndex === 0 ? 360 : 0);
    if (next - longitudes[index]! > gap) {
      gap = next - longitudes[index]!;
      west = longitudes[nextIndex]!;
    }
  }
  const longitudeCenter = west + (360 - gap) / 2;
  let south = Infinity;
  let north = -Infinity;
  for (const point of route.samples) {
    south = Math.min(south, point.latitude);
    north = Math.max(north, point.latitude);
  }
  const latitudeCenter = (south + north) / 2;
  const eastScale = Math.abs(latitudeCenter) === 90 ? 0
    : EARTH_RADIUS_METERS * RADIANS * Math.cos(latitudeCenter * RADIANS);
  const northScale = EARTH_RADIUS_METERS * RADIANS;
  const low = route.stats.minElevationMeters;
  const high = route.stats.maxElevationMeters;
  const elevationCenter = low === null || high === null ? 0 : (low + high) / 2;
  const span = Math.max((360 - gap) * eastScale, (north - south) * northScale, (high ?? 0) - (low ?? 0), 1);
  const metersPerUnit = span / 4;
  const points = route.samples.map((point) => {
    const longitude = point.longitude < 0 ? point.longitude + 360 : point.longitude;
    return {
      x: ((longitude < west ? longitude + 360 : longitude) - longitudeCenter) * eastScale / metersPerUnit,
      y: point.elevationMeters === null ? null : (point.elevationMeters - elevationCenter) / metersPerUnit,
      z: -(point.latitude - latitudeCenter) * northScale / metersPerUnit,
    };
  });
  return {
    points, metersPerUnit,
    sceneSegments: route.stats.unavailableElevations ? null : route.renderSegments.map((segment) =>
      segment.map((sample) => {
        const point = points[sample.sourceIndex - 1]!;
        return { x: point.x, y: point.y!, z: point.z };
      })),
  };
}
