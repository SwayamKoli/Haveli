/**
 * The Google Sheet card: connection check, set up sheet, open the sheet.
 */
import { useEffect, useState } from 'react';
import type { HealthReport } from '../../../shared/types';
import { Icon } from '../../components/Icon';
import { errText, plural } from '../../lib/format';
import { useStore } from '../../state/store';

export function SheetCard() {
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
        {owner && backend.mode === 'live' && (
          <button
            className={`btn ${report?.setupNeeded || data.setupNeeded ? 'primary' : 'soft'}`}
            onClick={() => void setup()}
            disabled={busy}
            title="Adds any missing tab or column and gives every tab the Clay & Sand look. No data is changed. Safe to press again."
          >
            <Icon name="check" />
            {busy ? 'Working…' : 'Set up sheet'}
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
