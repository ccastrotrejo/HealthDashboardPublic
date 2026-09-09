// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteExplorer } from './RouteExplorer';
import { buildRoute, parseGpx, projectRoute } from '../../lib/route';
import { MAX_GPX_BYTES } from '../../lib/routeLimits';
import type { GpxImportResult, GpxWorkerRequest, GpxWorkerResponse } from '../../lib/gpxWorkerProtocol';

vi.mock('../../lib/route', () => ({
  buildRoute: vi.fn(() => { throw new Error('Route construction must not run on the UI thread'); }),
  parseGpx: vi.fn(() => { throw new Error('Parsing must not run on the UI thread'); }),
  projectRoute: vi.fn(() => { throw new Error('Projection must not run on the UI thread'); }),
}));
vi.mock('../shared/ThreeView', () => ({ ThreeView: () => null }));
vi.mock('./RouteCharts', () => ({ RoutePlan: () => null, RouteProfile: () => null }));

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: MessageEvent<GpxWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(message: GpxWorkerRequest) => void>();
  terminate = vi.fn();

  constructor(readonly url: URL, readonly options: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  get requestId() { return this.postMessage.mock.calls[0]![0].requestId; }

  complete(result = importedRoute()) {
    this.onmessage?.(new MessageEvent('message', { data: { requestId: this.requestId, type: 'success', result } }));
  }
}

function importedRoute(count = 2): GpxImportResult {
  const samples = Array.from({ length: count }, (_, index) => ({
    latitude: 0, longitude: index / 1000, elevationMeters: index,
    sourceIndex: index + 1, segmentIndex: 1, segmentSampleIndex: index + 1, distanceMeters: index * 100,
  }));
  const points = samples.map((sample) => ({ x: sample.longitude, y: sample.elevationMeters, z: 0 }));
  return {
    route: {
      samples, segments: [samples], renderSegments: [samples], profileSegments: [samples],
      stats: {
        distanceMeters: 100, ascentMeters: 1, descentMeters: 0, minElevationMeters: 0,
        maxElevationMeters: 1, unavailableElevations: 0, elevationEdges: 1,
      },
    },
    projection: { points, sceneSegments: [points], metersPerUnit: 25 },
  };
}

function localFile(name = 'route.gpx') {
  const file = new File(['GPX contents must never be read by the UI'], name, { type: 'application/gpx+xml' });
  const read = vi.fn(() => { throw new Error('File contents must be read only in the worker'); });
  Object.defineProperty(file, 'text', { value: read });
  return { file, read };
}

beforeEach(() => {
  MockWorker.instances = [];
  vi.stubGlobal('Worker', MockWorker);
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(parseGpx).not.toHaveBeenCalled();
  expect(buildRoute).not.toHaveBeenCalled();
  expect(projectRoute).not.toHaveBeenCalled();
});

