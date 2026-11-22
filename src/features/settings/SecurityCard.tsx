/**
 * The owner's Security card: a short checklist of how well protected this installation is, the recent sign-in log
 * (wrong passwords show up here), and a button that signs everyone out on every device.
 */
import { useEffect, useState } from 'react';
import type { SecurityEvent, SecurityEventType, SecurityReport } from '../../../shared/types';
import { Icon } from '../../components/Icon';
import { errText } from '../../lib/format';
import { useStore } from '../../state/store';

const LABELS: Record<SecurityEventType, string> = {
  login: 'Signed in',
  'login-failed': 'Wrong username or password',
  'login-blocked': 'Blocked after too many wrong tries',
  'code-failed': 'Wrong 2-step code',
  logout: 'Signed out',
  'sign-out-all': 'Everyone signed out',
  'staff-saved': 'Employee saved',
  'sheet-link': 'Google Sheet link opened',
  'sheet-link-failed': 'Wrong owner password for the sheet link',
  'sheet-setup': 'Sheet set up',
  'background-changed': 'Background changed',
};

const WARNING = new Set<SecurityEventType>(['login-failed', 'login-blocked', 'code-failed', 'sheet-link-failed']);

const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function EventRow({ e }: { e: SecurityEvent }) {
  return (
    <div className="row">
      <i className="dotc" style={{ background: WARNING.has(e.type) ? 'var(--bad)' : 'var(--good)' }} />
      <div className="t">
        <b>{LABELS[e.type] ?? e.type}</b>
        <small style={{ whiteSpace: 'normal' }}>
          {[e.who && `user "${e.who}"`, e.ip, when(e.at), e.detail].filter(Boolean).join(' · ')}
        </small>
      </div>
    </div>
  );
}

export function SecurityCard() {
  const { backend } = useStore();
  const [report, setReport] = useState<SecurityReport | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function load() {
    setBusy(true);
    setErr('');
    try {
      setReport(await backend.security());
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOutAll() {
    setBusy(true);
    try {
      await backend.signOutAll();
      // This device is signed out too: go back to the sign-in screen.
      window.dispatchEvent(new Event('haveli:unauthorized'));
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  return (
    <section className="card anim wide-card">
      <div className="card-h">
        <div>
          <h3>Security</h3>
          <p className="sub">How well protected this installation is, and the latest sign-in activity</p>
        </div>
      </div>
      {err && <p role="alert" style={{ color: 'var(--bad)' }}>{err}</p>}
      <div className="checks">
        {(report?.checks ?? []).map((c) => (
          <div className="row" key={c.id}>
            <i className="dotc" style={{ background: c.ok ? 'var(--good)' : 'var(--warn)' }} />
            <div className="t">
              <b>{c.title}</b>
              <small style={{ whiteSpace: 'normal' }}>{c.detail}</small>
            </div>
          </div>
        ))}
        {!report && !err && <p className="empty">Checking…</p>}
      </div>
      {report && (
        <>
          <h4 style={{ margin: '16px 0 4px' }}>Recent activity</h4>
          <div className="checks" style={{ maxHeight: 300, overflowY: 'auto' }}>
            {report.events.length === 0 && <p className="empty">Nothing yet since the app started.</p>}
            {report.events.map((e, i) => <EventRow key={`${e.at}-${i}`} e={e} />)}
          </div>
          <p className="sub" style={{ color: 'var(--muted)', marginTop: 8 }}>Kept until the app restarts. Many "wrong password" lines from addresses you do not know mean someone is guessing: use a longer owner password and switch on the 2-step code.</p>
        </>
      )}
      <div className="stack" style={{ marginTop: 14 }}>
        {!confirm ? (
          <button className="btn soft" onClick={() => setConfirm(true)} disabled={busy}>
            <Icon name="lock" />
            Sign out everyone
          </button>
        ) : (
          <>
            <button className="btn danger" onClick={() => void signOutAll()} disabled={busy}>Yes, sign out every device, including this one</button>
            <button className="btn soft" onClick={() => setConfirm(false)} disabled={busy}>Cancel</button>
          </>
        )}
        <button className="btn soft" onClick={() => void load()} disabled={busy}>
          <Icon name="refresh" />
          Refresh
        </button>
      </div>
    </section>
  );
}
