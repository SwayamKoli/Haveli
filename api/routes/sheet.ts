/**
 * The Google Sheet itself: the link (needs the owner password), the connection check and the one-click setup.
 */
import { record } from '../auth/audit';
import { passwordMatches } from '../auth/session';
import { clearLoginFailures, loginBlocked, noteLoginFailure } from '../auth/throttle';
import { getConfig } from '../lib/env';
import { clientIp, HttpError, readBody } from '../lib/http';
import * as repo from '../sheets';
import { audit, sleep, type Route } from './context';

export const sheetRoutes: Record<string, Route> = {
  'sheet-link': {
    method: 'POST',
    auth: 'user',
    run: async (ctx) => {
      const { req, who } = ctx;
      const cfg = getConfig();
      // With the 2-step code on, only sign-ins that already passed it (the owner, or someone in with the owner password) may ask.
      if (cfg.ownerTotpSecret && !who.o && !who.v) throw new HttpError(403, 'Only the owner can open the Google Sheet.');
      const bucket = `sheet:${clientIp(req)}`;
      if (loginBlocked(bucket)) throw new HttpError(429, 'Too many wrong attempts. Wait 10 minutes and try again.');
      const given = readBody(req).password;
      if (typeof given !== 'string' || !passwordMatches(given, cfg.ownerPassword)) {
        noteLoginFailure(bucket);
        record('sheet-link-failed', who.u, clientIp(req));
        await sleep(500);
        throw new HttpError(401, 'That is not the owner password.');
      }
      clearLoginFailures(bucket);
      audit(ctx, 'sheet-link');
      return { url: repo.sheetUrl() };
    },
  },
  health: { method: 'GET', auth: 'owner', run: () => repo.health() },
  'sheet-setup': {
    method: 'POST',
    auth: 'owner',
    run: async (ctx) => {
      const r = await repo.setupSheet();
      audit(ctx, 'sheet-setup');
      return r;
    },
  },
};
