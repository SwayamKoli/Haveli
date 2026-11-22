/**
 * The side panel with everything about one booking.
 */
import { roomsLabel } from '../../../shared/rules';
import { PayChip, StageChip } from '../../components/Chips';
import { Icon } from '../../components/Icon';
import { Layer } from '../../components/Layer';
import { fmtD, inr, plural } from '../../lib/format';
import { useStore } from '../../state/store';

export function BookingDrawer({ id }: { id: string }) {
  const { data, closeLayer, openLayer, setStage } = useStore();
  const b = data.bookings.find((x) => x.id === id);
  if (!b) return null;
  const pays = data.payments.filter((p) => p.bookingId === id).sort((x, y) => x.at.localeCompare(y.at));
  const step = (to: 'in' | 'out') => () => {
    closeLayer();
    void setStage(b.id, to);
  };
  return (
    <Layer right onClose={closeLayer}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="mt">
        <div className="mh" style={{ margin: 0 }}>
          <div>
            <h2 id="mt">{b.guest}</h2>
            <p style={{ color: 'var(--muted)', marginTop: 4 }}>{b.id} · {b.mobile || 'no mobile'}</p>
          </div>
          <button className="round" onClick={closeLayer} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><StageChip stage={b.stage} /><PayChip b={b} /></div>
        <div className="kv">
          <div><small>{b.rooms.length > 1 ? 'Rooms' : 'Room'}</small><b className="num">{roomsLabel(b.rooms)}</b></div>
          <div><small>Guests</small><b className="num">{b.people}</b></div>
          <div><small>Check-in</small><b>{fmtD(b.ci)}</b></div>
          <div><small>Check-out</small><b>{fmtD(b.co)}</b></div>
          <div><small>Source</small><b>{b.source}</b></div>
          <div><small>Arrival</small><b>{b.eta || '—'}</b></div>
        </div>
        <div className="sumbox">
          <div><span>{inr(b.price)} × {plural(b.nights, 'night')}</span><b className="num">{inr(b.gross)}</b></div>
          {b.discount > 0 && <div className="minus"><span>Discount</span><b className="num">− {inr(b.discount)}</b></div>}
          <div className="tot"><span>Amount to pay</span><b className="num">{inr(b.total)}</b></div>
          <div><span>Paid</span><b className="num">{inr(b.paid)}</b></div>
          <div><span>Balance</span><b className="num">{inr(b.balance)}</b></div>
        </div>
        <div>
          <small style={{ color: 'var(--muted)' }}>Payments</small>
          {pays.length ? (
            <ul className="paylist">
              {pays.map((p) => (
                <li key={p.id}>
                  <span><b className="num" style={{ color: p.amount < 0 ? 'var(--bad)' : undefined }}>{p.amount < 0 ? '− ' : ''}{inr(Math.abs(p.amount))}</b> <em>{p.method}</em>{p.note ? ` · ${p.note}` : ''}</span>
                  <small>{fmtD(p.at.slice(0, 10))} {p.at.slice(11)} · {p.by}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty" style={{ margin: '6px 0 0' }}>No payments yet.</p>
          )}
        </div>
        <div className="kv">
          <div><small>Booked by</small><b>{b.createdBy || '—'}</b></div>
          <div><small>Last changed by</small><b>{b.updatedBy || '—'}</b></div>
        </div>
        {b.notes && <div className="card" style={{ background: 'var(--card-hi)' }}><small style={{ color: 'var(--muted)' }}>Notes</small><p style={{ marginTop: 6 }}>{b.notes}</p></div>}
        <div className="stack" style={{ marginTop: 'auto' }}>
          {b.stage === 'reserved' && <button className="btn primary" onClick={step('in')}><Icon name="check" />Check in</button>}
          {b.stage === 'in' && <button className="btn primary" onClick={step('out')}><Icon name="out" />Check out</button>}
          <button className="btn soft" onClick={() => openLayer({ kind: 'payment', id: b.id })} disabled={b.balance <= 0 && b.paid <= 0}>Payment or refund…</button>
          <button className="btn soft" onClick={() => openLayer({ kind: 'booking-edit', id: b.id })} disabled={b.stage === 'cancelled'}><Icon name="edit" />Edit booking</button>
        </div>
      </aside>
    </Layer>
  );
}
