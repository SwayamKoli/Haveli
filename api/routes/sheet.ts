/**
 * The Google Sheet itself: the link (needs the owner password), the connection check and the one-click setup.
 */
import { clearLoginFailures, loginBlocked, noteLoginFailure, passwordMatches } from '../auth/session';
import { getConfig } from '../lib/env';
import { clientIp, HttpError, readBody } from '../lib/http';
import * as repo from '../sheets';
import { sleep, type Route } from './context';

export const sheetRoutes: Record<string, Route> = {
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
  'sheet-setup': { method: 'POST', auth: 'owner', run: () => repo.setupSheet() },
};
