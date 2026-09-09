import { useCallback, useLayoutEffect, useRef, useState } from 'react';

interface Size {
  width: number;
  height: number;
}

/**
 * Observes an element's content-box size.
 *
 * Used by charts that need real pixel dimensions rather than a hard-coded
 * width — the SVG geometry is computed in user units, so it has to be re-run
 * whenever the container resizes (breakpoint change, sidebar, zoom).
 *
 * Returns `{ width: 0, height: 0 }` until the first measurement lands, so
 * callers should reserve space with a min-height and skip rendering until the
 * size is known.
 */
export function useElementSize<T extends HTMLElement>(): [
  (node: T | null) => void,
  Size,
] {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const box = entry.contentRect;
      setSize((prev) =>
        prev.width === box.width && prev.height === box.height
          ? prev
          : { width: box.width, height: box.height },
      );
    });
    observer.observe(node);
    observerRef.current = observer;

    const rect = node.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
  }, []);

  useLayoutEffect(() => () => observerRef.current?.disconnect(), []);

  return [ref, size];
}
