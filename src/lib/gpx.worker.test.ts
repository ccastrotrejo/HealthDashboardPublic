import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GpxWorkerRequest, GpxWorkerResponse } from './gpxWorkerProtocol';

const scope = {
  onmessage: null as ((event: MessageEvent<GpxWorkerRequest>) => Promise<void>) | null,
  postMessage: vi.fn<(message: GpxWorkerResponse) => void>(),
};

beforeEach(async () => {
  vi.resetModules();
  scope.postMessage.mockClear();
  vi.stubGlobal('self', scope);
  await import('./gpx.worker');
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('GPX module worker protocol', () => {
  it('returns the matching request ID with plain route and projection data', async () => {
    const file = new Blob(['<gpx><rte><rtept lat="0" lon="0"><ele>1</ele></rtept><rtept lat="0" lon="1"><ele>2</ele></rtept></rte></gpx>']);
    await scope.onmessage!(new MessageEvent('message', { data: { requestId: 7, file } }));
    expect(scope.postMessage).toHaveBeenCalledOnce();
    const result = scope.postMessage.mock.calls[0]![0];
    expect(result).toMatchObject({ requestId: 7, type: 'success' });
    if (result.type !== 'success') throw new Error('Expected successful import');
    expect(result.result.route.samples).toHaveLength(2);
    expect(result.result.projection.points).toHaveLength(2);
    expect(result.result.projection.sceneSegments![0]).toHaveLength(2);
    expect(structuredClone(result)).toEqual(result);
  });

  it.each(['<gpx><trk></gpx>', '<!DOCTYPE gpx><gpx/>'])('returns safe parsing failures: %s', async (xml) => {
    await scope.onmessage!(new MessageEvent('message', { data: { requestId: 8, file: new Blob([xml]) } }));
    expect(scope.postMessage).toHaveBeenCalledOnce();
    expect(scope.postMessage.mock.calls[0]![0]).toMatchObject({
      requestId: 8, type: 'error', message: expect.stringMatching(/malformed|declarations/),
    });
  });

  it('reports response serialization failures instead of leaving the client waiting', async () => {
    scope.postMessage.mockImplementationOnce(() => { throw new Error('Route response could not be serialized'); });
    const file = new Blob(['<gpx><rte><rtept lat="0" lon="0"/><rtept lat="0" lon="1"/></rte></gpx>']);
    await scope.onmessage!(new MessageEvent('message', { data: { requestId: 9, file } }));
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      requestId: 9, type: 'error', message: 'Route response could not be serialized',
    });
  });
});
