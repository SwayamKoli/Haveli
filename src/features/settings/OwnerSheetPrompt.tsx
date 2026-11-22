/**
 * Asks for the owner password before showing the link to the Google Sheet.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { Field, Layer } from '../../components/Layer';
import { errText } from '../../lib/format';
import { useStore } from '../../state/store';

export function OwnerSheetPrompt() {
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
