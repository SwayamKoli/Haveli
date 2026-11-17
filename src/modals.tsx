/** Dialogs and drawers. `Layers` shows whichever one the store says is open. */
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ID_TYPES, PAY_METHODS, SOURCES, STAGE_LABEL } from '../shared/constants';
import { addDays, diffDays } from '../shared/dates';
import { findClash, formatEta, money, planPayment, roomsLabel, validateBooking, validateNewRoom } from '../shared/rules';
import type { Booking, BookingFields, FieldErrors, NewBookingInput, Room } from '../shared/types';
import { errText, fmtD, inr, plural, rel } from './lib/format';
import { daysFrom, guestIn, roomState, roomTypes } from './lib/selectors';
import { useStore } from './store';
import { Avatar, Field, Icon, Layer, PayChip, RoomChip, StageChip } from './ui';

/** Which error messages to clear when a form field changes. */
const CLEARS: Record<string, string[]> = {
  name: ['name'], mobile: ['mob'], source: ['source'], ci: ['ci', 'out', 'room'], co: ['out', 'room'], rooms: ['room', 'people'],
  discount: ['discount'], discMode: ['discount'], advance: ['adv'], method: ['adv'], people: ['people', 'room'], eta: ['eta'],
  email: ['email'], city: ['city'], idType: ['idType', 'idLast4'], idLast4: ['idLast4'], notes: ['notes'],
};

const FIELD_ID: Record<string, string> = {
  name: 'f_name', mob: 'f_mob', source: 'f_src', ci: 'f_in', out: 'f_out', room: 'f_rooms', discount: 'f_disc', adv: 'f_adv',
  people: 'f_people', eta: 'f_eta', email: 'f_email', city: 'f_city', idType: 'f_idt', idLast4: 'f_id4', notes: 'f_notes',
};

function focusFirst(errors: FieldErrors, ids: Record<string, string>) {
  const key = Object.keys(errors)[0];
  if (key) document.getElementById(ids[key] ?? '')?.focus();
}

/* ---------- picking one or more rooms ---------- */

