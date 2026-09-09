import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { MAX_GPX_BYTES } from '../../lib/routeLimits';
import type { GpxImportResult, GpxWorkerRequest, GpxWorkerResponse } from '../../lib/gpxWorkerProtocol';
import { Card } from '../shared/Card';
import { ThreeView } from '../shared/ThreeView';
import { RoutePlan, RouteProfile } from './RouteCharts';

/** Browser-memory GPX exploration, with no persistence, uploads or map requests. */
export function RouteExplorer() {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const worker = useRef<Worker | null>(null);
  const [imported, setImported] = useState<GpxImportResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const route = imported?.route;
  const projection = imported?.projection;
  const selected = route?.samples[selectedIndex];
  const selectedPosition = projection?.points[selectedIndex];
  const scene = useMemo(() => projection?.sceneSegments && selectedPosition?.y !== null && selectedPosition
    ? {
      kind: 'route' as const,
      segments: projection.sceneSegments,
      selectedPoint: { x: selectedPosition.x, y: selectedPosition.y, z: selectedPosition.z },
    } : null, [projection, selectedPosition]);

  function stopWorker() {
    if (!worker.current) return;
    worker.current.onmessage = null;
    worker.current.onerror = null;
    worker.current.onmessageerror = null;
    worker.current.terminate();
    worker.current = null;
  }

  useEffect(() => () => {
    request.current++;
    stopWorker();
  }, []);

  function clearRoute() {
    request.current++;
    stopWorker();
    setImported(null);
    setSelectedIndex(0);
    setLoading(false);
    setError(null);
    if (input.current) input.current.value = '';
  }

  function importRoute(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const currentRequest = ++request.current;
    stopWorker();
    setImported(null);
    setSelectedIndex(0);
    setError(null);
    setLoading(true);
    const fail = (message: string) => {
      if (currentRequest !== request.current) return;
      request.current++;
      stopWorker();
      setError(message);
      setLoading(false);
    };
    try {
      if (file.size > MAX_GPX_BYTES) throw new Error('GPX files must be 5 MiB or smaller.');
      if (typeof Worker === 'undefined') {
        throw new Error('Local GPX import requires Web Worker support. Try a browser that supports Web Workers.');
      }
      const activeWorker = new Worker(new URL('../../lib/gpx.worker.ts', import.meta.url), { type: 'module' });
      worker.current = activeWorker;
      activeWorker.onmessage = (message: MessageEvent<GpxWorkerResponse>) => {
        if (currentRequest !== request.current || message.data.requestId !== currentRequest) return;
        request.current++;
        stopWorker();
        if (message.data.type === 'success') setImported(message.data.result);
        else setError(message.data.message);
        setLoading(false);
      };
      activeWorker.onerror = (event) => {
        event.preventDefault();
        fail('The local GPX worker could not process this file. Try again or use another browser.');
      };
      activeWorker.onmessageerror = () => fail('The local GPX worker could not return this route. Try another file.');
      const message: GpxWorkerRequest = { requestId: currentRequest, file };
      activeWorker.postMessage(message);
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : 'The local GPX worker could not start. Try another browser.');
    }
  }

  return (
    <Card title="Local route explorer" subtitle="Your route, without a map service" fitContent>
      <div className="space-y-4">
        <p className="text-sm text-ink-700">
          GPX data stays in this tab’s memory. Nothing is uploaded or saved to browser storage.
          No map tiles or vendor requests. Clear the route or leave this page to discard it.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor={`${id}-file`} className="mb-2 block text-sm font-medium text-ink-900">Import a GPX file</label>
            <input ref={input} id={`${id}-file`} type="file" accept=".gpx,.xml,application/gpx+xml,application/xml,text/xml"
              onChange={importRoute} aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`} aria-invalid={!!error}
              className="block min-h-11 w-full min-w-0 rounded-lg border border-ink-200 bg-ink-50 p-2 text-sm text-ink-700 file:mr-3 file:rounded file:border-0 file:bg-ink-100 file:px-3 file:py-2 file:text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
          </div>
          <button type="button" onClick={clearRoute} disabled={!route && !loading && !error}
            className="min-h-11 rounded-lg border border-ink-200 px-3 text-sm text-ink-900 enabled:hover:bg-ink-100 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            Clear route
          </button>
        </div>
        <p id={`${id}-help`} className="text-caption text-ink-500">
          GPX (.gpx or .xml), up to 5 MiB, 100,000 samples and 512 segments.
          Track segments and routes are supported; standalone waypoints are ignored.
          Elevation is required for 3D. XML declarations with a DOCTYPE are rejected.
        </p>
        <p role="status" className="text-caption text-ink-700">
          {loading ? 'Reading and parsing GPX locally…' : route
            ? `${route.samples.length.toLocaleString()} source samples across ${route.segments.length} separate segments loaded in memory.`
            : 'No route imported. Choose a local GPX to explore its shape and elevation.'}
        </p>
        {error && <p id={`${id}-error`} role="alert" className="rounded-lg bg-terra-surface p-3 text-sm text-terra-ink">{error}</p>}
        {route && projection && selected && <>
          <dl className="grid grid-cols-2 gap-4 border-y border-ink-200 py-4 sm:grid-cols-4">
            <div>
              <dt className="text-caption text-ink-500">Route distance</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums text-ink-900">{(route.stats.distanceMeters / 1_000).toFixed(2)} km</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-500">Ascent{route.stats.unavailableElevations ? ' (partial)' : ''}</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums text-ink-900">
                {route.stats.elevationEdges ? `${Math.round(route.stats.ascentMeters)} m` : 'Unavailable'}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-ink-500">Descent{route.stats.unavailableElevations ? ' (partial)' : ''}</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums text-ink-900">
                {route.stats.elevationEdges ? `${Math.round(route.stats.descentMeters)} m` : 'Unavailable'}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-ink-500">Elevation range</dt>
              <dd className="mt-1 text-sm tabular-nums text-ink-900">
                {route.stats.minElevationMeters === null ? 'Unavailable'
                  : `${route.stats.minElevationMeters} to ${route.stats.maxElevationMeters} m`}
              </dd>
            </div>
          </dl>
          <p className="text-caption text-ink-500">
            Statistics use every accepted source sample, not the reduced drawing.
            Distance is horizontal great-circle distance, summed only within segments.
            Ascent/descent use adjacent recorded elevations without smoothing and can include GPS noise.
          </p>
          {route.stats.unavailableElevations > 0 && <p className="rounded-lg bg-amber-surface p-3 text-sm text-amber-ink">
            {route.stats.unavailableElevations.toLocaleString()} samples have no usable elevation. 3D is unavailable;
            the plan and original samples remain usable. Elevation gaps are not filled or counted as zero.
            Only finite elevations from −12,000 to 100,000 m are supported.
          </p>}
          <figure className="min-w-0">
            <figcaption className="mb-2 text-sm font-medium text-ink-900">Route shape · north-up in 2D</figcaption>
            {scene ? <ThreeView scene={scene} label="Route shape" interactive className="h-64 sm:h-80"
              fallback={<RoutePlan route={route} projection={projection} selected={selected} />} />
              : <div className="h-64 overflow-hidden rounded-xl border border-ink-200 bg-ink-50 sm:h-80">
                <RoutePlan route={route} projection={projection} selected={selected} />
              </div>}
            <p className="mt-2 text-caption text-ink-500">
              {route.renderSegments.reduce((sum, segment) => sum + segment.length, 0).toLocaleString()} drawing samples;
              every segment endpoint is retained. Separate segments are never joined.
              The outlined marker selects an original sample, even when it is omitted from the reduced line.
              Local equirectangular projection is approximate for long or polar routes.
              3D uses one scale for distance and elevation, with no vertical exaggeration.
              The 3D grid is a visual reference, not terrain.
            </p>
          </figure>
          <RouteProfile route={route} selected={selected} />
          <section aria-labelledby={`${id}-selection`} className="rounded-lg border border-ink-200 p-3">
            <h4 id={`${id}-selection`} className="text-sm font-medium text-ink-900">Original sample details</h4>
            <label htmlFor={`${id}-sample`} className="mt-3 block text-caption text-ink-700">
              Source sample {selected.sourceIndex.toLocaleString()} of {route.samples.length.toLocaleString()}
            </label>
            <input id={`${id}-sample`} type="range" min="1" max={route.samples.length} step="1" value={selectedIndex + 1}
              aria-describedby={`${id}-sample-help`}
              aria-valuetext={`Source sample ${selected.sourceIndex} of ${route.samples.length}, segment ${selected.segmentIndex}, ${selected.distanceMeters.toFixed(2)} metres along route, elevation ${selected.elevationMeters === null ? 'unavailable' : `${selected.elevationMeters} metres`}`}
              onChange={(event) => setSelectedIndex(Number(event.target.value) - 1)}
              className="min-h-11 w-full accent-cool-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
            <p id={`${id}-sample-help`} className="text-caption text-ink-500">
              Use arrow keys for adjacent original samples; Home and End select the first and last.
              Elevation is the original numeric GPX value, not a rendered or interpolated height.
            </p>
            <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3 text-sm tabular-nums">
              <div><dt className="text-ink-500">Segment / sample within segment</dt>
                <dd className="mt-1 text-ink-900">{selected.segmentIndex} / {selected.segmentSampleIndex}</dd></div>
              <div><dt className="text-ink-500">Distance from start</dt>
                <dd className="mt-1 text-ink-900">{selected.distanceMeters.toFixed(2)} m</dd></div>
              <div><dt className="text-ink-500">Recorded elevation</dt>
                <dd className="mt-1 text-ink-900">{selected.elevationMeters === null ? 'Unavailable' : `${selected.elevationMeters} m`}</dd></div>
            </dl>
          </section>
        </>}
      </div>
    </Card>
  );
}
