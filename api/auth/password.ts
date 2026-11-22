/**
 * Employee passwords are stored as salted scrypt hashes, never as text.
 * Format: scrypt$N$r$p$salt$hash (salt and hash in base64).
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const run = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (e, key) => (e ? reject(e) : resolve(key))));

/** Cost of guessing: 2^15 rounds, about 32 MB of memory per try. Hashes made earlier (2^14) are stored with their own settings and still work. */
const N = 32768;
const R = 8;
const P = 1;
/** scrypt needs 128 * N * r bytes; allow a little more, and refuse a stored hash that asks for far more (a tampered sheet cannot exhaust memory). */
const MAX_N = 131072;
const MAXMEM = 256 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await run(password.normalize('NFKC'), salt, 32, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = String(stored ?? '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const N2 = Number(n);
  if (!Number.isInteger(N2) || N2 < 1024 || N2 > MAX_N || Number(r) !== R || Number(p) !== P || want.length < 16 || want.length > 64) return false;
  try {
    const got = await run(password.normalize('NFKC'), Buffer.from(salt, 'base64'), want.length, { N: N2, r: R, p: P, maxmem: MAXMEM });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;
/** A real hash to compare against when the username does not exist, so a wrong username takes as long as a wrong password. */
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword('not-a-real-password');
  return dummy;
}

/** A short fingerprint of a stored hash, kept inside the sign-in cookie so a changed password signs the old session out. */
export function fingerprint(stored: string): string {
  return String(stored ?? '').slice(-10);
}
