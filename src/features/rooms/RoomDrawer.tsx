/**
 * The side panel with one room: its status and its guest.
 */
import { roomsLabel } from '../../../shared/rules';
import type { Booking } from '../../../shared/types';
import { Avatar, RoomChip } from '../../components/Chips';
import { Icon } from '../../components/Icon';
import { Layer } from '../../components/Layer';
import { fmtD, inr, plural, rel } from '../../lib/format';
import { daysFrom, guestIn, roomState } from '../../lib/selectors';
import { useStore } from '../../state/store';

export function RoomDrawer({ no }: { no: number }) {
  const { data, closeLayer, setRoom, setStage, openLayer } = useStore();
  const { rooms, bookings, today } = data;
  const r = rooms.find((x) => x.no === no);
  if (!r) return null;
  const s = roomState(r, bookings);
  const g = guestIn(no, bookings);
  const next = bookings.filter((b) => b.rooms.includes(no) && b.stage === 'reserved').sort((a, b) => a.ci.localeCompare(b.ci))[0];
  const act = (fn: () => void) => () => {
    closeLayer();
    fn();
  };
  const also = (b: Booking) => b.rooms.filter((n) => n !== no);
  return (
    <Layer right onClose={closeLayer}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="mt">
        <div className="mh" style={{ margin: 0 }}>
          <div>
            <h2 id="mt">Room {no}</h2>
            <p style={{ color: 'var(--muted)', marginTop: 4 }}>{r.type} · Floor {r.floor}</p>
          </div>
          <button className="round" onClick={closeLayer} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div><RoomChip state={s} /></div>
        <div className="kv">
          <div><small>Rate</small><b className="num">{inr(r.price)}</b></div>
          <div><small>Bed</small><b>{r.bed || '—'}</b></div>
          <div><small>Sleeps</small><b className="num">{r.cap}</b></div>
          <div><small>Floor</small><b className="num">{r.floor}</b></div>
        </div>
        {r.notes && <div className="card" style={{ background: 'var(--card-hi)' }}><small style={{ color: 'var(--muted)' }}>Notes</small><p style={{ marginTop: 6 }}>{r.notes}</p></div>}
        {g && (
          <button className="card linkcard" style={{ background: 'var(--card-hi)' }} onClick={() => openLayer({ kind: 'booking-view', id: g.id })}>
            <small style={{ color: 'var(--muted)' }}>In house</small>
            <div className="who" style={{ marginTop: 8 }}>
              <Avatar name={g.guest} />
              <div><b>{g.guest}</b><small>Until {fmtD(g.co)}{also(g).length ? ` · also in ${roomsLabel(also(g))}` : ''}</small></div>
            </div>
          </button>
        )}
        {next && (
          <button className="card linkcard" style={{ background: 'var(--card-hi)' }} onClick={() => openLayer({ kind: 'booking-view', id: next.id })}>
            <small style={{ color: 'var(--muted)' }}>Next reservation</small>
            <div className="who" style={{ marginTop: 8 }}>
              <Avatar name={next.guest} />
              <div><b>{next.guest}</b><small>Arrives {rel(daysFrom(today, next.ci))} · {plural(next.nights, 'night')}{also(next).length ? ` · with ${roomsLabel(also(next))}` : ''}</small></div>
            </div>
          </button>
        )}
        <div className="stack" style={{ marginTop: 'auto' }}>
          {r.manual === 'cleaning' && <button className="btn primary" onClick={act(() => void setRoom(no, 'available'))}><Icon name="check" />Mark ready</button>}
          {r.manual === 'maintenance' && <button className="btn primary" onClick={act(() => void setRoom(no, 'available'))}><Icon name="check" />Back in service</button>}
          {s === 'available' && (
            <>
              <button className="btn soft" onClick={act(() => void setRoom(no, 'cleaning'))}>Needs cleaning</button>
              <button className="btn soft" onClick={act(() => void setRoom(no, 'maintenance'))}>Send to maintenance</button>
            </>
          )}
          {s === 'occupied' && g && <button className="btn primary" onClick={act(() => void setStage(g.id, 'out'))}>Check out {g.guest.split(' ')[0]}{g.rooms.length > 1 ? ` (all ${g.rooms.length} rooms)` : ''}</button>}
        </div>
      </aside>
    </Layer>
  );
}
