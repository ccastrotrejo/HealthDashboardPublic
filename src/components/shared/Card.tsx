import type { ReactNode } from 'react';
import { Card as AstryxCard } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { InfoTooltip } from './InfoTooltip';
import { Glyph, expandIcon } from './icons';
import { tooltipCopy, type MetricKey } from '../../hooks/useTooltipCopy';

interface CardProps {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  /** If set, an ⓘ button appears next to the title with this metric's copy. */
  info?: MetricKey;
  /**
   * When provided, the whole card becomes an activatable drill-down surface: a
   * keyboard-focusable overlay button (Enter/Space/click) that fires this
   * handler, plus a corner affordance. The interactive header controls (e.g.
   * the ⓘ tooltip) stay clickable above the overlay.
   */
  onExpand?: () => void;
  /** Accessible label for the drill-down button, e.g. "HRV". */
  expandLabel?: string;
  /**
   * Size to content instead of filling the grid row.
   *
   * Cards default to `h-full` so a card stretched by a taller neighbour can
   * hand that space to a chart. A card with no chart has nothing to do with it,
   * so the slack becomes dead space inside the card instead.
   */
  fitContent?: boolean;
}

/**
 * Generic card shell built on the Astryx `Card`. The title uses the Astryx
 * `Heading`; subtitle and the right slot stay as plain elements (the design
 * relies on precise Tailwind sizing/color here).
 */
export function Card({
  title,
  subtitle,
  right,
  children,
  className = '',
  info,
  onExpand,
  expandLabel,
  fitContent = false,
}: CardProps) {
  const copy = info ? tooltipCopy[info] : null;
  const expandable = onExpand != null;
  return (
    <AstryxCard
      padding={5}
      className={`glass-panel editorial-card group/card relative flex min-w-0 flex-col border-transparent shadow-border ${
        fitContent ? 'h-fit' : 'h-full'
      } ${expandable ? 'expandable-card' : ''} ${className}`}
    >
      {expandable && (
        <>
          <button
            type="button"
            onClick={onExpand}
            aria-label={`View ${expandLabel ?? title} full history`}
            className="absolute inset-0 z-10 rounded-[inherit] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
          {/* Always visible, not hover-revealed: on touch there is no hover, so
              a hover-only affordance means the card looks inert until tapped. */}
          <span
            aria-hidden
            className="pointer-events-none absolute right-3 top-3 z-20 text-ink-500 group-hover/card:text-ink-900 group-focus-within/card:text-ink-900"
          >
            <Glyph icon={expandIcon} size="sm" />
          </span>
        </>
      )}
      {/* Only the drill-down variant needs the header to sit out of the
          overlay's way. On a plain card the header stays selectable so titles
          and subtitles can be copied. */}
      <header
        className={`relative z-20 mb-4 flex min-w-0 shrink-0 flex-wrap items-start justify-between gap-x-3 gap-y-2 ${
          expandable ? 'pointer-events-none' : ''
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Heading level={3} className="text-base font-semibold tracking-tight text-ink-900">
              {title}
            </Heading>
            {copy && (
              <span className="pointer-events-auto">
                <InfoTooltip title={copy.title} body={copy.body} thresholds={copy.thresholds} />
              </span>
            )}
          </div>
          {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
        </div>
        {right && (
          <div
            className={`min-w-0 text-xs leading-snug text-ink-500 sm:max-w-[55%] sm:text-right ${
              expandable ? 'pointer-events-auto pr-5' : ''
            }`}
          >
            {right}
          </div>
        )}
      </header>
      {/* Body owns the remaining height, so a card stretched by a taller
          neighbour can hand that space to a chart (`flex-1`) instead of
          leaving a void under its content. */}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </AstryxCard>
  );
}
