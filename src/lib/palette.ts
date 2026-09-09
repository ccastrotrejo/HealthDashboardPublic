/**
 * The single source of truth for every color in the dashboard.
 *
 * Three consumers used to each carry their own copy of these hexes — the
 * `@theme` block in globals.css, `astryxTheme.ts`, and ~80 literals scattered
 * through component files. They drifted (ActivitiesList grew two blues that
 * were in no ramp at all), and there was no way to change a hue once.
 *
 * Now: this file owns the values, `astryxTheme.ts` and `chartTheme.ts` import
 * them, and components read them through `useBrandPalette()` so SVG/Recharts
 * attributes — which can't resolve CSS `var()` — still get a concrete hex for
 * the active color mode. The `@theme` block in globals.css is the one place
 * that necessarily restates them (CSS can't import TS); it carries a pointer
 * back here.
 *
 * Contrast rule baked into the ramp shape:
 *   · `-500` is a FILL/STROKE tone. It is never legible as small text on the
 *     light card surface (amber-500 measures 2.35:1). Do not use it for text.
 *   · `-700` is the light-mode TEXT tone (4.3–7.4:1 on the card).
 *   · `-300` is the dark-mode TEXT tone (lightened to clear AA on dark).
 */
import { useMemo } from 'react';
import { useTheme } from '@astryxdesign/core/theme';

export type Hue = 'sage' | 'amber' | 'terra' | 'dusty' | 'cool';

/** Brand hue ramps. `50` tint · `300` dark-mode text · `500` fill · `700` light-mode text. */
export const brand = {
  sage: { 50: '#eaf4ef', 300: '#78b092', 500: '#3f8060', 700: '#205f43' },
  amber: { 50: '#fbf1d9', 300: '#e2b75c', 500: '#bf8730', 700: '#7a5316' },
  terra: { 50: '#faeae5', 300: '#e58e78', 500: '#c6583f', 700: '#883522' },
  dusty: { 50: '#f2edf4', 300: '#b79ac0', 500: '#8e6f99', 700: '#654c6d' },
  cool: { 50: '#eaf0f8', 300: '#86a9d2', 500: '#4f79ae', 700: '#2c527e' },
} as const;

/**
 * Mode-aware tint background for each hue, as `[light, dark]`.
 *
 * The light branch is the hue's `-50`; the dark branch is that same hue mixed
 * ~18% over the dark card, because a `-50` pastel panel dropped into a dark UI
 * reads as a hole punched in the page. Paired with the hue's text tone
 * (`-700` light, `-300` dark) every combination measures 5.0–6.6:1.
 *
 * Mirrored in globals.css as `--color-{hue}-surface`.
 */
export const hueSurface = {
  sage: ['#eaf4ef', '#1d3027'] as [string, string],
  amber: ['#fbf1d9', '#352d1e'] as [string, string],
  terra: ['#faeae5', '#38241f'] as [string, string],
  dusty: ['#f2edf4', '#302633'] as [string, string],
  cool: ['#eaf0f8', '#202d3a'] as [string, string],
} as const;

/**
 * Neutral surfaces and ink, as `[light, dark]` tuples.
 *
 * `card` is deliberately NOT `#ffffff` — a pure-white surface reads flat and
 * synthetic against the tinted neutrals around it. It carries the same warm
 * cast as the rest of the ramp, and `body` sits a step deeper so cards
 * separate from the page without needing a heavier border.
 */
export const surface = {
  body: ['#eef1ee', '#101412'] as [string, string],
  card: ['#fbfcfa', '#171c19'] as [string, string],
  textPrimary: ['#17201d', '#f3f6f3'] as [string, string],
  /** Secondary ink. Light value is the AA floor on `card` (5.9:1), not a hint. */
  textSecondary: ['#4b5a55', '#a7b2ad'] as [string, string],
  border: ['#d9dfdb', '#2a332f'] as [string, string],
  borderEmphasized: ['#c5cec8', '#3a4640'] as [string, string],
} as const;

/** Chart furniture — axis ticks, gridlines, reference lines. */
export const chartInk = {
  axis: ['#4b5a55', '#a7b2ad'] as [string, string],
  grid: ['#d9dfdb', '#2a332f'] as [string, string],
  emphasis: ['#17201d', '#f3f6f3'] as [string, string],
} as const;

