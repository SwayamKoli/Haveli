/**
 * Who is signed in (session) and the sign-in itself (login).
 */
import type { SessionInfo } from '../../shared/types';
import { record } from '../auth/audit';
import {
  clearCookie,
  createToken,
  ownerFingerprint,
  passwordMatches,
  readSession,
  sessionCookie,
  tokenFromRequest,
  verifyToken,
  type SessionUser,
} from '../auth/session';
import { revokeToken } from '../auth/revocation';
import {
  accountDelay,
  clearAccountFailures,
  easeLoginFailures,
  loginBlocked,
  noteAccountFailure,
  noteLoginFailure,
  serialized,
} from '../auth/throttle';
import { checkOwnerCode } from '../auth/totp';
import { configProblems, getConfig, hotelName } from '../lib/env';
import { clientIp, HttpError, isHttps, readBody, type ApiRequest, type ApiResponse } from '../lib/http';
import * as media from '../media/media';
import * as repo from '../sheets';
import { sleep, staffInfo, stillAllowed, type Route } from './context';

export async function sessionInfo(req: ApiRequest): Promise<SessionInfo> {
  const problems = configProblems();
  if (problems.length) {
    return { authenticated: false, configured: false, missing: problems, mode: 'live', hotel: hotelName(), staff: null, background: media.readBackground() };
  }
  const cfg = getConfig();
  let who = readSession(req, cfg.sessionSecret);
  if (who && !(await stillAllowed(who))) who = null;
  return { authenticated: !!who, configured: true, missing: [], mode: 'live', hotel: cfg.hotelName, staff: who ? staffInfo(who) : null, background: media.readBackground() };
}

export async function login(ctx: { req: ApiRequest; res: ApiResponse }): Promise<SessionInfo> {
  const { req, res } = ctx;
  const cfg = getConfig();
  const ip = clientIp(req);
  if (loginBlocked(ip)) {
    record('login-blocked', '', ip);
    throw new HttpError(429, 'Too many wrong attempts. Wait 10 minutes and try again.');
  }
  const body = readBody(req);
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase().slice(0, 40) : '';
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
  const code = typeof body.code === 'string' ? body.code.slice(0, 12) : '';

  // Guesses at one username are checked one at a time, and answers slow down after a few wrong ones,
  // however many different addresses they come from.
  return serialized(username || '-', async () => {
    const wait = accountDelay(username || '-');
    if (wait) await sleep(wait);

    const fail = async (type: 'login-failed' | 'code-failed', message: string, why?: string): Promise<never> => {
      noteLoginFailure(ip);
      noteAccountFailure(username || '-');
      record(type, username, ip, why);
      await sleep(500);
      throw new HttpError(401, message, undefined, type === 'code-failed' ? 'CODE_REQUIRED' : undefined);
    };

    let user: SessionUser | null = null;
    const ownerFp = ownerFingerprint(cfg.sessionSecret, cfg.ownerPassword, cfg.ownerTotpSecret);
    if (username && password) {
      if (passwordMatches(password, cfg.ownerPassword)) {
        // The owner's password opens the owner account and every employee's account.
        if (username === cfg.ownerUsername) user = { u: cfg.ownerUsername, n: cfg.ownerName, r: 'Owner', o: true, v: false, k: ownerFp };
        else {
          const emp = await repo.findActiveEmployee(username);
          if (emp) user = { u: emp.username, n: emp.name, r: emp.role, o: false, v: true, k: ownerFp };
        }
      } else if (username !== cfg.ownerUsername) {
        const emp = await repo.verifyEmployee(username, password);
        if (emp) user = { u: emp.username, n: emp.name, r: emp.role, o: false, v: false, k: emp.fp };
      }
    }
    if (!user) return fail('login-failed', 'The username or password is not right.');

    // With the 2-step code switched on, the owner password alone is not enough, for the owner account or any other.
    if ((user.o || user.v) && cfg.ownerTotpSecret) {
      if (!code) throw new HttpError(401, 'Enter the 6-digit code from your authenticator app.', undefined, 'CODE_REQUIRED');
      if (!checkOwnerCode(cfg.ownerTotpSecret, code)) return fail('code-failed', 'That code is not right or has expired. Wait for the next one and try again.', user.v ? 'via owner' : '');
    }

    easeLoginFailures(ip);
    clearAccountFailures(username);
    record('login', user.u, ip, user.v ? 'via owner password' : user.o ? 'owner' : '');
    res.setHeader('Set-Cookie', sessionCookie(createToken(cfg.sessionSecret, user), isHttps(req)));
    return { authenticated: true, configured: true, missing: [], mode: 'live', hotel: cfg.hotelName, staff: staffInfo(user), background: media.readBackground() } satisfies SessionInfo;
  });
}

export const sessionRoutes: Record<string, Route> = {
  session: { method: 'GET', auth: 'none', run: ({ req }) => sessionInfo(req) },
  login: { method: 'POST', auth: 'none', run: (ctx) => login(ctx) },
  logout: {
    method: 'POST',
    auth: 'none',
    run: ({ req, res }) => {
      // Cancel this sign-in on the server too, so a copy of the cookie stops working.
      if (configProblems().length === 0) {
        const who = verifyToken(getConfig().sessionSecret, tokenFromRequest(req));
        if (who?.j && who.e) {
          revokeToken(who.j, who.e * 1000);
          record('logout', who.u, clientIp(req));
        }
      }
      res.setHeader('Set-Cookie', clearCookie(isHttps(req)));
      return { ok: true };
    },
  },
};
