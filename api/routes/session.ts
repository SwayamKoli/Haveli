/**
 * Who is signed in (session) and the sign-in itself (login).
 */
import type { SessionInfo } from '../../shared/types';
import {
  clearCookie,
  clearLoginFailures,
  createToken,
  loginBlocked,
  noteLoginFailure,
  ownerFingerprint,
  passwordMatches,
  readSession,
  sessionCookie,
  type SessionUser,
} from '../auth/session';
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
  if (loginBlocked(ip)) throw new HttpError(429, 'Too many wrong attempts. Wait 10 minutes and try again.');
  const body = readBody(req);
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase().slice(0, 40) : '';
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';

  let user: SessionUser | null = null;
  const ownerFp = ownerFingerprint(cfg.sessionSecret, cfg.ownerPassword);
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
  if (!user) {
    noteLoginFailure(ip);
    await sleep(500);
    throw new HttpError(401, 'The username or password is not right.');
  }
  clearLoginFailures(ip);
  res.setHeader('Set-Cookie', sessionCookie(createToken(cfg.sessionSecret, user), isHttps(req)));
  return { authenticated: true, configured: true, missing: [], mode: 'live', hotel: cfg.hotelName, staff: staffInfo(user), background: media.readBackground() };
}

export const sessionRoutes: Record<string, Route> = {
  session: { method: 'GET', auth: 'none', run: ({ req }) => sessionInfo(req) },
  login: { method: 'POST', auth: 'none', run: (ctx) => login(ctx) },
  logout: {
    method: 'POST',
    auth: 'none',
    run: ({ req, res }) => {
      res.setHeader('Set-Cookie', clearCookie(isHttps(req)));
      return { ok: true };
    },
  },
};
