/**
 * One request handler that answers every /api/<action> request.
 * The local server (server/) puts the action name in req.query.action.
 *
 *   GET  /api/session          who am I, and is the server set up?
 *   POST /api/login            username + password -> signed cookie
 *   POST /api/logout
 *   GET  /api/data             rooms, guests, bookings, payments from the sheet
 *   POST /api/booking-create   new booking (one or more rooms, optional discount)
 *   POST /api/booking-update   correct a booking that was saved wrongly
 *   POST /api/booking-stage    check in / check out / cancel / move back
 *   POST /api/booking-payment  record money received
 *   POST /api/room-status      available / cleaning / maintenance
 *   POST /api/room-create      add a room
 *   POST /api/sheet-link       link to the Google Sheet (needs the owner password)
 *   -- owner only --
 *   GET  /api/health           connection check shown in Settings
 *   GET  /api/staff-list       employees
 *   POST /api/staff-save       add an employee / change name, role, password, on-off
 *   POST /api/sheet-setup      add the tabs and columns the app needs (and give them the Clay & Sand look)
 *   POST /api/sheet-style      give every tab the Clay & Sand look again (colours only, no data is touched)
 *   POST /api/rooms-generate   add many rooms at once (floors x rooms per floor)
 *   POST /api/background-set     plain theme or the drawn hotel scene behind the website
 *   POST /api/background-upload  a photo or a short video behind the website (raw file as the body)
 */
import { configProblems, getConfig, hotelName } from './_lib/env';
import { HttpError, clientIp, isHttps, readBody } from './_lib/http';
import type { ApiRequest, ApiResponse } from './_lib/http';
import {
  parseEditBooking,
  parseNewBooking,
  parseNewRoom,
  parsePayment,
  parseRoomsGenerate,
  parseRoomStatus,
  parseStaffSave,
  parseStageInput,
} from './_lib/input';
import * as media from './_lib/media';
import * as repo from './_lib/repo';
import {
  clearCookie,
  clearLoginFailures,
  createToken,
  loginBlocked,
  noteLoginFailure,
  ownerFingerprint,
  passwordMatches,
  readSession,
  requireSameOriginHeader,
  requireSession,
  sessionCookie,
} from './_lib/session';
import type { SessionUser } from './_lib/session';
import type { SessionInfo, StaffInfo } from '../shared/types';

interface Ctx {
  req: ApiRequest;
  res: ApiResponse;
  /** The signed-in person (null on routes that do not need one). */
  who: SessionUser;
  /** How this person is named in the sheet's "Created by" / "Received by" columns. */
  by: string;
}

