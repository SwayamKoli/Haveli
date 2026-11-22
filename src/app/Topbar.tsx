/**
 * The bar across the top: search, theme switch, bell and the user button.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { ROOM_STATE_LABEL, STAGE_LABEL } from '../../shared/constants';
import { roomsLabel } from '../../shared/rules';
import { Avatar } from '../components/Chips';
import { Icon } from '../components/Icon';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { hue, initials } from '../lib/format';
import type { Page } from '../lib/route';
import { roomState } from '../lib/selectors';
import { useStore } from '../state/store';
import { Bell } from './Bell';

export function Topbar({ go, onMenu, searchRef }: { go: (p: Page) => void; onMenu: () => void; searchRef: RefObject<HTMLInputElement | null> }) {
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
                    <span className="av" style={{ background: '#EBD3A0' }}><Icon name="bed" size={15} /></span>
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
      <ThemeSwitch username={staff?.username ?? ''} />
      <Bell go={go} />
      <button className="me" id="meBtn" onClick={() => go('settings')} aria-label={`${name}. Open settings`} title="Settings">
        <div className="av" style={{ background: hue(name) }}>{initials(name)}</div>
        <div><b>{name}</b><small>{sub}</small></div>
      </button>
    </header>
  );
}
