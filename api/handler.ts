/**
 * The single entry point for every /api/<action> request (the server puts the action name in req.query.action).
 * authorize() finds the route (api/routes), checks the request ceiling, the method, the anti-forgery header and who may
 * call it; handler() then runs it and turns any error into a short message. The actions are listed in api/routes/index.ts.
 */
import { apiAllowed } from './auth/throttle';
import { requireSameOriginHeader, requireSession, type SessionUser } from './auth/session';
import { getConfig } from './lib/env';
import { clientIp, HttpError, type ApiRequest, type ApiResponse } from './lib/http';
import { actor, stillAllowed, type Route } from './routes/context';
import { ROUTES } from './routes';

/**
 * Everything that must be true before a request is read or run. The server also calls this before accepting an
 * upload, so a stranger cannot make it receive 20 MB just to be told no.
 */
export async function authorize(req: ApiRequest, res?: ApiResponse): Promise<{ route: Route; who: SessionUser }> {
  const raw = req.query.action;
  const action = Array.isArray(raw) ? raw[0] : (raw ?? '');
  const route = Object.prototype.hasOwnProperty.call(ROUTES, action) ? ROUTES[action] : undefined;
  if (!route) throw new HttpError(404, 'Not found.');
  if (!apiAllowed(clientIp(req))) throw new HttpError(429, 'Too many requests. Wait a minute and try again.');
  if ((req.method ?? 'GET') !== route.method) {
    res?.setHeader('Allow', route.method);
    throw new HttpError(405, 'Method not allowed.');
  }
  if (route.method === 'POST') requireSameOriginHeader(req);

  let who: SessionUser = { u: '', n: '', r: '', o: false, v: false, k: '' };
  if (route.auth !== 'none') {
    who = requireSession(req, getConfig().sessionSecret);
    if (!(await stillAllowed(who))) throw new HttpError(401, 'Please sign in again.');
    if (route.auth === 'owner' && !who.o) throw new HttpError(403, 'Only the owner can do this.');
  }
  return { route, who };
}

/** Answers with the error's short message. Anything unexpected becomes a generic message, never a stack trace. */
export function respondError(res: ApiResponse, e: unknown): void {
  if (e instanceof HttpError) {
    res.status(e.status).json({ error: e.message, ...(e.fields ? { fields: e.fields } : {}), ...(e.code ? { code: e.code } : {}) });
    return;
  }
  console.error('Unhandled error', e);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const { route, who } = await authorize(req, res);
    const out = await route.run({ req, res, who, by: actor(who) });
    res.status(200).json(out);
  } catch (e) {
    respondError(res, e);
  }
}
