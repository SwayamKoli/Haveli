import { useCallback, useEffect, useState } from 'react';

export const PAGES = ['dashboard', 'bookings', 'rooms', 'guests', 'analytics'] as const;
export type Page = (typeof PAGES)[number];

function read(): Page {
  const h = window.location.hash.slice(1);
  return (PAGES as readonly string[]).includes(h) ? (h as Page) : 'dashboard';
}

/** The current page, kept in the URL after the # so refresh and back-button work. */
export function useRoute(): [Page, (p: Page) => void] {
  const [page, setPage] = useState<Page>(read);
  useEffect(() => {
    const on = () => setPage(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((p: Page) => {
    if (window.location.hash.slice(1) !== p) window.location.hash = p;
    else setPage(p);
  }, []);
  return [page, go];
}
