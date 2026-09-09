import { defineTheme } from '@astryxdesign/core/theme';
import type { TokenValue } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { brand as palette, hueSurface, surface, type Hue } from './palette';

/**
 * Brand theme for the Health Dashboard.
 *
 * Extends the Astryx `neutral` theme (inheriting its Lucide icon set, fonts,
 * and component defaults) and overrides only the color tokens so Astryx
 * components render in the project's sage/amber/terra/cool/dusty palette.
 *
 * The palette itself lives in `lib/palette.ts` — this file only maps it onto
 * Astryx's token names. Every overridden token is a `[light, dark]` tuple,
 * which `defineTheme` compiles to CSS `light-dark()`. The active mode is
 * chosen by the `<Theme>` provider writing `data-theme` onto `<html>` (which
 * sets `color-scheme`), so cards, borders, text, Banners, and Badges all adapt
 * automatically. Both branches are tuned to clear WCAG AA on their surface:
 * light-mode text takes the `-700` step, dark-mode text the `-300` step.
 */

/**
 * Generate the four hue tokens (background/border/icon/text) Astryx uses for
 * Badges, StatusDots, and Banner accents. Both branches come from the shared
 * ramp: the mode-aware `hueSurface` tint as the fill, `-700`/`-300` as the
 * icon and text tone so each clears AA on its own background.
 */
function hueTokens(name: string, hue: Hue): Record<string, TokenValue> {
  const c = palette[hue];
  return {
    [`--color-background-${name}`]: [...hueSurface[hue]],
    [`--color-border-${name}`]: [c[500], c[500]],
    [`--color-icon-${name}`]: [c[700], c[300]],
    [`--color-text-${name}`]: [c[700], c[300]],
  };
}

export const healthTheme = defineTheme({
  name: 'health',
  extends: neutralTheme,
  tokens: {
    // --- Typography ---
    '--font-family-body': "'Archivo Variable', system-ui, sans-serif",
    '--font-family-heading': "'Archivo Variable', system-ui, sans-serif",
    '--font-family-code': "'JetBrains Mono Variable', ui-monospace, monospace",

    // --- Accent (links, focus rings, primary actions) ---
    '--color-accent': [palette.sage[700], palette.sage[500]],
    '--color-accent-muted': 'rgba(63, 128, 96, 0.18)',
    '--color-on-accent': '#ffffff',
    '--color-text-accent': [palette.sage[700], palette.sage[300]],
    '--color-icon-accent': [palette.sage[700], palette.sage[300]],

    // --- Text ---
    '--color-text-primary': surface.textPrimary,
    '--color-text-secondary': surface.textSecondary,
    '--color-icon-primary': surface.textPrimary,
    '--color-icon-secondary': surface.textSecondary,

    // --- Surfaces ---
    '--color-background-body': surface.body,
    '--color-background-surface': surface.card,
    '--color-background-card': surface.card,
    '--color-background-popover': surface.card,

    // --- Borders / lines ---
    '--color-border': surface.border,
    '--color-border-emphasized': surface.borderEmphasized,
    '--color-track': surface.border,
    '--color-skeleton': surface.border,

    // --- Status (green=sage, warning=amber, error=terra). The mid-tone is
    // used as text/icon color on translucent Banner backgrounds, so the dark
    // variant is lightened to stay readable. `on-*` are fixed for solid fills. ---
    '--color-success': [palette.sage[700], palette.sage[300]],
    '--color-on-success': '#ffffff',
    '--color-warning': [palette.amber[700], palette.amber[300]],
    '--color-on-warning': '#1f1f1d',
    '--color-error': [palette.terra[700], palette.terra[300]],
    '--color-on-error': '#ffffff',

    // --- Hue palettes remapped to brand colors (Badge / StatusDot / Banner) ---
    // green -> sage
    ...hueTokens('green', 'sage'),
    // yellow & orange -> amber
    ...hueTokens('yellow', 'amber'),
    ...hueTokens('orange', 'amber'),
    // red -> terra
    ...hueTokens('red', 'terra'),
    // blue & cyan -> cool
    ...hueTokens('blue', 'cool'),
    ...hueTokens('cyan', 'cool'),
    // pink & purple -> dusty
    ...hueTokens('pink', 'dusty'),
    ...hueTokens('purple', 'dusty'),
  },
});
