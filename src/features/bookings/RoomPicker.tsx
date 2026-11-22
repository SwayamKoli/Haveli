/**
 * Ticking one or more rooms for a booking.
 */
import { diffDays } from '../../../shared/dates';
import { findClash, roomsLabel } from '../../../shared/rules';
import type { Booking, Room } from '../../../shared/types';
import { inr, plural } from '../../lib/format';

export function RoomPicker({
  rooms, bookings, ci, co, selected, onChange, exceptId, locked, error,
}: {
  rooms: Room[]; bookings: Booking[]; ci: string; co: string; selected: number[]; onChange: (next: number[]) => void;
  exceptId?: string; locked?: boolean; error?: string;
}) {
  const nights = diffDays(ci, co);
  const takenBy = (no: number) => (nights >= 1 ? findClash([no], ci, co, bookings, exceptId)?.booking : undefined);
  const floors = Array.from(new Set(rooms.map((r) => r.floor))).sort((a, b) => a - b);
  const sel = rooms.filter((r) => selected.includes(r.no));
  const toggle = (no: number) => onChange(selected.includes(no) ? selected.filter((n) => n !== no) : [...selected, no].sort((a, b) => a - b));
  return (
    <div className={error ? 'bad' : ''}>
      <div className="rpick" id="f_rooms" tabIndex={-1} role="group" aria-label="Rooms">
        {floors.map((f) => (
          <div className="rrow" key={f}>
            <span className="rfl">Floor {f}</span>
            <div className="rchips">
              {rooms.filter((r) => r.floor === f).map((r) => {
                const other = takenBy(r.no);
                const on = selected.includes(r.no);
                const out = r.manual === 'maintenance' && !on;
                return (
                  <button
                    type="button"
                    key={r.no}
                    className={`rchip${on ? ' on' : ''}`}
                    aria-pressed={on}
                    disabled={locked || (!on && (!!other || out))}
                    title={other ? `Taken by ${other.guest} for part of this stay` : out ? 'Under maintenance' : `${r.type} · ${r.bed} · sleeps ${r.cap} · ${inr(r.price)}`}
                    onClick={() => toggle(r.no)}
                  >
                    <b className="num">{r.no}</b>
                    <small>{other ? 'taken' : out ? 'repair' : r.type}</small>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {rooms.length === 0 && <p className="empty">There are no rooms yet. Add rooms first.</p>}
      </div>
      <p className="sub" style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 12.5 }} aria-live="polite">
        {sel.length
          ? `${plural(sel.length, 'room')} chosen: ${roomsLabel(sel.map((r) => r.no))} · sleeps ${sel.reduce((s, r) => s + r.cap, 0)} · ${inr(sel.reduce((s, r) => s + r.price, 0))} a night`
          : 'Tap one room, or several for a family or group.'}
      </p>
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}