describe('local GPX worker lifecycle', () => {
  it('sends the File to a module worker, renders its result and releases the worker', async () => {
    const user = userEvent.setup();
    render(createElement(RouteExplorer));
    const { file, read } = localFile();
    await user.upload(screen.getByLabelText('Import a GPX file'), file);
    const worker = MockWorker.instances[0]!;
    expect(MockWorker.instances).toHaveLength(1);
    expect(worker.url.pathname).toMatch(/\/lib\/gpx\.worker\.ts$/);
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.postMessage).toHaveBeenCalledWith({ requestId: worker.requestId, file });
    expect(read).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Reading and parsing');
    expect(worker.terminate).not.toHaveBeenCalled();
    act(() => worker.complete());
    expect(screen.getByRole('status').textContent).toContain('2 source samples');
    expect(screen.getByRole('slider').getAttribute('max')).toBe('2');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    expect(read).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Clear route' }));
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('No route imported');
  });

  it('terminates a superseded import and ignores its late completion or failure', async () => {
    const user = userEvent.setup();
    render(createElement(RouteExplorer));
    const input = screen.getByLabelText('Import a GPX file');
    await user.upload(input, localFile('first.gpx').file);
    const first = MockWorker.instances[0]!;
    const lateMessage = first.onmessage!;
    const lateError = first.onerror!;
    await user.upload(input, localFile('second.gpx').file);
    const second = MockWorker.instances[1]!;
    expect(first.terminate).toHaveBeenCalledOnce();
    act(() => {
      lateMessage(new MessageEvent('message', {
        data: { requestId: first.requestId, type: 'success', result: importedRoute(3) },
      }));
      lateError(new ErrorEvent('error'));
    });
    expect(screen.getByRole('status').textContent).toContain('Reading and parsing');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(second.terminate).not.toHaveBeenCalled();
    act(() => second.complete());
    expect(screen.getByRole('status').textContent).toContain('2 source samples');
    act(() => lateMessage(new MessageEvent('message', {
      data: { requestId: first.requestId, type: 'error', message: 'Stale failure' },
    })));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('2 source samples');
  });

  it('clears an active import, resets the file input and ignores late results', async () => {
    const user = userEvent.setup();
    render(createElement(RouteExplorer));
    const input = screen.getByLabelText<HTMLInputElement>('Import a GPX file');
    const { file } = localFile();
    await user.upload(input, file);
    const worker = MockWorker.instances[0]!;
    const lateMessage = worker.onmessage!;
    await user.click(screen.getByRole('button', { name: 'Clear route' }));
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(input.value).toBe('');
    act(() => lateMessage(new MessageEvent('message', {
      data: { requestId: worker.requestId, type: 'success', result: importedRoute() },
    })));
    expect(screen.getByRole('status').textContent).toContain('No route imported');
    expect(screen.queryByRole('slider')).toBeNull();
    await user.upload(input, file);
    expect(MockWorker.instances).toHaveLength(2);
  });

  it('terminates on unmount and ignores a queued completion after unmount', async () => {
    const user = userEvent.setup();
    const view = render(createElement(RouteExplorer));
    await user.upload(screen.getByLabelText('Import a GPX file'), localFile().file);
    const worker = MockWorker.instances[0]!;
    const lateMessage = worker.onmessage!;
    view.unmount();
    expect(worker.terminate).toHaveBeenCalledOnce();
    act(() => lateMessage(new MessageEvent('message', {
      data: { requestId: worker.requestId, type: 'success', result: importedRoute() },
    })));
    expect(view.container.childElementCount).toBe(0);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('discards messages with a mismatched request ID without ending the active import', async () => {
    const user = userEvent.setup();
    render(createElement(RouteExplorer));
    await user.upload(screen.getByLabelText('Import a GPX file'), localFile().file);
    const worker = MockWorker.instances[0]!;
    act(() => worker.onmessage!(new MessageEvent('message', {
      data: { requestId: worker.requestId + 1, type: 'success', result: importedRoute() },
    })));
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Reading and parsing');
    act(() => worker.complete());
    expect(screen.getByRole('status').textContent).toContain('2 source samples');
  });

  it('ignores queued events after the active request has already completed', async () => {
    const user = userEvent.setup();
    render(createElement(RouteExplorer));
    await user.upload(screen.getByLabelText('Import a GPX file'), localFile().file);
    const worker = MockWorker.instances[0]!;
    const lateMessage = worker.onmessage!;
    const lateError = worker.onerror!;
    act(() => worker.complete());
    act(() => {
      lateMessage(new MessageEvent('message', {
        data: { requestId: worker.requestId, type: 'success', result: importedRoute(3) },
      }));
      lateError(new ErrorEvent('error'));
    });
    expect(screen.getByRole('status').textContent).toContain('2 source samples');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each(['parser', 'runtime', 'message'] as const)('shows %s failures and terminates the worker', async (failure) => {
    const user = userEvent.setup();
    render(createElement(RouteExplorer));
    await user.upload(screen.getByLabelText('Import a GPX file'), localFile().file);
    const worker = MockWorker.instances[0]!;
    act(() => {
      if (failure === 'parser') {
        worker.onmessage!(new MessageEvent('message', {
          data: { requestId: worker.requestId, type: 'error', message: 'The GPX XML is malformed.' },
        }));
      } else if (failure === 'runtime') {
        const event = new ErrorEvent('error', { cancelable: true });
        worker.onerror!(event);
        expect(event.defaultPrevented).toBe(true);
      } else worker.onmessageerror!();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/malformed|local GPX worker/);
    expect(screen.getByRole('status').textContent).not.toContain('Reading and parsing');
    expect(screen.queryByRole('slider')).toBeNull();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('shows an explicit error when Worker is unavailable instead of parsing synchronously', async () => {
    vi.stubGlobal('Worker', undefined);
    const user = userEvent.setup();
    render(createElement(RouteExplorer));
    const { file, read } = localFile();
    await user.upload(screen.getByLabelText('Import a GPX file'), file);
    expect(screen.getByRole('alert').textContent).toContain('requires Web Worker support');
    expect(MockWorker.instances).toHaveLength(0);
    expect(read).not.toHaveBeenCalled();
  });

  it('shows startup failures and releases a worker when posting the file fails', async () => {
    class FailingWorker extends MockWorker {
      postMessage = vi.fn(() => { throw new Error('Worker file transfer failed'); });
    }
    vi.stubGlobal('Worker', FailingWorker);
    const user = userEvent.setup();
    render(createElement(RouteExplorer));
    await user.upload(screen.getByLabelText('Import a GPX file'), localFile().file);
    expect(screen.getByRole('alert').textContent).toContain('Worker file transfer failed');
    expect(MockWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });

  it('reports module worker construction failures without falling back to synchronous parsing', async () => {
    vi.stubGlobal('Worker', class {
      constructor() { throw new Error('Module workers are blocked'); }
    });
    const user = userEvent.setup();
    render(createElement(RouteExplorer));
    await user.upload(screen.getByLabelText('Import a GPX file'), localFile().file);
    expect(screen.getByRole('alert').textContent).toContain('Module workers are blocked');
    expect(screen.getByRole('status').textContent).not.toContain('Reading and parsing');
  });

  it('rejects the byte limit before starting a worker or reading contents', async () => {
    const user = userEvent.setup();
    render(createElement(RouteExplorer));
    const { file, read } = localFile();
    Object.defineProperty(file, 'size', { value: MAX_GPX_BYTES + 1 });
    await user.upload(screen.getByLabelText('Import a GPX file'), file);
    expect(screen.getByRole('alert').textContent).toContain('5 MiB');
    expect(MockWorker.instances).toHaveLength(0);
    expect(read).not.toHaveBeenCalled();
  });
});
