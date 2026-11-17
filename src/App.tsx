import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import type { SessionInfo } from '../shared/types';
import { ROOM_STATE_LABEL, STAGE_LABEL } from '../shared/constants';
import { roomsLabel } from '../shared/rules';
import { DEMO, HOTEL_NAME } from './config';
import { makeLiveBackend } from './lib/api';
import type { Backend } from './lib/api';
import { makeDemoBackend } from './lib/demo';
import { errText, hue, initials, inr } from './lib/format';
import { animatePage, motionOn } from './lib/motion';
import { useRoute } from './lib/route';
import type { Page } from './lib/route';
import { arrivalsToday, attentionRooms, departuresToday, roomState } from './lib/selectors';
import { Layers } from './modals';
import { Analytics } from './pages/Analytics';
import { Bookings } from './pages/Bookings';
import { Dashboard } from './pages/Dashboard';
import { Guests } from './pages/Guests';
import { Rooms } from './pages/Rooms';
import { Settings } from './pages/Settings';
import { StoreProvider, useStore } from './store';
import { Avatar, Icon, StageMenu, Toasts, cssVars } from './ui';
import type { IconName } from './ui';

/** The product name. The hotel's own name comes from the server (HOTEL_NAME) and is shown next to it. */
const PRODUCT = 'Haveli';
const USER_KEY = 'haveli:last-user';

function rememberedUser(): string {
  try {
    return window.localStorage.getItem(USER_KEY) ?? '';
  } catch {
    return '';
  }
}

/* ---------- intro ---------- */

/** A short welcome shown once when the website opens. Click anywhere to skip it. Skipped for people who ask for less motion. */
function Intro({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, 2300);
    return () => window.clearTimeout(t);
  }, [onDone]);
  return (
    <div className="intro" onClick={onDone} role="presentation" aria-hidden="true">
      <div className="intro-in">
        <i className="intro-mark"><Icon name="hotel" /></i>
        <div className="intro-word">
          {PRODUCT.split('').map((c, i) => (
            <span key={i} style={cssVars({ '--i': i })}>{c}</span>
          ))}
        </div>
        <div className="intro-sub">Hotel management</div>
        <div className="intro-line" />
      </div>
    </div>
  );
}

/* ---------- sign-in ---------- */

