/**
 * One request handler that answers every /api/<action> request.
 * The local server (server/) puts the action name in req.query.action.
 *
 *   GET  /api/session          who am I, and is the server set up?
 *   POST /api/login            password -> signed cookie
 *   POST /api/logout
 *   GET  /api/data             rooms, guests, bookings from the sheet
 *   POST /api/booking-create   new booking (and guest if new)
 *   POST /api/booking-stage    check in / check out / cancel / move back
 *   POST /api/booking-payment  record money received
 *   POST /api/room-status      available / cleaning / maintenance
 *   POST /api/room-create      add a room
 *   GET  /api/health           connection check shown in Settings
 */
import { configProblems, getConfig } from './_lib/env';
import { HttpError, clientIp, isHttps, readBody } from './_lib/http';
import type { ApiRequest, ApiResponse } from './_lib/http';
import { parseNewBooking, parseNewRoom, parsePayment, parseRoomStatus, parseStageInput } from './_lib/input';
import * as repo from './_lib/repo';
import {
  clearCookie,
  clearLoginFailures,
  createToken,
  hasSession,
  loginBlocked,
  noteLoginFailure,
  passwordMatches,
  requireSameOriginHeader,
  requireSession,
  sessionCookie,
} from './_lib/session';
import type { SessionInfo } from '../shared/types';

interface Route {
  method: 'GET' | 'POST';
  /** Needs a signed-in session. */
  auth: boolean;
  run: (req: ApiRequest, res: ApiResponse) => Promise<unknown> | unknown;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function sessionInfo(req: ApiRequest): SessionInfo {
  const problems = configProblems();
  if (problems.length) {
    return { authenticated: false, configured: false, missing: problems, mode: 'live', staff: null };
  }
  const cfg = getConfig();
  const ok = hasSession(req, cfg.sessionSecret);
  return {
    authenticated: ok,
    configured: true,
    missing: [],
    mode: 'live',
    staff: ok ? { name: cfg.staffName, role: cfg.staffRole } : null,
  };
}

const ROUTES: Record<string, Route> = {
  session: { method: 'GET', auth: false, run: (req) => sessionInfo(req) },

  login: {
    method: 'POST',
    auth: false,
    run: async (req, res) => {
      const cfg = getConfig();
      const ip = clientIp(req);
      if (loginBlocked(ip)) throw new HttpError(429, 'Too many wrong attempts. Wait 10 minutes and try again.');
      const given = readBody(req).password;
      if (typeof given !== 'string' || !passwordMatches(given, cfg.appPassword)) {
        noteLoginFailure(ip);
        await sleep(500);
        throw new HttpError(401, 'That password is not right.');
      }
      clearLoginFailures(ip);
      res.setHeader('Set-Cookie', sessionCookie(createToken(cfg.sessionSecret), isHttps(req)));
      return { authenticated: true, configured: true, missing: [], mode: 'live', staff: { name: cfg.staffName, role: cfg.staffRole } } satisfies SessionInfo;
    },
  },

  logout: {
    method: 'POST',
    auth: false,
    run: (req, res) => {
      res.setHeader('Set-Cookie', clearCookie(isHttps(req)));
      return { ok: true };
    },
  },

  data: { method: 'GET', auth: true, run: () => repo.loadBundle() },
  health: { method: 'GET', auth: true, run: () => repo.health() },

  'booking-create': { method: 'POST', auth: true, run: (req) => repo.createBooking(parseNewBooking(readBody(req))) },

  'booking-stage': {
    method: 'POST',
    auth: true,
    run: (req) => {
      const { id, to, restore } = parseStageInput(readBody(req));
      return repo.changeStage(id, to, restore);
    },
  },

  'booking-payment': {
    method: 'POST',
    auth: true,
    run: (req) => {
      const { id, amount } = parsePayment(readBody(req));
      return repo.collectPayment(id, amount);
    },
  },

  'room-status': {
    method: 'POST',
    auth: true,
    run: (req) => {
      const { no, status } = parseRoomStatus(readBody(req));
      return repo.changeRoomStatus(no, status);
    },
  },

  'room-create': { method: 'POST', auth: true, run: (req) => repo.addRoom(parseNewRoom(readBody(req))) },
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const raw = req.query.action;
    const action = Array.isArray(raw) ? raw[0] : (raw ?? '');
    const route = Object.prototype.hasOwnProperty.call(ROUTES, action) ? ROUTES[action] : undefined;
    if (!route) throw new HttpError(404, 'Not found.');
    if ((req.method ?? 'GET') !== route.method) {
      res.setHeader('Allow', route.method);
      throw new HttpError(405, 'Method not allowed.');
    }
    if (route.method === 'POST') requireSameOriginHeader(req);
    if (route.auth) requireSession(req, getConfig().sessionSecret);
    const out = await route.run(req, res);
    res.status(200).json(out);
  } catch (e) {
    if (e instanceof HttpError) {
      res.status(e.status).json({ error: e.message, ...(e.fields ? { fields: e.fields } : {}) });
      return;
    }
    console.error('Unhandled error', e);
    res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
  }
}
