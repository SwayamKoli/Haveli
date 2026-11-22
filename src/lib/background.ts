/**
 * Applies the owner's chosen background (plain, scene, photo, video) to the page and lets components read it.
 */
import { useSyncExternalStore } from 'react';
import { NO_BACKGROUND, type BackgroundInfo } from '../../shared/types';

/**
 * What is behind the website right now. One value for the whole app: the sign-in screen sets it from
 * the session, the signed-in app keeps it fresh from the data, and the owner's settings change it.
 * The kind is also written on <html data-bg> so the stylesheet can make the panels a little denser
 * when there is a picture or video behind them.
 */
let current: BackgroundInfo = NO_BACKGROUND;
const listeners = new Set<() => void>();

export function setBackground(next: BackgroundInfo | undefined): void {
  const b = next ?? NO_BACKGROUND;
  document.documentElement.dataset.bg = b.kind;
  if (b.kind === current.kind && b.url === current.url && b.version === current.version) return;
  current = b;
  listeners.forEach((l) => l());
}

export function useBackground(): BackgroundInfo {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => NO_BACKGROUND,
  );
}
