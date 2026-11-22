/**
 * The new booking and edit booking form.
 */
import { useState, type FormEvent } from 'react';
import { ID_TYPES, PAY_METHODS, SOURCES, STAGE_LABEL } from '../../../shared/constants';
import { addDays, diffDays } from '../../../shared/dates';
import { formatEta, money, roomsLabel, validateBooking } from '../../../shared/rules';
import type { BookingFields, FieldErrors, NewBookingInput } from '../../../shared/types';
import { Icon } from '../../components/Icon';
import { Field, Layer } from '../../components/Layer';
import { inr, plural } from '../../lib/format';
import { CLEARS, FIELD_ID, focusFirst } from '../../lib/forms';
import { useStore } from '../../state/store';
import { RoomPicker } from './RoomPicker';

export function BookingModal({ editId }: { editId?: string }) {
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
