import { useEffect, useState } from 'react';

export type TabId = 'dashboard' | 'review' | 'races' | 'training';

const VALID: TabId[] = ['dashboard', 'review', 'races', 'training'];

function parseHash(): TabId {
  const h = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  return (VALID as string[]).includes(h) ? (h as TabId) : 'dashboard';
}

/**
 * Hash-based tab routing — no React Router dep. The URL hash mirrors the
 * active tab so deep-linking and back/forward both work. Defaults to
 * 'dashboard' when the hash is missing or unknown.
 */
export function useTab() {
  const [tab, setTabState] = useState<TabId>(() => parseHash());

  useEffect(() => {
    const onHash = () => setTabState(parseHash());
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, []);

  const setTab = (next: TabId) => {
    const url =
      next === 'dashboard'
        ? window.location.pathname + window.location.search
        : window.location.pathname + window.location.search + `#${next}`;
    history.pushState(null, '', url);
    setTabState(next);
  };

  return { tab, setTab };
}
