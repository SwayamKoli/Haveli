/**
 * "Are you sure you want to sign out?"
 */
import { Icon } from '../components/Icon';
import { Layer } from '../components/Layer';
import { useStore } from '../state/store';

export function ConfirmLogout() {
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
