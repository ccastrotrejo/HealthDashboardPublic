import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

/**
 * Horizontal scroll rail for controls that can't wrap — the sport filter and
 * the correlation axis pickers are segmented controls whose intrinsic width
 * grows with the number of options, and on a phone that pushed the whole page
 * ~700px wide.
 *
 * `min-w-0` lets it shrink inside a flex parent, `w-max` keeps the control at
 * its natural size, and the negative margin/padding pair keeps the focus ring
 * from being clipped by the scroll container.
 */
export function ScrollRow({ children, className = '' }: Props) {
  return (
    <div className={`-my-1 min-w-0 max-w-full overflow-x-auto py-1 ${className}`}>
      <div className="w-max">{children}</div>
    </div>
  );
}
