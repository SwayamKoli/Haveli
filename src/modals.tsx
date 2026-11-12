/** Dialogs and the room drawer. `Layers` shows whichever one the store says is open. */
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ID_TYPES, SOURCES } from '../shared/constants';
import { addDays, diffDays } from '../shared/dates';
import { findClash, formatEta, money, validateNewBooking, validateNewRoom } from '../shared/rules';
import type { FieldErrors, HealthReport, NewBookingInput } from '../shared/types';
import { fmtD, inr, plural, rel } from './lib/format';
import { daysFrom, guestIn, roomState, roomTypes } from './lib/selectors';
import { useStore } from './store';
import { Avatar, Field, Icon, Layer, RoomChip } from './ui';

const FIELD_ID: Record<string, string> = {
  name: 'f_name', mob: 'f_mob', source: 'f_src', ci: 'f_in', out: 'f_out', room: 'f_room', adv: 'f_adv',
  people: 'f_people', eta: 'f_eta', email: 'f_email', city: 'f_city', idType: 'f_idt', idLast4: 'f_id4', notes: 'f_notes',
};

function focusFirst(errors: FieldErrors, ids: Record<string, string>) {
  const key = Object.keys(errors)[0];
  if (key) document.getElementById(ids[key] ?? '')?.focus();
}

/* ---------- new booking ---------- */

