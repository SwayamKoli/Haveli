/**
 * Sign-in: the server hands the browser a signed, HTTP-only cookie that says who
 * signed in and until when. Changing the signature or the contents breaks it.
 * Cancelling a sign-in early (logout, "sign out everyone") is in revocation.ts; guessing limits are in throttle.ts.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { header, HttpError, type ApiRequest } from '../lib/http';
import { isRevoked } from './revocation';

export const COOKIE_NAME = 'haveli_session';
/** On https the cookie gets this name: browsers then refuse to let another site or subdomain overwrite it. */
export const SECURE_COOKIE_NAME = '__Host-haveli_session';
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
  /** when this sign-in was issued (ms), its unique id, and when it expires (seconds). Set by createToken. */
  i?: number;
  j?: string;
  e?: number;
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Changes whenever the owner password, the 2-step code secret or the session secret changes, so old owner sessions stop working. */
export function ownerFingerprint(secret: string, ownerPassword: string, totpSecret = ''): string {
  return createHmac('sha256', secret).update(`owner-password:${ownerPassword}|2fa:${totpSecret}`).digest('base64url').slice(0, 10);
}

export function passwordMatches(given: string, expected: string): boolean {
  return safeEqual(given, expected);
}

export function createToken(secret: string, user: SessionUser, nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + SESSION_SECONDS;
  const payload = { u: user.u, n: user.n, r: user.r, o: user.o, v: user.v, k: user.k, i: nowMs, j: randomBytes(12).toString('base64url'), e: exp };
  const body = `v3.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  return `${body}.${sign(secret, body)}`;
}

export function verifyToken(secret: string, token: string | null, nowMs: number = Date.now()): SessionUser | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v3') return null;
  const body = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(sign(secret, body), parts[2])) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as SessionUser & { e: number };
    if (!Number.isFinite(p.e) || p.e * 1000 <= nowMs || typeof p.u !== 'string' || !Number.isFinite(p.i) || typeof p.j !== 'string') return null;
    return { u: p.u, n: String(p.n ?? ''), r: String(p.r ?? ''), o: p.o === true, v: p.v === true, k: String(p.k ?? ''), i: p.i, j: p.j, e: p.e };
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
    if (part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return null; // a damaged cookie is the same as no cookie
    }
  }
  return null;
}

const cookieFlags = `Path=/; HttpOnly; SameSite=Strict`;

export function sessionCookie(token: string, secure: boolean): string {
  return `${secure ? SECURE_COOKIE_NAME : COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieFlags}; Max-Age=${SESSION_SECONDS}${secure ? '; Secure' : ''}`;
}

/** Both names are cleared, so a cookie left over from before https was switched on cannot linger. */
export function clearCookie(secure: boolean): string[] {
  const out = [`${COOKIE_NAME}=; ${cookieFlags}; Max-Age=0`];
  if (secure) out.unshift(`${SECURE_COOKIE_NAME}=; ${cookieFlags}; Max-Age=0; Secure`);
  return out;
}

/** The sign-in cookie's value, whichever name it came under. */
export function tokenFromRequest(req: ApiRequest): string | null {
  return readCookie(req, SECURE_COOKIE_NAME) ?? readCookie(req, COOKIE_NAME);
}

/** The person signed in on this request, or null (no cookie, forged, expired, or cancelled on the server). */
export function readSession(req: ApiRequest, secret: string): SessionUser | null {
  const who = verifyToken(secret, tokenFromRequest(req));
  return who && !isRevoked(who) ? who : null;
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
  // Browsers also say, in a header pages cannot change, whether the request came from another website.
  const site = header(req, 'sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Blocked: this request came from another website.');
}
