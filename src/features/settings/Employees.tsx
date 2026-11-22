/**
 * Employees (owner only): add, edit, switch on or off, set a password.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { STAFF_ROLES } from '../../../shared/constants';
import type { FieldErrors, StaffMember, StaffSaveInput } from '../../../shared/types';
import { Avatar } from '../../components/Chips';
import { Icon } from '../../components/Icon';
import { Field } from '../../components/Layer';
import { ApiError } from '../../lib/api';
import { errText } from '../../lib/format';
import { useStore } from '../../state/store';

const EMPTY_STAFF: StaffSaveInput = { username: '', name: '', role: STAFF_ROLES[0], active: true, password: '' };

export function Employees() {
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
              <input id="s_pw" type="text" autoComplete="off" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder={isNew ? 'At least 8 characters' : 'Unchanged'} />
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
