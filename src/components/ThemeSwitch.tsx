/**
 * The sun/moon button that switches between dark and light.
 */
import { useTheme } from '../lib/theme';
import { Icon } from './Icon';

/** The sun / moon switch: it shows which theme is on and switches to the other one. Used next to the bell, on the sign-in screen and in Settings. */
export function ThemeSwitch({ username }: { username: string }) {
  const [theme, toggle] = useTheme(username);
  const dark = theme === 'dark';
  const next = dark ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={`tswitch${dark ? ' is-dark' : ''}`}
      id="themeBtn"
      role="switch"
      aria-checked={dark}
      aria-label={`${dark ? 'Dark' : 'Light'} theme. Switch to ${next}`}
      title={`Switch to ${next} theme`}
      onClick={toggle}
    >
      <span className={`ic${dark ? '' : ' now'}`} style={{ display: 'grid' }}><Icon name="sun" /></span>
      <span className={`ic${dark ? ' now' : ''}`} style={{ display: 'grid' }}><Icon name="moon" /></span>
    </button>
  );
}
