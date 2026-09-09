import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ThemeMode } from '@astryxdesign/core/theme';
import { surface } from '../lib/palette';

/**
 * localStorage key holding the user's theme choice. Kept in sync with the
 * inline pre-paint script in index.html — change both together.
 */
export const THEME_STORAGE_KEY = 'health-theme';
export const APPEARANCE_STORAGE_KEY = 'health-appearance';

export type ThemeAppearance = 'classic' | 'liquid-glass';

const VALID: readonly ThemeMode[] = ['light', 'dark', 'system'];

function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && (VALID as string[]).includes(stored)) return stored as ThemeMode;
  } catch {
    // localStorage can throw in private-mode / sandboxed contexts — ignore.
  }
  return 'system';
}

function readStoredAppearance(): ThemeAppearance {
  try {
    return localStorage.getItem(APPEARANCE_STORAGE_KEY) === 'liquid-glass'
      ? 'liquid-glass'
      : 'classic';
  } catch {
    // Match the color-mode fallback when browser storage is unavailable.
    return 'classic';
  }
}

/**
 * Sync the inline `color-scheme` / background on <html> to the active mode.
 *
 * The pre-paint script in index.html sets these inline styles once (to avoid a
 * flash on first paint). Because inline styles beat reset.css's zero-specificity
 * `:where(html[data-theme])` rule, they'd otherwise stay frozen at the load-time
 * value while Astryx's <Theme> flips only its own wrapper on toggle — leaving
 * <html>/<body> stuck in the old scheme (light cards on a dark page). Re-applying
 * the same logic here on every mode change keeps the root element consistent.
 */
function applyRootColorScheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (mode === 'light' || mode === 'dark') {
    root.style.colorScheme = mode;
  } else {
    root.style.colorScheme = 'light dark';
  }

  const dark = mode === 'dark' || (mode !== 'light' && prefersDark);
  const background = dark ? surface.body[1] : surface.body[0];
  root.style.backgroundColor = background;
  document.getElementById('theme-color-meta')?.setAttribute('content', background);
}

interface ThemeModeContextValue {
  /** The user's chosen mode: 'light' | 'dark' | 'system'. */
  mode: ThemeMode;
  /** Persist a new mode and re-render consumers. */
  setMode: (mode: ThemeMode) => void;
  /** Surface treatment, independent of the selected color mode. */
  appearance: ThemeAppearance;
  setAppearance: (appearance: ThemeAppearance) => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

/**
 * Owns the color mode and optional glass appearance, persists them to
 * localStorage, and exposes them to Astryx and the header controls.
 *
 * Rendering it as the root provider lets the toggle live deep in the tree
 * while `main.tsx` reads the same state to drive `<Theme>`.
 */
export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [appearance, setAppearanceState] = useState<ThemeAppearance>(readStoredAppearance);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Ignore write failures — the in-memory state still updates the UI.
    }
  }, []);

  const setAppearance = useCallback((next: ThemeAppearance) => {
    setAppearanceState(next);
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, next);
    } catch {
      // Ignore write failures — the in-memory state still updates the UI.
    }
  }, []);

  // Keep tabs in sync: if the choice changes in another tab, mirror it here.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea !== localStorage) return;
      if (e.key === null || e.key === THEME_STORAGE_KEY) setModeState(readStoredMode());
      if (e.key === null || e.key === APPEARANCE_STORAGE_KEY) {
        setAppearanceState(readStoredAppearance());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (appearance === 'liquid-glass') {
      document.documentElement.setAttribute('data-appearance', appearance);
    } else {
      document.documentElement.removeAttribute('data-appearance');
    }
  }, [appearance]);

  // Keep <html>'s inline color-scheme/background in step with the chosen mode.
  // Without this, the load-time inline styles from index.html's pre-paint script
  // stay frozen and fight Astryx's runtime toggle (light content on a dark page).
  useEffect(() => {
    applyRootColorScheme(mode);
    // In system mode the background tracks the OS; update it when the OS flips.
    if (mode !== 'system' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyRootColorScheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode]);

  const value = useMemo(
    () => ({ mode, setMode, appearance, setAppearance }),
    [mode, setMode, appearance, setAppearance],
  );

  return <ThemeModeContext value={value}>{children}</ThemeModeContext>;
}

/** Access the current theme mode and setter. Must be used inside the provider. */
export function useThemeMode(): ThemeModeContextValue {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error('useThemeMode must be used within a ThemeModeProvider');
  return ctx;
}
