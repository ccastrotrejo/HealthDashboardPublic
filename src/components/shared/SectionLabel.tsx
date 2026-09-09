import type { ReactNode } from 'react';
import { Heading } from '@astryxdesign/core/Heading';

/** A quiet editorial boundary between distinct operating contexts. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <Heading level={2} className="text-lg font-semibold tracking-tight text-ink-900">
        {children}
      </Heading>
      <span aria-hidden className="h-px flex-1 bg-ink-200" />
    </div>
  );
}