/**
 * Heart-rate zone ramp (Z0–Z5), read as cool → warm.
 *
 * There used to be two of these with different values for the same six zones
 * (the weekly mix card and the activity rows disagreed), plus two blues that
 * belonged to no ramp at all. This is the only one. Zone identity is carried
 * by HUE, not lightness, so the sequence survives both surfaces; only the
 * darkest end swaps, because there is no "darker" on a dark card.
 */
const zoneScaleLight = [
  brand.cool[300],
  brand.cool[500],
  brand.sage[500],
  brand.amber[500],
  brand.terra[500],
  brand.terra[700],
] as const;

const zoneScaleDark = [
  brand.cool[300],
  brand.cool[500],
  brand.sage[500],
  brand.amber[500],
  brand.terra[500],
  brand.terra[300],
] as const;

/**
 * Training-density ramp for the calendar heatmap, quietest → densest.
 * Index 0 is the "no activity" track and follows the neutral ramp.
 */
const heatScaleLight = ['#d9dfdb', '#c8dacd', '#91b49d', brand.sage[500], brand.sage[700]] as const;
const heatScaleDark = ['#2a332f', '#304a3d', '#4f775f', brand.sage[500], brand.sage[300]] as const;

type Mode = 'light' | 'dark';

/**
 * Tailwind class for a hue's text tone, as a static literal so the Tailwind
 * scanner can see it. Prefer this over `useBrandPalette().text(hue)` whenever
 * the target is an element that can take a class — it flips with the theme
 * through CSS rather than a React re-render.
 */
export const hueTextClass: Record<Hue, string> = {
  sage: 'text-sage-ink',
  amber: 'text-amber-ink',
  terra: 'text-terra-ink',
  dusty: 'text-dusty-ink',
  cool: 'text-cool-ink',
};

/** Tailwind class for a hue's tint background. Static literals, same reason. */
export const hueSurfaceClass: Record<Hue, string> = {
  sage: 'bg-sage-surface',
  amber: 'bg-amber-surface',
  terra: 'bg-terra-surface',
  dusty: 'bg-dusty-surface',
  cool: 'bg-cool-surface',
};

const pick = <T,>(tuple: readonly [T, T], mode: Mode): T =>
  mode === 'dark' ? tuple[1] : tuple[0];

export interface BrandPalette {
  mode: Mode;
  /** Data-viz fill/stroke for a hue. Identical in both modes so charts stay comparable. */
  fill: (hue: Hue) => string;
  /** Legible text color for a hue in the active mode (`-700` light, `-300` dark). */
  text: (hue: Hue) => string;
  /** Neutral surfaces + ink resolved for the active mode. */
  surface: { body: string; card: string; ink: string; inkSecondary: string; border: string };
  /** Chart furniture resolved for the active mode. */
  chart: { axis: string; grid: string; emphasis: string };
  /** HR zones Z0–Z5, resolved for the active mode. */
  zoneScale: readonly string[];
  /** Calendar-heatmap density ramp, resolved for the active mode. */
  heatScale: readonly string[];
}

/**
 * Resolve the palette for the active color mode.
 *
 * Call this inside any component that needs a concrete hex — SVG `fill`,
 * `stroke`, or a Recharts color prop. Anything that can use a CSS class should
 * use the Tailwind tokens (`text-sage-ink`, `bg-terra-surface`) instead, so
 * the value flips without a re-render.
 */
export function useBrandPalette(): BrandPalette {
  const { mode: rawMode } = useTheme();
  const mode: Mode = rawMode === 'dark' ? 'dark' : 'light';

  return useMemo(
    () => ({
      mode,
      fill: (hue: Hue) => brand[hue][500],
      text: (hue: Hue) => (mode === 'dark' ? brand[hue][300] : brand[hue][700]),
      surface: {
        body: pick(surface.body, mode),
        card: pick(surface.card, mode),
        ink: pick(surface.textPrimary, mode),
        inkSecondary: pick(surface.textSecondary, mode),
        border: pick(surface.border, mode),
      },
      chart: {
        axis: pick(chartInk.axis, mode),
        grid: pick(chartInk.grid, mode),
        emphasis: pick(chartInk.emphasis, mode),
      },
      zoneScale: mode === 'dark' ? zoneScaleDark : zoneScaleLight,
      heatScale: mode === 'dark' ? heatScaleDark : heatScaleLight,
    }),
    [mode],
  );
}
