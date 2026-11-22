/**
 * The owner's Security card: how well protected this installation is, the recent sign-in log, and "Sign out everyone".
 */
import type { SecurityCheck, SecurityReport } from '../../shared/types';
import { OWNER_PASSWORD_MIN_PUBLIC } from '../../shared/rules';
import { recentEvents } from '../auth/audit';
import { signOutEveryone } from '../auth/revocation';
import { clearCookie } from '../auth/session';
import { getConfig } from '../lib/env';
import { isHttps, trustedProxies, type ApiRequest } from '../lib/http';
import { audit, type Route } from './context';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function checks(req: ApiRequest): SecurityCheck[] {
  const cfg = getConfig();
  const out: SecurityCheck[] = [];

  const on = !!cfg.ownerTotpSecret;
  out.push({
    id: 'two-step',
    ok: on,
    title: 'Owner 2-step code',
    detail: on
      ? 'Signing in with the owner password also needs the 6-digit code from your authenticator app.'
      : 'Off. Anyone who learns the owner password gets full access. Switch it on with "npm run setup -- --2fa" (in a customer folder: "node setup.mjs --2fa"), then restart. Strongly recommended for web use.',
  });

  const https = isHttps(req);
  const thisComputer = trustedProxies() === 0 && LOOPBACK.has(req.ip ?? '');
  out.push({
    id: 'https',
    ok: https || thisComputer,
    title: 'Private connection',
    detail: https
      ? 'You are connected over https, so passwords and bookings cannot be read on the way.'
      : thisComputer
        ? 'The app is open on this computer only.'
        : 'This connection is not https. Passwords can be read on the network. Open the app through an https address (see "Use it from anywhere" in the README).',
  });

  const long = cfg.ownerPassword.length >= OWNER_PASSWORD_MIN_PUBLIC;
  out.push({
    id: 'owner-password',
    ok: long,
    title: 'Owner password length',
    detail: long ? `The owner password has ${cfg.ownerPassword.length} characters.` : `Only ${cfg.ownerPassword.length} characters. Use ${OWNER_PASSWORD_MIN_PUBLIC} or more (a few unrelated words) in OWNER_PASSWORD, then restart.`,
  });
  return out;
}

export const securityRoutes: Record<string, Route> = {
  security: {
    method: 'GET',
    auth: 'owner',
    run: ({ req }): SecurityReport => ({ checks: checks(req), events: recentEvents(100) }),
  },
  'sign-out-all': {
    method: 'POST',
    auth: 'owner',
    run: (ctx) => {
      audit(ctx, 'sign-out-all');
      signOutEveryone();
      ctx.res.setHeader('Set-Cookie', clearCookie(isHttps(ctx.req)));
      return { ok: true };
    },
  },
};
