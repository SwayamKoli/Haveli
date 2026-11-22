/**
 * The owner's 2-step code (the 6 digits an authenticator app shows, RFC 6238). Works with Google Authenticator,
 * Microsoft Authenticator, Authy, 1Password and similar. The shared secret lives in .env as OWNER_TOTP_SECRET.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Null when the text is not valid base32. Spaces, dashes and lower case are fine (people type them). */
export function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (!clean) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret, 160 bits, as the letters and digits an authenticator app asks for. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** True when the text can be used as OWNER_TOTP_SECRET (at least 80 bits). */
export function validTotpSecret(text: string): boolean {
  const b = base32Decode(text);
  return !!b && b.length >= 10;
}

function codeFor(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function totpAt(secretText: string, nowMs: number): string {
  const secret = base32Decode(secretText);
  if (!secret) throw new Error('not a valid code secret');
  return codeFor(secret, Math.floor(nowMs / 1000 / STEP_SECONDS));
}

/**
 * Checks a typed code, allowing one step either way (clocks drift). Returns the step that matched, or null.
 * Pass the last step that was accepted: a code that was already used cannot be used again.
 */
export function verifyTotp(secretText: string, typed: string, nowMs: number, lastUsedStep = -1): number | null {
  const secret = base32Decode(secretText);
  const code = typed.replace(/\s/g, '');
  if (!secret || !/^\d{6}$/.test(code)) return null;
  const now = Math.floor(nowMs / 1000 / STEP_SECONDS);
  let hit: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const want = Buffer.from(codeFor(secret, step));
    // No early exit: every step is compared, so timing reveals nothing.
    if (timingSafeEqual(want, Buffer.from(code)) && step > lastUsedStep) hit = hit === null || step > hit ? step : hit;
  }
  return hit;
}

/** The address an authenticator app imports (as a QR code, or by typing the secret). */
export function otpauthUri(secretText: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretText.replace(/[\s-]/g, '').toUpperCase()}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/* ---------- the owner's sign-in check, remembering the last code used ---------- */

let lastAcceptedStep = -1;

/** True when `typed` is the current code. A code that was accepted once is refused the second time. */
export function checkOwnerCode(secretText: string, typed: string, nowMs: number = Date.now()): boolean {
  const step = verifyTotp(secretText, typed, nowMs, lastAcceptedStep);
  if (step === null) return false;
  lastAcceptedStep = step;
  return true;
}

/** For tests. */
export function resetCodeReplay(): void {
  lastAcceptedStep = -1;
}
