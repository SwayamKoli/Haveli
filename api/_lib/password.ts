/**
 * Employee passwords are stored as salted scrypt hashes, never as text.
 * Format: scrypt$N$r$p$salt$hash (salt and hash in base64).
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

const run = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (e, key) => (e ? reject(e) : resolve(key))));

const N = 16384;
const R = 8;
const P = 1;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await run(password.normalize('NFKC'), salt, 32, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = String(stored ?? '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  try {
    const got = await run(password.normalize('NFKC'), Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p) });
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
