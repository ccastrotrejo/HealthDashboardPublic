// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '../components/shared/ThemeToggle';
import { APPEARANCE_STORAGE_KEY, THEME_STORAGE_KEY, ThemeModeProvider } from './useThemeMode';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-appearance');
  vi.stubGlobal('matchMedia', vi.fn((media: string) => ({
    matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute('data-appearance');
  document.documentElement.removeAttribute('style');
  vi.unstubAllGlobals();
});

function renderControls() {
  render(createElement(ThemeModeProvider, { children: createElement(ThemeToggle) }));
  return screen.getByRole('button', { name: 'Liquid Glass' });
}

function publishStorage(key: string | null, storageArea = localStorage) {
  window.dispatchEvent(new StorageEvent('storage', { key, storageArea }));
}

describe('client appearance synchronization', () => {
  it('persists local clicks and updates the root appearance', async () => {
    const user = userEvent.setup();
    const toggle = renderControls();
    await user.click(toggle);
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe('liquid-glass');
    expect(document.documentElement.dataset.appearance).toBe('liquid-glass');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await user.click(toggle);
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe('classic');
    expect(document.documentElement.hasAttribute('data-appearance')).toBe(false);
  });

  it('mirrors appearance changes from another tab without changing color mode', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const toggle = renderControls();
    act(() => {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, 'liquid-glass');
      publishStorage(APPEARANCE_STORAGE_KEY);
    });
    expect(document.documentElement.dataset.appearance).toBe('liquid-glass');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Dark theme' }).getAttribute('aria-checked')).toBe('true');
    act(() => {
      localStorage.removeItem(APPEARANCE_STORAGE_KEY);
      publishStorage(APPEARANCE_STORAGE_KEY);
    });
    expect(document.documentElement.hasAttribute('data-appearance')).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('resets appearance and color mode after a cross-tab clear event', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem(APPEARANCE_STORAGE_KEY, 'liquid-glass');
    const toggle = renderControls();
    expect(document.documentElement.dataset.appearance).toBe('liquid-glass');
    act(() => {
      localStorage.clear();
      publishStorage(null);
    });
    expect(document.documentElement.hasAttribute('data-appearance')).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('radio', { name: 'System theme' }).getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.style.colorScheme).toBe('light dark');
  });

  it('ignores events from sessionStorage and unrelated localStorage keys', () => {
    const toggle = renderControls();
    act(() => {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, 'liquid-glass');
      publishStorage(APPEARANCE_STORAGE_KEY, sessionStorage);
      publishStorage('unrelated-key');
    });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(document.documentElement.hasAttribute('data-appearance')).toBe(false);
  });
});