function BookingModal() {
  const { data, closeLayer, createBooking } = useStore();
  const { rooms, bookings, today } = data;
  const [f, setF] = useState({
    name: '', mobile: '', source: SOURCES[0], ci: today, co: addDays(today, 1), room: 0, advance: '0', people: '1',
    eta: '14:00', email: '', city: '', idType: '', idLast4: '', notes: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const nights = diffDays(f.ci, f.co);
  const bookable = rooms.filter((r) => r.manual !== 'maintenance');
  const isTaken = (no: number) => nights >= 1 && !!findClash(no, f.ci, f.co, bookings);
  const firstFree = bookable.find((r) => !isTaken(r.no))?.no ?? 0;
  const currentOk = bookable.some((r) => r.no === f.room && !isTaken(r.no));
  const roomNo = currentOk ? f.room : firstFree;
  const room = rooms.find((r) => r.no === roomNo);
  const advance = Number(f.advance) || 0;

  const input = (): NewBookingInput => ({
    name: f.name, mobile: f.mobile.trim(), source: f.source, ci: f.ci, co: f.co, room: roomNo, advance, people: Number(f.people),
    eta: f.eta, email: f.email, city: f.city, idType: f.idType, idLast4: f.idLast4, notes: f.notes,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const body = input();
    const found = validateNewBooking(body, { rooms, bookings, today });
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return focusFirst(found, FIELD_ID);
    setBusy(true);
    const r = await createBooking(body);
    setBusy(false);
    if (r.ok) return closeLayer();
    setErrors(r.fields);
    setFormError(Object.keys(r.fields).length ? '' : r.error);
    focusFirst(r.fields, FIELD_ID);
  }

  return (
    <Layer onClose={closeLayer}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="mt" noValidate onSubmit={submit}>
        <div className="mh">
          <div>
            <h2 id="mt">New booking</h2>
            <p style={{ color: 'var(--muted)', marginTop: 4 }}>Creates the guest and the reservation together.</p>
          </div>
          <button type="button" className="round" onClick={closeLayer} aria-label="Close"><Icon name="x" /></button>
        </div>
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
            <input id="f_in" type="date" min={today} value={f.ci} onChange={(e) => {
              const ci = e.target.value;
              setF((x) => ({ ...x, ci, co: x.co > ci ? x.co : ci ? addDays(ci, 1) : x.co }));
            }} />
          </Field>
          <Field id="f_out" label="Check-out" error={errors.out}>
            <input id="f_out" type="date" min={f.ci} value={f.co} onChange={(e) => set('co', e.target.value)} />
          </Field>
          <Field id="f_room" label="Room" error={errors.room}>
            <select id="f_room" value={roomNo} onChange={(e) => set('room', Number(e.target.value))}>
              {bookable.map((r) => (
                <option key={r.no} value={r.no} disabled={isTaken(r.no)}>
                  {r.no} · {r.type} · {inr(r.price)}{isTaken(r.no) ? ' (taken)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field id="f_adv" label="Advance paid (₹)" error={errors.adv}>
            <input id="f_adv" type="number" min={0} step={100} value={f.advance} onChange={(e) => set('advance', e.target.value)} />
          </Field>
          <Field id="f_people" label="Guests" error={errors.people}>
            <input id="f_people" type="number" min={1} max={room?.cap ?? 10} value={f.people} onChange={(e) => set('people', e.target.value)} />
          </Field>
          <Field id="f_eta" label="Expected arrival" error={errors.eta}>
            <input id="f_eta" type="time" value={f.eta} onChange={(e) => set('eta', e.target.value)} />
          </Field>
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
          <p className="full" style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }} aria-live="polite">
            {room && nights >= 1
              ? `${plural(nights, 'night')} × ${inr(room.price)} = ${inr(money(room.price, nights, advance).total)} · balance ${inr(money(room.price, nights, advance).balance)}${f.eta ? ` · arrives ${formatEta(f.eta)}` : ''}`
              : 'Choose dates and a room to see the total.'}
          </p>
          {formError && <p className="full" role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{formError}</p>}
        </div>
        <div className="mf">
          <button type="button" className="btn soft" onClick={closeLayer}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy}>
            <Icon name="check" />
            {busy ? 'Saving…' : 'Create booking'}
          </button>
        </div>
      </form>
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
  const { data, closeLayer, setRoom, setStage } = useStore();
  const { rooms, bookings, today } = data;
  const r = rooms.find((x) => x.no === no);
  if (!r) return null;
  const s = roomState(r, bookings);
  const g = guestIn(no, bookings);
  const next = bookings.filter((b) => b.room === no && b.stage === 'reserved').sort((a, b) => a.ci.localeCompare(b.ci))[0];
  const act = (fn: () => void) => () => {
    closeLayer();
    fn();
  };
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
          <div className="card" style={{ background: 'var(--card-hi)' }}>
            <small style={{ color: 'var(--muted)' }}>In house</small>
            <div className="who" style={{ marginTop: 8 }}>
              <Avatar name={g.guest} />
              <div><b>{g.guest}</b><small>Until {fmtD(g.co)}</small></div>
            </div>
          </div>
        )}
        {next && (
          <div className="card" style={{ background: 'var(--card-hi)' }}>
            <small style={{ color: 'var(--muted)' }}>Next reservation</small>
            <div className="who" style={{ marginTop: 8 }}>
              <Avatar name={next.guest} />
              <div><b>{next.guest}</b><small>Arrives {rel(daysFrom(today, next.ci))} · {plural(next.nights, 'night')}</small></div>
            </div>
          </div>
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
          {s === 'occupied' && g && <button className="btn primary" onClick={act(() => void setStage(g.id, 'out'))}>Check out {g.guest.split(' ')[0]}</button>}
        </div>
      </aside>
    </Layer>
  );
}

/* ---------- record payment ---------- */

function PaymentModal({ id }: { id: string }) {
  const { data, closeLayer, recordPayment } = useStore();
  const b = data.bookings.find((x) => x.id === id);
  const [amount, setAmount] = useState(b ? String(Math.max(0, b.balance)) : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!b) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !b) return;
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) return setError('Enter a whole-rupee amount above zero.');
    if (n > b.balance) return setError(`Only ${inr(b.balance)} is due.`);
    setBusy(true);
    const r = await recordPayment(b.id, n);
    setBusy(false);
    if (r.ok) closeLayer();
    else setError(r.error);
  }

  return (
    <Layer onClose={closeLayer}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="mt" noValidate onSubmit={submit}>
        <div className="mh">
          <div>
            <h2 id="mt">Record payment</h2>
            <p style={{ color: 'var(--muted)', marginTop: 4 }}>{b.guest} · room {b.room} · {b.id}</p>
          </div>
          <button type="button" className="round" onClick={closeLayer} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="kv" style={{ marginBottom: 16 }}>
          <div><small>Total</small><b className="num">{inr(b.total)}</b></div>
          <div><small>Paid</small><b className="num">{inr(b.paid)}</b></div>
          <div><small>Due</small><b className="num">{inr(b.balance)}</b></div>
        </div>
        <div className="form">
          <Field id="p_amt" label="Amount received (₹)" full error={error}>
            <input id="p_amt" type="number" min={1} max={b.balance} step={1} value={amount} onChange={(e) => { setAmount(e.target.value); setError(''); }} />
          </Field>
        </div>
        <div className="mf">
          <button type="button" className="btn soft" onClick={closeLayer}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy}><Icon name="check" />{busy ? 'Saving…' : 'Record payment'}</button>
        </div>
      </form>
    </Layer>
  );
}

