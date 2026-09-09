import { describe, expect, it, vi } from 'vitest';
import { importGpxFile } from './gpxImport';
import { MAX_GPX_BYTES, MAX_RENDER_POINTS, MAX_ROUTE_SAMPLES } from './routeLimits';

describe('worker GPX import pipeline', () => {
  it('reads a Blob and parses, builds and projects the full 100,000-sample limit', async () => {
    const file = new Blob([`<gpx><trk><trkseg>${Array.from({ length: MAX_ROUTE_SAMPLES }, (_, index) =>
      `<trkpt lat="0" lon="${index / 100_000}"/>`).join('')}</trkseg></trk></gpx>`]);
    expect(file.size).toBeLessThan(MAX_GPX_BYTES);
    const read = vi.spyOn(file, 'text');
    const { route, projection } = await importGpxFile(file);
    expect(read).toHaveBeenCalledOnce();
    expect(route.samples).toHaveLength(MAX_ROUTE_SAMPLES);
    expect(projection.points).toHaveLength(MAX_ROUTE_SAMPLES);
    expect(route.renderSegments[0]).toHaveLength(MAX_RENDER_POINTS);
    expect(route.renderSegments[0]![0]).toBe(route.samples[0]);
    expect(route.renderSegments[0]!.at(-1)).toBe(route.samples.at(-1));
    expect(route.samples.at(-1)!.sourceIndex).toBe(MAX_ROUTE_SAMPLES);
    expect(route.stats.distanceMeters).toBeGreaterThan(111_000);
    expect(route.stats.unavailableElevations).toBe(MAX_ROUTE_SAMPLES);
    expect(projection.points[0]!.x).toBeCloseTo(-2);
    expect(projection.points.at(-1)!.x).toBeCloseTo(2);
    expect(projection.sceneSegments).toBeNull();
  }, 15_000);

  it('rejects oversized files before reading any contents', async () => {
    const file = new Blob(['x'.repeat(MAX_GPX_BYTES + 1)]);
    const read = vi.spyOn(file, 'text');
    await expect(importGpxFile(file)).rejects.toThrow(/5 MiB/);
    expect(read).not.toHaveBeenCalled();
  });

  it('reports file read failures without reflecting file contents or paths', async () => {
    const file = new Blob(['unreadable']);
    vi.spyOn(file, 'text').mockRejectedValue(new Error('private path'));
    await expect(importGpxFile(file)).rejects.toThrow('The GPX could not be read. Try another file.');
  });
});
