/**
 * Sign-in: the server hands the browser a signed, HTTP-only cookie that says who
 * signed in and until when. Changing the signature or the contents breaks it.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { header, HttpError, type ApiRequest } from '../lib/http';

export const COOKIE_NAME = 'haveli_session';
/** One shift. People sign in again the next day. */
export const SESSION_SECONDS = 12 * 60 * 60;

/** Who is signed in. Short keys keep the cookie small. */
export interface SessionUser {
  /** username */
  u: string;
  /** display name */
  n: string;
  /** role label */
  r: string;
  /** is the owner account */
  o: boolean;
  /** owner signed in to an employee's account with the owner password */
  v: boolean;
  /** fingerprint of the employee's password hash, or of the owner password for owner / via-owner sessions */
  k: string;
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Changes whenever the owner password (or the session secret) changes, so old owner sessions stop working. */
export function ownerFingerprint(secret: string, ownerPassword: string): string {
  return createHmac('sha256', secret).update(`owner-password:${ownerPassword}`).digest('base64url').slice(0, 10);
}

export function passwordMatches(given: string, expected: string): boolean {
  return safeEqual(given, expected);
}

export function createToken(secret: string, user: SessionUser, nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + SESSION_SECONDS;
  const body = `v2.${Buffer.from(JSON.stringify({ ...user, e: exp })).toString('base64url')}`;
  return `${body}.${sign(secret, body)}`;
}

export function verifyToken(secret: string, token: string | null, nowMs: number = Date.now()): SessionUser | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v2') return null;
  const body = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(sign(secret, body), parts[2])) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as SessionUser & { e: number };
    if (!Number.isFinite(p.e) || p.e * 1000 <= nowMs || typeof p.u !== 'string') return null;
    return { u: p.u, n: String(p.n ?? ''), r: String(p.r ?? ''), o: p.o === true, v: p.v === true, k: String(p.k ?? '') };
  } catch {
    return null;
  }
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

export function readSession(req: ApiRequest, secret: string): SessionUser | null {
  return verifyToken(secret, readCookie(req, COOKIE_NAME));
}

export function requireSession(req: ApiRequest, secret: string): SessionUser {
  const who = readSession(req, secret);
  if (!who) throw new HttpError(401, 'Please sign in again.');
  return who;
}

/**
 * Browsers cannot add a custom header to a cross-site form post, so asking for one
 * stops other websites from making changes on a signed-in person's behalf.
 */
export function requireSameOriginHeader(req: ApiRequest): void {
  if (header(req, 'x-requested-with') !== 'haveli') throw new HttpError(403, 'Blocked: this request did not come from the app.');
}

/* ---------- slow down password guessing (per server instance; key = IP address or a bucket + IP) ---------- */

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
