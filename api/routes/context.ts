/**
 * What every route receives, and who is allowed to do what.
 */
import type { StaffInfo } from '../../shared/types';
import { ownerFingerprint, type SessionUser } from '../auth/session';
import type { SecurityEventType } from '../../shared/types';
import { record } from '../auth/audit';
import { getConfig } from '../lib/env';
import { clientIp, type ApiRequest, type ApiResponse } from '../lib/http';
import * as repo from '../sheets';

export interface Ctx {
  req: ApiRequest;
  res: ApiResponse;
  /** The signed-in person (null on routes that do not need one). */
  who: SessionUser;
  /** How this person is named in the sheet's "Created by" / "Received by" columns. */
  by: string;
}

export interface Route {
  method: 'GET' | 'POST';
  auth: 'none' | 'user' | 'owner';
  run: (ctx: Ctx) => Promise<unknown> | unknown;
}

/** Writes a line in the security log for what the signed-in person just did. */
export const audit = (ctx: Ctx, type: SecurityEventType, detail = ''): void => record(type, ctx.who.u, clientIp(ctx.req), detail);

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const staffInfo = (u: SessionUser): StaffInfo => ({ username: u.u, name: u.n, role: u.r, owner: u.o, viaOwner: u.v });

export const actor = (u: SessionUser) => (u.v ? `${u.n} (via owner)` : u.n);

/** Owner accounts never change; employees must still exist, be switched on, and have the same password as when they signed in. */
export async function stillAllowed(who: SessionUser): Promise<boolean> {
  if (who.o || who.v) {
    // Signed in with the owner password: changing that password signs these sessions out.
    const cfg = getConfig();
    if (who.k !== ownerFingerprint(cfg.sessionSecret, cfg.ownerPassword, cfg.ownerTotpSecret)) return false;
  }
  if (who.o) return true;
  return repo.employeeStillValid(who.u, who.k, who.v);
}
