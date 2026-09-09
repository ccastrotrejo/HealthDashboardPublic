/**
 * The app's one icon vocabulary.
 *
 * There used to be four running side by side — emoji for sports, intensities,
 * anomaly severities, gear and nutrition; a hand-drawn SVG on the card expand
 * affordance; Astryx/Lucide inside Astryx components; and text glyphs (▸ ↑ ↓ →
 * ⚠ ✓) sprinkled through the rest. Emoji were the worst of the four: they
 * render differently on every OS, they can't take `currentColor`, and they
 * dropped saturated cartoon color into an otherwise restrained palette.
 *
 * Everything now resolves to Lucide, which the Astryx neutral theme already
 * ships, so the icons here and the icons inside Astryx components are drawn
 * from the same hand. Per-icon imports keep this tree-shakeable.
 *
 * Icons are decorative by default: every call site pairs them with a real text
 * label, so they render `aria-hidden` and add nothing to the accessible name.
 */
import {
  Activity,
  AlertTriangle,
  Anchor,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bike,
  Check,
  ChevronRight,
  CircleAlert,
  Cog,
  Dumbbell,
  Flag,
  Flame,
  Footprints,
  Fuel,
  Info,
  Maximize2,
  Moon,
  Mountain,
  MountainSnow,
  Move,
  PersonStanding,
  ShoppingBasket,
  Snowflake,
  Sparkles,
  Target,
  TrendingUp,
  UtensilsCrossed,
  Waves,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type { LucideIcon };

/**
 * Standard icon sizes, matched to the type scale they sit beside.
 * `sm` rides 11–12px captions, `md` rides body copy, `lg` leads a card.
 */
export const iconSize = { sm: 12, md: 16, lg: 22 } as const;
export type IconSize = keyof typeof iconSize;

/** Sport → icon. Falls back to a generic activity mark for unknown sports. */
export function sportIcon(sportType: string): LucideIcon {
  const s = sportType.toLowerCase();
  if (s.includes('run')) return Footprints;
  if (s.includes('ride') || s.includes('cycling') || s.includes('velomobile')) return Bike;
  if (s.includes('swim')) return Waves;
  if (s.includes('walk')) return PersonStanding;
  if (s.includes('hike')) return Mountain;
  if (s.includes('yoga')) return Move;
  if (s.includes('weight') || s.includes('strength') || s.includes('crossfit')) return Dumbbell;
  if (s.includes('row')) return Waves;
  if (s.includes('ski') || s.includes('snowboard')) return MountainSnow;
  if (s.includes('climb')) return Mountain;
  if (s.includes('surf')) return Waves;
  if (s.includes('skate')) return Zap;
  if (s.includes('workout')) return Dumbbell;
  return Activity;
}

/** Today's-call intensity → icon, quietest to loudest. */
export const intensityIcon = {
  rest: Moon,
  easy: PersonStanding,
  moderate: Footprints,
  hard: Flame,
} as const;

/** Anomaly severity → icon. Paired with the severity word, never alone. */
export const severityIcon = {
  info: Info,
  caution: CircleAlert,
  warning: AlertTriangle,
} as const;

/** Escalation banner mark — the loudest thing the dashboard can say. */
export const escalationIcon = AlertTriangle;

/** Gear kind → icon. */
export const gearIcon = {
  shoe: Footprints,
  bike: Bike,
  other: Cog,
} as const;

/** Nutrition section → icon. */
export const nutritionIcon = {
  dailyAnchors: Anchor,
  preAndPostFueling: Fuel,
  mealIdea: UtensilsCrossed,
  groceryItem: ShoppingBasket,
} as const;

/** Race priority → icon. A/B/C races differ in weight, not in kind. */
export const racePriorityIcon = {
  A: Flag,
  B: Target,
  C: Sparkles,
} as const;

/** Trend direction → icon, for deltas and contributor rows. */
export const directionIcon = {
  up: ArrowUp,
  down: ArrowDown,
  neutral: ArrowRight,
} as const;

/** Shared single-purpose marks. */
export const checkIcon = Check;
export const disclosureIcon = ChevronRight;
export const expandIcon = Maximize2;
export const trendIcon = TrendingUp;
export const coldIcon = Snowflake;

/**
 * Convenience wrapper for the common case: a decorative icon sitting next to
 * its own text label. Keeps stroke width and `aria-hidden` consistent so call
 * sites don't each re-decide them.
 */
export function Glyph({
  icon: Component,
  size = 'md',
  className = '',
}: {
  icon: LucideIcon;
  size?: IconSize;
  className?: string;
}) {
  return (
    <Component
      aria-hidden
      focusable={false}
      size={iconSize[size]}
      strokeWidth={1.75}
      className={`shrink-0 ${className}`}
    />
  );
}

/** `Glyph` for a sport, resolved from its Strava/Whoop sport_type string. */
export function SportGlyph({
  sportType,
  size = 'md',
  className = '',
}: {
  sportType: string;
  size?: IconSize;
  className?: string;
}) {
  return <Glyph icon={sportIcon(sportType)} size={size} className={className} />;
}
