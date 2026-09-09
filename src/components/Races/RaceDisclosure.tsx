import type { ReactNode } from 'react';

interface Props {
  title: string;
  description?: string;
  value?: string;
  children: ReactNode;
}

export function RaceDisclosure({ title, description, value, children }: Props) {
  return (
    <details className="min-w-0 rounded-xl border border-border bg-card">
      <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm text-ink-900 marker:text-ink-500 hover:bg-ink-50/50">
        <span className="ml-1 inline-flex w-[calc(100%_-_1.5rem)] flex-wrap items-baseline justify-between gap-x-4 gap-y-1 align-top">
          <span className="min-w-0 flex-1 basis-48">
            <span className="font-semibold [overflow-wrap:anywhere]">{title}</span>
            {description && <span className="mt-1 block text-caption text-ink-500">{description}</span>}
          </span>
          {value && <span className="text-sm tabular-nums text-ink-700">{value}</span>}
        </span>
      </summary>
      <div className="min-w-0 space-y-4 border-t border-border p-3 sm:p-4">{children}</div>
    </details>
  );
}
