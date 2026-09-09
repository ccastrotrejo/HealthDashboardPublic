import {
  CircleGeometry,
  Color,
  GridHelper,
  Group,
  Line,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { surface, type BrandPalette, type Hue } from './palette';
import { recoveryProgress, trainingHeights, type RouteScenePoint, type ThreeScene } from './threeScene';

const intensityHues: Record<keyof typeof trainingHeights, Hue> = {
  rest: 'cool', easy: 'sage', moderate: 'amber', hard: 'terra',
};

function glass(color: string) {
  return new MeshPhysicalMaterial({
    color: new Color(surface.card[0]).lerp(new Color(color), 0.12),
    metalness: 0, roughness: 0.085, transmission: 0.96,
    thickness: 0.3, ior: 1.45, opacity: 1,
    attenuationColor: new Color(color), attenuationDistance: 1.4,
    clearcoat: 0.8, clearcoatRoughness: 0.07, envMapIntensity: 1.2,
  });
}

function addRing(group: Group, progress: number, palette: BrandPalette) {
  const trackMaterial = glass(palette.surface.border);
  trackMaterial.roughness = 0.28;
  trackMaterial.transmission = 0.55;
  const track = new Mesh(
    new TorusGeometry(1.15, 0.17, 20, 100),
    trackMaterial,
  );
  const bezel = new Mesh(
    new TorusGeometry(1.39, 0.018, 8, 100),
    new MeshStandardMaterial({ color: palette.surface.border, metalness: 0.6, roughness: 0.35 }),
  );
  bezel.position.z = -0.12;
  group.add(track, bezel);
  if (progress > 0) {
    const arcGeometry = new TorusGeometry(1.15, 0.18, 20, 100, Math.PI * 2 * progress);
    arcGeometry.rotateZ(Math.PI / 2).rotateY(Math.PI);
    const arc = new Mesh(
      arcGeometry,
      glass(palette.text('sage')),
    );
    arc.position.z = 0.03;
    const coreGeometry = new TorusGeometry(1.15, 0.055, 8, 100, Math.PI * 2 * progress);
    coreGeometry.rotateZ(Math.PI / 2).rotateY(Math.PI);
    const core = new Mesh(coreGeometry,
      new MeshStandardMaterial({ color: palette.text('sage'), metalness: 0.25, roughness: 0.3 }));
    core.position.z = -0.04;
    group.add(core, arc);
    if (progress < 1) {
      for (const [name, angle] of [['arc-start', 0], ['arc-end', progress * Math.PI * 2]] as const) {
        const cap = new Mesh(new SphereGeometry(0.18, 20, 12), glass(palette.text('sage')));
        cap.name = name;
        cap.position.set(Math.sin(angle) * 1.15, Math.cos(angle) * 1.15, 0.03);
        group.add(cap);
      }
    }
  }
}

/** Build only geometry from supplied data; no fetching or inferred health metrics. */
export function buildThreeObjects(scene: ThreeScene, palette: BrandPalette): Group {
  const group = new Group();
  if (scene.kind === 'countdown') {
    addRing(group, scene.progress, palette);
  } else if (scene.kind === 'recovery') {
    const fraction = recoveryProgress(scene.score);
    addRing(group, fraction ?? 0, palette);
    const lens = new Mesh(new SphereGeometry(0.86, 40, 24), glass(palette.text('cool')));
    lens.scale.z = 0.18;
    lens.position.z = -0.08;
    group.add(lens);
  } else if (scene.kind === 'training') {
    const plinth = new Mesh(
      new RoundedBoxGeometry(scene.days.length * 0.55 + 0.35, 0.08, 1.15, 2, 0.035),
      new MeshStandardMaterial({ color: palette.surface.card, roughness: 0.4, metalness: 0.15 }),
    );
    plinth.position.set(0, -0.77, 0.1);
    group.add(plinth);
    scene.days.forEach((day, index) => {
      const height = trainingHeights[day.intensity];
      const tileMaterial = glass(palette.text(intensityHues[day.intensity]));
      tileMaterial.attenuationDistance = 0.55;
      tileMaterial.transmission = 0.88;
      tileMaterial.color.lerp(new Color(palette.fill(intensityHues[day.intensity])), 0.08);
      const tile = new Mesh(
        new RoundedBoxGeometry(0.42, height, 0.65, 2, 0.06),
        tileMaterial,
      );
      tile.position.set((index - (scene.days.length - 1) / 2) * 0.55, height / 2 - 0.7, 0);
      group.add(tile);
      if (index === scene.selectedIndex) {
        const marker = new Mesh(
          new CircleGeometry(0.075, 24),
          new MeshStandardMaterial({ color: palette.surface.ink, roughness: 0.7 }),
        );
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(tile.position.x, -0.72, 0.53);
        const collar = new Mesh(
          new TorusGeometry(0.115, 0.012, 8, 24),
          new MeshStandardMaterial({ color: palette.text('sage'), metalness: 0.45, roughness: 0.25 }),
        );
        collar.rotation.x = -Math.PI / 2;
        collar.position.copy(marker.position);
        group.add(marker, collar);
      }
    });
  } else {
    const floorY = scene.segments.reduce(
      (lowest, segment) => segment.reduce((value, point) => Math.min(value, point.y), lowest), 0,
    ) - 0.2;
    const grid = new GridHelper(4.6, 8, palette.surface.border, palette.surface.border);
    grid.position.y = floorY;
    grid.material.transparent = true;
    grid.material.opacity = 0.45;
    grid.material.depthWrite = false;
    group.add(grid);
    scene.segments.forEach((segment) => {
      if (segment.length === 1) {
        const point = new Mesh(
          new SphereGeometry(0.025, 12, 8),
          new MeshStandardMaterial({ color: palette.text('cool'), roughness: 0.7 }),
        );
        point.name = 'route-sample';
        point.position.copy(segment[0]!);
        group.add(point);
        return;
      }
      group.add(new Line2(
        new LineGeometry().setPositions(segment.flatMap(({ x, y, z }) => [x, y, z])),
        new LineMaterial({ color: palette.text('cool'), linewidth: 3.25 }),
      ));
    });
    const marker = new Mesh(
      new SphereGeometry(0.07, 20, 12),
      new MeshStandardMaterial({ color: palette.text('terra'), metalness: 0.3, roughness: 0.2 }),
    );
    marker.name = 'route-selection';
    group.add(marker);
    updateRouteSelection(group, scene.selectedPoint);
  }
  return group;
}

/** Selection moves one existing mesh; route lines and their GPU resources stay intact. */
export function updateRouteSelection(group: Group, point: RouteScenePoint | null): void {
  const marker = group.getObjectByName('route-selection');
  if (!(marker instanceof Mesh)) throw new Error('Route selection mesh is missing.');
  marker.visible = point !== null;
  if (point) marker.position.copy(point);
}

/** Scene-local geometry/materials are owned here; the environment is stage-owned. */
export function disposeThreeObjects(group: Group): void {
  group.traverse((object) => {
    if (object instanceof Mesh || object instanceof Line) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    }
  });
  group.clear();
}
