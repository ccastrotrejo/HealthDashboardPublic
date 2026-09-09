interface MetricRingProps {
  progress: number;
  value: string;
}

/** Decorative alternative; the enclosing feature also prints its exact value in HTML. */
export function MetricRing({ progress, value }: MetricRingProps) {
  return (
    <svg viewBox="0 0 200 160" aria-hidden="true" className="h-full w-full">
      <circle cx="100" cy="80" r="55" fill="none" stroke="var(--color-ink-200)" strokeWidth="12" />
      {progress > 0 && (
        <circle cx="100" cy="80" r="55" fill="none" stroke="var(--color-sage-ink)" strokeWidth="12"
          pathLength="100" strokeDasharray={`${progress * 100} 100`}
          transform="rotate(-90 100 80)" />
      )}
      <text x="100" y="85" textAnchor="middle" fill="var(--color-ink-900)" fontSize="20"
        fontWeight="600">{value}</text>
    </svg>
  );
}