/* ---------- settings / sheet status ---------- */

function SettingsModal() {
  const { backend, data, staff, closeLayer, reload, logout, toast } = useStore();
  const [report, setReport] = useState<HealthReport | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    backend.health().then((r) => alive && setReport(r)).catch((e: Error) => alive && setProblem(e.message));
    return () => {
      alive = false;
    };
  }, [backend]);

  async function refresh() {
    setBusy(true);
    await reload(false);
    setBusy(false);
    toast('Refreshed from the sheet.');
  }

  return (
    <Layer onClose={closeLayer}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mt">
        <div className="mh">
          <div>
            <h2 id="mt">Sheet status</h2>
            <p style={{ color: 'var(--muted)', marginTop: 4 }}>
              {backend.mode === 'demo' ? 'Demo mode · nothing is saved' : 'Live · Google Sheets'}{staff ? ` · signed in as ${staff.name}` : ''}
            </p>
          </div>
          <button type="button" className="round" onClick={closeLayer} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="list" style={{ maxHeight: 320 }}>
          {!report && !problem && <p className="empty">Checking the connection…</p>}
          {problem && <p className="empty" style={{ color: 'var(--bad)' }}>{problem}</p>}
          {report?.checks.map((c) => (
            <div className="row" key={c.name}>
              <i className="dotc" style={{ background: c.ok ? 'var(--good)' : 'var(--bad)' }} />
              <div className="t"><b>{c.name}</b><small>{c.detail}</small></div>
            </div>
          ))}
          {data.warnings.length > 0 && (
            <div className="row">
              <i className="dotc" style={{ background: 'var(--warn)' }} />
              <div className="t">
                <b>{plural(data.warnings.length, 'row')} skipped</b>
                {data.warnings.slice(0, 8).map((w) => <small key={w}>{w}</small>)}
              </div>
            </div>
          )}
        </div>
        <div className="mf">
          {report?.sheetUrl && <a className="btn soft" href={report.sheetUrl} target="_blank" rel="noreferrer noopener">Open the sheet</a>}
          <button className="btn soft" onClick={() => void refresh()} disabled={busy}><Icon name="refresh" />{busy ? 'Refreshing…' : 'Refresh now'}</button>
          {backend.mode === 'live' && <button className="btn primary" onClick={logout}><Icon name="out" />Sign out</button>}
        </div>
      </div>
    </Layer>
  );
}

/* ---------- switcher ---------- */

export function Layers() {
  const { layer } = useStore();
  if (!layer) return null;
  switch (layer.kind) {
    case 'booking': return <BookingModal />;
    case 'room-add': return <RoomModal />;
    case 'room': return <RoomDrawer no={layer.no} />;
    case 'payment': return <PaymentModal id={layer.id} />;
    case 'settings': return <SettingsModal />;
  }
}
