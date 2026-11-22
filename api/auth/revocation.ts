/**
 * Ending sign-ins on the server. A sign-in cookie is signed, so on its own it stays valid until it expires; these two
 * lists let the server cancel it earlier:
 *   - a token that was signed out (Logout) is remembered until it would have expired anyway
 *   - "Sign out everyone" remembers a moment in time, and every sign-in from before it stops working
 * Both are saved in the media folder (security-state.json) so a restart does not bring cancelled sign-ins back.
 * If that folder cannot be written, they are kept in memory only.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mediaDir } from '../media/media';

interface State {
  /** Sign-ins issued at or before this time (ms) are no longer valid. */
  validFrom: number;
  /** token id -> when the token expires (ms). */
  revoked: Record<string, number>;
}

const FILE = 'security-state.json';
let cache: { path: string; state: State } | null = null;

function load(): State {
  const path = join(mediaDir(), FILE);
  if (cache?.path === path) return cache.state;
  let state: State = { validFrom: 0, revoked: {} };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<State>;
    state = {
      validFrom: Number.isFinite(raw.validFrom) ? Number(raw.validFrom) : 0,
      revoked: raw.revoked && typeof raw.revoked === 'object' ? { ...raw.revoked } : {},
    };
  } catch {
    /* no file yet */
  }
  cache = { path, state };
  return state;
}

function save(state: State): void {
  try {
    mkdirSync(mediaDir(), { recursive: true });
    const tmp = join(mediaDir(), `${FILE}.tmp`);
    writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    renameSync(tmp, join(mediaDir(), FILE));
  } catch {
    /* read-only disk: the in-memory copy still works until the next restart */
  }
}

/** Has this sign-in been cancelled? `i` is when it was issued (ms) and `j` is its id. */
export function isRevoked(who: { i?: number; j?: string }): boolean {
  const s = load();
  if (typeof who.i !== 'number' || who.i <= s.validFrom) return true;
  return !!who.j && who.j in s.revoked;
}

/** Cancels one sign-in (when its person signs out). `expMs` is when it would have expired. */
export function revokeToken(j: string, expMs: number, nowMs: number = Date.now()): void {
  const s = load();
  s.revoked[j] = expMs;
  for (const [k, exp] of Object.entries(s.revoked)) if (exp < nowMs) delete s.revoked[k];
  save(s);
}

/** Cancels every sign-in issued so far, for everyone. */
export function signOutEveryone(nowMs: number = Date.now()): void {
  const s = load();
  s.validFrom = nowMs;
  s.revoked = {};
  save(s);
}

/** For tests: forget the cached copy (the file, if any, is kept). */
export function resetRevocations(): void {
  cache = null;
}
