import { Box3, Group, Line, Mesh, OrthographicCamera, Vector3 } from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { describe, expect, it, vi } from 'vitest';
import { brand, surface, type BrandPalette } from './palette';
import { buildThreeObjects, disposeThreeObjects, updateRouteSelection } from './threeObjects';
import type { ThreeScene } from './threeScene';
import { createStudioBackground, fitStudioCamera } from './threeStudio';

const palette: BrandPalette = {
  mode: 'light',
  fill: (hue) => brand[hue][500],
  text: (hue) => brand[hue][700],
  surface: {
    body: surface.body[0], card: surface.card[0], ink: surface.textPrimary[0],
    inkSecondary: surface.textSecondary[0], border: surface.border[0],
  },
  chart: { axis: surface.textSecondary[0], grid: surface.border[0], emphasis: surface.textPrimary[0] },
  zoneScale: [],
  heatScale: [],
};

const scenes: ThreeScene[] = [
  { kind: 'countdown', progress: 0 },
  { kind: 'countdown', progress: 1 },
  { kind: 'recovery', score: 87 },
  { kind: 'recovery', score: null },
  { kind: 'training', days: [{ label: 'Mon', intensity: 'rest' }, { label: 'Tue', intensity: 'hard' }], selectedIndex: 1 },
  { kind: 'route', segments: [[{ x: -1, y: 0, z: 0 }, { x: 1, y: 0.3, z: 1 }]], selectedPoint: { x: 0, y: 0, z: 0 } },
];

describe('scene ownership', () => {
  it.each(scenes)('creates finite, disposable $kind geometry', (scene) => {
    const group = buildThreeObjects(scene, palette);
    expect(group).toBeInstanceOf(Group);
    const disposed = vi.fn();
    let resourceCount = 0;
    group.traverse((object) => {
      if (!(object instanceof Mesh || object instanceof Line)) return;
      object.geometry.computeBoundingBox();
      const box = object.geometry.boundingBox!;
      for (const value of [...box.min.toArray(), ...box.max.toArray(), ...object.position.toArray()]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      object.geometry.addEventListener('dispose', disposed);
      resourceCount++;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        material.addEventListener('dispose', disposed);
        resourceCount++;
      }
    });

    disposeThreeObjects(group);
    expect(disposed).toHaveBeenCalledTimes(resourceCount);
    expect(group.children).toHaveLength(0);
  });

  it('does not connect separate recorded route segments', () => {
    const group = buildThreeObjects({
      kind: 'route',
      segments: [
        [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }],
        [{ x: 0.5, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      ],
      selectedPoint: null,
    }, palette);
    expect(group.children.filter((object) => object instanceof Line2)).toHaveLength(2);
    disposeThreeObjects(group);
  });

  it('keeps single-sample segments visible rather than dropping them', () => {
    const group = buildThreeObjects({
      kind: 'route', segments: [[{ x: -1, y: 0, z: 0 }], [{ x: 1, y: 0, z: 0 }]], selectedPoint: null,
    }, palette);
    expect(group.children.filter((object) => object.name === 'route-sample')).toHaveLength(2);
    expect(group.getObjectByName('route-selection')?.visible).toBe(false);
    expect(group.children.filter((object) => object instanceof Line2)).toHaveLength(0);
    disposeThreeObjects(group);
  });
});

describe('optical studio', () => {
  it('updates selection without replacing or disposing route geometry', () => {
    const segments = Array.from({ length: 512 }, (_, index) => [
      { x: index / 256 - 1, y: 0, z: 0 },
      { x: index / 256 - 1, y: 0.1, z: 0.5 },
    ]);
    const group = buildThreeObjects({ kind: 'route', segments, selectedPoint: null }, palette);
    const lines = group.children.filter((object) => object instanceof Line2);
    const buffers = lines.map((line) => line.geometry);
    const materials = lines.map((line) => line.material);
    const disposed = vi.fn();
    for (const resource of [...buffers, ...materials]) resource.addEventListener('dispose', disposed);
    const marker = group.getObjectByName('route-selection')!;
    for (let index = 0; index < 20; index++) {
      updateRouteSelection(group, { x: index / 20, y: 0.05, z: 0.25 });
    }
    expect(group.children.filter((object) => object instanceof Line2)).toEqual(lines);
    expect(lines.map((line) => line.geometry)).toEqual(buffers);
    expect(lines.map((line) => line.material)).toEqual(materials);
    expect(group.getObjectByName('route-selection')).toBe(marker);
    expect(marker.position.x).toBeCloseTo(0.95);
    expect(marker.visible).toBe(true);
    expect(disposed).not.toHaveBeenCalled();
    updateRouteSelection(group, null);
    expect(marker.visible).toBe(false);
    disposeThreeObjects(group);
    expect(disposed).toHaveBeenCalledTimes(1024);
  });

  it('keeps partial ring caps aligned clockwise with the 2D progress arc', () => {
    const group = buildThreeObjects({ kind: 'countdown', progress: 0.25 }, palette);
    const start = group.getObjectByName('arc-start')!;
    const end = group.getObjectByName('arc-end')!;
    expect(start.position.x).toBeCloseTo(0);
    expect(start.position.y).toBeCloseTo(1.15);
    expect(end.position.x).toBeCloseTo(1.15);
    expect(end.position.y).toBeCloseTo(0);
    disposeThreeObjects(group);
  });

  it.each([0, 1])('does not add misleading endpoint caps at progress %s', (progress) => {
    const group = buildThreeObjects({ kind: 'countdown', progress }, palette);
    expect(group.getObjectByName('arc-end')).toBeUndefined();
    disposeThreeObjects(group);
  });

  it('creates a bounded, deterministic, disposable local background', () => {
    const first = createStudioBackground(palette);
    const second = createStudioBackground(palette);
    expect(first.image.width).toBe(96);
    expect(first.image.height).toBe(96);
    expect(first.image.data).toHaveLength(96 * 96 * 4);
    expect(first.image.data).toEqual(second.image.data);
    const disposed = vi.fn();
    first.addEventListener('dispose', disposed);
    first.dispose();
    second.dispose();
    expect(disposed).toHaveBeenCalledOnce();
  });

  it.each([0.8, 1, 3])('fits rotated geometry at aspect ratio %s without clipping', (aspect) => {
    const group = buildThreeObjects({ kind: 'recovery', score: 87 }, palette);
    const camera = new OrthographicCamera(-3, 3, 3, -3, 0.1, 30);
    camera.position.set(2, 3, 8);
    camera.lookAt(0, 0, 0);
    fitStudioCamera(camera, group, aspect);
    const bounds = new Box3().setFromObject(group);
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const projected = new Vector3(x, y, z).project(camera);
          expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.81);
          expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.81);
        }
      }
    }
    disposeThreeObjects(group);
  });
});
