/**
 * Slowing down guessing and flooding. Everything here lives in memory (one server instance, see README), and every
 * table is size-limited so an attacker cannot fill the server's memory by inventing addresses or usernames.
 *
 *   loginBlocked / noteLoginFailure / clearLoginFailures   too many wrong passwords from one address (or bucket)
 *   accountDelay / noteAccountFailure / serialized         one username guessed from many addresses: answers get slower
 *   apiAllowed / uploadAllowed                             a ceiling on requests per address
 */
import { HttpError } from '../lib/http';

/** A map that forgets expired entries and never holds more than `max` of them. */
class Expiring<V extends { resetAt: number }> {
  private m = new Map<string, V>();
  constructor(private max: number) {}
  get(key: string, now: number): V | undefined {
    const v = this.m.get(key);
    if (v && v.resetAt < now) {
      this.m.delete(key);
      return undefined;
    }
    return v;
  }
  set(key: string, v: V, now: number): void {
    if (!this.m.has(key) && this.m.size >= this.max) {
      for (const [k, x] of this.m) if (x.resetAt < now) this.m.delete(k);
      // Still full: drop the oldest entries (Map keeps insertion order).
      for (const k of this.m.keys()) {
        if (this.m.size < this.max) break;
        this.m.delete(k);
      }
    }
    this.m.set(key, v);
  }
  delete(key: string): void {
    this.m.delete(key);
  }
  clear(): void {
    this.m.clear();
  }
}

/* ---------- wrong passwords from one address ---------- */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 8;
const fails = new Expiring<{ count: number; resetAt: number }>(5000);

export function loginBlocked(key: string, nowMs: number = Date.now()): boolean {
  const f = fails.get(key, nowMs);
  return !!f && f.count >= MAX_FAILS;
}

export function noteLoginFailure(key: string, nowMs: number = Date.now()): void {
  const f = fails.get(key, nowMs);
  if (!f) fails.set(key, { count: 1, resetAt: nowMs + WINDOW_MS }, nowMs);
  else f.count += 1;
}

export function clearLoginFailures(key: string): void {
  fails.delete(key);
}

/**
 * After a good sign-in the address is forgiven a little, not completely: otherwise someone with one valid
 * account could sign in as themselves between guesses and never be slowed down.
 */
export function easeLoginFailures(key: string, nowMs: number = Date.now()): void {
  const f = fails.get(key, nowMs);
  if (f) f.count = Math.max(0, f.count - 2);
}

/* ---------- one username, many addresses ---------- */

const ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
/** Failures against one username before answers start to slow down. */
const ACCOUNT_FREE_TRIES = 5;
const MAX_DELAY_MS = 10_000;
const MAX_QUEUE = 10;
const accountFails = new Expiring<{ count: number; resetAt: number }>(5000);

/** How long to wait before checking this username again. Zero for the first few tries, then growing to 10 seconds. */
export function accountDelay(username: string, nowMs: number = Date.now()): number {
  const f = accountFails.get(username, nowMs);
  if (!f || f.count <= ACCOUNT_FREE_TRIES) return 0;
  return Math.min(MAX_DELAY_MS, (f.count - ACCOUNT_FREE_TRIES) * 500);
}

export function noteAccountFailure(username: string, nowMs: number = Date.now()): void {
  const f = accountFails.get(username, nowMs);
  if (!f) accountFails.set(username, { count: 1, resetAt: nowMs + ACCOUNT_WINDOW_MS }, nowMs);
  else f.count += 1;
}

export function clearAccountFailures(username: string): void {
  accountFails.delete(username);
}

const chains = new Map<string, { tail: Promise<unknown>; waiting: number }>();

/**
 * Runs `fn` for a username one at a time, so guesses against the same account cannot be sent in parallel
 * to get around the slow-down. Too many people waiting for one username are turned away.
 */
export function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const slot = chains.get(key) ?? { tail: Promise.resolve(), waiting: 0 };
  if (slot.waiting >= MAX_QUEUE) throw new HttpError(429, 'Too many sign-in attempts for this account right now. Wait a minute and try again.');
  slot.waiting += 1;
  chains.set(key, slot);
  const run = slot.tail.catch(() => undefined).then(fn);
  slot.tail = run;
  const done = () => {
    slot.waiting -= 1;
    if (slot.waiting === 0 && chains.get(key) === slot) chains.delete(key);
  };
  run.then(done, done);
  return run;
}

/* ---------- a ceiling on requests per address ---------- */

interface Counter {
  count: number;
  resetAt: number;
}

function counter(max: number, windowMs: number) {
  const table = new Expiring<Counter>(10_000);
  return {
    allow(key: string, nowMs: number = Date.now()): boolean {
      const c = table.get(key, nowMs);
      if (!c) {
        table.set(key, { count: 1, resetAt: nowMs + windowMs }, nowMs);
        return true;
      }
      c.count += 1;
      return c.count <= max;
    },
    reset: () => table.clear(),
  };
}

/** Plenty for a busy front desk behind one Wi-Fi address (the dashboard asks every 45 seconds). */
const api = counter(600, 60_000);
const upload = counter(6, 10 * 60_000);

export const apiAllowed = (ip: string, nowMs?: number): boolean => api.allow(ip, nowMs);
export const uploadAllowed = (ip: string, nowMs?: number): boolean => upload.allow(ip, nowMs);

/** For tests: forget everything. */
export function resetThrottles(): void {
  fails.clear();
  accountFails.clear();
  chains.clear();
  api.reset();
  upload.reset();
}
