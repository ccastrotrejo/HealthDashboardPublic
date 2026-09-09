/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '../components/shared/ThemeToggle';
import { surface } from '../lib/palette';
import {
  APPEARANCE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  ThemeModeProvider,
} from './useThemeMode';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const prepaintScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

function storage(mode: string | null, appearance: string | null) {
  return {
    getItem: (key: string) => {
      if (key === THEME_STORAGE_KEY) return mode;
      if (key === APPEARANCE_STORAGE_KEY) return appearance;
      return null;
    },
  };
}

function renderControls() {
  return renderToStaticMarkup(
    createElement(ThemeModeProvider, { children: createElement(ThemeToggle) }),
  );
}

function runPrepaint(stored: ReturnType<typeof storage>, prefersDark = false) {
  if (!prepaintScript) throw new Error('Missing pre-paint theme script');
  const attributes = new Map<string, string>();
  const style: Record<string, string> = {};
  const meta = new Map<string, string>();
  runInNewContext(prepaintScript, {
    localStorage: stored,
    document: {
      documentElement: {
        style,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
      },
      getElementById: () => ({
        setAttribute: (name: string, value: string) => meta.set(name, value),
      }),
    },
    window: { matchMedia: () => ({ matches: prefersDark }) },
  });
  return { attributes, style, meta };
}

afterEach(() => vi.unstubAllGlobals());

describe('appearance controls', () => {
  it.each(['light', 'dark', 'system'])('keeps glass independent of %s mode', (mode) => {
    for (const appearance of ['classic', 'liquid-glass']) {
      vi.stubGlobal('localStorage', storage(mode, appearance));
      const markup = renderControls();
      const label = `${mode[0]?.toUpperCase()}${mode.slice(1)} theme`;
      expect(markup).toContain(`aria-checked="true" aria-label="${label}"`);
      expect(markup).toContain(`aria-pressed="${appearance === 'liquid-glass'}"`);
      expect(markup).toContain('Liquid Glass');
      expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    }
  });

  it.each([null, 'unknown', 'dark', ''])('defaults to classic for appearance %s', (appearance) => {
    vi.stubGlobal('localStorage', storage(null, appearance));
    expect(renderControls()).toContain('aria-pressed="false"');
    expect(renderControls()).toContain('aria-checked="true" aria-label="System theme"');
  });

  it('still renders default controls when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new DOMException('Storage blocked', 'SecurityError'); },
    });
    expect(renderControls()).toContain('aria-pressed="false"');
    expect(renderControls()).toContain('aria-checked="true" aria-label="System theme"');
  });
});

describe('pre-paint appearance synchronization', () => {
  it.each(['light', 'dark', 'system'])('applies glass before painting %s mode', (mode) => {
    for (const prefersDark of [false, true]) {
      const { attributes, style, meta } = runPrepaint(storage(mode, 'liquid-glass'), prefersDark);
      const dark = mode === 'dark' || (mode === 'system' && prefersDark);
      expect(attributes.get('data-appearance')).toBe('liquid-glass');
      expect(attributes.get('data-theme')).toBe(mode === 'system' ? undefined : mode);
      expect(style.colorScheme).toBe(mode === 'system' ? 'light dark' : mode);
      expect(style.backgroundColor).toBe(surface.body[dark ? 1 : 0]);
      expect(meta.get('content')).toBe(style.backgroundColor);
    }
  });

  it.each([null, 'classic', 'unknown', 'dark', ''])('does not opt in for appearance %s', (appearance) => {
    const { attributes } = runPrepaint(storage('light', appearance));
    expect(attributes.has('data-appearance')).toBe(false);
    expect(attributes.get('data-theme')).toBe('light');
  });

  it('falls back to system mode for an invalid saved color mode', () => {
    const { attributes, style } = runPrepaint(storage('invalid', 'liquid-glass'), true);
    expect(attributes.has('data-theme')).toBe(false);
    expect(attributes.get('data-appearance')).toBe('liquid-glass');
    expect(style.backgroundColor).toBe(surface.body[1]);
  });

  it('leaves CSS defaults intact when storage is blocked', () => {
    const { attributes, style } = runPrepaint({
      getItem: () => { throw new DOMException('Storage blocked', 'SecurityError'); },
    });
    expect(attributes.size).toBe(0);
    expect(style).toEqual({});
  });
});
