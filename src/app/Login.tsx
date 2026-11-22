/**
 * The sign-in screen.
 */
import { useState, type FormEvent } from 'react';
import type { SessionInfo } from '../../shared/types';
import { Logo } from '../components/Brand';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { HOTEL_NAME } from '../config';
import { ApiError, type Backend } from '../lib/api';
import { errText } from '../lib/format';

const USER_KEY = 'haveli:last-user';

function rememberedUser(): string {
  try {
    return window.localStorage.getItem(USER_KEY) ?? '';
  } catch {
    return '';
  }
}

export function Login({ backend, session, onSignedIn }: { backend: Backend; session: SessionInfo; onSignedIn: (s: SessionInfo) => void }) {
  const [username, setUsername] = useState(rememberedUser);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const hotel = session.hotel || HOTEL_NAME;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !username.trim() || !password) return;
    setBusy(true);
    setError('');
    try {
      const s = await backend.login(username.trim(), password, code.replace(/\s/g, '') || undefined);
      try {
        window.localStorage.setItem(USER_KEY, username.trim().toLowerCase());
      } catch {
        /* private window: nothing to remember */
      }
      onSignedIn(s);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CODE_REQUIRED') {
        // The password was right: keep it, and ask for the owner's 6-digit code.
        setNeedCode(true);
        setError(code ? errText(err) : '');
        setCode('');
      } else {
        setError(errText(err));
        setPassword('');
        setCode('');
        setNeedCode(false);
      }
    }
    setBusy(false);
  }

  return (
    <div className="login-wrap">
      <div className="login-corner"><ThemeSwitch username="" /></div>
      <form className="modal login-card" onSubmit={submit} aria-labelledby="lt" noValidate>
        <Logo name={hotel} />
        <h2 id="lt">Sign in</h2>
        {!session.configured ? (
          <div role="alert" style={{ color: 'var(--warn)', lineHeight: 1.6 }}>
            The server is not set up yet. Run <b>npm run setup</b> in the project folder, or open the <b>.env</b> file and fill in:
            <ul style={{ margin: '8px 0 0 18px' }}>
              {session.missing.map((m) => <li key={m}>{m}</li>)}
            </ul>
            {session.missing.some((m) => m.includes('not valid JSON')) && (
              <p style={{ color: 'var(--muted)', marginTop: 10 }}>
                The key must be the <b>whole</b> downloaded .json file, starting with <b>{'{'}</b> and ending with <b>{'}'}</b>, pasted inside single quotes.
              </p>
            )}
            <p style={{ color: 'var(--muted)', marginTop: 10 }}>Then stop the app (Ctrl+C) and start it again. README.md explains each one.</p>
          </div>
        ) : (
          <>
            <div className={`form${error ? ' bad' : ''}`}>
              <div className="full">
                <label htmlFor="un">Username</label>
                <input id="un" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus={!username} value={username} onChange={(e) => { setUsername(e.target.value); setNeedCode(false); }} />
              </div>
              <div className="full">
                <label htmlFor="pw">Password</label>
                <input id="pw" type="password" autoComplete="current-password" autoFocus={!!username && !needCode} value={password} onChange={(e) => { setPassword(e.target.value); setNeedCode(false); }} />
                {!needCode && <div className="err" role={error ? 'alert' : undefined}>{error}</div>}
              </div>
              {needCode && (
                <div className="full">
                  <label htmlFor="cd">6-digit code from your authenticator app</label>
                  <input id="cd" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, ''))} />
                  <div className="err" role={error ? 'alert' : undefined}>{error}</div>
                </div>
              )}
            </div>
            <p className="hint">{needCode ? 'Owner sign-in needs the code that changes every 30 seconds.' : 'Your username and password are given to you by the owner.'}</p>
            <div className="mf">
              <button className="btn primary" type="submit" disabled={busy || !username.trim() || !password || (needCode && code.replace(/\s/g, '').length < 6)}>{busy ? 'Checking…' : 'Sign in'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
