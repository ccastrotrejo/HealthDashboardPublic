import { useCallback, useRef, type KeyboardEvent } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import type { TabId } from '../../hooks/useTab';

interface TabItem {
  id: TabId;
  label: string;
  count?: number;
}

interface Props {
  tabs: TabItem[];
  active: TabId;
  onChange: (id: TabId) => void;
}

/** Stable DOM id for a tab button — referenced by its panel's aria-labelledby. */
export const tabId = (id: TabId) => `tab-${id}`;

/** Stable DOM id for a tab's panel — referenced by the tab's aria-controls. */
export const tabPanelId = (id: TabId) => `tabpanel-${id}`;

/**
 * Primary section navigation implemented as a WAI-ARIA tablist.
 *
 * - Container is `role="tablist"`; each button is `role="tab"` with
 *   `aria-selected` and `aria-controls` pointing at its panel.
 * - Roving tabindex: only the active tab is in the tab order; Arrow keys
 *   (Left/Right, plus Up/Down) and Home/End move focus between tabs, and
 *   selection follows focus (automatic activation). Enter/Space also select.
 * - Panels are wired up in App via `tabPanelId`/`tabId` so screen readers
 *   announce the relationship.
 *
 * Public props are unchanged from the previous Astryx-based implementation.
 */
export function TabNav({ tabs, active, onChange }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusTab = useCallback(
    (index: number) => {
      const count = tabs.length;
      const next = ((index % count) + count) % count;
      const item = tabs[next];
      if (!item) return;
      onChange(item.id);
      refs.current[next]?.focus();
    },
    [tabs, onChange],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          focusTab(index + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          focusTab(index - 1);
          break;
        case 'Home':
          e.preventDefault();
          focusTab(0);
          break;
        case 'End':
          e.preventDefault();
          focusTab(tabs.length - 1);
          break;
      }
    },
    [focusTab, tabs.length],
  );

  return (
    <div
      role="tablist"
      aria-label="Dashboard sections"
      className="glass-navigation -mx-4 grid grid-cols-4 gap-1 border-y border-ink-200 bg-ink-50 px-4 py-2 sm:-mx-6 sm:px-6 md:-mx-8 md:flex md:px-8"
    >
      {tabs.map((t, index) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={tabId(t.id)}
            aria-selected={isActive}
            aria-controls={tabPanelId(t.id)}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-transparent px-2 py-2 text-sm md:px-3 ${
              isActive
                ? 'bg-ink-100 font-semibold text-ink-900 shadow-border'
                : 'text-ink-500 hover:bg-ink-100/60 hover:text-ink-900'
            }`}
          >
            {t.label}
            {t.count != null && t.count > 0 && <span className="tabular-nums"><Badge variant="neutral" label={t.count} /></span>}
          </button>
        );
      })}
    </div>
  );
}
