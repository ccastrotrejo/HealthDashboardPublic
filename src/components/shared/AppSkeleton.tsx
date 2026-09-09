interface AppSkeletonProps {
  compact?: boolean;
}

/** Layout-matched loading state for the app shell and lazy tab panels. */
export function AppSkeleton({ compact = false }: AppSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading dashboard"
      className={compact ? 'mt-8 space-y-4' : 'mx-auto max-w-7xl space-y-6 p-6 md:p-8'}
    >
      {!compact && (
        <div className="space-y-3">
          <div className="h-8 w-52 rounded-md bg-ink-200" />
          <div className="h-4 w-full max-w-md rounded bg-ink-200" />
          <div className="h-3 w-64 rounded bg-ink-200" />
          <div className="mt-6 h-14 rounded-lg bg-ink-200" />
        </div>
      )}
      <div className="grid overflow-hidden rounded-2xl bg-ink-200 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="h-72 bg-ink-200" />
        <div className="h-60 border-t border-ink-100/50 bg-ink-200/80 lg:h-72 lg:border-l lg:border-t-0" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
