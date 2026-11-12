import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { SessionInfo } from '../shared/types';
import { DEMO, HOTEL_NAME } from './config';
import { makeLiveBackend } from './lib/api';
import type { Backend } from './lib/api';
import { makeDemoBackend } from './lib/demo';
import { errText, initials, hue } from './lib/format';
import { animatePage, gsap, motionOn } from './lib/motion';
import { useRoute } from './lib/route';
import type { Page } from './lib/route';
import { attentionRooms, arrivalsToday, roomState } from './lib/selectors';
import { Layers } from './modals';
import { Analytics } from './pages/Analytics';
import { Bookings } from './pages/Bookings';
import { Dashboard } from './pages/Dashboard';
import { Guests } from './pages/Guests';
import { Rooms } from './pages/Rooms';
import { StoreProvider, useStore } from './store';
import { Avatar, Icon, StageMenu, Toasts } from './ui';
import type { IconName } from './ui';
import { ROOM_STATE_LABEL, STAGE_LABEL } from '../shared/constants';

/* ---------- sign-in ---------- */

function Login({ backend, session, onSignedIn }: { backend: Backend; session: SessionInfo; onSignedIn: (s: SessionInfo) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError('');
    try {
      onSignedIn(await backend.login(password));
    } catch (err) {
      setError(errText(err));
      setPassword('');
    }
    setBusy(false);
  }

  return (
    <div className="login-wrap">
      <form className="modal login-card" onSubmit={submit} aria-labelledby="lt">
        <div className="logo" style={{ marginBottom: 18 }}>
          <i><Icon name="hotel" /></i>
          <span className="lbl">haveli</span>
        </div>
        <h2 id="lt">Sign in</h2>
        <p style={{ color: 'var(--muted)', margin: '6px 0 18px' }}>{HOTEL_NAME} · front desk</p>
        {!session.configured ? (
          <div role="alert" style={{ color: 'var(--warn)', lineHeight: 1.6 }}>
            The server is not set up yet. Open the <b>.env</b> file in the project folder and fill in:
            <ul style={{ margin: '8px 0 0 18px' }}>
              {session.missing.map((m) => <li key={m}>{m}</li>)}
            </ul>
            <p style={{ color: 'var(--muted)', marginTop: 10 }}>Then restart the app. README.md explains each one.</p>
          </div>
        ) : (
          <>
            <div className={`form${error ? ' bad' : ''}`}>
              <div className="full">
                <label htmlFor="pw">Password</label>
                <input id="pw" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
                <div className="err" role={error ? 'alert' : undefined}>{error}</div>
              </div>
            </div>
            <div className="mf">
              <button className="btn primary" type="submit" disabled={busy || !password}>{busy ? 'Checking…' : 'Sign in'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

/* ---------- navigation ---------- */

const NAV: [Page, string, IconName][] = [
  ['dashboard', 'Dashboard', 'grid'],
  ['bookings', 'Bookings', 'cal'],
  ['rooms', 'Rooms', 'bed'],
  ['guests', 'Guests', 'users'],
  ['analytics', 'Analytics', 'chart'],
];

function Sidebar({ page, go, rail, open, onRail, onNavigate }: { page: Page; go: (p: Page) => void; rail: boolean; open: boolean; onRail: () => void; onNavigate: () => void }) {
  const { data, backend, openLayer, toast, logout } = useStore();
  const ref = useRef<HTMLElement>(null);
  const reserved = data.bookings.filter((b) => b.stage === 'reserved').length;
  const badge: Partial<Record<Page, number>> = { bookings: reserved, rooms: attentionRooms(data).length };
  const general: [string, IconName, () => void][] = [
    ['Settings', 'gear', () => openLayer({ kind: 'settings' })],
    ['Help', 'help', () => toast('Help is not written yet. README.md in the project folder explains the app.')],
    ['Logout', 'out', () => (backend.mode === 'live' ? logout() : toast('Demo mode has no sign-in to leave.'))],
  ];
  return (
    <aside className={`side${rail ? ' rail' : ''}${open ? ' open' : ''}`} id="side" aria-label="Main navigation" ref={ref}>
      <div className="brand">
        <div className="logo">
          <i><Icon name="hotel" /></i>
          <span className="lbl">haveli</span>
        </div>
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
        {general.map(([label, icon, fn]) => (
          <button key={label} className="nav" title={label} onClick={() => { fn(); onNavigate(); }}>
            <Icon name={icon} />
            <span className="lbl">{label}</span>
          </button>
        ))}
      </div>
      <div className="spacer" />
      <div className="sidefoot">
        {HOTEL_NAME}
        <br />
        {backend.mode === 'demo' ? 'Demo data · not saved' : 'Live · Google Sheets'}
      </div>
    </aside>
  );
}

function Topbar({ go, onMenu, searchRef }: { go: (p: Page) => void; onMenu: () => void; searchRef: RefObject<HTMLInputElement | null> }) {
  const { data, staff, setUi, toast } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [bellSeen, setBellSeen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', away);
    return () => document.removeEventListener('click', away);
  }, []);

  const term = q.trim().toLowerCase();
  const guests = term ? data.bookings.filter((b) => b.guest.toLowerCase().includes(term) || b.mobile.includes(term)).slice(0, 4) : [];
  const rooms = term ? data.rooms.filter((r) => String(r.no).includes(term) || r.type.toLowerCase().includes(term)).slice(0, 3) : [];
  const name = staff?.name ?? 'Guest';

  return (
    <header className="top">
      <button className="round menu-btn" id="menuBtn" aria-label="Open menu" onClick={onMenu}><Icon name="menu" /></button>
      <div className="search" ref={wrap}>
        <span><Icon name="search" /></span>
        <input
          id="q"
          ref={searchRef}
          type="search"
          placeholder="Search guests or rooms"
          autoComplete="off"
          aria-label="Search guests and rooms"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        <span className="kbd" id="kbd">Ctrl K</span>
        {open && term && (
          <div className="results" id="results">
            {guests.length || rooms.length ? (
              <>
                {guests.map((b) => (
                  <button key={b.id} data-sg={b.id} onClick={() => { setUi({ bq: b.guest, bsrc: 'All', bview: 'board' }); go('bookings'); setQ(''); setOpen(false); }}>
                    <Avatar name={b.guest} />
                    <span>{b.guest}</span>
                    <small>Room {b.room} · {STAGE_LABEL[b.stage]}</small>
                  </button>
                ))}
                {rooms.map((r) => (
                  <button key={r.no} data-sr={r.no} onClick={() => { setUi({ rq: String(r.no), rst: 'All', rfl: 'All' }); go('rooms'); setQ(''); setOpen(false); }}>
                    <span className="av" style={{ background: '#cfe5ee' }}><Icon name="bed" size={15} /></span>
                    <span>Room {r.no}</span>
                    <small>{r.type} · {ROOM_STATE_LABEL[roomState(r, data.bookings)]}</small>
                  </button>
                ))}
              </>
            ) : (
              <div className="none">No guest or room matches “{q}”.</div>
            )}
          </div>
        )}
      </div>
      <div className="tspace" />
      <button className="round hide-s" id="mailBtn" aria-label="Messages" onClick={() => toast('Guest messages are not connected yet.')}><Icon name="mail" /></button>
      <button
        className={`round${bellSeen ? '' : ' dot'}`}
        id="bellBtn"
        aria-label="Notifications"
        onClick={() => {
          setBellSeen(true);
          const left = arrivalsToday(data).filter((b) => b.stage === 'reserved').length;
          const att = attentionRooms(data).length;
          toast(left || att ? `${left} arrival${left === 1 ? '' : 's'} still to come and ${att} room${att === 1 ? '' : 's'} need attention.` : 'Nothing needs attention right now.');
        }}
      >
        <Icon name="bell" />
      </button>
      <div className="me">
        <div className="av" style={{ background: hue(name) }}>{initials(name)}</div>
        <div><b>{name}</b><small>{staff?.role ?? ''}</small></div>
      </div>
    </header>
  );
}

/* ---------- the signed-in app ---------- */

function Shell() {
  const { setMenu, data, backend } = useStore();
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
    const move = (e: PointerEvent) => {
      const t = (e.target as Element).closest?.('.stat,.card,.kcard,.room') as HTMLElement | null;
      if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.setProperty('--mx', `${e.clientX - r.left}px`);
      t.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    const resize = () => {
      if (!mobileQuery()) setOpen(false);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', down);
    document.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', down);
      document.removeEventListener('pointermove', move);
      window.removeEventListener('resize', resize);
    };
  }, [setMenu]);

  function toggleRail() {
    if (mobileQuery()) return setOpen((o) => !o);
    const side = document.getElementById('side');
    const w0 = side?.offsetWidth ?? 0;
    flushSync(() => setRail((r) => !r));
    const w1 = side?.offsetWidth ?? 0;
    if (side && motionOn() && w0 !== w1) {
      gsap.fromTo(side, { width: w0 }, { width: w1, duration: 0.55, ease: 'expo.out', clearProps: 'width' });
      gsap.fromTo(side.querySelectorAll('.lbl,.grp'), { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.35, delay: 0.12, clearProps: 'opacity,transform' });
    }
  }

  return (
    <>
      <div className="app" id="app">
        <Sidebar page={page} go={go} rail={rail} open={open} onRail={toggleRail} onNavigate={() => setOpen(false)} />
        <div className="col">
          <Topbar go={go} onMenu={() => setOpen((o) => !o)} searchRef={searchRef} />
          <main className="main" id="main" tabIndex={-1} ref={mainRef}>
            {backend.mode === 'live' && data.warnings.length > 0 && page === 'dashboard' && (
              <p className="chip warn anim" style={{ height: 'auto', padding: '8px 14px', marginBottom: 14, whiteSpace: 'normal' }} role="status">
                {data.warnings.length} sheet row{data.warnings.length === 1 ? ' was' : 's were'} skipped because they could not be read. Open Settings → Sheet status to see which.
              </p>
            )}
            {page === 'dashboard' && <Dashboard go={go} />}
            {page === 'bookings' && <Bookings />}
            {page === 'rooms' && <Rooms />}
            {page === 'guests' && <Guests />}
            {page === 'analytics' && <Analytics />}
          </main>
        </div>
      </div>
      <Layers />
      <StageMenu />
      <Toasts />
    </>
  );
}

/* ---------- root ---------- */

export default function App() {
  const backend = useMemo<Backend>(() => (DEMO ? makeDemoBackend() : makeLiveBackend()), []);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError('');
    backend.session().then(setSession).catch((e) => setError(errText(e)));
  }, [backend, attempt]);

  useEffect(() => {
    const out = () => setSession((s) => (s ? { ...s, authenticated: false, staff: null } : s));
    window.addEventListener('haveli:unauthorized', out);
    return () => window.removeEventListener('haveli:unauthorized', out);
  }, []);

  const signOut = () => {
    void backend.logout().finally(() => setSession((s) => (s ? { ...s, authenticated: false, staff: null } : s)));
  };

  let body;
  if (error) {
    body = (
      <div className="splash" role="alert">
        <h2>Cannot reach the server</h2>
        <p>{error}</p>
        <button className="btn primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  } else if (!session) {
    body = <div className="splash" role="status"><p>Loading…</p></div>;
  } else if (!session.authenticated) {
    body = <Login backend={backend} session={session} onSignedIn={setSession} />;
  } else {
    body = (
      <StoreProvider backend={backend} staff={session.staff} onLogout={signOut}>
        <Shell />
      </StoreProvider>
    );
  }

  return (
    <>
      <div className="orbs" aria-hidden="true"><i /><i /><i /><i /></div>
      {body}
    </>
  );
}

