/**
 * The single entry point for every /api/<action> request (the server puts the action name in req.query.action).
 * It finds the route (api/routes), checks the method, the anti-forgery header and who may call it, runs it,
 * and turns any error into a short message. The actions themselves are listed in api/routes/index.ts.
 */
import { requireSameOriginHeader, requireSession, type SessionUser } from './auth/session';
import { getConfig } from './lib/env';
import { HttpError, type ApiRequest, type ApiResponse } from './lib/http';
import { actor, stillAllowed } from './routes/context';
import { ROUTES } from './routes';

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
