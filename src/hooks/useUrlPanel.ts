import { useCallback, useEffect, useState } from 'react';

/** Keep an expandable panel's open state shareable in the URL query string. */
export function useUrlPanel(id: string, defaultOpen = false) {
  const readOpenState = useCallback(() => {
    const panels = new URLSearchParams(window.location.search).getAll('panel');
    return panels.length > 0 ? panels.includes(id) : defaultOpen;
  }, [defaultOpen, id]);
  const [isOpen, setIsOpenState] = useState(readOpenState);

  useEffect(() => {
    const syncFromUrl = () => setIsOpenState(readOpenState());
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [readOpenState]);

  const setIsOpen = useCallback(
    (nextOpen: boolean) => {
      setIsOpenState(nextOpen);

      const url = new URL(window.location.href);
      const panels = new Set(url.searchParams.getAll('panel'));
      if (nextOpen) panels.add(id);
      else panels.delete(id);
      url.searchParams.delete('panel');
      [...panels].sort().forEach((panel) => url.searchParams.append('panel', panel));
      history.replaceState(null, '', url);
    },
    [id],
  );

  return [isOpen, setIsOpen] as const;
}