function Login({ backend, session, onSignedIn }: { backend: Backend; session: SessionInfo; onSignedIn: (s: SessionInfo) => void }) {
  const [username, setUsername] = useState(rememberedUser);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const hotel = session.hotel || HOTEL_NAME;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !username.trim() || !password) return;
    setBusy(true);
    setError('');
    try {
      const s = await backend.login(username.trim(), password);
      try {
        window.localStorage.setItem(USER_KEY, username.trim().toLowerCase());
      } catch {
        /* private window: nothing to remember */
      }
      onSignedIn(s);
    } catch (err) {
      setError(errText(err));
      setPassword('');
    }
    setBusy(false);
  }

  return (
    <div className="login-wrap">
      <form className="modal login-card" onSubmit={submit} aria-labelledby="lt" noValidate>
        <div className="logo" style={{ marginBottom: 18 }}>
          <i><Icon name="hotel" /></i>
          <span className="lbl">{PRODUCT}</span>
        </div>
        <h2 id="lt">Sign in</h2>
        <p style={{ color: 'var(--muted)', margin: '6px 0 18px' }}>{hotel}</p>
        {!session.configured ? (
          <div role="alert" style={{ color: 'var(--warn)', lineHeight: 1.6 }}>
            The server is not set up yet. Run <b>npm run setup</b> in the project folder, or open the <b>.env</b> file and fill in:
            <ul style={{ margin: '8px 0 0 18px' }}>
              {session.missing.map((m) => <li key={m}>{m}</li>)}
            </ul>
            {session.missing.some((m) => m.includes('not valid JSON')) && (
              <p style={{ color: 'var(--muted)', marginTop: 10 }}>
                The key must be the <b>whole</b> downloaded .json file, starting with <b>{'{'}</b> and ending with <b>{'}'}</b>, pasted inside single quotes.
              </p>
            )}
            <p style={{ color: 'var(--muted)', marginTop: 10 }}>Then stop the app (Ctrl+C) and start it again. README.md explains each one.</p>
          </div>
        ) : (
          <>
            <div className={`form${error ? ' bad' : ''}`}>
              <div className="full">
                <label htmlFor="un">Username</label>
                <input id="un" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus={!username} value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="full">
                <label htmlFor="pw">Password</label>
                <input id="pw" type="password" autoComplete="current-password" autoFocus={!!username} value={password} onChange={(e) => setPassword(e.target.value)} />
                <div className="err" role={error ? 'alert' : undefined}>{error}</div>
              </div>
            </div>
            <p className="hint">Your username and password are given to you by the owner.</p>
            <div className="mf">
              <button className="btn primary" type="submit" disabled={busy || !username.trim() || !password}>{busy ? 'Checking…' : 'Sign in'}</button>
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
  const { data, backend, openLayer, toast, hotel } = useStore();
  const reserved = data.bookings.filter((b) => b.stage === 'reserved').length;
  const badge: Partial<Record<Page, number>> = { bookings: reserved, rooms: attentionRooms(data).length };
  return (
    <aside className={`side${rail ? ' rail' : ''}${open ? ' open' : ''}`} id="side" aria-label="Main navigation">
      <div className="brand">
        <div className="logo">
          <i><Icon name="hotel" /></i>
          <span className="lbl">{PRODUCT}</span>
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
        {hotel}
        <br />
        {backend.mode === 'demo' ? 'Demo data · not saved' : 'Live · Google Sheets'}
      </div>
    </aside>
  );
}

/* ---------- top bar ---------- */

interface Note {
  key: string;
  tone: string;
  title: string;
  detail: string;
  act: () => void;
}

function Bell({ go }: { go: (p: Page) => void }) {
  const { data, setUi, openLayer } = useStore();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState('');
  const wrap = useRef<HTMLDivElement>(null);

  const notes = useMemo<Note[]>(() => {
    const out: Note[] = [];
    for (const b of arrivalsToday(data).filter((x) => x.stage === 'reserved')) {
      out.push({
        key: `a${b.id}`,
        tone: 'var(--accent)',
        title: `${b.guest} arrives today`,
        detail: `${roomsLabel(b.rooms)} · ${b.people} guest${b.people === 1 ? '' : 's'}`,
        act: () => openLayer({ kind: 'booking-view', id: b.id }),
      });
    }
    for (const b of departuresToday(data).filter((x) => x.stage === 'in')) {
      out.push({
        key: `d${b.id}`,
        tone: 'var(--warn)',
        title: `${b.guest} checks out today`,
        detail: b.balance > 0 ? `${roomsLabel(b.rooms)} · ${inr(b.balance)} still to collect` : roomsLabel(b.rooms),
        act: () => openLayer({ kind: 'booking-view', id: b.id }),
      });
    }
    for (const b of data.bookings.filter((x) => x.stage === 'in' && x.balance > 0 && x.co !== data.today)) {
      out.push({
        key: `p${b.id}`,
        tone: 'var(--bad)',
        title: `${inr(b.balance)} due from ${b.guest}`,
        detail: roomsLabel(b.rooms),
        act: () => openLayer({ kind: 'payment', id: b.id }),
      });
    }
    for (const r of attentionRooms(data)) {
      out.push({
        key: `r${r.no}`,
        tone: r.manual === 'maintenance' ? 'var(--bad)' : 'var(--warn)',
        title: `Room ${r.no} ${r.manual === 'maintenance' ? 'is under maintenance' : 'needs cleaning'}`,
        detail: `${r.type} · floor ${r.floor}`,
        act: () => { setUi({ rq: String(r.no), rst: 'All', rfl: 'All' }); go('rooms'); },
      });
    }
    return out;
  }, [data, go, openLayer, setUi]);

  const signature = notes.map((n) => n.key).join('|');
  const unread = notes.length > 0 && seen !== signature;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const shown = notes.slice(0, 12);
  return (
    <div className="bellwrap" ref={wrap}>
      <button
        className={`round${unread ? ' dot' : ''}`}
        id="bellBtn"
        aria-label={unread ? `Notifications, ${notes.length} new` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setSeen(signature); }}
      >
        <Icon name="bell" />
      </button>
      {open && (
        <div className="pop" id="bellPop" role="dialog" aria-label="Notifications">
          <div className="pop-h">
            <b>Notifications</b>
            <span className="chip">{notes.length ? notes.length : 'All clear'}</span>
          </div>
          {shown.length ? (
            <div className="pop-list">
              {shown.map((n) => (
                <button key={n.key} className="pop-item" onClick={() => { setOpen(false); n.act(); }}>
                  <i className="dotc" style={{ background: n.tone }} />
                  <span>
                    <b>{n.title}</b>
                    <small>{n.detail}</small>
                  </span>
                </button>
              ))}
              {notes.length > shown.length && <p className="pop-more">and {notes.length - shown.length} more</p>}
            </div>
          ) : (
            <p className="empty" style={{ padding: '14px 6px' }}>Nothing needs attention right now.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Topbar({ go, onMenu, searchRef }: { go: (p: Page) => void; onMenu: () => void; searchRef: RefObject<HTMLInputElement | null> }) {
  const { data, staff, setUi } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
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
  const sub = staff ? (staff.viaOwner ? `${staff.role} · via owner` : staff.role) : '';

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
                    <small>{roomsLabel(b.rooms)} · {STAGE_LABEL[b.stage]}</small>
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
      <Bell go={go} />
      <button className="me" id="meBtn" onClick={() => go('settings')} aria-label={`${name}. Open settings`} title="Settings">
        <div className="av" style={{ background: hue(name) }}>{initials(name)}</div>
        <div><b>{name}</b><small>{sub}</small></div>
      </button>
    </header>
  );
}

/* ---------- the signed-in app ---------- */

function Shell() {
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
    /* The glow that follows the pointer: at most one update per frame, and only on the card under it. */
    let raf = 0;
    let last: PointerEvent | null = null;
    const paint = () => {
      raf = 0;
      const e = last;
      if (!e) return;
      const t = (e.target as Element).closest?.('.stat,.card,.kcard,.room') as HTMLElement | null;
      if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.setProperty('--mx', `${e.clientX - r.left}px`);
      t.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    const move = (e: PointerEvent) => {
      last = e;
      if (!raf) raf = window.requestAnimationFrame(paint);
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
      if (raf) window.cancelAnimationFrame(raf);
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
            {page === 'dashboard' && <Dashboard go={go} />}
            {page === 'bookings' && <Bookings />}
            {page === 'rooms' && <Rooms />}
            {page === 'guests' && <Guests />}
            {page === 'analytics' && <Analytics />}
            {page === 'settings' && <Settings />}
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
  const [intro, setIntro] = useState(() => motionOn());
  const endIntro = useCallback(() => setIntro(false), []);

  useEffect(() => {
    setError('');
    backend.session().then(setSession).catch((e) => setError(errText(e)));
  }, [backend, attempt]);

  useEffect(() => {
    const out = () => setSession((s) => (s ? { ...s, authenticated: false, staff: null } : s));
    window.addEventListener('haveli:unauthorized', out);
    return () => window.removeEventListener('haveli:unauthorized', out);
  }, []);

  useEffect(() => {
    if (session?.hotel) document.title = `${session.hotel} · ${PRODUCT}`;
  }, [session?.hotel]);

  const signOut = () => {
    void backend.logout().finally(() => {
      window.location.hash = '';
      setSession((s) => (s ? { ...s, authenticated: false, staff: null } : s));
    });
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
      <StoreProvider backend={backend} staff={session.staff} hotel={session.hotel || HOTEL_NAME} onLogout={signOut}>
        <Shell />
      </StoreProvider>
    );
  }

  return (
    <>
      <div className="orbs" aria-hidden="true"><i /><i /><i /><i /></div>
      {body}
      {intro && <Intro onDone={endIntro} />}
    </>
  );
}
