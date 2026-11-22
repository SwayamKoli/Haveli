/**
 * Dark or light, for the person signed in.
 */
import { Icon } from '../../components/Icon';
import { applyTheme, useThemeName } from '../../lib/theme';
import { useStore } from '../../state/store';

export function ThemeCard() {
  const { staff } = useStore();
  const theme = useThemeName();
  const pick = (t: 'dark' | 'light') => applyTheme(t, staff?.username ?? '');
  return (
    <section className="card anim">
      <div className="card-h">
        <div>
          <h3>Appearance</h3>
          <p className="sub">Dark or light. Your choice is remembered the next time you sign in.</p>
        </div>
      </div>
      <div className="opts" role="radiogroup" aria-label="Theme">
        <button type="button" role="radio" aria-checked={theme === 'dark'} className={`opt${theme === 'dark' ? ' on' : ''}`} onClick={() => pick('dark')}>
          <span className="opt-sw s-dark"><Icon name="moon" /></span>
          <b>Dark</b>
          <small>Warm and easy on the eyes. The default.</small>
        </button>
        <button type="button" role="radio" aria-checked={theme === 'light'} className={`opt${theme === 'light' ? ' on' : ''}`} onClick={() => pick('light')}>
          <span className="opt-sw s-light"><Icon name="sun" /></span>
          <b>Light</b>
          <small>Bright, for a sunny front desk.</small>
        </button>
      </div>
    </section>
  );
}
