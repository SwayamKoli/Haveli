/**
 * The menu on the left: the hotel logo, pages, settings, logout.
 */
import { Logo } from '../components/Brand';
import { Icon, type IconName } from '../components/Icon';
import type { Page } from '../lib/route';
import { attentionRooms } from '../lib/selectors';
import { useStore } from '../state/store';

const NAV: [Page, string, IconName][] = [
  ['dashboard', 'Dashboard', 'grid'],
  ['bookings', 'Bookings', 'cal'],
  ['rooms', 'Rooms', 'bed'],
  ['guests', 'Guests', 'users'],
  ['analytics', 'Analytics', 'chart'],
];

export function Sidebar({ page, go, rail, open, onRail, onNavigate }: { page: Page; go: (p: Page) => void; rail: boolean; open: boolean; onRail: () => void; onNavigate: () => void }) {
  const { data, backend, openLayer, toast, hotel } = useStore();
  const reserved = data.bookings.filter((b) => b.stage === 'reserved').length;
  const badge: Partial<Record<Page, number>> = { bookings: reserved, rooms: attentionRooms(data).length };
  return (
    <aside className={`side${rail ? ' rail' : ''}${open ? ' open' : ''}`} id="side" aria-label="Main navigation">
      <div className="brand">
        <Logo name={hotel} />
        <button className="sq" id="railBtn" onClick={onRail} aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'} title={rail ? 'Expand sidebar' : 'Collapse sidebar'}>
          <Icon name="panel" />
        </button>
      </div>
      <div className="grp">MENU</div>
      <div>
        {NAV.map(([p, label, icon]) => (
          <button key={p} className={`nav${page === p ? ' on' : ''}`} title={label} aria-current={page === p ? 'page' : undefined} onClick={() => { go(p); onNavigate(); }}>
            <Icon name={icon} />
            <span className="lbl">{label}</span>
            {badge[p] ? <span className="badge num">{badge[p]}</span> : null}
          </button>
        ))}
      </div>
      <div className="grp">GENERAL</div>
      <div>
        <button className={`nav${page === 'settings' ? ' on' : ''}`} title="Settings" aria-current={page === 'settings' ? 'page' : undefined} onClick={() => { go('settings'); onNavigate(); }}>
          <Icon name="gear" />
          <span className="lbl">Settings</span>
        </button>
        <button className="nav" title="Help" onClick={() => { toast('Press Ctrl K to search. Click any booking to see its details or to edit it.'); onNavigate(); }}>
          <Icon name="help" />
          <span className="lbl">Help</span>
        </button>
        <button className="nav" title="Logout" onClick={() => { if (backend.mode === 'live') openLayer({ kind: 'confirm-logout' }); else toast('Demo mode has no sign-in to leave.'); onNavigate(); }}>
          <Icon name="out" />
          <span className="lbl">Logout</span>
        </button>
      </div>
      <div className="spacer" />
      <div className="sidefoot">
        {backend.mode === 'demo' ? 'Demo data · not saved' : 'Live · Google Sheets'}
      </div>
    </aside>
  );
}
