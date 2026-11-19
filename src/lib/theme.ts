import { useCallback, useSyncExternalStore } from 'react';

/**
 * Dark / light.
 * Dark is the default. The choice is remembered per person (by username) on this device,
 * and the last choice on the device is used on the sign-in screen.
 */
export type Theme = 'dark' | 'light';

const DEVICE_KEY = 'haveli:theme';
const userKey = (username: string) => `haveli:theme:${username.toLowerCase()}`;
const COLORS: Record<Theme, string> = { dark: '#120B09', light: '#F3E9DC' };

function read(key: string): Theme | null {
  try {
    const v = window.localStorage.getItem(key);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function write(key: string, value: Theme): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private window: the choice lasts until the tab closes */
  }
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** The theme to show before anyone signs in: whatever this device used last, otherwise dark. */
export function deviceTheme(): Theme {
  return read(DEVICE_KEY) ?? 'dark';
}

/** The theme this person left the website in, or null if they have never chosen one on this device. */
export function themeFor(username: string): Theme | null {
  return read(userKey(username));
}

const listeners = new Set<() => void>();

/** Switches the whole app at once (one attribute on <html>) and, when asked, remembers it. */
export function applyTheme(theme: Theme, username?: string): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', COLORS[theme]);
  if (username !== undefined) {
    write(DEVICE_KEY, theme);
    if (username) write(userKey(username), theme);
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useThemeName(): Theme {
  return useSyncExternalStore(subscribe, currentTheme, () => 'dark' as Theme);
}

/** [current theme, switch to the other one]. `username` is whoever is signed in, so the choice is theirs. */
export function useTheme(username: string): [Theme, () => void] {
  const theme = useThemeName();
  const toggle = useCallback(() => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', username), [username]);
  return [theme, toggle];
}
