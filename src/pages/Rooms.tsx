import { ROOM_STATE_LABEL } from '../../shared/constants';
import type { RoomState } from '../../shared/types';
import { inr } from '../lib/format';
import { counts, guestIn, roomState } from '../lib/selectors';
import { useStore } from '../store';
import { Icon, PageHead, RoomChip } from '../ui';

const STATES: RoomState[] = ['available', 'occupied', 'cleaning', 'maintenance'];

export function Rooms() {
  const { data, ui, setUi, openLayer } = useStore();
  const { rooms, bookings } = data;
  const c = counts(data);
  const q = ui.rq.trim().toLowerCase();
  const floors = Array.from(new Set(rooms.map((r) => r.floor))).sort((a, b) => a - b);

  const list = rooms.filter(
    (r) =>
      (ui.rst === 'All' || roomState(r, bookings) === ui.rst) &&
      (ui.rfl === 'All' || String(r.floor) === ui.rfl) &&
      (!q || String(r.no).includes(q) || r.type.toLowerCase().includes(q)),
  );

  return (
    <>
      <PageHead title="Rooms" sub={`${rooms.length} rooms · ${c.available} ready to sell`}>
        <button className="btn primary" onClick={() => openLayer({ kind: 'room-add' })}>
          <Icon name="plus" />
          Add room
        </button>
      </PageHead>

      <div className="bar-tools anim">
        <div className="field">
          <Icon name="search" size={16} />
          <input id="rq" type="search" placeholder="Search room number or type" aria-label="Search rooms" value={ui.rq} onChange={(e) => setUi({ rq: e.target.value })} />
        </div>
        <div className="fchips">
          {(['All', ...STATES] as const).map((s) => (
            <button key={s} className={`fchip${ui.rst === s ? ' on' : ''}`} onClick={() => setUi({ rst: s })}>
              {s === 'All' ? `All (${rooms.length})` : `${ROOM_STATE_LABEL[s]} (${c[s]})`}
            </button>
          ))}
        </div>
      </div>
      <div className="bar-tools anim" style={{ marginTop: -6 }}>
        <div className="fchips">
          {['All', ...floors.map(String)].map((f) => (
            <button key={f} className={`fchip${ui.rfl === f ? ' on' : ''}`} onClick={() => setUi({ rfl: f })}>
              {f === 'All' ? 'All floors' : `Floor ${f}`}
            </button>
          ))}
        </div>
      </div>

      <div>
        {list.length === 0 && <p className="empty">{rooms.length ? 'No rooms match these filters.' : 'No rooms yet. Use “Add room”, or fill in the Rooms tab of your sheet.'}</p>}
        {floors.map((f) => {
          const here = list.filter((r) => r.floor === f);
          if (!here.length) return null;
          return (
            <div key={f}>
              <h3 className="fl">Floor {f}</h3>
              <div className="rooms">
                {here.map((r) => {
                  const s = roomState(r, bookings);
                  const g = guestIn(r.no, bookings);
                  return (
                    <button className="room" key={r.no} onClick={() => openLayer({ kind: 'room', no: r.no })}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="rn num">{r.no}</span>
                        <RoomChip state={s} />
                      </div>
                      <span className="rt">{r.type} · {r.bed}</span>
                      <span className="rg">{g ? g.guest : ' '}</span>
                      <div className="rp">
                        <span className="num">{inr(r.price)} / night</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
