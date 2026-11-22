/**
 * The root of the website: loads who is signed in, applies the theme and background, shows the welcome animation, then the sign-in screen or the app.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionInfo } from '../shared/types';
import { Login } from './app/Login';
import { Shell } from './app/Shell';
import { Backdrop } from './components/Backdrop';
import { Intro } from './components/Brand';
import { DEMO, HOTEL_NAME } from './config';
import { makeLiveBackend, type Backend } from './lib/api';
import { setBackground } from './lib/background';
import { makeDemoBackend } from './lib/demo';
import { errText } from './lib/format';
import { motionOn } from './lib/motion';
import { applyTheme, currentTheme, themeFor } from './lib/theme';
import { StoreProvider } from './state/store';

/** Shows the welcome animation for about two seconds, then calls onDone. */
function IntroTimer({ name, onDone }: { name: string; onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, 2300);
    return () => window.clearTimeout(t);
  }, [onDone]);
  return <Intro name={name} onDone={onDone} />;
}

export default function App() {
  const backend = useMemo<Backend>(() => (DEMO ? makeDemoBackend() : makeLiveBackend()), []);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [intro, setIntro] = useState(() => motionOn());
  const endIntro = useCallback(() => setIntro(false), []);

  useEffect(() => {
    setError('');
    backend.session().then(setSession).catch((e) => setError(errText(e)));
  }, [backend, attempt]);

  /* Whoever is signed in gets the theme they left the website in (dark the first time); everyone sees the owner's background. */
  const who = session?.authenticated ? session.staff?.username : undefined;
  useEffect(() => {
    if (session) setBackground(session.background);
  }, [session]);
  useEffect(() => {
    if (who) applyTheme(themeFor(who) ?? currentTheme(), who);
  }, [who]);

  useEffect(() => {
    const out = () => {
      setSession((s) => (s ? { ...s, authenticated: false, staff: null } : s));
      // Ask again, so the sign-in screen shows the owner's current background and not an old one.
      backend.session().then(setSession).catch(() => undefined);
    };
    window.addEventListener('haveli:unauthorized', out);
    return () => window.removeEventListener('haveli:unauthorized', out);
  }, [backend]);

  useEffect(() => {
    if (session?.hotel) document.title = `${session.hotel} · Hotel dashboard`;
  }, [session?.hotel]);

  const signOut = () => {
    void backend.logout().finally(() => {
      window.location.hash = '';
      setSession((s) => (s ? { ...s, authenticated: false, staff: null } : s));
      backend.session().then(setSession).catch(() => undefined);
    });
  };

  let body;
  if (error) {
    body = (
      <div className="splash" role="alert">
        <h2>Cannot reach the server</h2>
        <p>{error}</p>
        <button className="btn primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  } else if (!session) {
    // While the welcome animation is waiting for the hotel's name, show nothing instead of "Loading…".
    body = <div className="splash" role="status">{!intro && <p>Loading…</p>}</div>;
  } else if (!session.authenticated) {
    body = <Login backend={backend} session={session} onSignedIn={setSession} />;
  } else {
    body = (
      <StoreProvider backend={backend} staff={session.staff} hotel={session.hotel || HOTEL_NAME} onLogout={signOut}>
        <Shell />
      </StoreProvider>
    );
  }

  return (
    <>
      <Backdrop view={session?.authenticated ? 'app' : 'login'} />
      {body}
      {intro && session && <IntroTimer name={session.hotel || HOTEL_NAME} onDone={endIntro} />}
    </>
  );
}
