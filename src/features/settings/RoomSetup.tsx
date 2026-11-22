/**
 * Quick room setup (owner only): add many rooms at once.
 */
import { useState, type FormEvent } from 'react';
import type { FieldErrors, RoomsGenerateInput } from '../../../shared/types';
import { Field } from '../../components/Layer';
import { roomTypes } from '../../lib/selectors';
import { useStore } from '../../state/store';

export function RoomSetup() {
  const { data, generateRooms } = useStore();
  const types = roomTypes(data.rooms);
  const [f, setF] = useState({ floors: '3', perFloor: '10', rate: '3000', type: types[0]?.type ?? 'Standard' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  async function go(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const body: RoomsGenerateInput = { floors: Number(f.floors), perFloor: Number(f.perFloor), rate: Number(f.rate), type: f.type };
    setBusy(true);
    setErrors({});
    setDone('');
    const r = await generateRooms(body);
    setBusy(false);
    if (r.ok) setDone('Done. Rooms are numbered 101, 102 … 201, 202 … Rooms that already existed were left alone.');
    else setErrors(Object.keys(r.fields).length ? r.fields : { floors: r.error });
  }

  return (
    <section className="card anim">
      <div className="card-h">
        <div>
          <h3>Quick room setup</h3>
          <p className="sub">Create many rooms at once for a new hotel. Change rates and room types later in the Rooms tab of the sheet.</p>
        </div>
      </div>
      <form onSubmit={go} noValidate>
        <div className="form">
          <Field id="g_fl" label="Floors" error={errors.floors}>
            <input id="g_fl" type="number" min={1} max={9} value={f.floors} onChange={(e) => setF({ ...f, floors: e.target.value })} />
          </Field>
          <Field id="g_pf" label="Rooms per floor" error={errors.perFloor}>
            <input id="g_pf" type="number" min={1} max={30} value={f.perFloor} onChange={(e) => setF({ ...f, perFloor: e.target.value })} />
          </Field>
          <Field id="g_ty" label="Room type" error={errors.type}>
            <select id="g_ty" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {types.map((t) => <option key={t.type}>{t.type}</option>)}
            </select>
          </Field>
          <Field id="g_rate" label="Rate per night (₹)" error={errors.rate}>
            <input id="g_rate" type="number" min={100} step={100} value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />
          </Field>
        </div>
        {done && <p role="status" style={{ color: 'var(--good)', marginTop: 10 }}>{done}</p>}
        <div className="mf">
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Adding…' : `Add ${Math.max(0, (Number(f.floors) || 0) * (Number(f.perFloor) || 0))} rooms`}</button>
        </div>
      </form>
    </section>
  );
}
