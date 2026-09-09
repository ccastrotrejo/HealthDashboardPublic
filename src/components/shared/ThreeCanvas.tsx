import { useEffect, useMemo, useRef } from 'react';
import {
  ACESFilmicToneMapping, AmbientLight, DirectionalLight, Group, OrthographicCamera,
  PMREMGenerator, Scene, WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { surface, useBrandPalette } from '../../lib/palette';
import { buildThreeObjects, disposeThreeObjects, updateRouteSelection } from '../../lib/threeObjects';
import { createStudioBackground, fitStudioCamera } from '../../lib/threeStudio';
import type { ThreeCamera, ThreeScene } from '../../lib/threeScene';

interface ThreeCanvasProps {
  scene: ThreeScene;
  camera: ThreeCamera;
  onUnavailable: (message: string) => void;
}

interface Stage {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: OrthographicCamera;
  objects: Group;
  requestRender: () => void;
}

/** One context per visible view. No render loop, external assets, or motion. */
export function ThreeCanvas({ scene, camera, onUnavailable }: ThreeCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const palette = useBrandPalette();
  const geometryInput = scene.kind === 'route' ? scene.segments : scene;
  const geometryScene = useMemo<ThreeScene>(() => Array.isArray(geometryInput)
    ? { kind: 'route', segments: geometryInput, selectedPoint: null }
    : geometryInput, [geometryInput]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // A fresh canvas also isolates StrictMode's setup/cleanup replay from a
    // context whose loss is still being processed by the browser.
    const canvas = document.createElement('canvas');
    canvas.className = 'block h-full w-full';
    canvas.setAttribute('aria-hidden', 'true');
    let renderer: WebGLRenderer | undefined;
    let environment: WebGLRenderTarget | undefined;
    const room = new RoomEnvironment();
    let pmrem: PMREMGenerator | undefined;
    try {
      const context = canvas.getContext('webgl2', { alpha: true, antialias: true });
      if (!context) {
        onUnavailable('WebGL 2 is unavailable. The 2D view and exact values are still available.');
        return;
      }
      renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: true });
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      pmrem = new PMREMGenerator(renderer);
      environment = pmrem.fromScene(room, 0.04);
    } catch (error) {
      renderer?.dispose();
      renderer?.forceContextLoss();
      environment?.dispose();
      if (!(error instanceof Error)) throw error;
      console.warn('[ThreeCanvas] Could not initialize 3D:', error.message);
      onUnavailable('3D could not start on this device. The 2D view is shown instead.');
      return;
    } finally {
      room.dispose();
      pmrem?.dispose();
    }

    const webgl = renderer;
    const environmentMap = environment;
    host.append(canvas);
    const world = new Scene();
    world.environment = environmentMap.texture;
    world.environmentIntensity = 0.85;
    world.add(new AmbientLight(surface.textPrimary[1], 0.3));
    const light = new DirectionalLight(surface.textPrimary[1], 2.4);
    light.position.set(3, 4, 5);
    const rim = new DirectionalLight(surface.textPrimary[1], 1.4);
    rim.position.set(-4, 2, -2);
    world.add(light, rim);
    const viewCamera = new OrthographicCamera(-3, 3, 3, -3, 0.1, 30);
    let frame = 0;
    let visible = true;
    const requestRender = () => {
      if (frame || document.hidden || !visible) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (document.hidden || !visible) return;
        const { width, height } = canvas.getBoundingClientRect();
        if (width === 0 || height === 0) return;
        webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        webgl.setSize(width, height, false);
        fitStudioCamera(viewCamera, stage.objects, width / height);
        try {
          webgl.render(world, viewCamera);
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          console.warn('[ThreeCanvas] Rendering failed:', error.message);
          onUnavailable('3D rendering stopped. The 2D view is shown instead.');
        }
      });
    };
    const stage: Stage = {
      renderer: webgl, scene: world, camera: viewCamera, objects: new Group(), requestRender,
    };
    world.add(stage.objects);
    stageRef.current = stage;

    const resize = new ResizeObserver(requestRender);
    resize.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (visible) requestRender();
    });
    intersection.observe(canvas);
    const onLost = (event: Event) => {
      event.preventDefault();
      onUnavailable('The 3D graphics context was lost. The 2D view is shown instead.');
    };
    canvas.addEventListener('webglcontextlost', onLost);
    document.addEventListener('visibilitychange', requestRender);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      document.removeEventListener('visibilitychange', requestRender);
      disposeThreeObjects(stage.objects);
      environmentMap.dispose();
      webgl.dispose();
      if (!webgl.getContext().isContextLost()) webgl.forceContextLoss();
      canvas.remove();
      stageRef.current = null;
    };
  }, [onUnavailable]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const background = createStudioBackground(palette);
    stage.scene.background = background;
    stage.requestRender();
    return () => {
      stage.scene.background = null;
      background.dispose();
    };
  }, [palette]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.scene.remove(stage.objects);
    disposeThreeObjects(stage.objects);
    stage.objects = buildThreeObjects(geometryScene, palette);
    stage.scene.add(stage.objects);
    stage.requestRender();
  }, [geometryScene, palette]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || scene.kind !== 'route') return;
    updateRouteSelection(stage.objects, scene.selectedPoint);
    stage.requestRender();
  }, [scene, palette]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const yaw = camera.rotation * Math.PI / 180;
    const elevation = camera.elevation * Math.PI / 180;
    stage.camera.position.set(
      8 * Math.sin(yaw) * Math.cos(elevation),
      8 * Math.sin(elevation),
      8 * Math.cos(yaw) * Math.cos(elevation),
    );
    stage.camera.lookAt(0, 0, 0);
    stage.camera.zoom = camera.zoom;
    stage.requestRender();
  }, [camera]);

  return <div ref={hostRef} aria-hidden="true" className="h-full w-full" />;
}
