import type { ReactElement } from 'react';
import { ResponsiveContainer } from 'recharts';
import { useElementSize } from '../../hooks/useElementSize';

interface ChartContainerProps {
  children: ReactElement;
}

/** Responsive chart frame with a warning-free first render. */
export function ChartContainer({ children }: ChartContainerProps) {
  const [containerRef, size] = useElementSize<HTMLDivElement>();

  return (
    <div ref={containerRef} className="h-full w-full min-w-0">
      {size.width > 0 && size.height > 0 && (
        <ResponsiveContainer
          width={size.width}
          height={size.height}
          initialDimension={size}
        >
          {children}
        </ResponsiveContainer>
      )}
    </div>
  );
}
