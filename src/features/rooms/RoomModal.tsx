/**
 * Adding one room.
 */
import { useState, type FormEvent } from 'react';
import { validateNewRoom } from '../../../shared/rules';
import type { FieldErrors } from '../../../shared/types';
import { Icon } from '../../components/Icon';
import { Field, Layer } from '../../components/Layer';
import { inr } from '../../lib/format';
import { focusFirst } from '../../lib/forms';
import { roomTypes } from '../../lib/selectors';
import { useStore } from '../../state/store';

export function RoomModal() {
  const { data, closeLayer, createRoom } = useStore();
  const types = roomTypes(data.rooms);
  const maxFloor = Math.max(5, ...data.rooms.map((r) => r.floor));
  const [no, setNo] = useState('');
  const [floor, setFloor] = useState('1');
  const [type, setType] = useState(types[0]?.type ?? 'Standard');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const body = { no: parseInt(no, 10), floor: Number(floor), type };
    const found = validateNewRoom(body, data.rooms, types.map((t) => t.type));
    setErrors(found);
    if (Object.keys(found).length) return focusFirst(found, { no: 'r_no', floor: 'r_fl', type: 'r_ty' });
    setBusy(true);
    const r = await createRoom(body);
    setBusy(false);
    if (r.ok) return closeLayer();
    setErrors(Object.keys(r.fields).length ? r.fields : { no: r.error });
  }

  return (
    <Layer onClose={closeLayer}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="mt" noValidate onSubmit={submit}>
        <div className="mh">
          <h2 id="mt">Add room</h2>
          <button type="button" className="round" onClick={closeLayer} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="form">
          <Field id="r_no" label="Room number" error={errors.no}>
            <input id="r_no" inputMode="numeric" placeholder="e.g. 511" value={no} onChange={(e) => setNo(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field id="r_fl" label="Floor" error={errors.floor}>
            <select id="r_fl" value={floor} onChange={(e) => setFloor(e.target.value)}>
              {Array.from({ length: maxFloor + 1 }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
            </select>
          </Field>
          <Field id="r_ty" label="Room type" full error={errors.type}>
            <select id="r_ty" value={type} onChange={(e) => setType(e.target.value)}>
              {types.map((t) => <option key={t.type} value={t.type}>{t.type} · {inr(t.price)}</option>)}
            </select>
          </Field>
        </div>
        <div className="mf">
          <button type="button" className="btn soft" onClick={closeLayer}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add room'}</button>
        </div>
      </form>
    </Layer>
  );
}
