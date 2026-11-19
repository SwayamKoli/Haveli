import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { STAFF_ROLES } from '../../shared/constants';
import type { FieldErrors, HealthReport, RoomsGenerateInput, StaffMember, StaffSaveInput } from '../../shared/types';
import { errText, plural } from '../lib/format';
import { roomTypes } from '../lib/selectors';
import { useStore } from '../store';
import { ApiError } from '../lib/api';
import { Avatar, Field, Icon, PageHead } from '../ui';
import { BackgroundCard, ThemeCard } from './Appearance';

const EMPTY_STAFF: StaffSaveInput = { username: '', name: '', role: STAFF_ROLES[0], active: true, password: '' };

/* ---------- my account ---------- */

function Account() {
  const { staff, openLayer, hotel, backend } = useStore();
  if (!staff) return null;
  return (
    <section className="card anim">
      <div className="card-h">
        <div>
          <h3>My account</h3>
          <p className="sub">{hotel}</p>
        </div>
      </div>
      <div className="who" style={{ marginBottom: 14 }}>
        <Avatar name={staff.name} />
        <div>
          <b>{staff.name}</b>
          <small>{staff.role} · username “{staff.username}”</small>
        </div>
      </div>
      {staff.viaOwner && <p className="note" role="note">You are signed in to this account with the owner password. Bookings you save are marked with this employee’s name.</p>}
      {!staff.owner && !staff.viaOwner && <p className="sub" style={{ color: 'var(--muted)', marginBottom: 12 }}>Forgot your password? Ask the owner to set a new one. There is no self-service reset.</p>}
      <div className="stack">
        {backend.mode === 'live' && (
          <button className="btn soft" onClick={() => openLayer({ kind: 'confirm-logout' })}>
            <Icon name="out" />
            Sign out
          </button>
        )}
      </div>
    </section>
  );
}

/* ---------- the Google Sheet ---------- */

