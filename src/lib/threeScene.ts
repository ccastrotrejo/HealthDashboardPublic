export interface RouteScenePoint {
  x: number;
  y: number;
  z: number;
}

export interface TrainingSceneDay {
  label: string;
  intensity: 'rest' | 'easy' | 'moderate' | 'hard';
}

/** Geometry inputs only; dates, health interpretation and labels stay in HTML. */
export type ThreeScene =
  | { kind: 'countdown'; progress: number }
  | { kind: 'recovery'; score: number | null }
  | { kind: 'training'; days: TrainingSceneDay[]; selectedIndex: number }
  | { kind: 'route'; segments: RouteScenePoint[][]; selectedPoint: RouteScenePoint | null };

export interface ThreeCamera {
  rotation: number;
  elevation: number;
  zoom: number;
}

export const COUNTDOWN_WINDOW_DAYS = 90;

/** Calendar progress through a labeled window, never training completion. */
export function countdownProgress(daysUntil: number): number | null {
  if (!Number.isFinite(daysUntil) || daysUntil < 0) return null;
  return Math.max(0, 1 - daysUntil / COUNTDOWN_WINDOW_DAYS);
}

/** Missing or invalid scores must not look like a measured zero. */
export function recoveryProgress(score: number | null): number | null {
  return score !== null && Number.isFinite(score) && score >= 0 && score <= 100
    ? score / 100
    : null;
}

/** Ordinal height encodes planned intensity, not duration or measured load. */
export const trainingHeights: Record<TrainingSceneDay['intensity'], number> = {
  rest: 0.2,
  easy: 0.6,
  moderate: 1,
  hard: 1.4,
};
