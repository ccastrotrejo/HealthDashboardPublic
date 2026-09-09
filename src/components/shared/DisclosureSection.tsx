import type { ReactNode, SyntheticEvent } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { useUrlPanel } from '../../hooks/useUrlPanel';
import { Glyph, disclosureIcon } from './icons';

interface DisclosureSectionProps {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}

/** Progressive disclosure for dense analysis and reference sections. */
export function DisclosureSection({
  id,
  title,
  description,
  children,
  className = '',
  defaultOpen = false,
}: DisclosureSectionProps) {
  const [isOpen, setIsOpen] = useUrlPanel(id, defaultOpen);

  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setIsOpen(event.currentTarget.open);
  };

  return (
    <details
      id={id}
      className={`group/disclosure border-y border-ink-200 bg-ink-100/35 ${className}`}
      open={isOpen}
      onToggle={onToggle}
    >
      <summary className="disclosure-trigger flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-1 py-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <Heading level={2} className="text-lg font-semibold tracking-tight text-ink-900">
            {title}
          </Heading>
          <span className="mt-1 block max-w-[70ch] text-xs leading-relaxed text-ink-500">
            {description}
          </span>
        </span>
        <span
          aria-hidden
          className="disclosure-chevron shrink-0 origin-center text-ink-500 transition-transform duration-150 ease-out-strong group-open/disclosure:rotate-90"
        >
          <Glyph icon={disclosureIcon} size="sm" />
        </span>
      </summary>
      <div id={`${id}-content`} className="border-t border-ink-200 py-5">
        {children}
      </div>
    </details>
  );
}
