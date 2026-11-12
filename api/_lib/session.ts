/**
 * Sign-in: one shared password gives a signed, HTTP-only cookie.
 * The cookie holds only an expiry time and a signature, nothing about the user.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError, header } from './http';
import type { ApiRequest } from './http';

export const COOKIE_NAME = 'haveli_session';
export const SESSION_SECONDS = 14 * 24 * 60 * 60;

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function passwordMatches(given: string, expected: string): boolean {
  return safeEqual(given, expected);
}

export function createToken(secret: string, nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + SESSION_SECONDS;
  const body = `v1.${exp}`;
  return `${body}.${sign(secret, body)}`;
}

export function verifyToken(secret: string, token: string | null, nowMs: number = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const body = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(sign(secret, body), parts[2])) return false;
  const exp = Number(parts[1]);
  return Number.isFinite(exp) && exp * 1000 > nowMs;
}

export function readCookie(req: ApiRequest, name: string): string | null {
  const raw = header(req, 'cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure ? '; Secure' : ''}`;
}

export function clearCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function hasSession(req: ApiRequest, secret: string): boolean {
  return verifyToken(secret, readCookie(req, COOKIE_NAME));
}

export function requireSession(req: ApiRequest, secret: string): void {
  if (!hasSession(req, secret)) throw new HttpError(401, 'Please sign in again.');
}

/**
 * Browsers cannot add a custom header to a cross-site form post, so asking for one
 * stops other websites from making changes on a signed-in person's behalf.
 */
export function requireSameOriginHeader(req: ApiRequest): void {
  if (header(req, 'x-requested-with') !== 'haveli') throw new HttpError(403, 'Blocked: this request did not come from the app.');
}

/* ---------- slow down password guessing (per server instance) ---------- */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 8;
const fails = new Map<string, { count: number; resetAt: number }>();

export function loginBlocked(ip: string, nowMs: number = Date.now()): boolean {
  const f = fails.get(ip);
  if (!f) return false;
  if (f.resetAt < nowMs) {
    fails.delete(ip);
    return false;
  }
  return f.count >= MAX_FAILS;
}

export function noteLoginFailure(ip: string, nowMs: number = Date.now()): void {
  const f = fails.get(ip);
  if (!f || f.resetAt < nowMs) fails.set(ip, { count: 1, resetAt: nowMs + WINDOW_MS });
  else f.count += 1;
}

export function clearLoginFailures(ip: string): void {
  fails.delete(ip);
}