function SheetCard() {
  const { backend, data, staff, reload, openLayer, toast } = useStore();
  const owner = !!staff?.owner;
  const [report, setReport] = useState<HealthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function check() {
    if (!owner) return;
    setBusy(true);
    setErr('');
    try {
      setReport(await backend.health());
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  }
  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  async function setup() {
    setBusy(true);
    try {
      const r = await backend.setupSheet();
      const done = [...r.changes, ...(r.style ? [r.style] : [])];
      toast(done.join(' · ') || 'The sheet already has everything it needs.');
      await reload(true);
      setReport(await backend.health());
    } catch (e) {
      toast(errText(e), { err: true });
    }
    setBusy(false);
  }

  async function restyle() {
    setBusy(true);
    try {
      const r = await backend.styleSheet();
      toast(r.changes.join(' · ') || 'Done.');
    } catch (e) {
      toast(errText(e), { err: true });
    }
    setBusy(false);
  }

  return (
    <section className="card anim">
      <div className="card-h">
        <div>
          <h3>Google Sheet</h3>
          <p className="sub">{backend.mode === 'demo' ? 'Demo data, nothing is saved' : 'Where every booking is kept'}</p>
        </div>
      </div>
      {owner && (
        <>
          {err && <p role="alert" style={{ color: 'var(--bad)' }}>{err}</p>}
          <div className="checks">
            {(report?.checks ?? []).map((c) => (
              <div className="row" key={c.name}>
                <i className="dotc" style={{ background: c.ok ? 'var(--good)' : 'var(--bad)' }} />
                <div className="t">
                  <b>{c.name}</b>
                  <small style={{ whiteSpace: 'normal' }}>{c.detail}</small>
                </div>
              </div>
            ))}
            {!report && !err && <p className="empty">Checking the connection…</p>}
            {data.warnings.length > 0 && (
              <div className="row">
                <i className="dotc" style={{ background: 'var(--warn)' }} />
                <div className="t">
                  <b>{plural(data.warnings.length, 'row')} skipped</b>
                  {data.warnings.slice(0, 8).map((w) => <small key={w} style={{ whiteSpace: 'normal' }}>{w}</small>)}
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {!owner && <p className="sub" style={{ color: 'var(--muted)' }}>The connection details and the sheet itself are for the owner.</p>}
      <div className="stack" style={{ marginTop: 14 }}>
        {owner && (report?.setupNeeded || data.setupNeeded) && backend.mode === 'live' && (
          <button className="btn primary" onClick={() => void setup()} disabled={busy}>
            <Icon name="check" />
            {busy ? 'Working…' : 'Set up sheet'}
          </button>
        )}
        {owner && backend.mode === 'live' && (
          <button className="btn soft" onClick={() => void restyle()} disabled={busy} title="Colours, widths and drop-downs for every tab. No data is changed.">
            <Icon name="image" />
            Apply Clay &amp; Sand style
          </button>
        )}
        {backend.mode === 'live' && (
          <button className="btn soft" onClick={() => openLayer({ kind: 'owner-sheet' })}>
            <Icon name="lock" />
            Open the Google Sheet
          </button>
        )}
        <button className="btn soft" onClick={() => void reload()}>
          <Icon name="refresh" />
          Refresh data now
        </button>
        {owner && backend.mode === 'live' && (
          <button className="btn soft" onClick={() => void check()} disabled={busy}>
            Check connection again
          </button>
        )}
      </div>
    </section>
  );
}

/* ---------- employees (owner only) ---------- */

function Staff() {
  const { backend, toast } = useStore();
  const [list, setList] = useState<StaffMember[] | null>(null);
  const [form, setForm] = useState<StaffSaveInput | null>(null);
  const [isNew, setIsNew] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState('');

  useEffect(() => {
    backend.listStaff().then((r) => setList(r.staff), (e) => setLoadErr(errText(e)));
  }, [backend]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    setErrors({});
    try {
      const r = await backend.saveStaff(form);
      setList(r.staff);
      toast(isNew ? `${form.name} can now sign in as “${form.username.toLowerCase()}”.` : `${form.name} updated.`);
      setForm(null);
    } catch (err) {
      setErrors(err instanceof ApiError && err.fields ? err.fields : { username: errText(err) });
    }
    setBusy(false);
  }

  const set = <K extends keyof StaffSaveInput>(k: K, v: StaffSaveInput[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <section className="card anim wide-card">
      <div className="card-h">
        <div>
          <h3>Employees</h3>
          <p className="sub">Each person gets their own username and password. Bookings and payments are recorded under their name. Your owner password opens any account.</p>
        </div>
        {!form && (
          <button className="btn primary sm" onClick={() => { setForm({ ...EMPTY_STAFF }); setIsNew(true); setErrors({}); }}>
            <Icon name="plus" />
            Add employee
          </button>
        )}
      </div>
      {loadErr && <p role="alert" style={{ color: 'var(--bad)' }}>{loadErr}</p>}
      {form ? (
        <form onSubmit={save} noValidate>
          <div className="form">
            <Field id="s_user" label="Username" error={errors.username}>
              <input id="s_user" autoComplete="off" autoCapitalize="none" disabled={!isNew} value={form.username} onChange={(e) => set('username', e.target.value.toLowerCase())} placeholder="e.g. asha" />
            </Field>
            <Field id="s_name" label="Name" error={errors.name}>
              <input id="s_name" autoComplete="off" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name" />
            </Field>
            <Field id="s_role" label="Role" error={errors.role}>
              <select id="s_role" value={form.role} onChange={(e) => set('role', e.target.value)}>
                {STAFF_ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </Field>
            <Field id="s_pw" label={isNew ? 'Password' : 'New password (leave empty to keep)'} error={errors.password}>
              <input id="s_pw" type="text" autoComplete="off" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder={isNew ? 'At least 6 characters' : 'Unchanged'} />
            </Field>
            <label className="check full">
              <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
              Can sign in
            </label>
          </div>
          <p className="sub" style={{ color: 'var(--muted)', marginTop: 8 }}>Tell the employee their password in person. It is stored scrambled and cannot be read back, only replaced.</p>
          <div className="mf">
            <button type="button" className="btn soft" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Add employee' : 'Save'}</button>
          </div>
        </form>
      ) : (
        <div className="tw">
          <table>
            <thead>
              <tr><th>Employee</th><th>Username</th><th>Role</th><th>Can sign in</th><th /></tr>
            </thead>
            <tbody>
              {(list ?? []).length ? (
                (list ?? []).map((s) => (
                  <tr key={s.username}>
                    <td><div className="who"><Avatar name={s.name} /><div><b>{s.name}</b></div></div></td>
                    <td className="num">{s.username}</td>
                    <td>{s.role}</td>
                    <td><span className={`chip ${s.active ? 'good' : ''}`}>{s.active ? 'Yes' : 'Switched off'}</span></td>
                    <td>
                      <button className="btn soft sm" onClick={() => { setForm({ username: s.username, name: s.name, role: s.role, active: s.active, password: '' }); setIsNew(false); setErrors({}); }}>
                        <Icon name="edit" size={14} />
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} className="empty">{list ? 'No employees yet. Add the first one.' : 'Loading…'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------- quick room setup (owner only) ---------- */

function Rooms() {
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

/* ---------- the page ---------- */

export function Settings() {
  const { staff, backend } = useStore();
  const owner = !!staff?.owner;
  return (
    <>
      <PageHead title="Settings" sub={owner ? 'Your account, look and feel, employees, rooms and the Google Sheet' : 'Your account and look'} />
      <div className="set-grid">
        <Account />
        <ThemeCard />
        {owner && <BackgroundCard />}
        <SheetCard />
        {owner && <Staff />}
        {owner && backend.mode === 'live' && <Rooms />}
        {owner && backend.mode === 'demo' && <Rooms />}
      </div>
    </>
  );
}