function RoomPicker({
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

/* ---------- new booking / edit booking ---------- */

function BookingModal({ editId }: { editId?: string }) {
  const { data, closeLayer, createBooking, updateBooking, staff } = useStore();
  const { rooms, bookings, today, guests } = data;
  const existing = editId ? bookings.find((b) => b.id === editId) : undefined;
  const guest = existing ? guests.find((g) => g.id === existing.guestId) : undefined;
  const finished = existing?.stage === 'out';

  const [f, setF] = useState(() => ({
    name: existing?.guest ?? '',
    mobile: existing?.mobile ?? '',
    source: existing?.source && SOURCES.includes(existing.source) ? existing.source : SOURCES[0],
    ci: existing?.ci ?? today,
    co: existing?.co ?? addDays(today, 1),
    rooms: existing ? [...existing.rooms] : ([] as number[]),
    discount: existing ? String(existing.discount) : '0',
    discMode: '₹' as '₹' | '%',
    advance: '0',
    method: PAY_METHODS[0],
    people: String(existing?.people ?? 1),
    eta: existing?.etaMin != null ? `${String(Math.floor(existing.etaMin / 60)).padStart(2, '0')}:${String(existing.etaMin % 60).padStart(2, '0')}` : existing ? '' : '14:00',
    email: guest?.email ?? '',
    city: guest?.city ?? '',
    idType: guest?.idType ?? '',
    idLast4: guest?.idLast4 ?? '',
    notes: existing?.notes ?? '',
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    // An error goes away as soon as the person starts fixing the field it was about.
    const drop = CLEARS[k as string];
    if (drop) setErrors((e) => (drop.some((d) => d in e) ? Object.fromEntries(Object.entries(e).filter(([key]) => !drop.includes(key))) : e));
  };

  const nights = diffDays(f.ci, f.co);
  const chosen = rooms.filter((r) => f.rooms.includes(r.no));
  const sameAsSaved = !!existing && existing.rooms.length === f.rooms.length && existing.rooms.every((n) => f.rooms.includes(n));
  const price = sameAsSaved ? existing!.price : chosen.reduce((s, r) => s + r.price, 0);
  const gross = nights >= 1 ? price * nights : 0;
  const typed = Number(f.discount);
  const discount = f.discMode === '%' ? Math.round((gross * (Number.isFinite(typed) ? typed : 0)) / 100) : typed;
  const advance = Number(f.advance) || 0;
  const paidNow = existing ? existing.paid : advance;
  const sum = money(price, Math.max(nights, 0), paidNow, Number.isFinite(discount) ? discount : 0);

  const fields = (): BookingFields => ({
    name: f.name, mobile: f.mobile.trim(), source: f.source, ci: f.ci, co: f.co, rooms: f.rooms, discount, people: Number(f.people),
    eta: f.eta, email: f.email, city: f.city, idType: f.idType, idLast4: f.idLast4, notes: f.notes,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const body = fields();
    const found = validateBooking(body, { rooms, bookings, today }, paidNow, existing);
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return focusFirst(found, FIELD_ID);
    setBusy(true);
    const r = existing ? await updateBooking({ ...body, id: existing.id }) : await createBooking({ ...body, advance, method: f.method } as NewBookingInput);
    setBusy(false);
    if (r.ok) return closeLayer();
    setErrors(r.fields);
    setFormError(Object.keys(r.fields).length ? '' : r.error);
    focusFirst(r.fields, FIELD_ID);
  }

  if (editId && !existing) return null;
  return (
    <Layer onClose={closeLayer}>
      <form className="modal wide" role="dialog" aria-modal="true" aria-labelledby="mt" noValidate onSubmit={submit}>
        <div className="mh">
          <div>
            <h2 id="mt">{existing ? `Edit booking ${existing.id}` : 'New booking'}</h2>
            <p style={{ color: 'var(--muted)', marginTop: 4 }}>
              {existing ? `${STAGE_LABEL[existing.stage]} · booked by ${existing.createdBy || 'unknown'}. Payments already taken stay as they are.` : `Creates the guest and the reservation together. Booked by ${staff?.name ?? 'you'}.`}
            </p>
          </div>
          <button type="button" className="round" onClick={closeLayer} aria-label="Close"><Icon name="x" /></button>
        </div>
        {finished && <p className="note" role="note">This stay has finished, so the dates and rooms are locked. You can still fix the guest details, notes, source and discount.</p>}
        <div className="form">
          <Field id="f_name" label="Guest name" full error={errors.name}>
            <input id="f_name" autoComplete="off" placeholder="Full name" value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field id="f_mob" label="Mobile" error={errors.mob}>
            <input id="f_mob" inputMode="numeric" maxLength={10} placeholder="10 digits" autoComplete="off" value={f.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field id="f_src" label="Source" error={errors.source}>
            <select id="f_src" value={f.source} onChange={(e) => set('source', e.target.value)}>
              {SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field id="f_in" label="Check-in" error={errors.ci}>
            <input id="f_in" type="date" min={existing ? undefined : today} disabled={finished} value={f.ci} onChange={(e) => {
              const ci = e.target.value;
              setF((x) => ({ ...x, ci, co: x.co > ci ? x.co : ci ? addDays(ci, 1) : x.co }));
            }} />
          </Field>
          <Field id="f_out" label="Check-out" error={errors.out}>
            <input id="f_out" type="date" min={f.ci} disabled={finished} value={f.co} onChange={(e) => set('co', e.target.value)} />
          </Field>
          <div className="full">
            <label htmlFor="f_rooms">Rooms {f.rooms.length > 1 && <span className="chip acc" style={{ marginLeft: 6 }}>{f.rooms.length} rooms on one booking</span>}</label>
            <RoomPicker rooms={rooms} bookings={bookings} ci={f.ci} co={f.co} selected={f.rooms} onChange={(next) => set('rooms', next)} exceptId={existing?.id} locked={finished} error={errors.room} />
          </div>
          <Field id="f_people" label="Guests" error={errors.people}>
            <input id="f_people" type="number" min={1} value={f.people} onChange={(e) => set('people', e.target.value)} />
          </Field>
          <Field id="f_eta" label="Expected arrival" error={errors.eta}>
            <input id="f_eta" type="time" value={f.eta} onChange={(e) => set('eta', e.target.value)} />
          </Field>
          <div className={errors.discount ? 'bad' : ''}>
            <label htmlFor="f_disc">Discount</label>
            <div className="split">
              <input id="f_disc" type="number" min={0} step={f.discMode === '%' ? 1 : 50} value={f.discount} onChange={(e) => set('discount', e.target.value)} aria-describedby="disc_hint" />
              <select aria-label="Discount in rupees or percent" value={f.discMode} onChange={(e) => set('discMode', e.target.value as '₹' | '%')}>
                <option value="₹">₹ off</option>
                <option value="%">% off</option>
              </select>
            </div>
            <div className="err" role={errors.discount ? 'alert' : undefined}>{errors.discount}</div>
          </div>
          {existing ? (
            <div>
              <label>Already paid</label>
              <div className="ro num">{inr(existing.paid)}</div>
              <small style={{ color: 'var(--faint)' }}>Use Payment or refund to change this.</small>
            </div>
          ) : (
            <>
              <Field id="f_adv" label="Advance paid (₹)" error={errors.adv}>
                <input id="f_adv" type="number" min={0} step={100} value={f.advance} onChange={(e) => set('advance', e.target.value)} />
              </Field>
              {advance > 0 && (
                <Field id="f_meth" label="Paid by" full>
                  <select id="f_meth" value={f.method} onChange={(e) => set('method', e.target.value)}>
                    {PAY_METHODS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}

          <div className="full sumbox" aria-live="polite" id="disc_hint">
            {chosen.length && nights >= 1 ? (
              <>
                <div><span>{roomsLabel(chosen.map((r) => r.no))} · {inr(price)} × {plural(nights, 'night')}</span><b className="num">{inr(sum.gross)}</b></div>
                {discount > 0 && Number.isFinite(discount) && <div className="minus"><span>Discount{f.discMode === '%' ? ` (${typed}%)` : ''}</span><b className="num">− {inr(Math.min(discount, sum.gross))}</b></div>}
                <div className="tot"><span>Amount to pay</span><b className="num" id="sum_total">{inr(sum.total)}</b></div>
                <div><span>{existing ? 'Paid so far' : 'Advance'}</span><b className="num">{inr(paidNow)}</b></div>
                <div><span>Balance</span><b className="num">{inr(sum.balance)}</b></div>
                {f.eta && <small>Arrives {formatEta(f.eta)}</small>}
              </>
            ) : (
              <span>Choose dates and rooms to see the amount.</span>
            )}
          </div>

          <p className="full sub" style={{ margin: '2px 0 -4px', color: 'var(--muted)', fontSize: 12 }}>Optional details (only the last 4 digits of an ID are ever stored)</p>
          <Field id="f_email" label="Email" error={errors.email}>
            <input id="f_email" type="email" autoComplete="off" value={f.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field id="f_city" label="City" error={errors.city}>
            <input id="f_city" autoComplete="off" value={f.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field id="f_idt" label="ID type" error={errors.idType}>
            <select id="f_idt" value={f.idType} onChange={(e) => set('idType', e.target.value)}>
              <option value="">Not collected</option>
              {ID_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field id="f_id4" label="ID last 4 digits" error={errors.idLast4}>
            <input id="f_id4" inputMode="numeric" maxLength={4} value={f.idLast4} onChange={(e) => set('idLast4', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field id="f_notes" label="Notes" full error={errors.notes}>
            <input id="f_notes" autoComplete="off" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          {formError && <p className="full" role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{formError}</p>}
        </div>
        <div className="mf">
          <button type="button" className="btn soft" onClick={closeLayer}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy}>
            <Icon name="check" />
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Create booking'}
          </button>
        </div>
      </form>
    </Layer>
  );
}

/* ---------- booking details ---------- */

function BookingDrawer({ id }: { id: string }) {
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

/* ---------- add room ---------- */

function RoomModal() {
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

/* ---------- room drawer ---------- */

function RoomDrawer({ no }: { no: number }) {
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

/* ---------- payment or refund ---------- */

function PaymentModal({ id }: { id: string }) {
  const { data, closeLayer, recordPayment } = useStore();
  const b = data.bookings.find((x) => x.id === id);
  const [refund, setRefund] = useState(false);
  const [amount, setAmount] = useState(b ? String(Math.max(0, b.balance)) : '');
  const [method, setMethod] = useState(PAY_METHODS[0]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!b) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !b) return;
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) return setError('Enter a whole-rupee amount above zero.');
    const signed = refund ? -n : n;
    const plan = planPayment(b, signed, method, note);
    if (!plan.ok) return setError(plan.error);
    setBusy(true);
    const r = await recordPayment(b.id, signed, method, note.trim());
    setBusy(false);
    if (r.ok) closeLayer();
    else setError(r.error);
  }

  return (
    <Layer onClose={closeLayer}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="mt" noValidate onSubmit={submit}>
        <div className="mh">
          <div>
            <h2 id="mt">{refund ? 'Give money back' : 'Record payment'}</h2>
            <p style={{ color: 'var(--muted)', marginTop: 4 }}>{b.guest} · {b.rooms.length > 1 ? 'rooms' : 'room'} {roomsLabel(b.rooms)} · {b.id}</p>
          </div>
          <button type="button" className="round" onClick={closeLayer} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="kv" style={{ marginBottom: 16 }}>
          <div><small>Amount to pay{b.discount > 0 ? ' (after discount)' : ''}</small><b className="num">{inr(b.total)}</b></div>
          <div><small>Paid</small><b className="num">{inr(b.paid)}</b></div>
          <div><small>Due</small><b className="num">{inr(b.balance)}</b></div>
        </div>
        <div className="tabs2" role="tablist">
          <button type="button" role="tab" aria-selected={!refund} className={!refund ? 'on' : ''} onClick={() => { setRefund(false); setError(''); setAmount(String(Math.max(0, b.balance))); }}>Money received</button>
          <button type="button" role="tab" aria-selected={refund} className={refund ? 'on' : ''} onClick={() => { setRefund(true); setError(''); setAmount(''); }} disabled={b.paid <= 0}>Refund</button>
        </div>
        <div className="form">
          <Field id="p_amt" label={refund ? 'Amount given back (₹)' : 'Amount received (₹)'} error={error}>
            <input id="p_amt" type="number" min={1} step={1} value={amount} onChange={(e) => { setAmount(e.target.value); setError(''); }} />
          </Field>
          <Field id="p_meth" label={refund ? 'Returned by' : 'Paid by'}>
            <select id="p_meth" value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAY_METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field id="p_note" label={refund ? 'Reason (required)' : 'Note (optional)'} full>
            <input id="p_note" autoComplete="off" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder={refund ? 'e.g. Left a day early' : ''} />
          </Field>
        </div>
        <div className="mf">
          <button type="button" className="btn soft" onClick={closeLayer}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy}><Icon name="check" />{busy ? 'Saving…' : refund ? 'Record refund' : 'Record payment'}</button>
        </div>
      </form>
    </Layer>
  );
}

/* ---------- sign out? ---------- */

function ConfirmLogout() {
  const { closeLayer, logout } = useStore();
  return (
    <Layer onClose={closeLayer}>
      <div className="modal small" role="alertdialog" aria-modal="true" aria-labelledby="mt" aria-describedby="md">
        <div className="mh">
          <h2 id="mt">Sign out?</h2>
          <button type="button" className="round" onClick={closeLayer} aria-label="Close"><Icon name="x" /></button>
        </div>
        <p id="md" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>You will need your username and password to get back in.</p>
        <div className="mf">
          <button className="btn soft" onClick={closeLayer} autoFocus>Stay signed in</button>
          <button className="btn primary" onClick={() => { closeLayer(); logout(); }}><Icon name="out" />Sign out</button>
        </div>
      </div>
    </Layer>
  );
}

/* ---------- the owner password opens the Google Sheet ---------- */

function OwnerSheetPrompt() {
  const { backend, closeLayer } = useStore();
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !pw) return;
    setBusy(true);
    setError('');
    try {
      const r = await backend.sheetLink(pw);
      setUrl(r.url);
    } catch (err) {
      setError(errText(err));
      setPw('');
    }
    setBusy(false);
  }

  return (
    <Layer onClose={closeLayer}>
      <form className="modal small" role="dialog" aria-modal="true" aria-labelledby="mt" noValidate onSubmit={submit}>
        <div className="mh">
          <div>
            <h2 id="mt">Owner password needed</h2>
            <p style={{ color: 'var(--muted)', marginTop: 4 }}>Only the owner can open the Google Sheet.</p>
          </div>
          <button type="button" className="round" onClick={closeLayer} aria-label="Close"><Icon name="x" /></button>
        </div>
        {url ? (
          <>
            <p style={{ color: 'var(--good)', margin: '4px 0 0' }} role="status">Verified.</p>
            <div className="mf">
              <button type="button" className="btn soft" onClick={closeLayer}>Close</button>
              <a className="btn primary" href={url} target="_blank" rel="noreferrer noopener" onClick={closeLayer}>Open the sheet</a>
            </div>
          </>
        ) : (
          <>
            <div className="form">
              <Field id="o_pw" label="Owner password" full error={error}>
                <input id="o_pw" ref={field} type="password" autoComplete="off" value={pw} onChange={(e) => { setPw(e.target.value); setError(''); }} />
              </Field>
            </div>
            <div className="mf">
              <button type="button" className="btn soft" onClick={closeLayer}>Cancel</button>
              <button className="btn primary" type="submit" disabled={busy || !pw}><Icon name="lock" />{busy ? 'Checking…' : 'Unlock'}</button>
            </div>
          </>
        )}
      </form>
    </Layer>
  );
}

/* ---------- switcher ---------- */

export function Layers() {
  const { layer } = useStore();
  if (!layer) return null;
  switch (layer.kind) {
    case 'booking': return <BookingModal />;
    case 'booking-edit': return <BookingModal editId={layer.id} />;
    case 'booking-view': return <BookingDrawer id={layer.id} />;
    case 'room-add': return <RoomModal />;
    case 'room': return <RoomDrawer no={layer.no} />;
    case 'payment': return <PaymentModal id={layer.id} />;
    case 'confirm-logout': return <ConfirmLogout />;
    case 'owner-sheet': return <OwnerSheetPrompt />;
  }
}
