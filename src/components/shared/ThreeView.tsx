import { lazy, Suspense, useCallback, useId, useState, type ReactNode } from 'react';
import { Box, Check, RotateCcw } from 'lucide-react';
import type { ThreeCamera, ThreeScene } from '../../lib/threeScene';
import { ErrorBoundary } from './ErrorBoundary';

const createThreeCanvas = () => lazy(() => import('./ThreeCanvas').then((module) => ({ default: module.ThreeCanvas })));

interface ThreeViewProps {
  scene: ThreeScene;
  label: string;
  fallback: ReactNode;
  className?: string;
  interactive?: boolean;
  readout?: { value: string; label: string };
}

const INITIAL_CAMERA: ThreeCamera = { rotation: -8, elevation: 12, zoom: 1 };
const INTERACTIVE_CAMERA: ThreeCamera = { rotation: -30, elevation: 30, zoom: 1 };

/** 3D is explicitly opt-in; all information remains available without WebGL. */
export function ThreeView({ scene, label, fallback, className = 'h-48', interactive = false, readout }: ThreeViewProps) {
  const [enabled, setEnabled] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [ThreeCanvas, setThreeCanvas] = useState(createThreeCanvas);
  const initialCamera = interactive ? INTERACTIVE_CAMERA : INITIAL_CAMERA;
  const [camera, setCamera] = useState(initialCamera);
  const viewId = useId();
  const onUnavailable = useCallback((message: string) => {
    setUnavailable(message);
    setEnabled(false);
  }, []);
  const failedView = (
    <div className="flex h-full flex-col">
      <p role="status" className="px-3 pt-2 text-caption text-ink-700">
        {unavailable ?? '3D could not load. The 2D view is shown instead.'}
      </p>
      <div className="min-h-0 flex-1">{fallback}</div>
    </div>
  );

  return (
    <div className="three-view min-w-0 text-ink-900">
      <div className="three-view__toolbar">
        <div className="min-w-0">
          <span className="block text-sm font-medium tracking-tight">{label}</span>
          <span className="text-caption text-ink-500">
            {enabled && !unavailable ? 'Optical view' : 'Data view'}
          </span>
        </div>
        <button
          type="button"
          aria-pressed={enabled}
          aria-controls={viewId}
          aria-label={`${label} 3D view`}
          onClick={() => {
            if (unavailable) setThreeCanvas(() => createThreeCanvas());
            setEnabled(!enabled);
            setUnavailable(null);
          }}
          className="three-view__toggle"
        >
          {enabled
            ? <Check size={14} strokeWidth={1.5} aria-hidden="true" />
            : <Box size={14} strokeWidth={1.5} aria-hidden="true" />}
          3D view
        </button>
      </div>
      <div id={viewId} className={`three-view__stage ${className}`}>
        {unavailable ? failedView : enabled ? (
          <ErrorBoundary section={label} fallback={failedView}
            onError={() => onUnavailable('3D could not load. The 2D view is shown instead.')}>
            <Suspense fallback={<div className="h-full" role="status" aria-label="Loading 3D view">{fallback}</div>}>
              <ThreeCanvas scene={scene} camera={camera} onUnavailable={onUnavailable} />
            </Suspense>
          </ErrorBoundary>
        ) : fallback}
        {enabled && !unavailable && readout && (
          <div className="three-view__readout" aria-hidden="true">
            <strong>{readout.value}</strong>
            <span>{readout.label}</span>
          </div>
        )}
      </div>
      {enabled && interactive && !unavailable && (
        <fieldset className="three-view__camera">
          <legend className="sr-only">{label} camera</legend>
          <div className="three-view__camera-heading">
            <span>Adjust view</span>
            <button type="button" onClick={() => setCamera(initialCamera)}
              className="three-view__reset">
              <RotateCcw size={13} aria-hidden="true" /> Reset view
            </button>
          </div>
          <label className="three-view__range">
            <span>Rotation <span aria-hidden="true">{camera.rotation} deg</span></span>
            <input type="range" min="-180" max="180" step="5" value={camera.rotation}
              aria-valuetext={`${camera.rotation} degrees`}
              onChange={(event) => setCamera({ ...camera, rotation: Number(event.target.value) })} />
          </label>
          <label className="three-view__range">
            <span>Tilt <span aria-hidden="true">{camera.elevation} deg</span></span>
            <input type="range" min="0" max="75" step="5" value={camera.elevation}
              aria-valuetext={`${camera.elevation} degrees`}
              onChange={(event) => setCamera({ ...camera, elevation: Number(event.target.value) })} />
          </label>
          <label className="three-view__range">
            <span>Zoom <span aria-hidden="true">{Math.round(camera.zoom * 100)}%</span></span>
            <input type="range" min="0.75" max="1.5" step="0.05" value={camera.zoom}
              aria-valuetext={`${Math.round(camera.zoom * 100)} percent`}
              onChange={(event) => setCamera({ ...camera, zoom: Number(event.target.value) })} />
          </label>
        </fieldset>
      )}
    </div>
  );
}
