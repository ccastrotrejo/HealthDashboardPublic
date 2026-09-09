import { useCallback, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { ThemeMode } from '@astryxdesign/core/theme';
import { useThemeMode } from '../../hooks/useThemeMode';

const SunIcon = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

const MoonIcon = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
);

const SystemIcon = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

const OPTIONS: { value: ThemeMode; label: string; icon: ReactNode }[] = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: SystemIcon },
];

/**
 * Three-way Light / Dark / System theme control, rendered as an ARIA
 * radiogroup. The selected segment owns the single tab stop (roving
 * tabindex); Left/Right/Up/Down move and activate the neighbouring option,
 * wrapping at the ends, per the WAI-ARIA radio-group pattern.
 */
function ColorThemeToggle() {
  const { mode, setMode } = useThemeMode();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusAndSelect = useCallback(
    (index: number) => {
      const next = (index + OPTIONS.length) % OPTIONS.length;
      const option = OPTIONS[next];
      if (!option) return;
      setMode(option.value);
      refs.current[next]?.focus();
    },
    [setMode],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          focusAndSelect(index + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          focusAndSelect(index - 1);
          break;
        case 'Home':
          e.preventDefault();
          focusAndSelect(0);
          break;
        case 'End':
          e.preventDefault();
          focusAndSelect(OPTIONS.length - 1);
          break;
      }
    },
    [focusAndSelect],
  );

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="inline-flex items-center gap-1 rounded-full bg-ink-50 p-0.5 shadow-border"
    >
      {OPTIONS.map((option, index) => {
        const isSelected = mode === option.value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`${option.label} theme`}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => setMode(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`pressable-feedback relative flex h-9 w-9 items-center justify-center rounded-full after:absolute after:left-1/2 after:top-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] ${
              isSelected
                ? 'bg-ink-100 text-ink-900 shadow-sm'
                : 'text-ink-500 hover:text-ink-700'
            }`}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}

/** Keep the optional surface treatment separate from light/dark/system. */
export function ThemeToggle() {
  const { appearance, setAppearance } = useThemeMode();
  const glassEnabled = appearance === 'liquid-glass';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ColorThemeToggle />
      <button
        type="button"
        aria-pressed={glassEnabled}
        onClick={() => setAppearance(glassEnabled ? 'classic' : 'liquid-glass')}
        className="glass-appearance-toggle pressable-feedback inline-flex min-h-11 items-center gap-2 rounded-full bg-ink-100 px-3 text-xs font-medium text-ink-900 shadow-border"
      >
        Liquid Glass
        <span aria-hidden="true" className="text-ink-500">
          {glassEnabled ? 'On' : 'Off'}
        </span>
      </button>
    </div>
  );
}