interface Route {
  method: 'GET' | 'POST';
  auth: 'none' | 'user' | 'owner';
  run: (ctx: Ctx) => Promise<unknown> | unknown;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const staffInfo = (u: SessionUser): StaffInfo => ({ username: u.u, name: u.n, role: u.r, owner: u.o, viaOwner: u.v });
const actor = (u: SessionUser) => (u.v ? `${u.n} (via owner)` : u.n);

/** Owner accounts never change; employees must still exist, be switched on, and have the same password as when they signed in. */
async function stillAllowed(who: SessionUser): Promise<boolean> {
  if (who.o || who.v) {
    // Signed in with the owner password: changing that password signs these sessions out.
    const cfg = getConfig();
    if (who.k !== ownerFingerprint(cfg.sessionSecret, cfg.ownerPassword)) return false;
  }
  if (who.o) return true;
  return repo.employeeStillValid(who.u, who.k, who.v);
}

async function sessionInfo(req: ApiRequest): Promise<SessionInfo> {
  const problems = configProblems();
  if (problems.length) {
    return { authenticated: false, configured: false, missing: problems, mode: 'live', hotel: hotelName(), staff: null, background: media.readBackground() };
  }
  const cfg = getConfig();
  let who = readSession(req, cfg.sessionSecret);
  if (who && !(await stillAllowed(who))) who = null;
  return { authenticated: !!who, configured: true, missing: [], mode: 'live', hotel: cfg.hotelName, staff: who ? staffInfo(who) : null, background: media.readBackground() };
}

async function login(ctx: { req: ApiRequest; res: ApiResponse }): Promise<SessionInfo> {
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

const ROUTES: Record<string, Route> = {
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
  data: { method: 'GET', auth: 'user', run: () => repo.loadBundle() },
  'booking-create': { method: 'POST', auth: 'user', run: ({ req, by }) => repo.createBooking(parseNewBooking(readBody(req)), by) },
  'booking-update': { method: 'POST', auth: 'user', run: ({ req, by }) => repo.updateBooking(parseEditBooking(readBody(req)), by) },
  'booking-stage': {
    method: 'POST',
    auth: 'user',
    run: ({ req, by }) => {
      const { id, to, restore } = parseStageInput(readBody(req));
      return repo.changeStage(id, to, restore, by);
    },
  },
  'booking-payment': {
    method: 'POST',
    auth: 'user',
    run: ({ req, by }) => {
      const { id, amount, method, note } = parsePayment(readBody(req));
      return repo.collectPayment(id, amount, method, note, by);
    },
  },
  'room-status': {
    method: 'POST',
    auth: 'user',
    run: ({ req }) => {
      const { no, status } = parseRoomStatus(readBody(req));
      return repo.changeRoomStatus(no, status);
    },
  },
  'room-create': { method: 'POST', auth: 'user', run: ({ req }) => repo.addRoom(parseNewRoom(readBody(req))) },
  'sheet-link': {
    method: 'POST',
    auth: 'user',
    run: async ({ req }) => {
      const cfg = getConfig();
      const bucket = `sheet:${clientIp(req)}`;
      if (loginBlocked(bucket)) throw new HttpError(429, 'Too many wrong attempts. Wait 10 minutes and try again.');
      const given = readBody(req).password;
      if (typeof given !== 'string' || !passwordMatches(given, cfg.ownerPassword)) {
        noteLoginFailure(bucket);
        await sleep(500);
        throw new HttpError(401, 'That is not the owner password.');
      }
      clearLoginFailures(bucket);
      return { url: repo.sheetUrl() };
    },
  },
  health: { method: 'GET', auth: 'owner', run: () => repo.health() },
  'staff-list': { method: 'GET', auth: 'owner', run: async () => ({ staff: await repo.listStaff() }) },
  'staff-save': {
    method: 'POST',
    auth: 'owner',
    run: async ({ req, by }) => ({ staff: await repo.saveStaff(parseStaffSave(readBody(req)), by) }),
  },
  'sheet-setup': { method: 'POST', auth: 'owner', run: () => repo.setupSheet() },
  'sheet-style': { method: 'POST', auth: 'owner', run: () => repo.styleSheet() },
  'background-set': {
    method: 'POST',
    auth: 'owner',
    run: ({ req }) => {
      const kind = readBody(req).kind;
      if (kind !== 'none' && kind !== 'scene') throw new HttpError(400, 'Choose the plain theme or the hotel scene. Photos and videos are uploaded.');
      return { background: media.setSimpleBackground(kind) };
    },
  },
  'background-upload': {
    method: 'POST',
    auth: 'owner',
    run: async ({ req }) => {
      const q = req.query.kind;
      const kind = Array.isArray(q) ? q[0] : (q ?? '');
      return { background: await media.saveUpload(kind, req.raw ?? Buffer.alloc(0)) };
    },
  },
  'rooms-generate': { method: 'POST', auth: 'owner', run: ({ req }) => repo.generateRooms(parseRoomsGenerate(readBody(req))) },
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

    let who: SessionUser = { u: '', n: '', r: '', o: false, v: false, k: '' };
    if (route.auth !== 'none') {
      who = requireSession(req, getConfig().sessionSecret);
      if (!(await stillAllowed(who))) throw new HttpError(401, 'Please sign in again.');
      if (route.auth === 'owner' && !who.o) throw new HttpError(403, 'Only the owner can do this.');
    }
    const out = await route.run({ req, res, who, by: actor(who) });
    res.status(200).json(out);
  } catch (e) {
    if (e instanceof HttpError) {
      res.status(e.status).json({ error: e.message, ...(e.fields ? { fields: e.fields } : {}), ...(e.code ? { code: e.code } : {}) });
      return;
    }
    console.error('Unhandled error', e);
    res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
  }
}
