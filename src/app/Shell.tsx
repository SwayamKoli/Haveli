/**
 * The signed-in app: sidebar, top bar and the page that is open.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StageMenu } from '../components/StageMenu';
import { Toasts } from '../components/Toasts';
import { AnalyticsPage } from '../features/analytics/AnalyticsPage';
import { BookingsPage } from '../features/bookings/BookingsPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { GuestsPage } from '../features/guests/GuestsPage';
import { RoomsPage } from '../features/rooms/RoomsPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { animatePage } from '../lib/motion';
import { useRoute } from '../lib/route';
import { useStore } from '../state/store';
import { Layers } from './Layers';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function Shell() {
  const { setMenu, data, backend, staff } = useStore();
  const [page, go] = useRoute();
  const mobileQuery = () => window.matchMedia('(max-width:820px)').matches;
  const [rail, setRail] = useState(() => window.matchMedia('(max-width:1000px)').matches && !mobileQuery());
  const [open, setOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
    animatePage(mainRef.current);
    setOpen(false);
  }, [page]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === 'Escape') {
        setMenu(null);
        setOpen(false);
      }
    };
    const down = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.('.menu')) setMenu(null);
    };
    const resize = () => {
      if (!mobileQuery()) setOpen(false);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', down);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', down);
      window.removeEventListener('resize', resize);
    };
  }, [setMenu]);

  /* Switching the sidebar is a plain class change: nothing is animated frame by frame, so nothing lags. */
  const toggleRail = useCallback(() => {
    if (mobileQuery()) setOpen((o) => !o);
    else setRail((r) => !r);
  }, []);

  return (
    <>
      <div className="app" id="app">
        <Sidebar page={page} go={go} rail={rail} open={open} onRail={toggleRail} onNavigate={() => setOpen(false)} />
        <div className="col">
          <Topbar go={go} onMenu={() => setOpen((o) => !o)} searchRef={searchRef} />
          <main className="main" id="main" tabIndex={-1} ref={mainRef}>
            {backend.mode === 'live' && data.warnings.length > 0 && page === 'dashboard' && (
              <p className="chip warn anim" style={{ height: 'auto', padding: '8px 14px', marginBottom: 14, whiteSpace: 'normal' }} role="status">
                {data.warnings.length} sheet row{data.warnings.length === 1 ? ' was' : 's were'} skipped because they could not be read.
                {staff?.owner ? ' Open Settings to see which.' : ' Ask the owner to check the sheet.'}
              </p>
            )}
            {page === 'dashboard' && <DashboardPage go={go} />}
            {page === 'bookings' && <BookingsPage />}
            {page === 'rooms' && <RoomsPage />}
            {page === 'guests' && <GuestsPage />}
            {page === 'analytics' && <AnalyticsPage />}
            {page === 'settings' && <SettingsPage />}
          </main>
        </div>
      </div>
      <Layers />
      <StageMenu />
      <Toasts />
    </>
  );
}
