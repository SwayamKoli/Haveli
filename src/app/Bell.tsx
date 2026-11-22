/**
 * The bell at the top right: today's arrivals, check-outs, dues and rooms that need attention.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { roomsLabel } from '../../shared/rules';
import { Icon } from '../components/Icon';
import { inr } from '../lib/format';
import type { Page } from '../lib/route';
import { arrivalsToday, attentionRooms, departuresToday } from '../lib/selectors';
import { useStore } from '../state/store';

interface Note {
  key: string;
  tone: string;
  title: string;
  detail: string;
  act: () => void;
}

export function Bell({ go }: { go: (p: Page) => void }) {
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
